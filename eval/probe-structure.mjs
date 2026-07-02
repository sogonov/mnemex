#!/usr/bin/env node
// probe-structure.mjs — attempted arm-B measurement (⚠ INCONCLUSIVE — do not cite).
//
// GOAL: does structure-recovery + breadcrumb improve chapter-level retrieval on a
// real (heading-less) Gutenberg book vs the flat original? Indexes the SAME book
// two ways — flat (as converted) and struct (structure.mjs + breadcrumb.mjs) — as
// two qmd collections, asks chapter-specific questions, and marks a hit relevant
// iff its chunk falls in the gold chapter's line range.
//
// ⚠ WHY IT'S INCONCLUSIVE (kept as a record + a starting point, NOT a result):
//   1. LOW POWER by construction — flat and struct index the *same text*, so qmd
//      retrieves near-identical chunks; the structure's benefit (chunk-boundary
//      alignment) is second-order and this design can't isolate it.
//   2. OFFSET MISALIGNMENT — qmd's bestChunkPos is a char offset into its
//      normalized body, which doesn't line up cleanly with the source file's line
//      numbers, so the chunk→chapter mapping is unreliable (each query landed a hit
//      in at most one arm for identical text — a tooling artifact, not a signal).
// Run gave flat MRR == struct MRR == 0.10; that number is an artifact, not a null
// result. A trustworthy measurement needs a different design (e.g. chunk-boundary
// purity: what fraction of qmd chunks straddle a chapter line, flat vs struct).
// The features ship justified STRUCTURALLY (heading-aware chunking + breadcrumb
// enablement + navigation + chapter-anchored provenance), not on a recall number.
//
// Setup (run first, in eval/):
//   node probe-structure.mjs --setup <flat-book.md>   # writes probe dirs
//   qmd collection add "$PWD/.probe/flat"   --name probe-flat   --mask '**/*.md'
//   qmd collection add "$PWD/.probe/struct" --name probe-struct --mask '**/*.md'
//   qmd update && qmd embed
//   node probe-structure.mjs --score
//
// Zero deps beyond the qmd SDK (same as run-retrieval-graph.mjs).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { recoverStructure } from "../apps/wiki-template/scripts/structure.mjs";
import { breadcrumbMarkdown } from "../apps/wiki-template/scripts/breadcrumb.mjs";
import { reciprocalRank, mean } from "./metrics.mjs";

const evalDir = dirname(fileURLToPath(import.meta.url));
const probeDir = join(evalDir, ".probe");
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };

