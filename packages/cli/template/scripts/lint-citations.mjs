#!/usr/bin/env node
// lint-citations.mjs — claim-level provenance lint for a mnemex wiki.
//
// Enforces the rule from CLAUDE.md > Provenance: every extracted claim, evidence
// row, and source-attributed definition must carry a token that resolves to the
// raw source lines:  ^[<raw-path>:Lstart-Lend]   (chapter fallback: ^[<slug>#Ch.N])
//
// Checks (deterministic, no LLM):
//   - MISSING      claim/evidence line with no token
//   - MALFORMED    a ^[...] token whose body matches neither form
//   - UNRESOLVABLE line-range token whose raw file is missing, or range is
//                  inverted / out of the file's bounds
//
// Usage:
//   node scripts/lint-citations.mjs [--wiki <path>] [--json]
//   (defaults: --wiki = $WIKI_ROOT or the current directory)
//
// Exit code: 0 = clean, 1 = findings, 2 = usage/setup error. Zero dependencies.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const argv = process.argv.slice(2);
let wikiRoot = process.env.WIKI_ROOT || process.cwd();
let asJson = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--wiki") wikiRoot = argv[++i];
  else if (argv[i] === "--json") asJson = true;
  else if (argv[i] === "-h" || argv[i] === "--help") {
    console.log("usage: node scripts/lint-citations.mjs [--wiki <path>] [--json]");
    process.exit(0);
  }
}
wikiRoot = resolve(wikiRoot);

// ^[ ... ] — capture the token body between the caret-bracket and the closing bracket.
const TOKEN = /\^\[([^\]]+)\]/g;
const RANGE = /^(.+):(\d+)-(\d+)$/;   // raw/books/slug/book.md:412-418
const CHAPTER = /^([^:#]+)#(.+)$/;    // slug#Ch.3

const lineCountCache = new Map();
function rawLineCount(rawPath) {
  if (lineCountCache.has(rawPath)) return lineCountCache.get(rawPath);
  const abs = join(wikiRoot, rawPath);
  let n = null;
  if (existsSync(abs) && statSync(abs).isFile()) {
    const raw = readFileSync(abs, "utf8");
    // Don't count a single trailing newline as an extra (empty) line.
    n = raw.replace(/\r?\n$/, "").split(/\r?\n/).length;
  }
  lineCountCache.set(rawPath, n);
  return n;
}

const findings = [];
function flag(file, line, level, msg) {
  findings.push({ file: relative(wikiRoot, file), line, level, msg });
}

// Classify a single token body; returns null if OK, else an error message.
function checkToken(body) {
  const r = body.match(RANGE);
  if (r) {
    const [, path, aStr, bStr] = r;
    const a = +aStr, b = +bStr;
    const total = rawLineCount(path);
    if (total === null) return `unresolvable: raw file not found: ${path}`;
    if (a < 1 || a > b) return `unresolvable: bad range ${a}-${b}`;
    if (b > total) return `unresolvable: line ${b} > ${path} has ${total} lines`;
    return null; // resolves
  }
  if (CHAPTER.test(body)) return null; // chapter fallback — accepted, not resolvable
  return `malformed token: ^[${body}]`;
}

// Walk a markdown file, section-aware, and report findings.
function lintFile(file) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  let section = "";           // current "## Heading" text, lowercased
  const inClaims = () => section.startsWith("extracted claims");
  const inEvidence = () => section.startsWith("evidence");

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const ln = i + 1;
    const h = raw.match(/^##+\s+(.*)$/);
    if (h) { section = h[1].trim().toLowerCase(); continue; }

    // 1) Any token present anywhere must be well-formed + resolvable.
    let m, hadToken = false;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(raw)) !== null) {
      hadToken = true;
      const problem = checkToken(m[1]);
      if (problem) flag(file, ln, problem.startsWith("malformed") ? "MALFORMED" : "UNRESOLVABLE", problem);
    }

    // 2) Lines that MUST carry a token but don't.
    if (!hadToken) {
      // Extracted-claims list item: "- <claim>" or "* <claim>" with real text.
      if (inClaims() && /^\s*[-*]\s+\S/.test(raw)) {
        flag(file, ln, "MISSING", "claim has no provenance token ^[raw-path:Lstart-Lend]");
      }
      // Evidence-table data row (skip header row and |---| separator).
      else if (inEvidence() && /^\s*\|/.test(raw) && !/^\s*\|[\s|:-]+\|?\s*$/.test(raw)) {
        const firstCell = raw.split("|")[1]?.trim().toLowerCase() ?? "";
        if (firstCell && firstCell !== "claim") {
          flag(file, ln, "MISSING", "evidence row has no provenance token in Location cell");
        }
      }
    }
  }
}

// Collect wiki/sources/*.md and wiki/syntheses/*.md.
function mdFiles(dir) {
  const abs = join(wikiRoot, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(abs, f));
}

const targets = [...mdFiles("wiki/sources"), ...mdFiles("wiki/syntheses")];

if (!existsSync(join(wikiRoot, "wiki"))) {
  console.error(`lint-citations: no wiki/ under ${wikiRoot} (pass --wiki <path>)`);
  process.exit(2);
}

for (const f of targets) lintFile(f);

if (asJson) {
  console.log(JSON.stringify({ wikiRoot, scanned: targets.length, findings }, null, 2));
  process.exit(findings.length ? 1 : 0);
}

const RED = "\x1b[0;31m", YEL = "\x1b[1;33m", GRN = "\x1b[0;32m", DIM = "\x1b[2m", RST = "\x1b[0m";
const color = { MISSING: YEL, MALFORMED: RED, UNRESOLVABLE: RED };
for (const f of findings) {
  console.log(`${f.file}:${f.line}: ${color[f.level]}${f.level}${RST}: ${f.msg}`);
}
if (findings.length === 0) {
  console.log(`${GRN}✓${RST} citations clean ${DIM}(${targets.length} page(s) scanned)${RST}`);
} else {
  const by = findings.reduce((a, f) => ((a[f.level] = (a[f.level] || 0) + 1), a), {});
  const parts = Object.entries(by).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ");
  console.log(`\n${RED}✗${RST} ${findings.length} finding(s): ${parts} ${DIM}(${targets.length} page(s) scanned)${RST}`);
}
process.exit(findings.length ? 1 : 0);
