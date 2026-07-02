#!/usr/bin/env node
// strip-boilerplate.mjs — remove Project Gutenberg license wrapper from a book.
//
// Every Gutenberg text is bracketed by a legal boilerplate: ~25 lines of license
// header at the top and a longer license footer at the bottom, delimited by
//   *** START OF THE PROJECT GUTENBERG EBOOK <title> ***
//   *** END OF THE PROJECT GUTENBERG EBOOK <title> ***
// That wrapper is not the book. Indexed as-is it (a) surfaces as retrieval noise,
// (b) is IDENTICAL across every book so a "gutenberg license" query matches the
// whole library at once, and (c) inflates every line number the `^[raw:L-L]`
// provenance token counts from.
//
// This pass drops everything up to and including the START marker, and everything
// from the END marker onward, leaving the clean book body. Runs FIRST at
// conversion (before structure.mjs / breadcrumb.mjs and before any claim cites a
// line), so all downstream line numbers are boilerplate-free. No markers found
// (a non-Gutenberg source) → no-op. Idempotent (re-run finds no markers).
//
// Usage:
//   node scripts/strip-boilerplate.mjs <book.md> [--stdout]
//   node scripts/strip-boilerplate.mjs --selftest
//   (default: rewrites <book.md> in place)
//
// Exit: 0 ok, 2 = usage/setup error. Zero dependencies.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const START = /^\s*\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG/i;
const END = /^\s*\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG/i;

// Returns { text, head, tail } where head/tail = # of lines removed from each end.
export function stripBoilerplate(input) {
  const lines = input.split(/\r?\n/);
  let start = lines.findIndex((l) => START.test(l));
  let end = lines.findIndex((l) => END.test(l));
  if (start < 0 && end < 0) return { text: input, head: 0, tail: 0 }; // not Gutenberg — untouched

  let lo = 0, hi = lines.length;
  if (start >= 0) {
    lo = start + 1;
    while (lo < lines.length && lines[lo].trim() === "") lo++; // skip blank lines after START
  }
  if (end > lo) hi = end;
  while (hi > lo && lines[hi - 1].trim() === "") hi--;          // trim blank lines before END

  const body = lines.slice(lo, hi);
  return { text: body.join("\n"), head: lo, tail: lines.length - hi };
}

// ---- self-test ------------------------------------------------------------

function selftest() {
  let fail = 0;
  const eq = (got, want, name) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fail++; console.log(`  ✗ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); } else console.log(`  ✓ ${name}`); };

  const g = ["The Project Gutenberg eBook of X", "license blah", "*** START OF THE PROJECT GUTENBERG EBOOK X ***", "", "", "Chapter one text.", "the end of the story.", "", "*** END OF THE PROJECT GUTENBERG EBOOK X ***", "", "license footer", "more legal"].join("\n");
  const r = stripBoilerplate(g);
  eq(r.text, "Chapter one text.\nthe end of the story.", "strips header+footer, trims surrounding blanks");
  eq([r.head, r.tail], [5, 5], "reports lines removed head/tail");
  eq(stripBoilerplate(r.text), { text: r.text, head: 0, tail: 0 }, "idempotent (no markers left)");

  const plain = "Just a normal book\nno gutenberg markers\nat all";
  eq(stripBoilerplate(plain).text, plain, "non-Gutenberg source untouched");

  const headerOnly = ["preamble", "*** START OF THIS PROJECT GUTENBERG EBOOK Y ***", "real body"].join("\n");
  eq(stripBoilerplate(headerOnly).text, "real body", "START-only (no END) still strips header; THIS variant");

  console.log(fail ? `\nFAIL (${fail})` : "\nstrip-boilerplate.mjs OK");
  return fail;
}

// ---- entry (only when run directly, NOT when imported) --------------------

if (/(^|\/)strip-boilerplate\.mjs$/.test(process.argv[1] || "")) {
  if (process.argv.includes("--selftest")) process.exit(selftest() ? 1 : 0);
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith("--"));
  const toStdout = argv.includes("--stdout");
  if (!file) { console.error("usage: node scripts/strip-boilerplate.mjs <book.md> [--stdout]"); process.exit(2); }
  if (!existsSync(file)) { console.error(`strip-boilerplate: file not found: ${file}`); process.exit(2); }

  const { text, head, tail } = stripBoilerplate(readFileSync(file, "utf8"));
  if (toStdout) process.stdout.write(text + "\n");
  else {
    writeFileSync(file, text.endsWith("\n") ? text : text + "\n");
    console.error(head || tail ? `strip-boilerplate: removed ${head} header + ${tail} footer line(s) → ${file}` : `strip-boilerplate: no Gutenberg markers, untouched → ${file}`);
  }
}
