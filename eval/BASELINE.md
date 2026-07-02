# Eval baseline — Phase 1 (2026-07-02)

First real run of `node eval/run.mjs` over the built corpus (see `corpus.md`).
This is the **before** number; Phase 2 (Contextual Retrieval) re-runs the same
fixture + questions unchanged to produce the before/after delta for the relaunch.

## Corpus

**16 public-domain Gutenberg classics** (strategy, ethics, politics, self-direction, science),
ingested into 16 source pages + 1 synthesis (`eval/.wiki/wiki/`, tracked; raw texts gitignored —
rebuild via `corpus.md`). Every extracted claim carries a line-level `^[raw:Lstart-Lend]` token;
lint passes clean (17 pages). The pages carry ~45 hand-typed cross-book edges
(`Contrasted with` / `See also` / `Builds on`). The original arm-A/per-backend numbers below were
measured on the first 4-book / 5-page cut; the arm-C ablation is on the full 16-book / 17-page set.

**Independent-authorship protocol (breaks circularity).** The typed edges and the 36 cross-source
eval queries were produced by **two separate agent pools running concurrently, each blind to the
other's output**: edge-authors read a book and wrote its page + edges without seeing any query;
query-authors read the raw books and wrote cross-source questions without seeing any edge. So a
query landing on an edged pair reflects real relatedness, not an author teaching to the test.

## Headline

| Metric | Value |
|---|---|
| Retrieval recall (hybrid) | **0.94** |
| Retrieval recall@3 (hybrid) | 0.91 |
| Citation correctness | **1.00** (16/16 gold answers resolve to a real token) |
| **Combined score** | **0.97** |

## Retrieval by backend (why hybrid matters)

| Backend | avg_recall | recall@3 | MRR |
|---|---|---|---|
| bm25 (keyword) | 0.375 | 0.375 | 0.375 |
| vector (Qwen3) | 0.656 | 0.656 | 0.719 |
| **hybrid** | **0.938** | 0.906 | 0.927 |

Keyword-only finds ~⅜ of targets; multilingual vectors roughly double that;
hybrid (BM25 + vector + rerank) nearly closes the gap. This is the graph.

## Credibility-grade retrieval baseline — arm A (plain hybrid)

`node eval/run-retrieval.mjs` (rank-aware metrics, stratified buckets, bootstrap CI,
dev+holdout split). This is **arm A** of the Phase-2 ablation (plain qmd hybrid, no
breadcrumb, no graph). Same corpus + the `mnemex-wiki` collection.

| bucket | n | nDCG@10 | R@10 | note |
|---|---|---|---|---|
| exact/title | 3 | 100.0 | 100 | trivial |
| single-hop | 9 | 100.0 | 100 | trivial |
| **cross-source** | 4 | **64.3** | 75 | the weak spot → target of typed-graph expansion (arm C / 2c) |
| **cross-lingual (RU→EN)** | 6 | **83.3** | 83.3 | **the moat**: Russian questions retrieve English source pages, 5/6 |
| **OVERALL** | 22 | **89.0** | 90.9 | headline nDCG@10, 95% CI [76.7, 98.4] |

- **no-answer control: 4/4 abstained** (borscht / kubernetes / quantum / neural-net → qmd
  returns nothing, top score 0.00). The eval is built to catch failures, not hide them.
- **Cross-lingual is the demonstrable win** competitors' English-default stacks cannot produce.
  The one miss (`xl-control-ru`, "не в нашей власти" → Meditations) is an honest RU-phrasing gap —
  a candidate for corpus-language HyDE / graph expansion.
- **Arms B (contextual breadcrumb) and C (typed-graph expansion)** re-run this identical fixture;
  the delta on the `cross-source` and `cross-lingual` buckets is the relaunch graph.

## Arm C — typed-graph expansion (4-arm ablation; the honest result)

An adversarial audit killed the first, naive "arm A vs arm C" measurement: arm C both added
graph neighbors **and** switched qmd's RRF-blend ordering for a pure cross-encoder pass (applied
only when the graph fired) — so its "+14 pt" lift was **confounded** by the extra rerank, and the
held-out queries were **circular** (the same author wrote both the edges and the queries).
`node eval/run-retrieval-graph.mjs` now runs a 4-arm ablation to isolate the graph:

- **A** = qmd hybrid order (`store.search`) — the product baseline.
- **B** = pure cross-encoder rerank of the **seeds only** (no graph).
- **C** = pure cross-encoder rerank of **seeds ∪ graph-neighbors** (B + graph).
- **D** = pure cross-encoder rerank of **every page** (ceiling: "just consider all").

`A→B` is the ranking-function switch; **`B→C` is the graph's true marginal effect**; `C vs D`
asks whether the graph beats brute-force "rerank everything."

**Measured on the enlarged, independent-authorship setup** (16-book corpus → 17 pages; the typed
edges and the cross-source queries were written by **separate agent pools, each blind to the
other's output** — see `corpus.md`; fixture `fixture-retrieval-v2.json`, 36 independent
cross-source queries):

