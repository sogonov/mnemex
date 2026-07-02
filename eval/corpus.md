# mnemex eval corpus

A small, **fixed, public-domain** corpus so the eval is reproducible by anyone and legal to
redistribute the *questions* about. Four Project Gutenberg books that map onto mnemex's real
domains (leadership, strategy, self-improvement, psychology) and cross-link naturally.

| # | Book | Author | Gutenberg | raw slug | source page (`wiki/sources/…`) |
|---|------|--------|-----------|----------|-------------------------------|
| 1 | The Art of War | Sun Tzu (Giles tr.) | [132](https://www.gutenberg.org/ebooks/132) | `sun-tzu-art-of-war` | `Art-of-War-Sun-Tzu.md` |
| 2 | The Prince | Machiavelli | [1232](https://www.gutenberg.org/ebooks/1232) | `machiavelli-the-prince` | `The-Prince-Machiavelli.md` |
| 3 | Meditations | Marcus Aurelius | [2680](https://www.gutenberg.org/ebooks/2680) | `marcus-aurelius-meditations` | `Meditations-Marcus-Aurelius.md` |
| 4 | The Autobiography of Benjamin Franklin | B. Franklin | [20203](https://www.gutenberg.org/ebooks/20203) | `franklin-autobiography` | `Autobiography-Franklin.md` |

The `raw slug` and `source page` names are a **contract**: `fixture.json` and `questions.jsonl`
reference them, so ingest must use exactly these names or the eval won't match.

## Build the eval wiki (one-time, ~an afternoon of ingest)

The harness measures a *built* wiki — it does not ingest for you (ingest is an LLM+human loop,
by design). To produce the corpus:

```bash
# 1. Scaffold a throwaway wiki just for eval (kept out of git; see eval/.gitignore).
node packages/cli/dist/index.js init eval/.wiki      # or: mnemex init eval/.wiki
export EVAL_WIKI_ROOT="$PWD/eval/.wiki"

# 2. Fetch the four books via the library MCP (Gutenberg ids above) into
#    $EVAL_WIKI_ROOT/raw/books/<slug>/book.md, then convert with scripts/ingest-book.sh.

# 3. Ingest each book with Claude Code pointed at $EVAL_WIKI_ROOT, following that wiki's
#    CLAUDE.md. Use the exact source-page names from the table above. Every extracted claim
#    MUST carry a ^[raw-path:Lstart-Lend] token (lint enforces it).

# 4. Index for search.
mnemex setup-search --wiki "$EVAL_WIKI_ROOT"

# 5. Fill the gold line ranges in questions.jsonl (the `gold_lines` fields) from the
#    passages you actually cited, then run the eval.
node eval/run.mjs
```

## What "done" looks like

- `fixture.json` queries retrieve the right source pages → **retrieval recall**.
- Each `questions.jsonl` gold answer resolves to a real provenance token in its source page
  → **citation correctness**.
- `run.mjs` prints one combined score. Phase 2 (Contextual Retrieval) re-runs it for a
  before/after delta — that's the graph the relaunch article needs.

## Honesty note

Until the eval wiki is built (steps above), `run.mjs` reports the corpus as *not built* and
scores 0 — that's expected. Phase 1 ships the harness, fixtures, and gold set, not the numbers.
