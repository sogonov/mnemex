#!/usr/bin/env node
// run-retrieval-graph.mjs — isolate the typed-graph effect with a 4-arm ablation.
//
// The naive "arm A vs arm C" comparison is CONFOUNDED: arm C also swaps qmd's
// RRF-position-blend ordering for a pure cross-encoder pass, applied only when the
// graph fires. So a lift could be the extra rerank, not the graph. This runner
// isolates it:
//
//   A  qmd hybrid order (store.search)                     — the product baseline
//   B  pure cross-encoder rerank of the SEEDS only          — no graph
//   C  pure cross-encoder rerank of SEEDS ∪ graph-neighbors  — B + graph
//   D  pure cross-encoder rerank of EVERY page (ceiling)     — "just consider all"
//
//   A→B = the ranking-function switch.  B→C = the graph's MARGINAL effect (the only
//   delta attributable to the graph).   C vs D = does the graph beat brute-force
//   "rerank everything" (on a tiny corpus, D is near-perfect and C→D≈0 means the
//   graph adds nothing a full rerank wouldn't).
//
// Held-out cross-source is split edged/un-edged (does an edge actually bridge the
// gold pair?) — only UN-EDGED recall tests generalization; edged is circular by
// construction (same author wrote the edges and the queries).
//
// Usage: node eval/run-retrieval-graph.mjs [--collection mnemex-wiki]
//   [--wiki-root eval/.wiki/wiki] [--fixture eval/fixture-retrieval.json] [--seed-k 12]

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scoreQuery, mean } from "./metrics.mjs";
import { pairedPermutationTest } from "./stats.mjs";
import { buildPageIndex, expand } from "./graph-expand.mjs";

// Prefer the installed package name; fall back to the known global path (dev-only script).
let createStore;
try { ({ createStore } = await import("@tobilu/qmd")); }
catch { ({ createStore } = await import("/opt/homebrew/lib/node_modules/@tobilu/qmd/dist/index.js")); }

const evalDir = dirname(fileURLToPath(import.meta.url));
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const collection = arg("--collection", "mnemex-wiki");
const wikiRoot = arg("--wiki-root", join(evalDir, ".wiki", "wiki"));
const fixturePath = arg("--fixture", join(evalDir, "fixture-retrieval.json"));
const SEED_K = parseInt(arg("--seed-k", "12"), 10);
const K = 10;
const Cl = { g: "\x1b[0;32m", y: "\x1b[1;33m", r: "\x1b[0;31m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" };