| bucket | n | A | B | C | D |
|---|---|---|---|---|---|
| exact/title | 3 | 100.0 | 100.0 | 100.0 | 100.0 |
| single-hop | 9 | 88.9 | 88.9 | 88.9 | 100.0 |
| cross-lingual (RU→EN) | 6 | 83.3 | 83.3 | 83.3 | 100.0 |
| **cross-source** | 36 | 74.8 | 76.4 | **87.6** | **91.6** |

Cross-source split by whether a typed edge actually bridges the gold pair (auto-detected):

| slice | n | B (rerank seeds) | C (+graph) | Δ (B→C) | permutation p |
|---|---|---|---|---|---|
| **edged** | 32 | 77.0 | **89.8** | **+12.8** | **0.0016** |
| **un-edged** | 4 | 71.0 | 70.4 | −0.5 | 1.0 |

**Honest read — the graph now shows a real, significant effect, but does not yet beat brute force.**
- **Significant and NOT circular:** on edged pairs, graph expansion lifts nDCG@10 **+12.8 pts
  (p = 0.0016)** — and the queries were authored **independently** of the edges (separate blind
  agent pools), so this is not the earlier self-authored artifact. When two genuinely-related books
  are asked about together, walking the typed edge surfaces the second source the seed retrieval
  ranked low.
- **Bounded, as it should be:** on **un-edged** pairs the graph adds **nothing** (Δ ≈ 0) — no edge,
  no help. That's the correct boundary, not a bug; it says the graph helps exactly where the wiki
  encodes a relationship.
- **Still beaten by brute force here:** arm **D (rerank all 17 pages) = 91.6 > C = 87.6**. On a
  17-page corpus, "consider every page and rerank" is still cheap and slightly better than the
  graph's targeted union. **The graph's real advantage — not having to rerank the whole corpus —
  only pays off when the library is large enough that rerank-all is impractical/noisy.** 17 pages
  isn't there yet; this is a direction, not a shippable win over D.
- Regressions from the bigger corpus: one single-hop query (88.9) and one no-answer (3/4 abstained)
  now find a loose competitor among 17 pages — expected as the corpus grows; arm D still nails them.

**Status.** The typed-graph tier is **no longer "unproven"**: it produces a **statistically
significant, independently-verified** lift over the seeds-only rerank on related-pair questions.
What is **not** yet shown is that it beats simply reranking the whole corpus — that needs a
much larger library (hundreds+ of pages) where rerank-all stops being feasible. External-facing
claim, honestly scoped: *"walking the hand-typed graph gives a significant recall lift over hybrid
retrieval on cross-source questions (p<0.01, independent eval); at small corpus sizes a full
rerank still matches it, so the graph's efficiency edge is pending a larger library."*

## Brain B+ retest — real 615-page corpus (the honest, sobering result)

The 17-page result above left one question: does the graph beat brute force once the corpus is
big enough that rerank-all is infeasible? Tested on the owner's **real `brain-wiki` (615 pages,
his actual software/leadership domain, dense hand-typed concept graph)** with **48 cross-concept
queries authored by 6 agents** reading source summaries + concept names, **blind to the
concept-concept edges** (fixture `fixture-brain.json`). Arm D = rerank a broad top-50 retrieval
(rerank-all is infeasible at 615 pages). 43/48 queries scored before the long SDK run was reaped.

| arm | nDCG@10 (n=43) |
|---|---|
| A qmd hybrid | 73.0 |
| B rerank(seeds) | 79.5 |
| C rerank(seeds+graph) | **82.1** |
| D rerank(broad top-50) | 80.4 |

| comparison | Δ | permutation p | verdict |
|---|---|---|---|
| **A→B** (the rerank switch) | +6.5 | 0.07 | biggest lever — and it's **not the graph** |
| **B→C** (graph over rerank-seeds) | +2.6 | 0.14 | **not significant** |
| **C→D** (graph over broad-pool rerank) | +1.8 | 0.29 | **not significant** |

edged n=33 B→C +1.2 · un-edged n=10 B→C +7.2 (95% CIs C[75.8, 87.9] vs D[73.4, 87.0] overlap heavily).

**Honest verdict — B+ did NOT deliver a significant graph win.**
- **Directional crossover is real:** at 615 pages C (82.1) is on top, edging D (80.4) — reversing
  the 17-page D>C. Encouraging as a point estimate.
- **But nothing is significant:** C-vs-D p=0.29, C-vs-B p=0.14. At n=43 with wide, overlapping CIs
  we **cannot** claim the graph beats brute-force or even rerank-seeds. The dominant, most reliable
  lever is the **cross-encoder rerank itself** (A→B, +6.5), which qmd already does — not the graph.
- **The edged/un-edged flip is informative:** on the brain, directly-linked concepts are so similar
  that seeds already retrieve both (edged Δ only +1.2); the graph helps more when the missing gold
  is reachable via a *seed's* edge, not gold-gold adjacency (un-edged +7.2). The mechanism is real
  but weak and setup-dependent.