// Chapter boundaries from a book's own division markers → [{ roman, start, end }].
// For flat we use recoverStructure()'s detected marker lines; for struct the same
// markers are now `## CHAPTER …` headings at shifted line numbers — recoverStructure
// re-detects nothing there (already headings), so we parse the heading lines directly.
const ROMAN = /\b([IVXLCDM]{1,7})\b/;
function chapters(text, fromHeadings) {
  const lines = text.split(/\r?\n/);
  const marks = [];
  if (fromHeadings) {
    lines.forEach((l, i) => { const m = l.match(/^##\s+CHAPTER\s+([IVXLCDM]{1,7})/i); if (m) marks.push({ roman: m[1].toUpperCase(), start: i + 1 }); });
  } else {
    for (const p of recoverStructure(text).promoted) {
      if (p.level !== 2) continue;
      const m = p.text.match(/CHAPTER\s+([IVXLCDM]{1,7})/i) || p.text.match(ROMAN);
      if (m) marks.push({ roman: m[1].toUpperCase(), start: p.line });
    }
  }
  // de-dupe repeated romans (TOC then body): keep the LAST occurrence (real chapter body).
  const byRoman = new Map();
  for (const m of marks) byRoman.set(m.roman, m.start);
  const ordered = [...byRoman.entries()].map(([roman, start]) => ({ roman, start })).sort((a, b) => a.start - b.start);
  return ordered.map((c, i) => ({ ...c, end: i + 1 < ordered.length ? ordered[i + 1].start : lines.length }));
}

function goldRange(chs, roman) {
  const c = chs.find((x) => x.roman === roman.toUpperCase());
  return c ? [c.start, c.end] : null;
}

// ---- setup: write flat + struct copies -----------------------------------
if (process.argv.includes("--setup")) {
  const book = arg("--setup", null);
  if (!book || !existsSync(book)) { console.error("usage: node probe-structure.mjs --setup <flat-book.md>"); process.exit(2); }
  mkdirSync(join(probeDir, "flat"), { recursive: true });
  mkdirSync(join(probeDir, "struct"), { recursive: true });
  const raw = readFileSync(book, "utf8");
  writeFileSync(join(probeDir, "flat", "the-prince.md"), raw);
  writeFileSync(join(probeDir, "struct", "the-prince.md"), breadcrumbMarkdown(recoverStructure(raw).text) + "\n");
  const flatCh = chapters(raw, false), structCh = chapters(readFileSync(join(probeDir, "struct", "the-prince.md"), "utf8"), true);
  console.error(`setup: flat ${flatCh.length} chapters, struct ${structCh.length} chapters → ${probeDir}`);
  console.error(`next: register probe-flat / probe-struct collections, qmd update && qmd embed, then --score`);
  process.exit(0);
}

// ---- score ----------------------------------------------------------------
const FIXTURE = [
  { q: "is it better for a prince to be feared or loved?", chapter: "XVII" },
  { q: "how should a prince keep his word and use cunning like the fox and the lion?", chapter: "XVIII" },
  { q: "on mercenary soldiers and why they are useless and dangerous", chapter: "XII" },
  { q: "auxiliary troops borrowed from another ruler", chapter: "XIII" },
  { q: "what a prince should do about the art of war and military training", chapter: "XIV" },
  { q: "fortune governs half our actions but we can resist her", chapter: "XXV" },
  { q: "principalities won by the arms and fortune of others, like Cesare Borgia", chapter: "VII" },
  { q: "new principalities acquired by one's own arms and prowess", chapter: "VI" },
  { q: "how a prince gains reputation and honour by great enterprises", chapter: "XXI" },
  { q: "exhortation to liberate Italy from the barbarians", chapter: "XXVI" },
];

const K = 10;
let createStore;
try { ({ createStore } = await import("@tobilu/qmd")); }
catch { ({ createStore } = await import("/opt/homebrew/lib/node_modules/@tobilu/qmd/dist/index.js")); }

// qmd returns bestChunkPos = character offset of the chunk into the doc body.
// The probe books have no frontmatter, so body ≈ file; map offset → 1-based line.
const lineOfPos = (text, pos) => (pos == null ? -1 : text.slice(0, pos).split("\n").length);

async function scoreArm(collection, bookPath, chs) {
  const bookText = readFileSync(bookPath, "utf8");
  const store = await createStore({ dbPath: process.env.HOME + "/.cache/qmd/index.sqlite" });
  const per = [];
  for (const item of FIXTURE) {
    const gold = goldRange(chs, item.chapter);
    const hits = await store.search({ query: item.q, collections: [collection], limit: K });
    // mark each retrieved position relevant iff its chunk falls in the gold chapter
    const ranked = hits.map((_, i) => i);
    const relevant = new Set(hits.map((h, i) => { const ln = lineOfPos(bookText, h.bestChunkPos); return gold && ln >= gold[0] && ln < gold[1] ? i : -1; }).filter((i) => i >= 0));
    const inTopK = [...relevant].filter((i) => i < K).length;
    per.push({ id: item.chapter, mrr: reciprocalRank(ranked, relevant), hit1: relevant.has(0) ? 1 : 0, p_at_k: inTopK / K });
  }
  await store.close();
  return per;
}

const flatCh = chapters(readFileSync(join(probeDir, "flat", "the-prince.md"), "utf8"), false);
const structCh = chapters(readFileSync(join(probeDir, "struct", "the-prince.md"), "utf8"), true);
const flat = await scoreArm("probe-flat", join(probeDir, "flat", "the-prince.md"), flatCh);
const struct = await scoreArm("probe-struct", join(probeDir, "struct", "the-prince.md"), structCh);

const B = "\x1b[1m", D = "\x1b[2m", X = "\x1b[0m";
const pct = (xs) => (mean(xs) * 100).toFixed(1).padStart(6);
console.log(`\n${B}structure-recovery probe — The Prince, chapter-level retrieval${X} ${D}(n=${FIXTURE.length}, gold = target chapter's line range)${X}\n`);
console.log(`  ${"chapter".padEnd(9)} ${"flat MRR".padStart(9)} ${"struct MRR".padStart(11)}   ${D}(hit = chunk lands in the right chapter)${X}`);
for (let i = 0; i < FIXTURE.length; i++)
  console.log(`  ${("Ch " + flat[i].id).padEnd(9)} ${(flat[i].mrr).toFixed(2).padStart(9)} ${(struct[i].mrr).toFixed(2).padStart(11)}`);
console.log(`  ${"-".repeat(34)}`);
console.log(`\n  ${B}aggregate${X}     ${"flat".padStart(8)} ${"struct".padStart(8)}`);
console.log(`  MRR          ${(mean(flat.map((p) => p.mrr))).toFixed(3).padStart(8)} ${(mean(struct.map((p) => p.mrr))).toFixed(3).padStart(8)}`);
console.log(`  hit@1 %      ${pct(flat.map((p) => p.hit1))} ${pct(struct.map((p) => p.hit1))}`);
console.log(`  precision@${K} % ${pct(flat.map((p) => p.p_at_k))} ${pct(struct.map((p) => p.p_at_k))}`);
