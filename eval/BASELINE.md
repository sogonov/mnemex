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
node eval/metrics.mjs --selftest && node eval/stats.mjs --selftest           # unit tests
```
