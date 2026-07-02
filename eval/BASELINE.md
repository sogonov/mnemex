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
node eval/run.mjs            # or: pnpm eval
```
