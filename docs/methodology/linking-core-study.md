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

> Updated after this session — the mnemex column reflects what was BUILT (suggest-links, UNTYPED lint), with honest measured status. ⬆ = improved this session.

| Axis | llm-wiki-compiler | claude-obsidian | mnemex (after this session) |
|---|---|---|---|
| **Edge creation** | ✅ deterministic: `resolver.ts` links **every** title-mention exhaustively | 🟡 prose fan-out **quota** (8–15), no engine to find targets | ◑ **`suggest-links`** ⬆ — qmd surfaces missed candidates, agent types them (was ❌ memory-only) |
| **Retroactive self-heal** | ✅ `resolveInboundLinks` rescans ALL pages when a new concept appears | ❌ | 🟡 can run `suggest-links` on any page on demand; not auto-on-new-concept (still no true self-heal) |
| **Backlinks / bidirectional** | ✅ `buildAdjacency` incoming edges, free | 🟡 soft "check B links back", rots | 🟡 `## Referenced by` hand-maintained (unchanged) |
| **Edge TYPING** | ❌ collapses to `reason:"wikilink"` | 🟡 typed-by-section, generic templates collapse to `## Connections` | ✅ typed + weighted + consumed by `graph-expand`; **UNTYPED lint** ⬆ now nudges the convention |
| **Semantic edges** | ❌ title-mention only — two related pages that never name each other are NEVER linked | 🟡 whatever the agent read | ✅ **`suggest-links`** ⬆ — semantic (qmd), the exact edge llmwiki structurally cannot make |
| **Measurement** | 🟡 floors (`minWikilinks`) — a floor is not recall | ❌ nothing | ✅ measures retrieval **and the linking itself** ⬆ (suggester 73% precision, +6% graph density) |

**Honest verdict (updated).** llmwiki still wins on **mechanical completeness + retroactive
self-heal** (auto-rescan of old pages on a new concept — mnemex has no true equivalent) — but that
completeness is **exhaustive, not precise**: its string resolver is a measured ~50%-noisy mechanism
(see *Rejected: link-mentions*), whereas mnemex's semantic suggester hits 73% by disambiguating
polysemy. cobsidian wins
on typed + contradiction discipline breadth. mnemex wins on **typed-edge quality + provenance +
measurement**, and — after this session — **closed its one big gap: semantic connection DISCOVERY**
via `suggest-links` (qmd), measured at 73% precision / +6% graph density. So no system dominates: the
remaining mnemex weakness is retroactive self-heal; its edge is semantic discovery + typing + the fact
that it is the only one that *measures* its own linking.

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

## Measured results (2026-07-03) — precision, coverage, latency

Built, then **measured** on the real 615-page `brain-wiki` (not asserted). Candidates generated for a
deterministic 40-page sample; each candidate judged **should-link yes/no by a strict independent agent
(one per source page, blind to the score)** that read both pages and required a genuine typed
relationship, not same-topic proximity.

| metric | value | note |
|---|---|---|
| **Precision** | **73%** (33/45 candidates) | ~3 of 4 suggestions are genuine missed links; the agent gates the rest |
| by score band | 0.40–0.45 → 76% · 0.45+ → 70% | **score does NOT discriminate above the floor** — raising min-score wouldn't help; 0.4 is right |
| **Coverage** | **21/40 pages** get ≥1 candidate (~1.1/page) | sparse by design — doesn't flood; ~half the pages get nothing (niche or already well-linked) |
| **Latency** | **~15s/page** (qmd rerank on CPU) | an ingest of 10–15 pages spends 2.5–4 min here — a real cost, not "instant" |

The 27% false positives are honest and obvious on reading: title coincidences (`Adam-Wathan` →
`Martin-Fowler`, "superficial Refactoring word-match"), same-broad-topic (`Bronze-Silver-Gold` →
`Stability-Patterns`, "different subdomain"), metaphorical ties (`DORA` → `Validated-Learning`). All
the kind a human rejects in one glance — which is exactly the propose-agent-gates contract.

### Did the CORE actually get better? Before/after graph density (the real question)

