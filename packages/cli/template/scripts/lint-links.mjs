#!/usr/bin/env node
// lint-links.mjs — wikilink integrity lint for a mnemex wiki.
//
// mnemex pages are densely cross-linked with [[wikilinks]], but nothing checks
// them: a renamed page silently breaks every inbound link, a concept gets filed
// twice under slightly different names, a stub is created and never referenced.
// This lint is the deterministic half of CLAUDE.md > Lint > "judgment lint"
// (broken wikilinks / orphan pages / duplicate concepts).
//
// Checks (deterministic, no LLM):
//   - BROKEN     a [[Target]] that resolves to no page (by basename or alias)
//   - DUPLICATE  one normalized name (basename or alias) owned by 2+ pages —
//                Obsidian can't disambiguate [[that]] (the gist's headline gripe)
//   - ORPHAN     a wiki page with no inbound link from any OTHER wiki page
//                (advisory — a fresh stub is legitimately orphaned; off exit code
//                 unless --strict)
//
// Resolution model mirrors Obsidian: links resolve by basename OR frontmatter
// alias, case-insensitively. Dashes vs. spaces are kept distinct (the convention
// is Title-Case-With-Dashes; `[[Bounded Context]]` for `Bounded-Context.md` is a
// real break). Extraction is fence-aware (skips ``` / ~~~ blocks and `inline`
// code) and \p{L}-safe (Cyrillic page titles resolve).
//
// Usage:
//   node scripts/lint-links.mjs [--wiki <path>] [--json] [--strict]
//   node scripts/lint-links.mjs --selftest
//   (defaults: --wiki = $WIKI_ROOT or the current directory)
//
// Exit: 0 = clean, 1 = BROKEN/DUPLICATE (or ORPHAN under --strict), 2 = setup error.
// Zero dependencies.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

// ---- pure core (unit-tested via --selftest) ------------------------------

// Normalize a link target / title / alias for case-insensitive matching.
// Lowercase + collapse internal whitespace. Dashes are preserved (they carry
// identity in Title-Case-With-Dashes filenames).
export function normKey(s) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// A page wikilink addresses a wiki page by bare basename. A target with a path
// separator is a file link (`[[../../raw/books/x/book.md]]` — that belongs in a
// ^[raw:L-L] provenance token, not the page graph), and a media/doc extension is
// an embedded asset (`![[diagram.png]]`). Neither is a page-graph edge.
const MEDIA = /\.(png|jpe?g|gif|svg|webp|bmp|ico|pdf|mp4|mov|mp3|wav|webm|zip)$/i;
export function isPageLink(target) {
  if (!target) return false;
  if (target.includes("/")) return false;
  if (MEDIA.test(target)) return false;
  return true;
}

// A typed relationship section (the convention from CLAUDE.md > Relationships).
// A page with links but none of these files all its relationships in prose — the
// "everything is related" trap. Cosmetic/consistency check, not retrieval.
const TYPED_SECTION = /^#{2,}\s+(see also|builds on|subsumes|contrasted with|contradicts|referenced by)\b/i;
export function hasTypedSection(text) {
  return text.split(/\r?\n/).some((l) => TYPED_SECTION.test(l));
}

