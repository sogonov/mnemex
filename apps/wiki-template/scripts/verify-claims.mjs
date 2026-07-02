#!/usr/bin/env node
// verify-claims.mjs — fresh-context claim verifier for a mnemex wiki.
//
// lint-citations.mjs checks that a claim's provenance token *resolves* (the raw
// file exists, the line range is in bounds). It cannot check the thing that
// actually matters: do those cited lines *support* the claim, or did the agent
// paraphrase something the source never says? That judgment is semantic — an LLM
// makes it, not a regex. But we don't want the verifier re-reading the whole book
// or re-searching (that's how hallucinations slip back in).
//
// So this script does the MECHANICAL half deterministically: for every claim that
// carries a `^[<raw>:Lstart-Lend]` token, it slices the EXACT cited lines out of
// the immutable raw source and pairs them — producing a verification worksheet of
// (claim ↔ what the source literally says there). A fresh-context agent then reads
// the worksheet and judges support, flagging any mismatch. No human gate, no book
// re-read, no API key — the ingest agent already running does the judgment against
// lines it cannot fabricate.
//
// This is the "fresh-context verifier" claude-obsidian proved out (no manual
// staging queue), realized in mnemex's idiom: a zero-dep script that hands the
// agent an un-fakeable worksheet, judgment stays in prose (CLAUDE.md > Ingest).
//
// Usage:
//   node scripts/verify-claims.mjs [--wiki <path>] [--json] [--page <rel>]
//   node scripts/verify-claims.mjs --selftest
//   (defaults: --wiki = $WIKI_ROOT or the current directory)
//
// Exit: 0 always on a clean parse (it produces a worksheet, it does not judge);
//       2 = setup error. Zero dependencies.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

// ---- pure core (unit-tested via --selftest) ------------------------------

const TOKEN = /\^\[([^\]]+)\]/g;
const RANGE = /^(.+):(\d+)-(\d+)$/;   // raw/books/slug/book.md:412-418

// Strip provenance tokens + leading list/table/quote markers to recover the bare
// claim text a line asserts. \p{L}-safe (no letter-class assumptions).
export function cleanClaim(line) {
  return line
    .replace(TOKEN, "")                 // drop every ^[...] token
    .replace(/^\s*[-*>]+\s*/, "")        // list / blockquote marker
    .replace(/^\s*\|/, "").replace(/\|\s*$/, "")  // outer table pipes
    .replace(/\s*\|\s*/g, " · ")         // inner table cells → separator
    .replace(/\s+/g, " ")
    .trim();
}