**Bottom line across all three corpora (5-page → 17-page → 615-page):** the typed-graph tier is a
**promising but unproven** add-on — directional at scale, never robustly significant. **Reranking
is the real retrieval lever, and mnemex already delegates it to qmd.** The clean, un-confounded,
demonstrable wins remain the **cross-lingual moat** and **provenance/citation** — not the graph.
Resolving the graph would need hundreds of queries (to shrink the CIs) on a large corpus; it is
not a relaunch headline today.

## Contextual breadcrumb / structure recovery — the honest 3-arm test (2026-07-03)

Phase 2b shipped a conversion-time **contextual breadcrumb** (ancestor-path line under nested
headings — mnemex's flavor of Anthropic Contextual Retrieval) and a **structure-recovery** pass
(promote flat Gutenberg `BOOK/CHAPTER` markers → ATX headings). The retrieval benefit was asserted
"structurally, not measured" — the exact vibes-trap this project exists to avoid. So it was tested.

**Design (real power, unlike the earlier under-powered `probe-structure.mjs`).** 6 real
nested-structure books from the owner's library (Kleppmann, Kimball, Fowler, Ousterhout, Voss,
Taleb), indexed **three ways** as separate qmd collections: **A** plain · **B** +breadcrumb ·
**SB** +structure+breadcrumb. **48 context-dependent queries** authored by 6 agents (one per book,
blind to the arms; `eval/probe3-*`), each with a verbatim `gold_phrase` from a deep passage;
queries deliberately share few content words with the gold (tests context, not lexical overlap).
A deterministic gate dropped any fabricated or leaky query (**48/48 passed**). A query is
*chunk-correct* for an arm iff the gold book's best chunk (`bestChunk`) contains the gold phrase.
Scored via the qmd SDK (`store.search`, reranker on), incremental JSONL so a kill never loses data.

| arm | chunk-correct (95% CI) | MRR | book-in-topK |
|---|---|---|---|
| A  plain | 22.9 [13,35] | 0.198 | 100% |
| B  +breadcrumb | 25.0 [13,38] | 0.219 | 100% |
| SB +structure+breadcrumb | 22.9 [10,35] | 0.208 | 100% |

| comparison | Δ | paired permutation p | verdict |
|---|---|---|---|
| **A→B** (breadcrumb) | +2.1 pts | **1.0000** | **not significant** |
| A→SB (structure+breadcrumb) | +0.0 pts | 1.0000 | not significant |
| B→SB (structure added) | −2.1 pts | 1.0000 | not significant |

**Verdict — breadcrumb fails; it was cut from the defaults.** Δ+2.1 is a single query out of 48;
p=1.0; the CIs sit on top of each other. The mechanism is understood: a **per-section** breadcrumb
never reaches the deep chunks qmd splits off (mnemex doesn't control qmd's chunk boundaries, so it
can't do Anthropic's true **per-chunk** prefix), and qmd already embeds `docTitle | text` + chunks
heading-aware — so the breadcrumb's marginal signal is nil. Per the pre-committed decision rule
(*ship default-on only if A→B is significant*), **breadcrumb is now OFF by default** (opt-in
`--breadcrumb`); the code stays for anyone who wants it. **Structure recovery** shows no retrieval
lift either (A≈SB) but is kept default-on on a **separate, non-retrieval** justification — it turns
a 0-heading Gutenberg blob into a navigable, outline-able chaptered document (a deterministic,
visible transformation) and doesn't hurt retrieval. The demonstrated, un-confounded conversion wins
remain **boilerplate strip** (−6,195 lines) and **metadata auto-fill** (16/16 books) — both
deterministic, neither a retrieval claim.

Caveat honestly stated: `book-in-topK` is 100% (6 topically-distinct books → the right book is
always found), so the test measures **chunk selection within the right book**, which is exactly what
a breadcrumb should sway — and it doesn't. A larger, topically-crowded corpus could in principle
stress cross-book disambiguation differently, but on this evidence breadcrumb earns no default slot.

## Reproduce

```bash
export QMD_EMBED_MODEL="hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf"
# breadcrumb/structure 3-arm test: build A/B/SB collections from 6 books, embed, then:
node eval/probe3-score.mjs --fixture eval/probe3-fixture.json --emit eval/probe3-emit.jsonl
node eval/probe3-score.mjs --emit eval/probe3-emit.jsonl --aggregate   # re-report from saved rows
# corpus.md builds eval/.wiki/raw (16 books) + registers the mnemex-wiki qmd collection
node eval/run-retrieval.mjs --label A-plain --out eval/results-A-plain.json  # arm A, buckets, CI
node eval/run-retrieval-graph.mjs --fixture eval/fixture-retrieval-v2.json   # 4-arm A/B/C/D ablation
node eval/metrics.mjs --selftest && node eval/stats.mjs --selftest \
  && node eval/graph-expand.mjs --selftest eval/.wiki/wiki                   # unit tests
```

The eval wiki **pages** (`eval/.wiki/wiki/`, incl. the typed cross-source edges the graph walks)
are committed. Only the raw book texts (`eval/.wiki/raw/`) and the qmd index are rebuilt from
`corpus.md`.
