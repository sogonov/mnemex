#!/usr/bin/env node
// run-retrieval-graph.mjs — arm A (plain hybrid) vs arm C (typed-graph expansion
// + cross-encoder union rerank), PAIRED on the same queries, in one qmd process.
//
// Arm A: store.search() — qmd's hybrid BM25+vector+RRF+rerank (the baseline).
// Arm C: seeds = arm A → walk the typed wikilink graph (graph-expand.mjs) →
//        union(seeds, neighbors) → store.internal.rerank(query, union) → rank.
//
// The cross-encoder over the union is the guardrail that keeps graph expansion
// from dumping unranked neighbors. Paired permutation test (stats.mjs) on the
// held-out cross-source bucket says whether C actually beats A.
//
// Usage: node eval/run-retrieval-graph.mjs [--collection mnemex-wiki]
//   [--wiki-root eval/.wiki/wiki] [--fixture eval/fixture-retrieval.json]
//   [--seed-k 8] [--na-threshold 0.5]

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createStore } from "/opt/homebrew/lib/node_modules/@tobilu/qmd/dist/index.js";
import { scoreQuery, mean } from "./metrics.mjs";
import { pairedPermutationTest, bootstrapCI } from "./stats.mjs";
import { buildPageIndex, expand } from "./graph-expand.mjs";

const evalDir = dirname(fileURLToPath(import.meta.url));
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const collection = arg("--collection", "mnemex-wiki");
const wikiRoot = arg("--wiki-root", join(evalDir, ".wiki", "wiki"));
const fixturePath = arg("--fixture", join(evalDir, "fixture-retrieval.json"));
const SEED_K = parseInt(arg("--seed-k", "8"), 10);
const naThreshold = parseFloat(arg("--na-threshold", "0.5"));
const MAX_UNION = 12;
const C = { g: "\x1b[0;32m", y: "\x1b[1;33m", r: "\x1b[0;31m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" };

const norm = (p) => (p || "").replace(/^qmd:\/\/[^/]+\//, "").replace(/^\.?\//, "");
const stripFm = (t) => t.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
const bodyOf = (rel) => { const p = join(wikiRoot, rel); return existsSync(p) ? stripFm(readFileSync(p, "utf8")).slice(0, 1600) : ""; };

const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const pageIndex = buildPageIndex(wikiRoot);

console.error(`${C.b}run-retrieval-graph${C.x} collection=${collection} seeds=${SEED_K} — ${fixture.queries.length} queries, ${pageIndex.size} pages`);
const store = await createStore({ dbPath: process.env.HOME + "/.cache/qmd/index.sqlite" });

const rows = [];
for (let i = 0; i < fixture.queries.length; i++) {
  const q = fixture.queries[i];
  process.stderr.write(`  [${i + 1}/${fixture.queries.length}] ${q.id}                 \r`);
  const hits = await store.search({ query: q.q, collections: [collection], limit: SEED_K });
  const seeds = hits.map((h) => ({ rel: norm(h.file), text: h.bestChunk || stripFm(h.body || ""), score: h.score }));
  const seedRels = seeds.map((s) => s.rel);
  const topScore = seeds.length ? seeds[0].score : 0;

  // arm C: expand top seeds, build union, cross-encoder rerank
  const union = new Map();
  for (const s of seeds) union.set(s.rel, s.text);
  for (const s of seeds.slice(0, 4)) {
    for (const n of expand(s.rel, wikiRoot, { index: pageIndex })) {
      if (!union.has(n.target) && union.size < MAX_UNION) union.set(n.target, bodyOf(n.target));
    }
  }
  let armC = seedRels;
  if (union.size > seeds.length && seeds.length > 0) {
    const docs = [...union].map(([file, text]) => ({ file, text: text || file }));
    const reranked = await store.internal.rerank(q.q, docs);
    armC = reranked.map((r) => norm(r.file));
  }

  const isNA = q.bucket === "no-answer" || !q.expected_files || q.expected_files.length === 0;
  if (isNA) {
    rows.push({ id: q.id, bucket: q.bucket, split: q.split, noAnswer: true, topScore, abstained: seeds.length === 0 || topScore < naThreshold });
  } else {
    const rel = new Set(q.expected_files);
    rows.push({
      id: q.id, bucket: q.bucket, split: q.split || "dev",
      A: scoreQuery(seedRels, rel, { k: 10 }), C: scoreQuery(armC, rel, { k: 10 }),
      grew: union.size - seeds.length,
    });
  }
}
process.stderr.write("\n");
await store.close();

// ---- report ----
const ans = rows.filter((r) => !r.noAnswer);
const buckets = [...new Set(ans.map((r) => r.bucket))];
const pct = (v) => (v == null ? " n/a " : (v * 100).toFixed(1).padStart(5));
const aggBucket = (rows, arm, key) => mean(rows.map((r) => r[arm][key]));

console.log(`\n${C.b}Arm A (plain hybrid) vs Arm C (typed-graph + union rerank)${C.x}  ${C.d}collection ${collection}${C.x}\n`);
console.log(`  ${"bucket".padEnd(20)} ${"n".padStart(2)}   ${"nDCG@10 A→C".padEnd(14)} ${"R@10 A→C".padEnd(12)} ${"MRR A→C"}`);
console.log(`  ${"-".repeat(64)}`);
for (const bk of buckets) {
  const rs = ans.filter((r) => r.bucket === bk);
  const aN = aggBucket(rs, "A", "ndcg"), cN = aggBucket(rs, "C", "ndcg");
  const aR = aggBucket(rs, "A", "recall_at_10"), cR = aggBucket(rs, "C", "recall_at_10");
  const aM = aggBucket(rs, "A", "mrr"), cM = aggBucket(rs, "C", "mrr");
  const arrow = cN > aN + 1e-9 ? `${C.g}↑${C.x}` : cN < aN - 1e-9 ? `${C.r}↓${C.x}` : "=";
  console.log(`  ${bk.padEnd(20)} ${String(rs.length).padStart(2)}   ${pct(aN)}→${pct(cN)} ${arrow}  ${pct(aR)}→${pct(cR)}   ${pct(aM)}→${pct(cM)}`);
}

// held-out cross-source: the honest headline + significance
const holdCS = ans.filter((r) => r.bucket === "cross-source" && r.split === "holdout");
if (holdCS.length) {
  const aN = holdCS.map((r) => r.A.ndcg), cN = holdCS.map((r) => r.C.ndcg);
  const perm = pairedPermutationTest(cN, aN, { seed: 1 });
  const ciA = bootstrapCI(aN), ciC = bootstrapCI(cN);
  console.log(`\n  ${C.b}HELD-OUT cross-source (n=${holdCS.length}) — the honest test${C.x}`);
  console.log(`    arm A nDCG@10 ${pct(mean(aN))}  CI[${pct(ciA.lo)},${pct(ciA.hi)}]`);
  console.log(`    arm C nDCG@10 ${pct(mean(cN))}  CI[${pct(ciC.lo)},${pct(ciC.hi)}]`);
  console.log(`    Δ = ${((mean(cN) - mean(aN)) * 100).toFixed(1)} pts   paired permutation p = ${perm.p.toFixed(4)}  ${C.d}(n=${perm.n})${C.x}`);
}
const naRows = rows.filter((r) => r.noAnswer);
if (naRows.length) console.log(`\n  no-answer abstention (arm C safe?): ${naRows.filter((r) => r.abstained).length}/${naRows.length}`);
