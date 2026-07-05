#!/usr/bin/env node
// run-retrieval.mjs — query-driven, credibility-grade retrieval eval for ONE arm.
//
// Drives `qmd query --json` per fixture query, computes rank-aware metrics
// (nDCG@10 / Recall@5,10 / MRR / MAP) per stratified bucket, with a bootstrap
// 95% CI on the headline. no-answer queries are scored as abstention (top score
// below threshold). Writes a per-query dump so two arms can be compared with a
// paired permutation test (stats.mjs) later.
//
// Usage:
//   node eval/run-retrieval.mjs [--collection mnemex-wiki] [--label A-plain]
//     [--fixture eval/fixture-retrieval.json] [--n 10] [--split dev|holdout|all]
//     [--na-threshold 0.5] [--out eval/results-<label>.json]

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scoreQuery, mean } from "./metrics.mjs";
import { bootstrapCI } from "./stats.mjs";

const evalDir = dirname(fileURLToPath(import.meta.url));
const arg = (flag, def) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : def; };
const collection = arg("--collection", "mnemex-wiki");
const label = arg("--label", collection);
const fixturePath = arg("--fixture", join(evalDir, "fixture-retrieval.json"));
const N = parseInt(arg("--n", "10"), 10);
const split = arg("--split", "all");
const naThreshold = parseFloat(arg("--na-threshold", "0.5"));
const outPath = arg("--out", null);
const EMBED = process.env.QMD_EMBED_MODEL || "hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf";

const C = { g: "\x1b[0;32m", y: "\x1b[1;33m", r: "\x1b[0;31m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" };

// Strip qmd://<collection>/ so result paths compare to fixture expected_files.
const norm = (p) => p.replace(/^qmd:\/\/[^/]+\//, "").replace(/^\.?\//, "");

function qmdQuery(q) {
  const r = spawnSync("qmd", ["query", q, "-c", collection, "-n", String(N), "--json"], {
    encoding: "utf8", env: { ...process.env, QMD_EMBED_MODEL: EMBED }, maxBuffer: 1 << 24,
  });
  // qmd can crash on llama.cpp teardown AFTER printing valid JSON — parse stdout regardless of exit code.
  const out = (r.stdout || "").trim();
  if (!out) return { ranked: [], scores: [], error: (r.stderr || "no stdout").split("\n")[0] };
  try {
    const arr = JSON.parse(out);
    const list = Array.isArray(arr) ? arr : arr.results || [];
    return { ranked: list.map((h) => norm(h.file || h.path || h.uri || "")), scores: list.map((h) => h.score ?? 0) };
  } catch (e) {
    return { ranked: [], scores: [], error: "parse: " + String(e).slice(0, 80) };
  }
}

const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
let queries = fixture.queries;
if (split !== "all") queries = queries.filter((q) => (q.split || "dev") === split);

console.error(`${C.b}run-retrieval${C.x} arm=${label} collection=${collection} n=${N} split=${split} — ${queries.length} queries`);

const perQuery = [];
for (let i = 0; i < queries.length; i++) {
  const q = queries[i];
  const { ranked, scores, error } = qmdQuery(q.q);
  const topScore = scores.length ? scores[0] : 0;
  const isNoAnswer = q.bucket === "no-answer" || !q.expected_files || q.expected_files.length === 0;
  let row;
  if (isNoAnswer) {
    const abstained = ranked.length === 0 || topScore < naThreshold;
    row = { id: q.id, bucket: q.bucket, noAnswer: true, topScore, abstained, error };
  } else {
    const rel = new Set(q.expected_files);
    const m = scoreQuery(ranked, rel, { k: N });
    row = { id: q.id, bucket: q.bucket, split: q.split || "dev", topScore, ...m, top: ranked.slice(0, 3), error };
  }
  perQuery.push(row);
  process.stderr.write(`  ${error ? C.r + "!" + C.x : "·"} [${i + 1}/${queries.length}] ${q.id}\r`);
}
process.stderr.write("\n");

// ---- aggregate ----
const answerable = perQuery.filter((r) => !r.noAnswer);
const buckets = [...new Set(answerable.map((r) => r.bucket))];
const agg = (rows, key) => mean(rows.map((r) => r[key]));

function bucketRow(name, rows) {
  return {
    bucket: name, n: rows.length,
    ndcg: agg(rows, "ndcg"), recall5: agg(rows, "recall_at_5"),
    recall10: agg(rows, "recall_at_10"), mrr: agg(rows, "mrr"), map: agg(rows, "ap"),
  };
}
const bucketRows = buckets.map((bk) => bucketRow(bk, answerable.filter((r) => r.bucket === bk)));
const overall = bucketRow("OVERALL", answerable);
const ndcgCI = bootstrapCI(answerable.map((r) => r.ndcg));

// no-answer
const naRows = perQuery.filter((r) => r.noAnswer);
const naPass = naRows.filter((r) => r.abstained).length;

// ---- report ----
const pct = (v) => (v === null || v === undefined ? " n/a " : (v * 100).toFixed(1).padStart(5));
console.log(`\n${C.b}Retrieval eval — arm ${label}${C.x}  ${C.d}(collection ${collection}, n=${N})${C.x}\n`);
console.log(`  ${"bucket".padEnd(16)} ${"n".padStart(2)}  ${"nDCG@10"} ${"R@5"} ${"R@10"} ${"MRR"} ${"MAP"}`);
console.log(`  ${"-".repeat(52)}`);
for (const b of [...bucketRows, overall]) {
  const sep = b.bucket === "OVERALL" ? `  ${C.d}${"-".repeat(52)}${C.x}\n` : "";
  process.stdout.write(sep);
  const bold = b.bucket === "OVERALL" ? C.b : "";
  console.log(`  ${bold}${b.bucket.padEnd(16)}${C.x} ${String(b.n).padStart(2)}  ${bold}${pct(b.ndcg)}${C.x}  ${pct(b.recall5)} ${pct(b.recall10)} ${pct(b.mrr)} ${pct(b.map)}`);
}
console.log(`\n  ${C.b}headline nDCG@10 ${pct(overall.ndcg)}%${C.x}  ${C.d}95% CI [${pct(ndcgCI.lo)}, ${pct(ndcgCI.hi)}]  (bootstrap, n=${ndcgCI.n})${C.x}`);
if (naRows.length) {
  console.log(`  no-answer abstention: ${C.b}${naPass}/${naRows.length}${C.x} ${C.d}(top score < ${naThreshold}; scores: ${naRows.map((r) => (r.topScore ?? 0).toFixed(2)).join(", ")})${C.x}`);
}
const errs = perQuery.filter((r) => r.error);
if (errs.length) console.log(`  ${C.y}${errs.length} query error(s): ${errs.map((e) => e.id).join(", ")}${C.x}`);

if (outPath) {
  writeFileSync(outPath, JSON.stringify({ label, collection, n: N, split, perQuery, overall, ndcgCI }, null, 2));
  console.log(`  ${C.d}per-query dump → ${outPath}${C.x}`);
}
