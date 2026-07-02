#!/usr/bin/env node
// run.mjs — mnemex mini-eval. One number for the relaunch article's graph.
//
// Two metrics over the fixed public-domain corpus (see corpus.md):
//   1. Retrieval recall   — does a query fetch the right source page(s)?  (via `qmd bench`)
//   2. Citation correctness — does each gold answer resolve to a real provenance token in
//                             its source page? (deterministic check of ^[raw:Lstart-Lend])
//
// Phase 2 (Contextual Retrieval) re-runs this unchanged to produce a before/after delta.
//
// Usage:
//   node eval/run.mjs [--json]
//   EVAL_WIKI_ROOT   built eval wiki (default: eval/.wiki)
//   EVAL_COLLECTION  qmd collection name (default: mnemex-wiki)

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const evalDir = dirname(fileURLToPath(import.meta.url));
const asJson = process.argv.includes("--json");
const wikiRoot = process.env.EVAL_WIKI_ROOT || join(evalDir, ".wiki");
const collection = process.env.EVAL_COLLECTION || "mnemex-wiki";
const fixture = join(evalDir, "fixture.json");
const questionsFile = join(evalDir, "questions.jsonl");

const C = { g: "\x1b[0;32m", y: "\x1b[1;33m", r: "\x1b[0;31m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" };

// ---- corpus built? -----------------------------------------------------------
function sourcePages() {
  const d = join(wikiRoot, "wiki", "sources");
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".md")) : [];
}
const built = sourcePages().length > 0;

// ---- 1. retrieval recall (qmd bench) ----------------------------------------
function retrievalRecall() {
  const has = spawnSync("qmd", ["--version"], { stdio: "ignore" }).status === 0;
  if (!has) return { ok: false, reason: "qmd not installed" };
  const r = spawnSync("qmd", ["bench", fixture, "--json", "-c", collection], {
    encoding: "utf8",
    env: { ...process.env },
  });
  if (r.status !== 0) return { ok: false, reason: (r.stderr || "qmd bench failed").trim().split("\n")[0] };
  let data;
  try { data = JSON.parse(r.stdout); } catch { return { ok: false, reason: "could not parse qmd bench json" }; }
  const summary = data.summary || {};
  const backends = Object.entries(summary).map(([name, s]) => ({ name, recall: s.avg_recall ?? 0, recall3: s.avg_recall_at_3 ?? 0 }));
  if (!backends.length) return { ok: false, reason: "empty bench summary" };
  backends.sort((a, b) => b.recall - a.recall);
  return { ok: true, best: backends[0], backends };
}

// ---- 2. citation correctness -------------------------------------------------
const TOKEN = /\^\[([^\]]+)\]/g;
const RANGE = /^(.+):(\d+)-(\d+)$/;

function tokensIn(fileAbs) {
  if (!existsSync(fileAbs)) return [];
  const out = [];
  const text = readFileSync(fileAbs, "utf8");
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text)) !== null) {
    const rm = m[1].match(RANGE);
    if (rm) out.push({ path: rm[1], a: +rm[2], b: +rm[3] });
  }
  return out;
}

function citationCorrectness() {
  const lines = readFileSync(questionsFile, "utf8").split(/\r?\n/).filter((l) => l.trim());
  const questions = lines.map((l) => JSON.parse(l));
  let scored = 0, correct = 0;
  const unscored = [];
  for (const q of questions) {
    if (!Array.isArray(q.gold_lines) || q.gold_lines.length !== 2) { unscored.push(q.id); continue; }
    scored++;
    const [ga, gb] = q.gold_lines;
    const toks = tokensIn(join(wikiRoot, q.gold_source));
    const hit = toks.some((t) => t.path === q.gold_raw && t.a <= gb && ga <= t.b);
    if (hit) correct++;
  }
  return { total: questions.length, scored, correct, unscored, rate: scored ? correct / scored : null };
}

// ---- report ------------------------------------------------------------------
if (!built) {
  const payload = { built: false, score: 0, note: "eval wiki not built — see eval/corpus.md" };
  if (asJson) { console.log(JSON.stringify(payload, null, 2)); process.exit(0); }
  console.log(`${C.y}!${C.x} eval corpus not built at ${C.b}${wikiRoot}${C.x}`);
  console.log(`  Build it first: see ${C.b}eval/corpus.md${C.x}. Score: ${C.b}0${C.x} (expected pre-build).`);
  process.exit(0);
}

const recall = retrievalRecall();
const cite = citationCorrectness();

const recallVal = recall.ok ? recall.best.recall : null;
const citeVal = cite.rate;
let combined = null;
if (recallVal !== null && citeVal !== null) combined = 0.5 * recallVal + 0.5 * citeVal;
else if (recallVal !== null) combined = recallVal;
else if (citeVal !== null) combined = citeVal;

if (asJson) {
  console.log(JSON.stringify({ built: true, wikiRoot, collection, recall, citation: cite, combined }, null, 2));
  process.exit(0);
}

const pct = (v) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);
console.log(`${C.b}mnemex eval${C.x}  ${C.d}wiki=${wikiRoot} collection=${collection}${C.x}\n`);
if (recall.ok) {
  console.log(`  retrieval recall   ${C.b}${pct(recall.best.recall)}${C.x}  ${C.d}(${recall.best.name}; recall@3 ${pct(recall.best.recall3)})${C.x}`);
} else {
  console.log(`  retrieval recall   ${C.y}n/a${C.x}  ${C.d}(${recall.reason})${C.x}`);
}
if (citeVal !== null) {
  console.log(`  citation correct   ${C.b}${pct(cite.rate)}${C.x}  ${C.d}(${cite.correct}/${cite.scored} scored${cite.unscored.length ? `, ${cite.unscored.length} unscored — fill gold_lines` : ""})${C.x}`);
} else {
  console.log(`  citation correct   ${C.y}n/a${C.x}  ${C.d}(no gold_lines filled — see corpus.md step 5)${C.x}`);
}
console.log(`\n  ${C.b}SCORE ${pct(combined)}${C.x}\n`);