// Extract [[wikilink]] targets from markdown, skipping YAML frontmatter, fenced
// code blocks (``` / ~~~), and inline `code` spans. Returns [{ target, line }]
// where target is the page part (without #heading or |display), 1-based line.
// \p{L}-safe: the target class is a negated set, so any Unicode letter passes.
export function extractWikiLinks(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let inFrontmatter = false, inFence = false, fence = "";
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // YAML frontmatter: a leading `---` on line 1 opens it, next `---` closes it.
    if (i === 0 && line.trim() === "---") { inFrontmatter = true; continue; }
    if (inFrontmatter) { if (line.trim() === "---") inFrontmatter = false; continue; }
    // Fenced code block toggle (``` or ~~~, 3+ of the same char).
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) {
      if (!inFence) { inFence = true; fence = f[1][0]; }
      else if (f[1][0] === fence) { inFence = false; fence = ""; }
      continue;
    }
    if (inFence) continue;
    // Strip inline code spans so `[[x]]` inside backticks isn't counted.
    line = line.replace(/`[^`]*`/g, "");
    for (const m of line.matchAll(/\[\[([^\]|#\n]+)(?:[#|][^\]\n]*)?\]\]/g)) {
      const target = m[1].trim();
      if (target) out.push({ target, line: i + 1 });
    }
  }
  return out;
}

// Parse the `aliases:` field from YAML frontmatter (inline [a, b] or block "- a").
// Zero-dep, tolerant of quotes. Returns [] when absent.
export function parseAliases(text) {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return [];
  const body = fm[1];
  const inline = body.match(/^aliases:\s*\[(.*)\]\s*$/m);
  if (inline) {
    return inline[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  }
  const block = body.match(/^aliases:\s*\r?\n((?:\s*-\s*.+\r?\n?)+)/m);
  if (block) {
    return block[1].split(/\r?\n/).map((l) => l.replace(/^\s*-\s*/, "").trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  }
  return [];
}

// ---- fs walk + report (only runs as a script) ----------------------------

function mdFilesRecursive(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name.startsWith(".")) continue;
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith(".md")) out.push(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

function run(wikiRoot, { asJson, strict }) {
  const wikiDir = join(wikiRoot, "wiki");
  if (!existsSync(wikiDir)) {
    console.error(`lint-links: no wiki/ under ${wikiRoot} (pass --wiki <path>)`);
    process.exit(2);
  }

  const pages = mdFilesRecursive(wikiDir);            // the page universe
  const rel = (f) => relative(wikiRoot, f);

  // name-key -> Set<page> (basename + every alias), for resolution + duplicates.
  const keyToPages = new Map();
  const aliasesOf = new Map();
  const textOf = new Map();
  const addKey = (k, file) => {
    const nk = normKey(k);
    if (!nk) return;
    (keyToPages.get(nk) || keyToPages.set(nk, new Set()).get(nk)).add(file);
  };
  for (const f of pages) {
    const base = f.slice(f.lastIndexOf("/") + 1).replace(/\.md$/, "");
    const text = readFileSync(f, "utf8");
    textOf.set(f, text);
    const aliases = parseAliases(text);
    aliasesOf.set(f, aliases);
    addKey(base, f);
    for (const a of aliases) addKey(a, f);
  }

  const findings = [];
  const flag = (file, line, level, msg) => findings.push({ file: rel(file), line, level, msg });

  // Link sources for BROKEN: all wiki pages + the root nav files (a broken link
  // in index.md / hot.md / log.md is a real problem too). Nav files do NOT count
  // toward inbound (orphan) — else the index catalog would mask every orphan.
  const navFiles = ["index.md", "hot.md", "log.md"].map((n) => join(wikiRoot, n)).filter(existsSync);
  const referenced = new Set();   // pages reached by an inbound link from another PAGE

  const scan = (file, countsInbound) => {
    for (const { target, line } of extractWikiLinks(readFileSync(file, "utf8"))) {
      if (!isPageLink(target)) continue;    // file path or media embed — not a page-graph edge
      const hit = keyToPages.get(normKey(target));
      if (!hit || hit.size === 0) { flag(file, line, "BROKEN", `[[${target}]] resolves to no page`); continue; }
      if (countsInbound) for (const t of hit) if (t !== file) referenced.add(t);
    }
  };
  for (const f of pages) scan(f, true);
  for (const f of navFiles) scan(f, false);

  // DUPLICATE: a normalized name owned by 2+ distinct pages.
  for (const [nk, set] of keyToPages) {
    if (set.size < 2) continue;
    const owners = [...set].map(rel).sort();
    for (const f of set) flag(f, 1, "DUPLICATE", `name "${nk}" also owned by: ${owners.filter((o) => o !== rel(f)).join(", ")}`);
  }

  // ORPHAN: a page nothing else links to (advisory).
  for (const f of pages) if (!referenced.has(f)) flag(f, 1, "ORPHAN", "no inbound wikilink from any other page");

  // UNTYPED (advisory, cosmetic): a page relates to 3+ pages but files none of them
  // under a typed relationship section — its relationships are all buried in prose.
  for (const f of pages) {
    const text = textOf.get(f);
    const distinct = new Set(extractWikiLinks(text).filter((l) => isPageLink(l.target)).map((l) => normKey(l.target)));
    if (distinct.size >= 3 && !hasTypedSection(text))
      flag(f, 1, "UNTYPED", `${distinct.size} wikilinks but no typed relationship section (## See also / Builds on / Subsumes / Contrasted with / Contradicts)`);
  }

  const hard = findings.filter((f) => f.level === "BROKEN" || f.level === "DUPLICATE");
  const advisory = (f) => f.level === "ORPHAN" || f.level === "UNTYPED";
  const fail = hard.length > 0 || (strict && findings.some(advisory));

  if (asJson) {
    console.log(JSON.stringify({ wikiRoot, scanned: pages.length, findings }, null, 2));
    process.exit(fail ? 1 : 0);
  }

  const RED = "\x1b[0;31m", YEL = "\x1b[1;33m", GRN = "\x1b[0;32m", DIM = "\x1b[2m", RST = "\x1b[0m";
  const color = { BROKEN: RED, DUPLICATE: RED, ORPHAN: YEL, UNTYPED: YEL };
  const order = { BROKEN: 0, DUPLICATE: 1, ORPHAN: 2, UNTYPED: 3 };
  for (const f of findings.sort((a, b) => order[a.level] - order[b.level] || a.file.localeCompare(b.file))) {
    console.log(`${f.file}:${f.line}: ${color[f.level]}${f.level}${RST}: ${f.msg}`);
  }
  if (findings.length === 0) {
    console.log(`${GRN}✓${RST} links clean ${DIM}(${pages.length} page(s) scanned)${RST}`);
  } else {
    const by = findings.reduce((a, f) => ((a[f.level] = (a[f.level] || 0) + 1), a), {});
    const parts = Object.entries(by).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ");
    const mark = fail ? `${RED}✗${RST}` : `${YEL}⚠${RST}`;
    console.log(`\n${mark} ${findings.length} finding(s): ${parts} ${DIM}(${pages.length} page(s) scanned` +
      `${!hard.length && !strict ? "; orphan/untyped are advisory — exit 0" : ""})${RST}`);
  }
  process.exit(fail ? 1 : 0);
}