// Extract every (claim, line-range-citation) pair from a page's markdown.
// Only range tokens are returned — those are the ones whose exact source lines we
// can slice and show. Chapter-fallback tokens (^[slug#Ch.3]) are counted by the
// caller but can't be sliced, so they're not worksheet rows. Returns
// [{ line, claim, path, from, to }].
export function extractClaimCites(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let inFence = false, fence = "";
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const f = raw.match(/^\s*(`{3,}|~{3,})/);
    if (f) { if (!inFence) { inFence = true; fence = f[1][0]; } else if (f[1][0] === fence) { inFence = false; } continue; }
    if (inFence) continue;
    const claim = cleanClaim(raw);
    let m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(raw)) !== null) {
      const r = m[1].match(RANGE);
      if (!r) continue;                 // chapter fallback — not sliceable
      out.push({ line: i + 1, claim, path: r[1], from: +r[2], to: +r[3] });
    }
  }
  return out;
}

// ---- fs walk + worksheet (script) ----------------------------------------

function mdFiles(wikiRoot, sub) {
  const abs = join(wikiRoot, sub);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).filter((f) => f.endsWith(".md")).map((f) => join(abs, f));
}

const sliceCache = new Map();
function rawLines(wikiRoot, relPath) {
  if (!sliceCache.has(relPath)) {
    const abs = join(wikiRoot, relPath);
    sliceCache.set(relPath, existsSync(abs) && statSync(abs).isFile()
      ? readFileSync(abs, "utf8").replace(/\r?\n$/, "").split(/\r?\n/) : null);
  }
  return sliceCache.get(relPath);
}

function run(wikiRoot, { asJson, onlyPage }) {
  if (!existsSync(join(wikiRoot, "wiki"))) {
    console.error(`verify-claims: no wiki/ under ${wikiRoot} (pass --wiki <path>)`);
    process.exit(2);
  }
  let targets = [...mdFiles(wikiRoot, "wiki/sources"), ...mdFiles(wikiRoot, "wiki/syntheses")];
  if (onlyPage) targets = targets.filter((f) => relative(wikiRoot, f) === onlyPage || f.endsWith(onlyPage));

  const rows = [];
  let missing = 0, oob = 0;
  for (const f of targets) {
    const relPage = relative(wikiRoot, f);
    for (const c of extractClaimCites(readFileSync(f, "utf8"))) {
      const src = rawLines(wikiRoot, c.path);
      let cited = null, note = null;
      if (!src) { note = "raw file not found"; missing++; }
      else if (c.from < 1 || c.to > src.length || c.from > c.to) { note = `range ${c.from}-${c.to} out of 1-${src.length}`; oob++; }
      else cited = src.slice(c.from - 1, c.to).join("\n");
      rows.push({ page: relPage, line: c.line, claim: c.claim, cite: `${c.path}:${c.from}-${c.to}`, cited, note });
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ wikiRoot, pages: targets.length, claims: rows.length, rows }, null, 2));
    process.exit(0);
  }

  const B = "\x1b[1m", DIM = "\x1b[2m", YEL = "\x1b[1;33m", GRN = "\x1b[0;32m", RST = "\x1b[0m";
  console.log(`${B}claim-verification worksheet${RST} ${DIM}— judge each: do the cited lines SUPPORT the claim? flag any that don't.${RST}\n`);
  let cur = "";
  for (const r of rows) {
    if (r.page !== cur) { cur = r.page; console.log(`\n${B}${cur}${RST}`); }
    console.log(`  ${DIM}L${r.line}${RST}  claim: ${r.claim || DIM + "(no text)" + RST}`);
    console.log(`       ${DIM}cited ${r.cite}${RST}`);
    if (r.cited != null) for (const l of r.cited.split("\n")) console.log(`       ${GRN}│${RST} ${l}`);
    else console.log(`       ${YEL}│ ⚠ ${r.note} — run lint first${RST}`);
    console.log("");
  }
  const parts = [`${rows.length} claim(s) across ${targets.length} page(s)`];
  if (missing) parts.push(`${missing} unsliceable (raw missing)`);
  if (oob) parts.push(`${oob} out-of-range`);
  console.log(`${DIM}${parts.join(" · ")}. Verifier: confirm support against the cited lines; flag mismatches with a > [!caution] Unverified callout.${RST}`);
  process.exit(0);
}

// ---- self-test ------------------------------------------------------------

function selftest() {
  let fail = 0;
  const eq = (got, want, name) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fail++; console.log(`  ✗ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); } else console.log(`  ✓ ${name}`); };

  eq(cleanClaim("- Aggregates bound consistency. ^[raw/x.md:10-12]"), "Aggregates bound consistency.", "cleanClaim list+token");
  eq(cleanClaim("| Trust is built | ^[raw/y.md:3-3] | fast |"), "Trust is built · · fast", "cleanClaim table row");
  eq(cleanClaim("> quoted ^[a#Ch.2]"), "quoted", "cleanClaim blockquote + chapter token dropped");

  const md = [
    "## Extracted claims",
    "- Range claim here. ^[raw/books/x/book.md:10-12]",
    "- Chapter-only claim. ^[x#Ch.3]",
    "```", "- Fenced. ^[raw/books/x/book.md:1-1]", "```",
    "- Two cites. ^[raw/books/x/book.md:20-20] and ^[raw/books/x/book.md:30-31]",
  ].join("\n");
  const got = extractClaimCites(md);
  eq(got.map((r) => `${r.from}-${r.to}`), ["10-12", "20-20", "30-31"], "extractClaimCites (range-only, fence-skip, multi-token)");
  eq(got[0].claim, "Range claim here.", "extractClaimCites claim text");
  eq(got.every((r) => r.path === "raw/books/x/book.md"), true, "extractClaimCites path");

  console.log(fail ? `\nFAIL (${fail})` : "\nverify-claims.mjs OK");
  return fail;
}

// ---- entry (only when run directly, NOT when imported) --------------------

if (/(^|\/)verify-claims\.mjs$/.test(process.argv[1] || "")) {
  if (process.argv.includes("--selftest")) process.exit(selftest() ? 1 : 0);
  const argv = process.argv.slice(2);
  let wikiRoot = process.env.WIKI_ROOT || process.cwd();
  let asJson = false, onlyPage = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--wiki") wikiRoot = argv[++i];
    else if (argv[i] === "--json") asJson = true;
    else if (argv[i] === "--page") onlyPage = argv[++i];
    else if (argv[i] === "-h" || argv[i] === "--help") {
      console.log("usage: node scripts/verify-claims.mjs [--wiki <path>] [--json] [--page <rel>]");
      process.exit(0);
    }
  }
  run(resolve(wikiRoot), { asJson, onlyPage });
}
