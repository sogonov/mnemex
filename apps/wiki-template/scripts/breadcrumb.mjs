#!/usr/bin/env node
// breadcrumb.mjs — deterministic contextual-breadcrumb pass for a converted book.
//
// Anthropic's Contextual Retrieval prepends a short "where am I" context to each
// chunk before embedding, cutting top-20 retrieval failure. qmd already embeds
// `docTitle | text` per chunk and chunks heading-aware — so a book's *title* and
// its *nearest* heading are already carried. What a deep chunk of a long, NESTED
// chapter loses is the INTERMEDIATE hierarchy (Part › Chapter › Section). This
// pass re-injects exactly that: under every heading at depth ≥ 2 it writes one
// breadcrumb line naming the ancestor path, in the book's own words (the headings
// themselves) — multilingual-safe, no model, no English bias.
//
// Runs at CONVERSION time (ingest-book.sh), before any wiki claim cites a line —
// so `^[raw:Lstart-Lend]` provenance is computed against the breadcrumbed file and
// stays stable. Idempotent: re-running strips prior breadcrumb lines first.
//
// HONEST SCOPE: marginal over qmd's title+heading baseline; helps only NESTED
// books (flat `# CHAPTER N` texts have no intermediate hierarchy to add, so they
// get nothing — correct, not a bug). Effect is expected small; measure, don't
// assert (eval arm B).
//
// Usage:
//   node scripts/breadcrumb.mjs <book.md> [--stdout] [--strip]
//   node scripts/breadcrumb.mjs --selftest
//   (default: rewrites <book.md> in place)
//
// Exit: 0 ok, 2 = usage/setup error. Zero dependencies.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

// Sentinel-led breadcrumb line. `↪` is language-neutral (one BM25 token) and makes
// the line unambiguously detectable for idempotent re-runs. Italic so it renders
// as a subtle context note, not body prose.
const CRUMB = /^\*↪ .*\*\s*$/;
const SEP = " › ";

// Strip any previously-injected breadcrumb lines. breadcrumbMarkdown inserts a
// blank line then the crumb directly after a heading; it does NOT insert a blank
// AFTER the crumb — so remove only the crumb and its preceding inserted blank,
// leaving the section's own following blank intact (else re-runs eat blank lines).
export function stripBreadcrumbs(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (CRUMB.test(lines[i])) {
      if (out.length && out[out.length - 1] === "") out.pop(); // drop the blank we inserted before
      continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}

// Inject a breadcrumb line under every heading of depth ≥ 2 naming its ancestor
// path (inclusive). Fence-aware (a `#` inside ``` is not a heading). Idempotent.
export function breadcrumbMarkdown(text) {
  const src = stripBreadcrumbs(text).split(/\r?\n/);
  const out = [];
  const stack = [];               // stack[L-1] = heading text at level L
  let inFence = false, fence = "";
  for (const line of src) {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) { if (!inFence) { inFence = true; fence = f[1][0]; } else if (f[1][0] === fence) { inFence = false; } out.push(line); continue; }
    const h = inFence ? null : line.match(/^(#{1,6})\s+(.*\S)\s*$/);
    if (!h) { out.push(line); continue; }
    const level = h[1].length;
    const title = h[2].trim();
    stack.length = level - 1;      // pop deeper/sibling levels
    stack[level - 1] = title;
    out.push(line);
    if (level >= 2) {              // depth 1 == just the title qmd already carries
      const crumbs = stack.slice(0, level).filter(Boolean);
      if (crumbs.length >= 2) { out.push(""); out.push(`*↪ ${crumbs.join(SEP)}*`); }
    }
  }
  return out.join("\n");
}

// ---- self-test ------------------------------------------------------------

function selftest() {
  let fail = 0;
  const eq = (got, want, name) => { const ok = got === want; if (!ok) { fail++; console.log(`  ✗ ${name}:\n--- got ---\n${got}\n--- want ---\n${want}`); } else console.log(`  ✓ ${name}`); };

  const nested = ["# Part I", "intro", "## Chapter 3", "body of ch3", "### 3.2 Foo", "deep body"].join("\n");
  const bc = breadcrumbMarkdown(nested);
  eq(bc, ["# Part I", "intro", "## Chapter 3", "", "*↪ Part I › Chapter 3*", "body of ch3", "### 3.2 Foo", "", "*↪ Part I › Chapter 3 › 3.2 Foo*", "deep body"].join("\n"),
     "nested → ancestor-path breadcrumbs at depth ≥ 2");

  eq(breadcrumbMarkdown(bc), bc, "idempotent (re-run is a no-op)");

  const flat = ["# CHAPTER I", "text", "# CHAPTER II", "more"].join("\n");
  eq(breadcrumbMarkdown(flat), flat, "flat H1-only book → no breadcrumbs (nothing to add)");

  const fenced = ["# Part I", "## Chapter 1", "```md", "## Not a heading", "```", "end"].join("\n");
  const fb = breadcrumbMarkdown(fenced);
  eq((fb.match(/\*↪/g) || []).length, 1, "fence-aware: `##` inside a code block is not a heading");

  const cyr = ["# Часть I", "## Глава 3", "текст"].join("\n");
  eq(breadcrumbMarkdown(cyr).includes("*↪ Часть I › Глава 3*"), true, "\\p{L}-safe (Cyrillic headings)");

  console.log(fail ? `\nFAIL (${fail})` : "\nbreadcrumb.mjs OK");
  return fail;
}

// ---- entry (only when run directly, NOT when imported) --------------------

// ESM runs an imported module top-to-bottom — gate the CLI so importing
// breadcrumbMarkdown() can't rewrite the parent's argv file. See structure.mjs.
if (/(^|\/)breadcrumb\.mjs$/.test(process.argv[1] || "")) {
  if (process.argv.includes("--selftest")) process.exit(selftest() ? 1 : 0);
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith("--"));
  const toStdout = argv.includes("--stdout");
  const stripOnly = argv.includes("--strip");
  if (!file) { console.error("usage: node scripts/breadcrumb.mjs <book.md> [--stdout] [--strip]"); process.exit(2); }
  if (!existsSync(file)) { console.error(`breadcrumb: file not found: ${file}`); process.exit(2); }

  const input = readFileSync(file, "utf8");
  const result = stripOnly ? stripBreadcrumbs(input) : breadcrumbMarkdown(input);
  if (toStdout) { process.stdout.write(result + "\n"); }
  else {
    writeFileSync(file, result.endsWith("\n") ? result : result + "\n");
    const n = (result.match(/^\*↪ /gm) || []).length;
    console.error(`breadcrumb: ${stripOnly ? "stripped" : `injected ${n} breadcrumb(s)`} → ${file}`);
  }
}
