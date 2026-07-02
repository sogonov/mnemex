#!/usr/bin/env node
// extract-meta.mjs — auto-fill meta.yaml from the Project Gutenberg header.
//
// The license header this pipeline strips also CARRIES the bibliographic metadata:
//   Title: Meditations
//   Author: Emperor of Rome Marcus Aurelius
//   Translator: J. J. Graham            (optional)
//   Editor: Arthur Hugh Clough          (optional)
//   Release date: June 1, 2001 [eBook #2680]
//   Language: English
// mnemex's meta.yaml stub ships those fields EMPTY for the owner to type by hand.
// But the data is already in the file — so parse it and fill the stub. Run BEFORE
// strip-boilerplate (which removes the header). Only fills fields still empty, so
// a value the owner set by hand is never clobbered.
//
// Usage:
//   node scripts/extract-meta.mjs <book.md> <meta.yaml>   # patch meta.yaml in place
//   node scripts/extract-meta.mjs <book.md> --json        # just print parsed fields
//   node scripts/extract-meta.mjs --selftest
//
// Exit: 0 ok, 2 = usage/setup error. Zero dependencies.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FIELD = (name) => new RegExp(`^${name}:\\s*(.+?)\\s*$`, "i");

// Parse the Gutenberg header (the region before the *** START *** marker, or the
// first 60 lines if there is none). Returns a flat object; missing fields absent.
export function parseGutenbergMeta(text) {
  const all = text.split(/\r?\n/);
  const startIdx = all.findIndex((l) => /\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG/i.test(l));
  const head = all.slice(0, startIdx >= 0 ? startIdx : Math.min(60, all.length));
  const first = (re) => { for (const l of head) { const m = l.match(re); if (m) return m[1].trim(); } return null; };

  const out = {};
  const title = first(FIELD("Title"));
  if (title) out.title = title.replace(/\s+/g, " ");
  const author = first(FIELD("Author"));
  if (author) out.authors = author.split(/\s+and\s+|,\s+/).map((s) => s.trim()).filter(Boolean);
  const translator = first(FIELD("Translator"));
  if (translator) out.translator = translator;
  const editor = first(FIELD("Editor"));
  if (editor) out.editor = editor;
  const language = first(FIELD("Language"));
  if (language) out.language = language;

  const release = first(FIELD("Release date"));
  if (release) {
    const y = release.match(/\b(\d{4})\b/);
    if (y) out.year = +y[1];
    const id = release.match(/#\s*(\d+)/) || release.match(/ebooks?\/(\d+)/i);
    if (id) out.gutenbergId = +id[1];
  }
  return out;
}

// YAML double-quote-escape a scalar.
const q = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// Fill only-empty fields of a meta.yaml stub from parsed metadata. Recognizes the
// stub's exact empty forms (`title: ""`, `author: []`, `year:` blank, `language: ""`);
// a field already carrying a value is left as-is. Appends gutenberg_id / translator /
// editor (not in the stub) when parsed. Returns { text, filled: [names] }.
export function patchMetaYaml(meta, ex) {
  let text = meta;
  const filled = [];
  const setScalar = (key, emptyRe, val) => {
    if (val == null) return;
    const re = new RegExp(`^(${key}:)${emptyRe}$`, "m");
    if (re.test(text)) { text = text.replace(re, `$1 ${val}`); filled.push(key); }
  };
  if (ex.title != null) setScalar("title", '\\s*""', q(ex.title));
  if (ex.language != null) setScalar("language", '\\s*""', q(ex.language));
  if (ex.year != null) setScalar("year", '\\s*', String(ex.year));
  if (ex.authors && ex.authors.length) {
    const re = /^(author:)\s*\[\]$/m;
    if (re.test(text)) { text = text.replace(re, `$1 [${ex.authors.map(q).join(", ")}]`); filled.push("author"); }
  }
  // Append fields the stub doesn't have, if not already present.
  const append = (key, val) => { if (val == null) return; if (!new RegExp(`^${key}:`, "m").test(text)) { text = text.replace(/\n?$/, `\n${key}: ${val}\n`); filled.push(key); } };
  append("gutenberg_id", ex.gutenbergId);
  if (ex.translator) append("translator", q(ex.translator));
  if (ex.editor) append("editor", q(ex.editor));
  return { text, filled };
}

// ---- self-test ------------------------------------------------------------

function selftest() {
  let fail = 0;
  const eq = (got, want, name) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fail++; console.log(`  ✗ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); } else console.log(`  ✓ ${name}`); };

  const header = ["Title: On War", "Author: Carl von Clausewitz", "Translator: J. J. Graham", "Release date: February 26, 2006 [eBook #1946]", "Language: English", "", "*** START OF THE PROJECT GUTENBERG EBOOK ON WAR ***", "body Title: not-parsed"].join("\n");
  const ex = parseGutenbergMeta(header);
  eq([ex.title, ex.authors[0], ex.translator, ex.year, ex.gutenbergId, ex.language], ["On War", "Carl von Clausewitz", "J. J. Graham", 2006, 1946, "English"], "parse full header (body after START ignored)");

  eq(parseGutenbergMeta("Author: A and B and C\n*** START OF THE PROJECT GUTENBERG EBOOK X ***").authors, ["A", "B", "C"], "multiple authors split on ' and '");

  const stub = ['slug: x', 'title: ""', 'author: []', 'year:', 'isbn: ""', 'language: ""', 'pages:', 'llm_ingested: false'].join("\n");
  const { text, filled } = patchMetaYaml(stub, ex);
  eq(filled.sort(), ["author", "gutenberg_id", "language", "title", "translator", "year"].sort(), "fills empty fields + appends extras");
  eq(/^title: "On War"$/m.test(text) && /^author: \["Carl von Clausewitz"\]$/m.test(text) && /^year: 2006$/m.test(text) && /^gutenberg_id: 1946$/m.test(text), true, "patched values correct");

  const preset = ['title: "My Own Title"', 'author: []', 'year:'].join("\n");
  eq(/^title: "My Own Title"$/m.test(patchMetaYaml(preset, ex).text), true, "does not clobber a hand-set title");

  console.log(fail ? `\nFAIL (${fail})` : "\nextract-meta.mjs OK");
  return fail;
}

// ---- entry (only when run directly, NOT when imported) --------------------

if (/(^|\/)extract-meta\.mjs$/.test(process.argv[1] || "")) {
  if (process.argv.includes("--selftest")) process.exit(selftest() ? 1 : 0);
  const argv = process.argv.slice(2);
  const [book, metaOrFlag] = argv.filter((a) => !a.startsWith("--"));
  const asJson = argv.includes("--json");
  if (!book || !existsSync(book)) { console.error("usage: node scripts/extract-meta.mjs <book.md> <meta.yaml>  |  <book.md> --json"); process.exit(2); }

  const ex = parseGutenbergMeta(readFileSync(book, "utf8"));
  if (asJson || !metaOrFlag) { console.log(JSON.stringify(ex, null, 2)); process.exit(0); }
  if (!existsSync(metaOrFlag)) { console.error(`extract-meta: meta file not found: ${metaOrFlag}`); process.exit(2); }
  const { text, filled } = patchMetaYaml(readFileSync(metaOrFlag, "utf8"), ex);
  writeFileSync(metaOrFlag, text.endsWith("\n") ? text : text + "\n");
  console.error(filled.length ? `extract-meta: filled ${filled.join(", ")} → ${metaOrFlag}` : `extract-meta: no Gutenberg metadata found → ${metaOrFlag}`);
}
