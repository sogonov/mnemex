# Strengthening the core: ingest + connection-building (study + plan)

> **Status:** design study (2026-07-03). Multi-agent deep-read of the linking cores of
> `llm-wiki-compiler`, `claude-obsidian`, and mnemex, plus an adversarial verification pass that
> rejected ~half the first design. This records the honest head-to-head, the one validated keystone,
> what was cut and why, and the plan (validate → build).

mnemex's **core** is ingest + **connection-building** (linking ideas/sources into a compounding
graph). Retrieval is delegated to qmd; acquisition is the moat that feeds ingest. Everything else
(conversion pipeline, lint, verify, eval) is plumbing around this core. So the core is where a
significant improvement lives.

## Head-to-head on connection-building

| Axis | llm-wiki-compiler | claude-obsidian | mnemex today |
|---|---|---|---|
| **Edge creation** | ✅ deterministic: `resolver.ts` links **every** title-mention exhaustively | 🟡 prose fan-out **quota** (8–15), no engine to find targets | ❌ single-pass **agent memory** only |
| **Retroactive self-heal** | ✅ `resolveInboundLinks` rescans ALL pages when a new concept appears | ❌ | ❌ ("disconnected islands" — worked around by batch-by-theme) |
| **Backlinks / bidirectional** | ✅ `buildAdjacency` incoming edges, free | 🟡 soft "check B links back", rots | 🟡 `## Referenced by` hand-maintained, silently rots |
| **Edge TYPING** | ❌ collapses to `reason:"wikilink"`; rich LLM relations (contradicted_by, confidence) never reach the graph | 🟡 typed-by-section, but generic templates collapse to one `## Connections` | ✅ typed + weighted + surfaced, **and consumed** by `graph-expand` |
| **Semantic edges** | ❌ title-mention only — two related pages that never name each other are NEVER linked | 🟡 whatever the agent read | ❌ none at ingest |
| **Measurement** | 🟡 floors (`minWikilinks`) — a floor is not recall | ❌ nothing | ✅ measures whether the graph *helps retrieval* (4-arm ablation) |

**Honest verdict:** no system dominates. llmwiki wins on **mechanical completeness + retroactive
self-heal** (the one thing prose-by-memory fundamentally can't do). cobsidian wins on **typed +
contradiction discipline breadth**. mnemex wins on **typed-edge quality + provenance + measurement**
— but has **zero connection DISCOVERY**: every edge is born from single-pass agent memory + a lossy
~500-word `hot.md`.

**The opening:** llmwiki's programmatic graph is *strictly weaker* than an LLM/engine on one axis —
it can only make an edge when one page literally spells another's title. A qmd-powered semantic
suggester makes exactly the edges its resolver structurally cannot, and supplies the discovery
engine cobsidian's quota lacks — bolted onto mnemex's already-superior typing.

## mnemex's real gaps (verified against our code)

1. **No connection discovery.** qmd is wired only to query-time retrieval, never to ingest.
2. **No retroactive inbound.** A book ingested today never links back to relevant pages from months ago.
3. **Backlinks rot silently.** `## Referenced by` is hand-maintained; orphan lint only fires on *total* absence of inbound links.
4. **Inline links are invisible to the graph.** `graph-expand.parseTypedLinks` counts only the FIRST wikilink under a typed heading; prose links aren't edges — retrieval silently depends on agent discipline.
5. **The two hardest judgment-lints ship with zero tooling:** semantic near-duplicate concepts, and implicit concepts (a term on 3+ pages with no page).

## The keystone (validated GO): `suggest-links.mjs`

A qmd-powered, **ingest-time link SUGGESTER**. For each freshly-written page, query the existing
wiki (hybrid BM25+vector+rerank, already installed) → a markdown worklist of top-N existing pages
the new page does **not** yet link, each with score + matched snippet. The agent triages into typed
sections (accept/reject), exactly mirroring `verify-claims.mjs`'s "script proposes candidates, agent
judges with fresh context" contract. **Never writes edges itself.** ~90 LOC, zero-dep, qmd-delegating.

This is the single change that most strengthens the core: it converts connection-building from pure
single-pass recall into **retrieval-assisted recall**, using infrastructure already paid for.

## What the adversarial pass CUT (and why) — read before building

The first design bundled 6 steps; verification returned `holds: false`. Rejections stand:

- **Do NOT sell any of this as "improves retrieval."** Our own `eval/BASELINE.md` shows the typed
  graph is **not a significant retrieval lever** at 615 pages (B→C p=0.14, C→D p=0.29), and
  `HANDOFF.md` explicitly parked it and cut it from the pitch. Value = **navigation / synthesis /
  browsing**, not recall. Every "real recall hole" justification is refuted by our data.
- **Edge-recall / "completeness" metric — NO-GO.** There is no gold edge set: the eval fixture pairs
  are *query→relevant-doc*, not *which-pages-should-link* ground truth. `accepted N of M` measures
  suggester/agent agreement, not completeness. Keep only a descriptive accept-count; don't call it
  completeness (true completeness needs human-labeled edges — the honest price).
- **Typed reciprocity — PARTIAL only.** Restrict to genuinely symmetric relations that exist in
  `graph-expand`'s `EDGE_TYPES` (Contradicts↔Contradicts, Contrasted-with↔Contrasted-with). The
  invented `part-of` / `prerequisite-of` inverses are unenforceable (no such sections).
- **Promote `graph-expand` into the product — NO-GO.** Contradicts the parked-graph decision; if its
  structural-neighbor signal is wanted, import from `eval/` as an advisory helper, or raise promotion
  to the owner explicitly — don't smuggle it in as "relocation."
- **Auto-written backlinks — drop.** Obsidian provides backlinks natively; product retrieval ignores
  the graph anyway; auto-mutating N target pages per ingest fights the two-phase/sub-agent ingest.
- **Per-type link floor** keys on a `comparison` type that doesn't exist (types are
  entity|concept|source|synthesis); a floor is llmwiki's `minWikilinks`, which the design elsewhere
  derides. Keep only the **section-aware warning** (inline-vs-typed) as an advisory density nudge.

## Plan (validate → build)

1. **Validate qmd behavior first (this doc's next step, before any code).** Open questions the
   adversary flagged as *unvalidated assumptions*: (a) does qmd behave sanely when the query is a
   whole **page body** (its reranker isn't tuned for book-length inputs), or is `title + lead +
   key-concepts` a better query? (b) calibrate `minScore` empirically on the real `brain-wiki`
   (615 pages) — 0.5 was arbitrary. (c) latency of one rerank call per page × 10–15 pages/ingest.
2. **Build `suggest-links.mjs`** (~90 LOC) framed as candidate **suggestion**, agent gates. Hard N
   cap; accepted suggestions must fit an existing typed section.
3. **Section-aware lint** (extend `lint-links.mjs`): warn when an important body link sits outside any
   typed section (invisible to the graph). Real, verified gap. Advisory.
4. Everything else: advisory navigation aids or dropped, per the cuts above.

**Sources:** cloned `atomicstrata/llm-wiki-compiler` (`src/compiler/resolver.ts`, `src/context/graph.ts`,
`build.ts`, `ranking.ts`, `src/linter/rules.ts`, `src/schema/`, `src/compiler/prompts.ts`),
`AgriciDaniel/claude-obsidian` (`skills/wiki-*`, `_templates/`), mnemex (`apps/wiki-template/CLAUDE.md`,
`templates/`, `eval/graph-expand.mjs`, `apps/wiki-template/scripts/lint-links.mjs`). Full agent
findings in the workflow transcript.