// ---- self-test ------------------------------------------------------------

function selftest() {
  let fail = 0;
  const eq = (got, want, name) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fail++; console.log(`  ✗ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); } else console.log(`  ✓ ${name}`); };

  // extractWikiLinks: skips frontmatter, fences, inline code; strips #/| ; \p{L}-safe.
  const md = [
    "---", "aliases: [Foo]", "see: [[InFrontmatter]]", "---",
    "Body links [[Bounded-Context]] and [[Aggregate-Root#Invariants]] and [[DDD|domain design]].",
    "Cyrillic [[Мышление-быстрое-и-медленное]] works.",
    "Inline `[[NotALink]]` is code.",
    "```", "[[AlsoNotALink]]", "```",
    "Trailing [[Real-One]].",
  ].join("\n");
  eq(extractWikiLinks(md).map((l) => l.target),
     ["Bounded-Context", "Aggregate-Root", "DDD", "Мышление-быстрое-и-медленное", "Real-One"],
     "extractWikiLinks (fence/frontmatter/inline/#|/unicode)");

  // parseAliases: inline and block forms; absent -> [].
  eq(parseAliases('---\naliases: ["DDD", "Domain Driven Design"]\n---\nx'), ["DDD", "Domain Driven Design"], "parseAliases inline");
  eq(parseAliases("---\naliases:\n  - DDD\n  - Foo Bar\n---\nx"), ["DDD", "Foo Bar"], "parseAliases block");
  eq(parseAliases("---\ntype: concept\n---\nx"), [], "parseAliases absent");

  // isPageLink: bare basenames are page edges; paths and media embeds are not.
  eq([["Bounded-Context", true], ["../../raw/books/x/book.md", false], ["diagram.png", false], ["Мышление", true]]
       .every(([t, w]) => isPageLink(t) === w), true, "isPageLink (path/media exclusion)");

  // normKey: case-insensitive, whitespace-collapsing, dash-preserving.
  eq(normKey("  Bounded-Context "), "bounded-context", "normKey trim+lower");
  eq(normKey("Domain  Driven   Design"), "domain driven design", "normKey collapse ws");
  eq(normKey("Bounded Context") === normKey("Bounded-Context"), false, "normKey dash != space");

  // hasTypedSection: recognizes the relationship headings (any level), else false.
  eq(hasTypedSection("body [[X]]\n## See also\n- [[Y]]"), true, "hasTypedSection (See also)");
  eq(hasTypedSection("### Contrasted with\n- [[Y]]"), true, "hasTypedSection (Contrasted with, h3)");
  eq(hasTypedSection("## Notes\nlinks [[A]] [[B]] in prose only"), false, "hasTypedSection (none → false)");

  console.log(fail ? `\nFAIL (${fail})` : "\nlint-links.mjs OK");
  return fail;
}

// ---- entry (only when run directly, NOT when imported) --------------------

// ESM runs an imported module top-to-bottom — gate the CLI so importing
// extractWikiLinks/isPageLink (e.g. from suggest-links.mjs) can't trigger a wiki
// scan + process.exit. See structure.mjs.
if (/(^|\/)lint-links\.mjs$/.test(process.argv[1] || "")) {
  if (process.argv.includes("--selftest")) process.exit(selftest() ? 1 : 0);
  const argv = process.argv.slice(2);
  let wikiRoot = process.env.WIKI_ROOT || process.cwd();
  let asJson = false, strict = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--wiki") wikiRoot = argv[++i];
    else if (argv[i] === "--json") asJson = true;
    else if (argv[i] === "--strict") strict = true;
    else if (argv[i] === "-h" || argv[i] === "--help") {
      console.log("usage: node scripts/lint-links.mjs [--wiki <path>] [--json] [--strict]");
      process.exit(0);
    }
  }
  run(resolve(wikiRoot), { asJson, strict });
}
