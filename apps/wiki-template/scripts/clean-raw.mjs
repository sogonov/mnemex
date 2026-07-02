#!/usr/bin/env node
// clean-raw.mjs — retrofit the conversion pipeline onto already-ingested books.
//
// strip-boilerplate / structure / breadcrumb / extract-meta run at ingest time, so
// books converted BEFORE those passes existed never got them. This applies the same
// pipeline to every raw/books/*/book.md in a wiki — one pass, idempotent (safe to
// re-run: strip no-ops once markers are gone, structure skips existing headings,
// breadcrumb strips+reinjects, extract-meta fills only empty meta fields).
//
// It reuses the four passes' PURE functions (import-safe thanks to their main-module
// guards), in the same order ingest-book.sh uses:
//   extract-meta (needs the header) → strip-boilerplate → structure → breadcrumb
//
// Usage:
//   node scripts/clean-raw.mjs [--wiki <path>] [--dry-run]
//        [--keep-boilerplate] [--no-structure] [--breadcrumb] [--no-meta]
//   (breadcrumb is OFF by default — a 3-arm test found no retrieval benefit; opt in)
//   node scripts/clean-raw.mjs --selftest
//   (defaults: --wiki = $WIKI_ROOT or the current directory)
//
// Exit: 0 ok, 2 = setup error. Zero dependencies.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { parseGutenbergMeta, patchMetaYaml } from "./extract-meta.mjs";
import { stripBoilerplate } from "./strip-boilerplate.mjs";
import { recoverStructure } from "./structure.mjs";
import { breadcrumbMarkdown } from "./breadcrumb.mjs";

// Apply the pipeline to one book's text (+ its meta.yaml text if given). Pure.
// Returns { book, meta, delta } — delta summarizes what each pass changed.
export function cleanOne(bookText, metaText, opts = {}) {
  const delta = {};
  let meta = metaText;
  if (!opts.noMeta && metaText != null) {
    const { text, filled } = patchMetaYaml(metaText, parseGutenbergMeta(bookText));
    meta = text; delta.metaFilled = filled;
  }
  let book = bookText;
  if (!opts.keepBoilerplate) { const r = stripBoilerplate(book); book = r.text; delta.stripped = r.head + r.tail; }
  if (!opts.noStructure) { const r = recoverStructure(book); book = r.text; delta.promoted = r.promoted.length; }
  if (opts.breadcrumb) { const before = book; book = breadcrumbMarkdown(book); delta.breadcrumbs = (book.match(/^\*↪ /gm) || []).length; delta.changed = book !== before || delta.stripped || delta.promoted; }
  return { book, meta, delta };
}

// ---- fs walk (script) -----------------------------------------------------

function bookDirs(wikiRoot) {
  const base = join(wikiRoot, "raw", "books");
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .map((d) => join(base, d))
    .filter((d) => statSync(d).isDirectory() && existsSync(join(d, "book.md")));
}

function run(wikiRoot, opts) {
  const dirs = bookDirs(wikiRoot);
  if (!dirs.length) { console.error(`clean-raw: no raw/books/*/book.md under ${wikiRoot}`); process.exit(2); }

  const B = "\x1b[1m", D = "\x1b[2m", G = "\x1b[0;32m", X = "\x1b[0m";
  console.log(`${B}clean-raw${X} ${D}${opts.dryRun ? "(dry-run — no writes)" : ""} — ${dirs.length} book(s) under ${relative(process.cwd(), wikiRoot) || "."}${X}\n`);
  let totStripped = 0, totPromoted = 0, touched = 0;
  for (const dir of dirs) {
    const bookPath = join(dir, "book.md"), metaPath = join(dir, "meta.yaml");
    const bookText = readFileSync(bookPath, "utf8");
    const metaText = existsSync(metaPath) ? readFileSync(metaPath, "utf8") : null;
    const { book, meta, delta } = cleanOne(bookText, metaText, opts);
    const bookChanged = book !== bookText, metaChanged = meta !== metaText;
    if (!opts.dryRun) {
      if (bookChanged) writeFileSync(bookPath, book.endsWith("\n") ? book : book + "\n");
      if (metaChanged && meta != null) writeFileSync(metaPath, meta.endsWith("\n") ? meta : meta + "\n");
    }
    totStripped += delta.stripped || 0; totPromoted += delta.promoted || 0;
    if (bookChanged || metaChanged) touched++;
    const parts = [];
    if (delta.stripped) parts.push(`−${delta.stripped} boilerplate`);
    if (delta.promoted) parts.push(`+${delta.promoted} headings`);
    if (delta.breadcrumbs) parts.push(`${delta.breadcrumbs} breadcrumbs`);
    if (delta.metaFilled?.length) parts.push(`meta: ${delta.metaFilled.join("/")}`);
    const name = relative(join(wikiRoot, "raw", "books"), dir);
    console.log(`  ${(bookChanged || metaChanged) ? G + "✎" + X : D + "·" + X} ${name.padEnd(38)} ${parts.length ? parts.join(", ") : D + "already clean" + X}`);
  }
  console.log(`\n${D}${opts.dryRun ? "would touch" : "touched"} ${touched}/${dirs.length} book(s) · −${totStripped} boilerplate lines · +${totPromoted} headings total${X}`);
  process.exit(0);
}

// ---- self-test ------------------------------------------------------------

function selftest() {
  let fail = 0;
  const eq = (got, want, name) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fail++; console.log(`  ✗ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); } else console.log(`  ✓ ${name}`); };

  const book = ["Title: On War", "Author: Carl von Clausewitz", "*** START OF THE PROJECT GUTENBERG EBOOK ON WAR ***", "", "# BOOK I", "", "intro", "", "CHAPTER I. What is War?", "", "body", "", "*** END OF THE PROJECT GUTENBERG EBOOK ON WAR ***", "license footer"].join("\n");
  const meta = ['title: ""', "author: []", "year:"].join("\n");
  const r = cleanOne(book, meta);
  eq([r.delta.stripped > 0, r.delta.promoted, r.book.includes("license footer"), r.book.includes("## CHAPTER I. What is War?")],
     [true, 1, false, true], "full chain: strips, promotes CHAPTER, drops footer");
  eq(/^title: "On War"$/m.test(r.meta), true, "meta auto-filled from header");
  // idempotent
  const r2 = cleanOne(r.book, r.meta);
  eq([r2.delta.stripped, r2.book === r.book], [0, true], "idempotent (second pass is a no-op on the book)");

  console.log(fail ? `\nFAIL (${fail})` : "\nclean-raw.mjs OK");
  return fail;
}

// ---- entry (only when run directly, NOT when imported) --------------------

if (/(^|\/)clean-raw\.mjs$/.test(process.argv[1] || "")) {
  if (process.argv.includes("--selftest")) process.exit(selftest() ? 1 : 0);
  const argv = process.argv.slice(2);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const wikiRoot = resolve(val("--wiki") || process.env.WIKI_ROOT || process.cwd());
  run(wikiRoot, {
    dryRun: argv.includes("--dry-run"),
    keepBoilerplate: argv.includes("--keep-boilerplate"),
    noStructure: argv.includes("--no-structure"),
    breadcrumb: argv.includes("--breadcrumb"),
    noMeta: argv.includes("--no-meta"),
  });
}
