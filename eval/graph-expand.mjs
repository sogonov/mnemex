// graph-expand.mjs — typed-wikilink graph expansion for retrieval. Zero deps.
//
// The leapfrog no flat-RAG competitor can copy: from a seed page, walk the
// HAND-TYPED relationship edges (Contrasted-with / Contradicts / Builds-on /
// Subsumes / See-also / …) to pull in neighbors that flat vector/BM25 misses —
// weighted by edge type, always surfacing Contradicts/Contrasted-with.
//
// Pure over the filesystem (regex + path resolution) → multilingual-safe.
// Self-test: node eval/graph-expand.mjs --selftest [<wiki-collection-root>]

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

// Section heading (lowercased, trimmed) -> { type, weight, surface }.
// weight steers ranking; surface=true means "always include" (contradictions/contrasts
// are the whole point of a compounding library — never let them be pruned).
const EDGE_TYPES = [
  { re: /^contrasted with/, type: "contrasted-with", weight: 1.0, surface: true },
  { re: /^contradict/, type: "contradicts", weight: 1.0, surface: true },
  { re: /^builds on/, type: "builds-on", weight: 0.8, surface: false },
  { re: /^subsumes/, type: "subsumes", weight: 0.8, surface: false },
  { re: /^sources surveyed/, type: "surveys", weight: 0.7, surface: false },
  { re: /^(concepts involved|key concepts)/, type: "concept", weight: 0.6, surface: false },
  { re: /^referenced by/, type: "referenced-by", weight: 0.6, surface: false },
  { re: /^see also/, type: "see-also", weight: 0.5, surface: false },
];

function edgeFor(heading) {
  const h = heading.trim().toLowerCase();
  return EDGE_TYPES.find((e) => e.re.test(h)) || null;
}

/** All markdown files under a wiki collection root, as basename -> collection-relative path. */
export function buildPageIndex(root) {
  const index = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith(".md")) index.set(name.replace(/\.md$/, ""), relative(root, p));
    }
  };
  walk(root);
  return index;
}

/** Extract [[Page]] links grouped by the typed section they appear under. */
export function parseTypedLinks(text) {
  const out = [];
  let edge = null; // current typed section, or null
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^#{2,}\s+(.*)$/);
    if (h) { edge = edgeFor(h[1]); continue; }
    if (!edge) continue;
    for (const m of line.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
      out.push({ page: m[1].trim(), ...edge });
    }
  }
  return out;
}

/**
 * Expand a seed page into weighted neighbors.
 * seedRel: collection-relative path (e.g. "sources/The-Prince-Machiavelli.md").
 * Returns [{ target, edgeType, weight, surface }] for neighbors that resolve to real pages,
 * deduped (best weight wins), excluding the seed itself. maxPerType caps fan-out per edge type.
 */
export function expand(seedRel, root, { maxPerType = 4, index = null } = {}) {
  const idx = index || buildPageIndex(root);
  const abs = join(root, seedRel);
  if (!existsSync(abs)) return [];
  const links = parseTypedLinks(readFileSync(abs, "utf8"));
  const byType = new Map();
  const best = new Map(); // target -> {target,edgeType,weight,surface}
  for (const l of links) {
    const target = idx.get(l.page);
    if (!target || target === seedRel) continue; // unresolved link or self
    const seen = (byType.get(l.type) || 0);
    if (seen >= maxPerType) continue;
    byType.set(l.type, seen + 1);
    const prev = best.get(target);
    if (!prev || l.weight > prev.weight) best.set(target, { target, edgeType: l.type, weight: l.weight, surface: l.surface });
  }
  return [...best.values()].sort((a, b) => b.weight - a.weight);
}

// ---- self-test ----
function selftest(root) {
  let fail = 0;
  const idx = buildPageIndex(root);
  console.log(`  page index: ${idx.size} pages`);
  const seed = "sources/The-Prince-Machiavelli.md";
  const nb = expand(seed, root, { index: idx });
  console.log(`  expand(${seed}):`);
  for (const n of nb) console.log(`    ${n.surface ? "★" : " "} ${n.edgeType.padEnd(15)} w=${n.weight}  ${n.target}`);
  const targets = new Set(nb.map((n) => n.target));
  const want = ["sources/Meditations-Marcus-Aurelius.md", "sources/Autobiography-Franklin.md", "sources/Art-of-War-Sun-Tzu.md"];
  for (const w of want) {
    if (!targets.has(w)) { fail++; console.log(`  ✗ expected neighbor missing: ${w}`); }
  }
  // Contrasted-with must be surfaced (weight 1.0).
  const contrasted = nb.filter((n) => n.edgeType === "contrasted-with");
  if (!contrasted.length || !contrasted.every((n) => n.surface)) { fail++; console.log("  ✗ contrasted-with not surfaced"); }
  // Self must be excluded.
  if (targets.has(seed)) { fail++; console.log("  ✗ seed not excluded"); }
  console.log(fail ? `\nFAIL (${fail})` : "\ngraph-expand.mjs OK");
  return fail;
}

if (process.argv.includes("--selftest")) {
  const root = process.argv[process.argv.length - 1];
  const r = root && !root.endsWith("--selftest") ? root : join(process.cwd(), "eval/.wiki/wiki");
  process.exit(selftest(r) ? 1 : 0);
}