Precision measures the tool; this measures the **wiki**. The 33 judge-verified true candidates are
links the agent authored the page WITHOUT — genuine misses the suggester recovers. Against the pages'
**existing** authored links (counted from the wiki), that is the real completeness gain:

| | resolvable page-links |
|---|---|
| **before** (40 sampled pages, existing) | 553 (avg 13.8/page) |
| recovered genuine misses (judge-verified) | +33 |
| **after** | 586 |

- **+6% denser corpus-wide** (553 → 586); **+11% on the 21 pages the tool touched** (304 → 337).
- **+1.6 genuine links per touched page.**

**Honest read — real but MODEST, and it corrects the study's own premise.** The synthesis claimed the
agent "links ~5 of the 20 it should." That was wrong: the pages already average **13.8 links** — the
agent links *densely* by memory. The suggester recovers **~1.6 more genuine links per touched page**
(on ~half the pages), for **+6% corpus density** at **73% precision** and **~15s/page**. It is a real,
judge-verified improvement to graph completeness — not the transformation the "5 of 20" framing
implied. Caveats: the gain is a **lower bound** on the true gap (the tool only recovers what it
surfaces above the floor — genuinely-missed links that aren't semantically close are not counted); and
"before" links are assumed correct (the agent authored them deliberately). Decision: **kept on** as
ingest step 6 — a measured +6% completeness for a few minutes/ingest — but framed honestly as a modest
discovery aid, not a core-transforming lever.

**Honest confidence:** the suggester is now *measured*, not hoped — 73% precision, sparse, ~15s/page.
It genuinely surfaces missed connections; it is not perfect and not fast. Earlier "~2s/page" was a
wrong extrapolation from a single warm query; the real batch cost is ~15s/page.

> **Correction note.** An earlier version of this doc / the script header claimed "~2s/page warm."
> That was extrapolated from one back-to-back warm query and is wrong — the measured per-page cost in
> a real batch is ~15s. Latency is a genuine cost to weigh, not a footnote.

## Rejected: deterministic title-mention linking (`link-mentions`) — measured 48%, cut

llmwiki wins the *mechanical-completeness* axes (edge creation / retroactive self-heal / backlinks)
with a deterministic resolver: scan page bodies for exact mentions of other pages' titles and link
them. It looked cheap and high-precision to match ("if the prose literally names a concept, linking
it is surely right"), so it was built (`link-mentions.mjs`, suggest-only, with a specificity guard)
and **measured** on the real brain: a full scan found **1,820 unlinked title mentions across 525/615
pages**; a 40-pair sample was judged should-link/no by strict independent agents.

**Result: 48% precision (19/40) — WORSE than the semantic suggester's 73%. Cut, not shipped.**

- **Why: polysemy (17 of 21 false positives).** Page titles are often common words that mean
  different things in context — `Partitioning` (DB sharding vs. architectural decomposition),
  `Delegation` (a `delegate()` call vs. management), `Output` (Newport's craft sense vs. Cagan's
  outcome-vs-output). Exact string match is context-blind; the semantic reranker isn't (a chunk about
  DB partitioning doesn't semantically match an architecture page), which is exactly why
  suggest-links scores 73% and this scores 48%. The remaining 4 were our own over-reach (matching
  aliases with a hyphen like `lock-in` that slipped the specificity guard).
- **Does llmwiki avoid it? No — it's worse, just unmeasured.** Its `resolver.ts` (read directly)
  matches the frontmatter `title` with **no** length/stopword/specificity guard at all (we at least
  skip short generic words), and it **auto-writes** the link into the page — so its polysemy errors
  become wrong links polluting the wiki, where ours were only suggestions an agent rejects. llmwiki's
  own code review lists this as a weakness. Its eval measures retrieval, never link correctness, so
  the noise is invisible. **Their "win" on these axes is an unmeasured ~50%-noisy mechanism.**
- **Takeaway.** Matching llmwiki's string resolver is not worth it — the semantic suggester is the
  strictly better mechanism (73% > 48%) *because* it disambiguates polysemy. We do not need to close
  the mechanical-completeness gap with string matching; we already beat it on precision with meaning.
  Negative result kept on the record, same as the breadcrumb test.

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
