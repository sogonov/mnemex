#!/usr/bin/env bash
# qmd-embed.sh — run `qmd embed` resiliently until every chunk is vectored.
#
# On a large first-time embed the model session can expire partway through: the
# single `qmd embed` invocation stops early yet still exits 0, leaving thousands
# of chunks un-vectored (and search silently blind to them). You can't tell a
# finished run from an expired one by its output — both print "Embedded N chunks".
# So loop: keep re-running (each pass resumes the remaining chunks) until a pass
# reports there is nothing left. Converges in a handful of passes; capped as a
# backstop. Idempotent and safe to re-run any time.
set -euo pipefail
export QMD_EMBED_MODEL="${QMD_EMBED_MODEL:-hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf}"

MAX="${QMD_EMBED_MAX_PASSES:-15}"
for i in $(seq 1 "$MAX"); do
  out="$(qmd embed 2>&1)" || true
  echo "$out" | tail -2
  if echo "$out" | grep -qiE "already have embeddings|nothing to embed|Embedded 0 chunks|up to date|^0 (documents?|chunks?) need"; then
    echo "==> Embeddings complete (pass $i)."
    exit 0
  fi
  echo "==> pass $i left chunks un-vectored (embed session likely expired) — resuming…"
done
echo "==> WARNING: embeddings still incomplete after $MAX passes. Re-run 'scripts/qmd-embed.sh' to continue." >&2
exit 1
