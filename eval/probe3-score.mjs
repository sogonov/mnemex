#!/usr/bin/env node
// probe3-score.mjs — the honest 3-arm breadcrumb/structure retrieval test.
//
// Arms (same 6 real books, three qmd collections):
//   A  = plain (as converted)
//   B  = + contextual breadcrumb
//   SB = + structure-recovery + breadcrumb
//
// Fixture: context-dependent queries, each with a verbatim gold_phrase from the
// target passage (authored blind to the arms; filtered so gold is present in the
// book and not leaked into the query). A query is "chunk-correct" for an arm iff
// the gold book's best-matching chunk (qmd bestChunk) CONTAINS the gold phrase
// (whitespace-normalized) — i.e. the query retrieved the RIGHT passage, which is
// exactly what a breadcrumb is supposed to help. Also records the gold book's rank.
//
// Reports per-arm chunk-correct rate + MRR, and paired permutation tests
// A→B (breadcrumb's effect) and A→SB / B→SB (structure's added effect).
//
// Usage: node eval/probe3-score.mjs --fixture eval/probe3-fixture.json [--out ...]

import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { pairedPermutationTest, bootstrapCI } from "./stats.mjs";
import { mean } from "./metrics.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const fixturePath = arg("--fixture", "eval/probe3-fixture.json");
const outPath = arg("--out", null);
const emitPath = arg("--emit", null);        // incremental JSONL — survives a kill
const aggregateOnly = process.argv.includes("--aggregate"); // skip search, report from --emit
const K = 10;
const ARMS = { A: "probe3-a", B: "probe3-b", SB: "probe3-sb" };

const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
const collapse = (s) => norm(s);

let createStore;
try { ({ createStore } = await import("@tobilu/qmd")); }
catch { ({ createStore } = await import("/opt/homebrew/lib/node_modules/@tobilu/qmd/dist/index.js")); }

const fixture = JSON.parse(readFileSync(fixturePath, "utf8")); // [{slug, queries:[{query, gold_phrase}]}]
const flat = [];
for (const b of fixture) for (const q of b.queries) flat.push({ slug: b.slug, query: q.query, gold: q.gold_phrase });
console.error(`probe3: ${flat.length} queries across ${fixture.length} books, arms ${Object.keys(ARMS).join("/")}`);

// Score one query against one arm → { correct: 0|1, rank, bookRank }. Correct iff
// the gold book's best chunk contains the gold phrase; rank = its position in the hits.
async function scoreOne(store, collection, q) {
  const hits = await store.search({ query: q.query, collections: [collection], limit: K });
  const goldNorm = collapse(q.gold);
  let rank = 0, correct = 0, bookRank = 0;
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const isGoldBook = (h.file || "").includes(q.slug);
    if (isGoldBook && bookRank === 0) bookRank = i + 1;
    if (isGoldBook && collapse(h.bestChunk || "").includes(goldNorm)) { correct = 1; if (!rank) rank = i + 1; }
  }
  return { correct, rank, bookRank };
}

// Per-query across all arms, emitting each row to JSONL as it completes (survives a
// kill; resume/aggregate with --aggregate). rows = [{ id, slug, A, B, SB }].
let rows;
if (aggregateOnly) {
  rows = readFileSync(emitPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  console.error(`aggregate-only: ${rows.length} rows from ${emitPath}`);
} else {
  // Resume: keep rows already in the emit file, only score the missing query ids.
  const done = new Map();
  if (emitPath && existsSync(emitPath)) for (const l of readFileSync(emitPath, "utf8").trim().split("\n").filter(Boolean)) { const r = JSON.parse(l); done.set(r.id, r); }
  console.error(`resuming: ${done.size}/${flat.length} already scored`);
  const store = await createStore({ dbPath: process.env.HOME + "/.cache/qmd/index.sqlite" });
  rows = [];
  for (let i = 0; i < flat.length; i++) {
    if (done.has(i)) { rows.push(done.get(i)); continue; }
    const q = flat[i];
    const row = { id: i, slug: q.slug };
    for (const [name, coll] of Object.entries(ARMS)) row[name] = await scoreOne(store, coll, q);
    rows.push(row);
    if (emitPath) appendFileSync(emitPath, JSON.stringify(row) + "\n");
    process.stderr.write(`  [${i + 1}/${flat.length}] ${q.slug.slice(0, 20).padEnd(20)} A${row.A.correct} B${row.B.correct} SB${row.SB.correct}   \r`);
  }
  await store.close();
  process.stderr.write("\n");
}

const out = { A: rows.map((r) => r.A), B: rows.map((r) => r.B), SB: rows.map((r) => r.SB) };

// ---- report ----
const C = { b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[0;32m", x: "\x1b[0m" };
const rate = (name) => mean(out[name].map((r) => r.correct));
const mrr = (name) => mean(out[name].map((r) => (r.correct ? 1 / r.rank : 0)));
const bookHit = (name) => mean(out[name].map((r) => (r.bookRank && r.bookRank <= K ? 1 : 0)));

console.log(`\n${C.b}3-arm breadcrumb/structure test — chunk-correct retrieval${C.x} ${C.d}(n=${flat.length}, gold = right passage retrieved as best chunk)${C.x}\n`);
console.log(`  ${"arm".padEnd(26)} ${"chunk-correct".padStart(14)} ${"MRR".padStart(7)} ${"book-in-topK".padStart(13)}`);
for (const [name, label] of [["A", "A  plain"], ["B", "B  +breadcrumb"], ["SB", "SB +structure+breadcrumb"]]) {
  const ci = bootstrapCI(out[name].map((r) => r.correct), { resamples: 10000, seed: 1 });
  console.log(`  ${label.padEnd(26)} ${(rate(name) * 100).toFixed(1).padStart(9)} ${C.d}[${(ci.lo * 100).toFixed(0)},${(ci.hi * 100).toFixed(0)}]${C.x} ${mrr(name).toFixed(3).padStart(7)} ${(bookHit(name) * 100).toFixed(0).padStart(12)}%`);
}

console.log(`\n  ${C.b}paired permutation (the pre-committed decision test)${C.x}`);
const test = (a, b, label) => {
  const av = out[a].map((r) => r.correct), bv = out[b].map((r) => r.correct);
  const p = pairedPermutationTest(bv, av, { seed: 1 });
  const d = (mean(bv) - mean(av)) * 100;
  console.log(`    ${label.padEnd(34)} Δ ${(d >= 0 ? "+" : "") + d.toFixed(1)} pts   p=${p.p.toFixed(4)}   ${p.p < 0.05 ? C.g + "SIGNIFICANT" + C.x : C.d + "not significant" + C.x}`);
};
test("A", "B", "A→B  (breadcrumb effect)");
test("A", "SB", "A→SB (structure+breadcrumb)");
test("B", "SB", "B→SB (structure added)");

if (outPath) writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`\n  ${C.d}decision rule: breadcrumb stays default-on only if A→B is SIGNIFICANT (p<0.05) and positive.${C.x}`);
