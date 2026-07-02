#!/usr/bin/env node
// suggest-links.mjs — qmd-powered ingest-time link SUGGESTER (the connection-discovery core).
//
// mnemex builds every edge from single-pass agent memory: the agent links what it
// happened to recall. So a new book connects to ~5 of the 20 pages it should, and
// never links back to a relevant page from months ago. This closes that gap without
// a graph DB or an LLM judge: for each freshly-written page it asks the qmd index
// (already installed) "which existing pages is this most related to?" and prints a
// triage worklist of candidates the page does NOT yet link. The agent reads both
// pages and decides the typed relationship — the script NEVER writes an edge. Same
// "script proposes, agent judges with fresh context" contract as verify-claims.mjs.
//
// This does the one thing llm-wiki-compiler's title-mention resolver structurally
// cannot: link two related pages that never spell each other's name. And it is the
// discovery engine claude-obsidian's prose fan-out quota lacks.
//
// Validated parameters (see docs/methodology/linking-core-study.md):
//   - query = COMPACT (title + ~400-char lead), NOT the whole body — sharper + faster.
//   - reranker ON — surfaces the right neighbors (Entity/Value-Object, not "aggregate"
//     word-matches); warm cost ≈ 2s/page, so ALL target pages run in ONE session
//     (one model load, then ~2s each) rather than a cold process per page.
//   - min-score ≈ 0.4 default (relevant cluster ~0.44–0.93; noise below ~0.40).
//
// HONEST SCOPE: this is connection-DISCOVERY for navigation/synthesis — NOT a proven
// retrieval-recall lever (mnemex's own eval marks the typed graph not-significant at
// scale). It suggests; the agent still reads and types every accepted edge.
//
// Usage:
//   node scripts/suggest-links.mjs [--wiki <path>] [--collection mnemex-wiki]
//        [--page sources/X.md ...] [--n 8] [--min-score 0.4] [--json]
//   (no --page → every page under wiki/; --page limits to the freshly-written ones)
//
// Exit: 0 ok, 2 = setup error, 3 = qmd SDK unavailable. Depends on the installed qmd.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, basename } from "node:path";
import { extractWikiLinks, isPageLink } from "./lint-links.mjs";

const argv = process.argv.slice(2);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const wikiRoot = resolve(val("--wiki", process.env.WIKI_ROOT || process.cwd()));
const collection = val("--collection", "mnemex-wiki");
const N = parseInt(val("--n", "8"), 10);
const MIN = parseFloat(val("--min-score", "0.4"));
const asJson = argv.includes("--json");
const pageArgs = []; for (let i = 0; i < argv.length; i++) if (argv[i] === "--page") pageArgs.push(argv[i + 1]);

const stripFm = (t) => t.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
const titleOf = (rel) => basename(rel).replace(/\.md$/, "").replace(/-/g, " ");
const norm = (p) => (p || "").replace(/^qmd:\/\/[^/]+\//, "").replace(/^\.?\//, "");
const key = (rel) => basename(rel).replace(/\.md$/, "").toLowerCase();

function allPages(dir) {
  const out = [];
  const walk = (d) => { for (const n of readdirSync(d)) { if (n.startsWith(".")) continue; const p = join(d, n); const st = statSync(p); if (st.isDirectory()) walk(p); else if (n.endsWith(".md")) out.push(p); } };
  if (existsSync(dir)) walk(dir);
  return out;
}

const wikiDir = join(wikiRoot, "wiki");
if (!existsSync(wikiDir)) { console.error(`suggest-links: no wiki/ under ${wikiRoot}`); process.exit(2); }

// target pages: --page list (resolved against wiki/) or all pages
let targets = pageArgs.length
  ? pageArgs.map((p) => (existsSync(p) ? p : join(wikiDir, p))).filter((p) => existsSync(p))
  : allPages(wikiDir);
if (!targets.length) { console.error("suggest-links: no target pages"); process.exit(2); }

let createStore;
try { ({ createStore } = await import("@tobilu/qmd")); }
catch { try { ({ createStore } = await import("/opt/homebrew/lib/node_modules/@tobilu/qmd/dist/index.js")); } catch { console.error("suggest-links: qmd SDK not found — is qmd installed? (scripts/setup-search.sh)"); process.exit(3); } }

const store = await createStore({ dbPath: process.env.HOME + "/.cache/qmd/index.sqlite" });

const results = [];
for (const path of targets) {
  const raw = readFileSync(path, "utf8");
  const body = stripFm(raw);
  const rel = relative(wikiRoot, path);
  const self = key(rel);
  // already-linked targets (basenames) + self — never suggest these
  const linked = new Set([self]);
  for (const { target } of extractWikiLinks(raw)) if (isPageLink(target)) linked.add(target.toLowerCase());

  // COMPACT query: title + lead. Validated sharper + ~3x faster than the whole body.
  const q = `${titleOf(rel)}. ${body.slice(0, 400)}`;
  const hits = await store.search({ query: q, collections: [collection], limit: N + linked.size + 5 });
  const cands = [];
  for (const h of hits) {
    const cand = norm(h.file);
    const ck = key(cand);
    if (linked.has(ck)) continue;                 // already linked or self
    if (h.score < MIN) continue;                  // below the noise floor
    cands.push({ page: cand, score: +h.score.toFixed(3), snippet: (h.bestChunk || "").replace(/\s+/g, " ").slice(0, 120) });
    if (cands.length >= N) break;
  }
  results.push({ page: rel, existingLinks: linked.size - 1, candidates: cands });
}
await store.close();

if (asJson) { console.log(JSON.stringify({ collection, minScore: MIN, results }, null, 2)); process.exit(0); }

const B = "\x1b[1m", D = "\x1b[2m", G = "\x1b[0;32m", X = "\x1b[0m";
console.log(`${B}link suggestions${X} ${D}— for each page, existing pages it may want to link (min-score ${MIN}). You decide the typed relationship; reject the off-topic ones.${X}\n`);
let total = 0;
for (const r of results) {
  console.log(`${B}${r.page}${X} ${D}(${r.existingLinks} links already)${X}`);
  if (!r.candidates.length) { console.log(`  ${D}— no new candidates above ${MIN}${X}\n`); continue; }
  for (const c of r.candidates) { total++; console.log(`  ${G}${c.score}${X}  [[${basename(c.page).replace(/\.md$/, "")}]]  ${D}${c.snippet}${X}`); }
  console.log("");
}
console.log(`${D}${total} candidate(s) across ${results.length} page(s). Triage: file each real connection under its typed section (## Builds on / ## Subsumes / ## Contrasted with / ## Contradicts / ## See also); drop the rest.${X}`);
