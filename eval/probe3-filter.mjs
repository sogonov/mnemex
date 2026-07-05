#!/usr/bin/env node
// probe3-filter.mjs — deterministic fairness gate for the authored queries.
//
// Query authors (blind to the arms) can hallucinate a gold phrase or leak it into
// the query. This drops both, so the benchmark is honest:
//   - gold_phrase MUST appear VERBATIM (whitespace-normalized) in the book → else
//     it's fabricated and unscoreable.
//   - the query must NOT share too many content words with the gold_phrase → else
//     it's a trivial lexical match that tests nothing about context.
//
// Input:  a JSON array [{ slug, path, queries:[{query, gold_phrase, note}] }]
// Output: eval/probe3-fixture.json with only the fair queries + a rejection report.
//
// Usage: node eval/probe3-filter.mjs <authored.json> [--out eval/probe3-fixture.json]

import { readFileSync, writeFileSync } from "node:fs";

const inPath = process.argv[2];
const outArg = process.argv.indexOf("--out");
const outPath = outArg >= 0 ? process.argv[outArg + 1] : "eval/probe3-fixture.json";
if (!inPath) { console.error("usage: node eval/probe3-filter.mjs <authored.json> [--out ...]"); process.exit(2); }

const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
const STOP = new Set("the a an of to in on for and or with how does do is are what when why which that this it its as by at from into about author book chapter section discussion".split(" "));
const words = (s) => norm(s).replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w));

const authored = JSON.parse(readFileSync(inPath, "utf8"));
const out = [], rejects = [];
let kept = 0, total = 0;

for (const book of authored) {
  const text = norm(readFileSync(book.path, "utf8"));
  const fair = [];
  for (const q of book.queries || []) {
    total++;
    const g = norm(q.gold_phrase);
    if (g.length < 25) { rejects.push([book.slug, "gold too short", q.gold_phrase]); continue; }
    if (!text.includes(g)) { rejects.push([book.slug, "gold NOT in book (fabricated)", q.gold_phrase]); continue; }
    // leak check: fraction of gold content-words that appear in the query
    const gw = new Set(words(q.gold_phrase)), qw = new Set(words(q.query));
    if (gw.size === 0) { rejects.push([book.slug, "gold has no content words", q.gold_phrase]); continue; }
    let overlap = 0; for (const w of gw) if (qw.has(w)) overlap++;
    const frac = overlap / gw.size;
    if (frac > 0.5) { rejects.push([book.slug, `leak: ${(frac * 100) | 0}% gold words in query`, q.query]); continue; }
    fair.push({ query: q.query, gold_phrase: q.gold_phrase, leak: +frac.toFixed(2) });
    kept++;
  }
  if (fair.length) out.push({ slug: book.slug, queries: fair });
}

writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`kept ${kept}/${total} fair queries across ${out.length} books → ${outPath}`);
console.log(`rejected ${rejects.length}:`);
for (const [slug, why, what] of rejects.slice(0, 40)) console.log(`  ✗ ${slug.padEnd(24)} ${why.padEnd(34)} ${JSON.stringify((what || "").slice(0, 60))}`);
for (const b of out) console.log(`  ${b.slug.padEnd(30)} ${b.queries.length} queries`);