const norm = (p) => (p || "").replace(/^qmd:\/\/[^/]+\//, "").replace(/^\.?\//, "");
const stripFm = (t) => t.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
const bodyOf = (rel) => { const p = join(wikiRoot, rel); return existsSync(p) ? stripFm(readFileSync(p, "utf8")).slice(0, 1600) : ""; };

const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const pageIndex = buildPageIndex(wikiRoot);
const allPages = [...pageIndex.values()].filter((p) => /\.md$/.test(p)).map((rel) => ({ file: rel, text: bodyOf(rel) || rel }));

// Does a typed edge bridge the two gold pages (either direction)? → "edged" (circular).
function isEdged(expected) {
  if (!expected || expected.length < 2) return null;
  const [a, b] = expected;
  const na = expand(a, wikiRoot, { index: pageIndex }).map((n) => n.target);
  const nb = expand(b, wikiRoot, { index: pageIndex }).map((n) => n.target);
  return na.includes(b) || nb.includes(a);
}

console.error(`${Cl.b}run-retrieval-graph${Cl.x} collection=${collection} seed-k=${SEED_K} — ${fixture.queries.length} queries, ${pageIndex.size} pages`);
const store = await createStore({ dbPath: process.env.HOME + "/.cache/qmd/index.sqlite" });
if (typeof store.internal?.rerank !== "function") {
  console.error(`${Cl.r}FATAL${Cl.x}: store.internal.rerank unavailable in this qmd build — arms B/C/D need it. Aborting.`);
  await store.close(); process.exit(3);
}
const rerankTo = async (query, docs) => (await store.internal.rerank(query, docs)).map((r) => norm(r.file));

const rows = [];
for (let i = 0; i < fixture.queries.length; i++) {
  const q = fixture.queries[i];
  process.stderr.write(`  [${i + 1}/${fixture.queries.length}] ${q.id}                    \r`);
  const hits = await store.search({ query: q.q, collections: [collection], limit: SEED_K });
  const seeds = hits.map((h) => ({ rel: norm(h.file), text: h.bestChunk || stripFm(h.body || "") }));
  const seedDocs = seeds.map((s) => ({ file: s.rel, text: s.text || s.rel }));
  const topScore = hits.length ? hits[0].score : 0;

  // union = seeds ∪ graph neighbors (from the top few seeds)
  const union = new Map(seedDocs.map((d) => [d.file, d.text]));
  for (const s of seeds.slice(0, 4))
    for (const n of expand(s.rel, wikiRoot, { index: pageIndex }))
      if (!union.has(n.target)) union.set(n.target, bodyOf(n.target) || n.target);
  const unionDocs = [...union].map(([file, text]) => ({ file, text }));

  const isNA = q.bucket === "no-answer" || !q.expected_files || q.expected_files.length === 0;
  if (isNA) { rows.push({ id: q.id, bucket: q.bucket, noAnswer: true, abstained: hits.length === 0 || topScore < 0.5 }); continue; }

  const rel = new Set(q.expected_files);
  const armA = seeds.map((s) => s.rel);
  const armB = seedDocs.length ? await rerankTo(q.q, seedDocs) : [];
  const armC = unionDocs.length ? await rerankTo(q.q, unionDocs) : [];
  const armD = await rerankTo(q.q, allPages);
  rows.push({
    id: q.id, bucket: q.bucket, split: q.split || "dev", edged: isEdged(q.expected_files),
    grew: union.size - seeds.length,
    A: scoreQuery(armA, rel, { k: K }), B: scoreQuery(armB, rel, { k: K }),
    C: scoreQuery(armC, rel, { k: K }), D: scoreQuery(armD, rel, { k: K }),
  });
}
process.stderr.write("\n");
await store.close();

// ---- report ----
const ans = rows.filter((r) => !r.noAnswer);
const pct = (v) => (v == null ? " n/a " : (v * 100).toFixed(1).padStart(5));
const agg = (rs, arm) => mean(rs.map((r) => r[arm].ndcg));

console.log(`\n${Cl.b}4-arm ablation — nDCG@${K}${Cl.x}  ${Cl.d}A=qmd hybrid · B=rerank(seeds) · C=rerank(seeds+graph) · D=rerank(all)${Cl.x}\n`);
console.log(`  ${"bucket".padEnd(20)} ${"n".padStart(2)}    A     B     C     D    ${Cl.d}(B→C = graph's marginal effect)${Cl.x}`);
console.log(`  ${"-".repeat(60)}`);
for (const bk of [...new Set(ans.map((r) => r.bucket))]) {
  const rs = ans.filter((r) => r.bucket === bk);
  console.log(`  ${bk.padEnd(20)} ${String(rs.length).padStart(2)}   ${pct(agg(rs, "A"))} ${pct(agg(rs, "B"))} ${pct(agg(rs, "C"))} ${pct(agg(rs, "D"))}`);
}

// held-out cross-source, split edged vs un-edged; permutation on B→C (isolates the graph)
const hold = ans.filter((r) => r.bucket === "cross-source" && r.split === "holdout");
for (const [name, rs] of [["EDGED (circular)", hold.filter((r) => r.edged)], ["UN-EDGED (generalization)", hold.filter((r) => !r.edged)]]) {
  if (!rs.length) continue;
  const b = rs.map((r) => r.B.ndcg), c = rs.map((r) => r.C.ndcg);
  const perm = pairedPermutationTest(c, b, { seed: 1 });
  console.log(`\n  ${Cl.b}held-out cross-source · ${name} (n=${rs.length})${Cl.x}`);
  console.log(`    B rerank(seeds) nDCG ${pct(mean(b))}  →  C +graph nDCG ${pct(mean(c))}   Δ ${((mean(c) - mean(b)) * 100).toFixed(1)} pts   B→C permutation p=${perm.p.toFixed(4)}`);
}
const na = rows.filter((r) => r.noAnswer);
if (na.length) console.log(`\n  no-answer abstention: ${na.filter((r) => r.abstained).length}/${na.length}`);
console.log(`  ${Cl.d}Note: |corpus|=${allPages.length} pages. With k=${K} ≥ corpus, arm D (rerank-all) is a near-ceiling and recall is degenerate — this eval measures DIRECTION only, not a shippable lift.${Cl.x}`);
