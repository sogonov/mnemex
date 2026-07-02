# Eval baseline — Phase 1 (2026-07-02)

First real run of `node eval/run.mjs` over the built corpus (see `corpus.md`).
This is the **before** number; Phase 2 (Contextual Retrieval) re-runs the same
fixture + questions unchanged to produce the before/after delta for the relaunch.

## Corpus

4 public-domain Gutenberg books, focused-ingested into 4 source pages + 1
synthesis (`eval/.wiki/`, gitignored — rebuild via `corpus.md`). Every extracted
claim carries a line-level `^[raw:Lstart-Lend]` token; lint passes clean.

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

| bucket | n | A | B | C | D |
|---|---|---|---|---|---|
| exact/title, single-hop | 12 | 100.0 | 100.0 | 100.0 | 100.0 |
| cross-source | 11 | 49.2 | 52.0 | 66.8 | **80.5** |
| cross-lingual (RU→EN) | 6 | 83.3 | 83.3 | 83.3 | **100.0** |

Held-out cross-source, split by whether a hand-typed edge actually bridges the gold pair:

| held-out slice | n | B (rerank seeds) | C (+graph) | Δ (B→C) | permutation p |
|---|---|---|---|---|---|
| **edged** (circular by construction) | 5 | 32.3 | 52.5 | +20.2 | 0.25 |
| **un-edged** (generalization test) | 2 | 61.3 | 61.3 | **0.0** | 1.0 |

**Honest read — the typed-graph leapfrog is NOT demonstrated.**
- **Zero generalization:** on gold pairs I did *not* hand-connect, the graph adds **nothing**
  (un-edged Δ = 0.0). It "helps" only on the exact pairs whose edges I wrote — i.e. it recovers
  what was planted, which is circular.
- **Beaten by brute force:** arm **D (rerank-all-5-pages) = 80.5 > C = 66.8** on cross-source, and
  D fixes the cross-lingual miss too (100 vs 83.3). On a 5-page corpus, "consider every page and
  rerank" dominates graph expansion — the corpus is far too small (k=10 ≥ |corpus|=5) for a graph
  to matter or for recall to be meaningful.
- **What *is* real and un-confounded:** the **cross-lingual moat** (arm A, RU→EN 83%, 5/6) and the
  **no-answer control** (4/4 abstained). Those need no graph.

**Status:** the graph plumbing is built + unit-tested (`graph-expand.mjs --selftest`) and the
cross-encoder-over-union path is verified reachable — but **do not put a typed-graph retrieval
lift in any external claim.** A real test needs (1) a much larger corpus so arm D isn't a ceiling,
(2) **independently-authored** edges and queries, and (3) coverage of un-edged pairs. That is the
next eval increment, not a finished result.

## The 2 misses (Phase 2 targets)

Both are cross-domain queries needing **two** source pages, where only one was
retrieved — the case Contextual Retrieval is meant to fix:

- `cross-leader-character` ("what character should a leader cultivate") →
  expected Meditations + Franklin; got The Prince + the synthesis.
- `cross-strategy-politics` ("outmaneuvering rivals through strategy") →
  expected Art of War + The Prince; got only Art of War.

## Reproduce

```bash
export QMD_EMBED_MODEL="hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf"
# corpus.md steps build eval/.wiki and register the mnemex-wiki qmd collection
node eval/run.mjs                                   # citation + recall (qmd bench)
node eval/run-retrieval.mjs --label A-plain --out eval/results-A-plain.json  # arm A
node eval/run-retrieval-graph.mjs                                            # arm A vs C (graph)
node eval/metrics.mjs --selftest && node eval/stats.mjs --selftest \
  && node eval/graph-expand.mjs --selftest eval/.wiki/wiki                   # unit tests
```

The eval wiki **pages** (`eval/.wiki/wiki/`, incl. the typed cross-source edges the graph walks)
are committed. Only the raw book texts (`eval/.wiki/raw/`) and the qmd index are rebuilt from
`corpus.md`.
