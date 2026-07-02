#!/usr/bin/env node
// structure.mjs — recover heading structure from a heading-less converted book.
//
// Project Gutenberg (mnemex's unique acquisition moat) ships plain text: chapter
// divisions are ALL-CAPS lines like `BOOK II` / `CHAPTER I.`, NOT markdown `#`
// headings. Consequence: qmd cannot chunk heading-aware (it splits the book into
// arbitrary ~200-word windows straight across chapter boundaries), and the
// breadcrumb pass has nothing to anchor to. Both of mnemex's retrieval-structure
// mechanisms are dead on its own primary source.
//
// This pass promotes recognizable division markers to real ATX headings so both
// come alive. It is DELIBERATELY conservative — high precision over recall: it
// only touches standalone lines that match a tight division grammar
// (BOOK/PART/VOLUME/CHAPTER/CANTO/LETTER/SECTION + a numeral), inside the
// Gutenberg body (between the *** START *** / *** END *** markers when present).
// A collection of essays with bespoke titles (Bacon, Emerson) is left untouched —
// better no structure than wrong structure.
//
// Runs at CONVERSION time, BEFORE breadcrumb.mjs and before any claim cites a
// line, so `^[raw:Lstart-Lend]` provenance is computed against the final file.
// Idempotent (a line already a heading is skipped). Use --dry-run to audit.
//
// Usage:
//   node scripts/structure.mjs <book.md> [--stdout] [--dry-run]
//   node scripts/structure.mjs --selftest
//   (default: rewrites <book.md> in place)
//
// Exit: 0 ok, 2 = usage/setup error. Zero dependencies.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

// Top-level divisions → H1; chapter-level → H2. Order matters (longest/first win).
const H1_KW = "BOOK|PART|VOLUME";
const H2_KW = "CHAPTER|CANTO|LETTER|SECTION|SCENE|ACT";
const NUM = "[IVXLCDM]{1,7}|\\d{1,4}|FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN";
// A division line: optional THE, keyword, optional THE, a numeral, optional
// ".:—-" + short trailing title. Whole line ≤ 72 chars, standalone. Case-sensitive
// on the keyword (UPPER or Title) — Gutenberg divisions are capitalized.
const mk = (kw) => new RegExp(`^(THE\\s+)?(${kw})(\\s+THE)?\\s+(${NUM})\\b[.:—-]?\\s*(.{0,50})$`, "i");
const H1_RE = mk(H1_KW), H2_RE = mk(H2_KW);

const isDivision = (line) => {
  const t = line.trim();
  if (t.length === 0 || t.length > 72) return null;
  if (/^#{1,6}\s/.test(t)) return null;          // already a heading
  if (H1_RE.test(t)) return { level: 1, text: t };
  if (H2_RE.test(t)) return { level: 2, text: t };
  return null;
};

// Promote division markers to ATX headings within the Gutenberg body. Fence-aware.
// Returns { text, promoted: [{line, level, text}] }.
export function recoverStructure(input) {
  const lines = input.split(/\r?\n/);
  // Confine to the Gutenberg body when the markers exist (avoids the license
  // header + the endnotes/index, where "BOOK II" appears as a citation, not a division).
  let lo = 0, hi = lines.length;
  const startIdx = lines.findIndex((l) => /\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG/i.test(l));
  const endIdx = lines.findIndex((l) => /\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG/i.test(l));
  if (startIdx >= 0) lo = startIdx + 1;
  if (endIdx > lo) hi = endIdx;

  const out = lines.slice();
  const promoted = [];
  let inFence = false, fence = "";
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].match(/^\s*(`{3,}|~{3,})/);
    if (f) { if (!inFence) { inFence = true; fence = f[1][0]; } else if (f[1][0] === fence) { inFence = false; } continue; }
    if (inFence || i < lo || i >= hi) continue;
    // Standalone: blank (or nothing) directly above.
    const prevBlank = i === 0 || lines[i - 1].trim() === "";
    if (!prevBlank) continue;
    const d = isDivision(lines[i]);
    if (!d) continue;
    out[i] = `${"#".repeat(d.level)} ${d.text}`;
    promoted.push({ line: i + 1, level: d.level, text: d.text });
  }
  return { text: out.join("\n"), promoted };
}

// ---- self-test ------------------------------------------------------------

function selftest() {
  let fail = 0;
  const eq = (got, want, name) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fail++; console.log(`  ✗ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); } else console.log(`  ✓ ${name}`); };

  const body = ["*** START OF THE PROJECT GUTENBERG EBOOK X ***", "", "BOOK I", "", "text about virtue", "", "CHAPTER I. Of Fortune", "", "more text", "", "*** END OF THE PROJECT GUTENBERG EBOOK X ***", "", "BOOK II note in endnotes"].join("\n");
  const r = recoverStructure(body);
  eq(r.promoted.map((p) => `${p.level}:${p.text}`), ["1:BOOK I", "2:CHAPTER I. Of Fortune"], "promotes BOOK→H1, CHAPTER→H2 in body only");
  eq(/^# BOOK I$/m.test(r.text) && /^## CHAPTER I\. Of Fortune$/m.test(r.text), true, "rewrites to ATX headings");
  eq(r.text.includes("BOOK II note in endnotes") && !/^#+ BOOK II note/m.test(r.text), true, "endnotes region (after END marker) untouched");

  eq(recoverStructure(recoverStructure(body).text).promoted.length, 0, "idempotent (already-heading skipped)");

  const noStart = ["random ALL CAPS SHOUT", "", "CHAPTER 3", "", "body"].join("\n");
  eq(recoverStructure(noStart).promoted.map((p) => p.text), ["CHAPTER 3"], "no Gutenberg markers → whole file scanned, only real divisions promoted");

  const midline = ["", "He read the BOOK II at night.", ""].join("\n"); // not standalone division
  eq(recoverStructure(midline).promoted.length, 0, "mid-sentence 'BOOK II' not promoted (length/standalone guard)");

  console.log(fail ? `\nFAIL (${fail})` : "\nstructure.mjs OK");
  return fail;
}

// ---- entry ----------------------------------------------------------------

if (process.argv.includes("--selftest")) process.exit(selftest() ? 1 : 0);

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("--"));
const toStdout = argv.includes("--stdout");
const dryRun = argv.includes("--dry-run");
if (!file) { console.error("usage: node scripts/structure.mjs <book.md> [--stdout] [--dry-run]"); process.exit(2); }
if (!existsSync(file)) { console.error(`structure: file not found: ${file}`); process.exit(2); }

const { text, promoted } = recoverStructure(readFileSync(file, "utf8"));
if (dryRun) {
  for (const p of promoted) console.error(`  L${String(p.line).padStart(6)}  H${p.level}  ${p.text}`);
  console.error(`structure: would promote ${promoted.length} division(s) in ${file}`);
  process.exit(0);
}
if (toStdout) process.stdout.write(text + "\n");
else { writeFileSync(file, text.endsWith("\n") ? text : text + "\n"); console.error(`structure: promoted ${promoted.length} division(s) → ${file}`); }
