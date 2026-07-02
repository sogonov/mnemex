# mnemex retrieval — best-in-class design (supersedes the Phase-2 draft)

> **Status:** build spec. This document replaces the earlier "Contextual retrieval —
> design (Phase 2)" draft, which scoped only a single technique (a contextual-prefix
> shadow collection). That draft was correct but under-reaching: it optimized the raw
> layer and ignored the two assets that actually make mnemex best-in-class — the
> **compiled synthesis tier** and the **hand-typed wikilink graph**. This spec keeps the
> contextual-prefix idea (downgraded to its cheapest form) and adds the graph-retrieval
> tier, cross-source decomposition, and a credibility-grade eval.
>
> Grounded in 8 research dossiers (referenced below as **[D1]**…**[D8]**), a code-read of
> `qmd` internals **[D6]**, the two competitors' source **[D7]**, and mnemex's own files
> (`eval/BASELINE.md`, `apps/wiki-template/CLAUDE.md`, `apps/wiki-template/scripts/ingest-book.sh`).
> Nothing here rebuilds what `qmd` owns.

> **⚠ Correction (verified against the installed qmd SDK + context7 docs + a live test, 2026-07-02).**
> The design below names a public `QMDStore.rerank(query, docs)` for reranking an
> externally-assembled candidate union (Tier 4). **No such method exists on the *public*
> `QMDStore` interface** and context7's qmd docs describe reranking only *inside* the `query`
> pipeline (top-30 of qmd's own retrieval). **But the capability is real:** the internal `Store`
> (reachable via `createStore().internal`) exposes a **typed** method
> `rerank(query, {file,text}[], model?, intent?) → {file,score}[]` (`dist/store.d.ts`).
> A live test (`createStore({dbPath: ~/.cache/qmd/index.sqlite}).internal.rerank(...)`) ranked
> *"feared or loved" → The Prince 0.73 > Art of War 0.50 > borscht recipe 0.50* — **correct.**
> **Consequence:** Tier-4 union cross-encoder rerank **is feasible** via `store.internal.rerank`
> — an *internal* (not-in-README) but typed, working API. Ship it behind a runtime feature-guard
> (`typeof store.internal?.rerank === 'function'`) with **deterministic union ordering**
> (edge-weight × seed rank) as the fallback if a future qmd drops the internal method. So 2c keeps
> the real cross-encoder union rerank; only the *method path* changes (`store.internal.rerank`,
> not a fabricated public `QMDStore.rerank`). See the corrected Decision #2.

> **⚠ Measurement status (updated 2026-07-02) — graph effect now SIGNIFICANT & independent, but
> not yet beating brute force.** A 4-arm ablation (A qmd hybrid · B rerank-seeds · C
> rerank-seeds+graph · D rerank-all; `eval/run-retrieval-graph.mjs`, see `eval/BASELINE.md`) was
> re-run on a **16-book / 17-page** corpus with **36 independently-authored** cross-source queries
> (edges and queries written by separate agent pools, each blind to the other — the circularity
> fix). Result: on **edged** pairs the graph lifts nDCG@10 **+12.8 pts, p = 0.0016** (real,
> not self-authored); on **un-edged** pairs **Δ ≈ 0** (correct boundary — no edge, no help). BUT
> **arm D (rerank all 17 pages) = 91.6 > C = 87.6**: at this corpus size a full rerank still edges
> out the graph. So the graph's *lift over hybrid* is proven and significant; its *efficiency
> advantage* (avoiding a full-corpus rerank) is **pending a much larger library** where rerank-all
> is impractical. Honestly-scoped external claim OK: "significant recall lift over hybrid on
> cross-source questions (p<0.01, independent eval)"; NOT yet "beats reranking the whole corpus."
> The earlier +20 pt / p=0.25 self-authored number is superseded. The cross-lingual moat (arm A)
> remains the other un-confounded win.

**Dossier key:** D1 contextual-retrieval · D2 GraphRAG · D3 query-understanding ·
D4 multilingual · D5 eval-methodology · D6 qmd-capability-audit · D7 competitor-exploit-list ·
D8 mnemex-substrate-advantage.

---

## 1. Thesis

**The retrieval unit is a compiled, typed graph node — not a chunk.**

Every competitor does flat RAG: chunk raw text → embed → retrieve at query time → generate.
Their recall is capped by a single channel over context-poor fragments **[D7]**. mnemex
inverts this. Knowledge is **compiled once** at ingest into two coupled artifacts that no
flat-RAG system has:

1. A **synthesis tier** — hand/LLM-authored concept, source, and synthesis pages. A synthesis
   page is a *maximally-contextual retrieval unit*: it is the endpoint of Anthropic's
   contextual-retrieval curve (which pre-situates each chunk to cut top-20 failure 35→49→67%
   — [anthropic.com/engineering/contextual-retrieval](https://www.anthropic.com/engineering/contextual-retrieval), **[D1]**). Where Anthropic bolts context onto a chunk, mnemex's
   primary tier *is* the context, so it needs no prefixing at all **[D8]**.
2. A **hand-typed wikilink graph** — `Builds-on` / `Subsumes` / `Contrasted-with` /
   `Contradicts` / `See-also` edges (`apps/wiki-template/CLAUDE.md` §Relationships). This is
   the exact artifact GraphRAG spends its entire budget (up to the ~$33K MS-GraphRAG index)
   trying to auto-extract — and still gets noisier, untyped, machine-inferred results
   (arXiv [2404.16130](https://arxiv.org/abs/2404.16130), [2506.05690](https://arxiv.org/html/2506.05690v3), **[D2]**). mnemex owns a cleaner, higher-precision
   version *for free*.

Both artifacts sit over **raw books with line-level provenance** (`^[raw:Lstart-Lend]`,
`apps/wiki-template/CLAUDE.md` §Provenance) and are indexed by `qmd`'s multilingual
BM25 + Qwen3-vector + RRF + qwen3-reranker cascade — the same cascade every published SOTA
result identifies as the biggest lever, delegated wholesale so mnemex writes ~0 engine code
**[D6]**.

The one architectural idea, in one line:

> **Route the query → seed on the compiled synthesis child → walk the typed graph (the
> retrieval-time payoff no competitor exploits) → rerank the union → descend to raw via
> line-provenance for the verbatim quote.**

**Why it beats flat-RAG competitors.** A flat store must, on *every* question, re-derive
synthesis from context-poor chunks (Karpathy's named anti-pattern) and has no walkable typed
graph. mnemex answers from the pre-compiled synthesis, then follows human-curated edges to
reach the indirectly-relevant page that flat vector similarity misses — precisely the
multi-hop/cross-source class where graph structure helps *in principle* (MS-GraphRAG, HippoRAG
arXiv [2405.14831](https://arxiv.org/abs/2405.14831)). Honest scope: those headline numbers are large-corpus and
**Personalized-PageRank**-driven; at mnemex's 683-doc scale the lift of cheap **1-hop typed**
expansion over flat retrieval is a claim our **own** eval must demonstrate (Arm C, §6), not a
figure borrowed from a PPR benchmark **[D2][D8]**. And because the index is Qwen3-multilingual,
a Russian query lands on a same-language synthesis page and follows a citation into an
English source — a bridge neither English-default competitor has **[D4][D7]**.

---

## 2. The design, in tiers

Pipeline. Each component is tagged **native** (qmd does it over its own retrieved set),
**shadow-collection** (a gitignored derived collection qmd indexes), **SDK-step** (an
in-process `createStore` call — same engine, no new runtime), or **external-step** (a thin
mnemex script / agent-prompt over qmd results). Nothing adds an index, embedding runtime,
graph DB, daemon, or API key.

```
                          user query (any language)
                                   │
   Tier 0  QUERY ROUTING ──────────┤  external-step (agent prompt)
   classify intent + decide expansion; simple lookup skips the graph
                                   │
   Tier 1  DUAL-TIER HYBRID RETRIEVAL ─ native (qmd structuredSearch)
   agent-authored lex+vec+hyde sub-queries across BOTH collections
   (mnemex-wiki + mnemex-raw), RRF-fused, qwen3-reranked, intent set
                                   │
   Tier 2  CONTEXTUAL RAW ─────────┤  shadow-collection / native-at-ingest
   deterministic breadcrumb headers make raw chunks self-locating
                                   │
   Tier 3  TYPED GRAPH EXPANSION ──┤  external-step (~150–300 LOC)
   parse typed sections of seeds → resolve [[links]] → multi_get
   neighbors; edge-weighted; always surface Contradicts/Contrasted-with
                                   │
   Tier 4  UNION RERANK ───────────┤  SDK-step (createStore QMDStore.rerank)
   dedup seeds+neighbors+synthesis → qwen3-reranker → top-N
   (unreachable over pure MCP — the guardrail that stops neighbor-dumping)
                                   │
   Tier 5  PROVENANCE DESCENT ─────┤  native (qmd get file:line)
   follow ^[raw:Lstart-Lend] to exact lines for the verbatim quote
                                   ▼
                       provenance-anchored answer
```

| Tier | Component | qmd-feasibility | What qmd does natively | What mnemex adds |
|---|---|---|---|---|
| 0 | **Intent router** — simple-lookup / concept / cross-source / verbatim-quote / no-answer; gates graph expansion | **external-step** | nothing (no query classifier) | a few lines of agent-prompt cues in `apps/wiki-template/CLAUDE.md` §Query; language-agnostic cues, **no trained model**; its gating decision is a **measured** eval metric (§6), not an assumption **[D3]** |
| 1 | **Dual-tier hybrid** — lex+vec+hyde over `mnemex-wiki`+`mnemex-raw` | **native** | BM25 (FTS5) + Qwen3 vectors + RRF (k=60, orig×2) + qwen3-reranker + position blend; `collections` OR-union scope; `intent` steers expansion/rerank | agent writes its own typed sub-queries (better than qmd's 1.7B expander **[D6]**); confidence-gated pruning to one tier; **synthesis-first** for broad queries via a **page-type/path-glob scope inside `mnemex-wiki`** (synthesis pages already live there — GraphRAG "global search" with **zero** extra collection or re-index) **[D2][D3][D6]** |
| 2 | **Contextual raw** — self-locating raw chunks | **native-at-ingest** (preferred) or **shadow-collection** | **heading-aware** chunking (H1–H6 boundary scoring) **and** injects `docTitle` into every chunk embedding (`title \| text`); but **no per-chunk prefix hook**; `qmd context add` is display-only, never embedded/ranked **[D6]** | a ~40-line pass in `ingest-book.sh` that walks the pandoc/marker ATX heading hierarchy and prepends a deterministic breadcrumb (`Source-title (author, year) > Part > Chapter —`) per section, in the section's **own language**. Because qmd already carries the title + heading boundaries, the breadcrumb's *marginal* contribution is only the intermediate **Part>Chapter** hierarchy — expected small; Arm B (§6) measures it rather than asserting it **[D1][D4][D6]** |
| 3 | **Typed graph expansion** — the leapfrog | **external-step** | nothing — `[[links]]` are plain lex-searchable text; **no traversal, no neighbor pull, no PageRank** **[D6]** | ~150–300 LOC wrapper: seed = qmd hits → regex the typed sections → resolve `[[Page]]`→path → `multi_get` neighbors; **edge-type weights** (follow Builds-on/Subsumes for depth; *always* surface Contradicts/Contrasted-with); per-type fan-out caps **[D2][D8]** |
| 3′ | **Cross-source decomposition** — comparison → per-source sub-queries | **native** (orchestration) | RRF fuses N typed sub-queries in one call | read the concept page's `Contrasted-with` edges → emit one sub-query per linked source across both tiers → union. Deterministically enumerates the *other side* of a comparison; the two documented BASELINE misses are **dev-only diagnostics** of this class — the headline lift is scored on held-out, independently-authored cross-source queries (§6) **[D3]** |
| 4 | **Union rerank** — the guardrail that makes expansion safe | **SDK-step** | qwen3-reranker cross-encodes the candidate set **qmd itself retrieved**; over MCP `query`/`multi_get` there is **no entry point for an externally-assembled candidate set** **[D6]** | cross-encode the deduped union (seeds+neighbors+synthesis) via the `createStore` SDK `QMDStore.rerank(query, docs)`; keep top-N. No new model, but **not reachable over pure MCP** — see the Tier-4 note below and Decision #2 **[D2][D6]** |
| 5 | **Provenance descent** — synthesis → concept → source → exact lines | **native** | every result carries an absolute `line`; `get(file, fromLine, maxLines)` slices raw | follow the retrieved page's `^[raw:Lstart-Lend]` token to the verbatim span for quotation/fact-check — the operating manual's "drop to raw only for the quote" rule, as a retrieval primitive **[D8]** |

**Reranking depth (load-bearing, native).** Anthropic's ablation shows the reranker is the
single biggest lever (2.9%→1.9%, larger than contextual-BM25 itself) and that **top-20
before rerank beats top-5/10** **[D1]**. Action: confirm the reranker runs by default in
mnemex's qmd path and that `candidateLimit` is large enough (≈20–40) that graph neighbors and
cross-lingual dense hits actually reach it. Zero LOC; biggest single accuracy source.

**Tier-4 reachability (the graph guardrail).** The union rerank is what keeps expansion from
degenerating into *dumping unranked neighbors into context* — the top prompt-inflation risk of
any graph tier **[D2]**. But qmd's cross-encoder is only invokable on a candidate set **qmd
retrieved itself**: the MCP `query`/`multi_get` tools run their own retrieval internally and
expose **no way to hand back an arbitrary post-expansion set for scoring** — only the in-process
`createStore` SDK (`QMDStore.rerank(query, docs)`) does **[D6]**. Consequence: Tiers 3–4 must
**commit to the SDK** to get a real cross-encoder over the union (see Decision #2). If you stay
MCP-only, Tier 4 falls back to a **deterministic** ordering (edge-type weight × seed rank) under
a hard fan-out cap — a weaker but still-safe guardrail; do **not** describe that fallback as
cross-encoder reranking.

---

## 3. How each SOTA technique is used or skipped

| Technique | Use? | Why | Effort | qmd-feasibility |
|---|---|---|---|---|
| **Reranking (qwen3-reranker) as primary lever** | ✅ **on, top-~20** | Biggest delta in every ablation; load-bearing cross-lingually. **Native over qmd's own retrieved set**; reranking the *expanded union* (Tier 4) needs the SDK **[D1][D4][D6]** | none | **native (Tier 1) / SDK (Tier 4)** |
| **Deterministic contextual breadcrumb headers** | ✅ **default** | Free, multilingual-safe flavor of Anthropic CR; preserves line-provenance (inserted at conversion, before tokens exist); zero English bias. **Headroom is small — not the 5–10% D1 reports over *title-less fixed splits*:** qmd already embeds `title \| text` and chunks heading-aware, so the breadcrumb only adds the Part>Chapter hierarchy above that. Arm B measures it **[D1][D6]** | low | **native-at-ingest** |
| **Parent-document / small-to-big** | ✅ **already the topology** | Match dense synthesis "child", dereference provenance to raw "parent". mnemex uniquely has *both* ends of the pipe **[D1][D8]** | none | **native** |
| **Typed graph expansion (local search)** | ✅ **Phase 2c** | Targets the cross-source/multi-hop class (the two known misses are dev diagnostics; lift proven on held-out); the one capability neither competitor can walk **[D2][D8]** | low–med | **external-step + SDK rerank** |
| **Edge-type weighting / path pruning (PathRAG)** | ✅ **with expansion** | Curated typed edges = PathRAG's most expensive artifact, for free; keeps expansion precise, surfaces contradictions **[D2]** | low | **external-step** |
| **Cross-source decomposition** | ✅ **Phase 2c** | Splits comparison into per-source sub-queries via `Contrasted-with` edges; RRF-fused natively **[D3]** | med | **native** |
| **Synthesis-first routing (global search)** | ✅ | Synthesis pages are hand-written community summaries; route broad/sensemaking queries there first via a **page-type/path-glob scope inside `mnemex-wiki`** — no extra collection **[D2][D6]** | low | **native** |
| **Query routing (intent → expand-or-not)** | ✅ **agent-prompt** | Graph help is conditional — flat RAG *wins* simple lookup (83.2 vs 70.3); routing captures upside without downside — **and routing accuracy is measured** (§6) so the no-regression claim is shown **[D2][D3][D5]** | low | **external-step** |
| **HyDE / expansion** | ⚠️ **conditional, not default** | Unconditional HyDE misfires on small personal corpora (+40–60% latency, hallucination); gate to low-confidence / cross-lingual follow-ups **[D3][D4]** | low | **native** |
| **Cross-lingual handling** | ✅ **structural** | Qwen3 dense crosses languages without translation; BM25≈0 cross-lingually so don't over-weight the lex arm; reranker fixes ordering **[D4]** | low | **native** |
| **Step-back abstraction → synthesis tier** | ➖ **optional playbook** | Abstract sub-query is a natural key for concept pages; near-free as one more `vec` sub-query, but marginal over Tier-1 **[D3]** | low | **native** |
| **LLM "situate the chunk" prefix (full Anthropic)** | ➖ **fallback flag only** | Only marginally beats the free breadcrumb; adds model dep + English-bias risk. Reserve `--context` for heading-less scanned PDFs **[D1][D8]** | med | **needs-external-step** |
| **Proposition / Dense-X chunking** | ➖ **already hand-done** | Wiki claims *are* curated propositions, provenance-anchored. Do **not** propositionize raw — destroys provenance, multiplies cost, English-biased **[D1]** | — | native (as authored) |
| **LLM-judge citation *faithfulness*** | ➖ **secondary metric** | "Correctness ≠ faithfulness" (arXiv [2412.18004](https://arxiv.org/pdf/2412.18004)); useful honesty signal but keep off the ship-gate to stay deterministic **[D5]** | med | **needs-external-step** |
| **Late Chunking (Jina)** | ❌ **skip** | Architecturally blocked: needs **mean** pooling; Qwen3-Embedding is **last-token** pooling, and it lives in the embed pipeline mnemex delegates to qmd. File as a qmd upstream request **[D1][D6]** | high | **not-feasible** |
| **Semantic / embedding-similarity chunking** | ❌ **skip** | NAACL 2025: fixed 200-word chunks match or beat it at a fraction of the cost; qmd owns boundaries **[D1]** | med | **not-feasible** |
| **Naive multi-query / RAG-Fusion (paraphrase)** | ❌ **skip** | Industry-scale study: recall gains "largely neutralized after re-ranking" (qmd *has* a reranker) at 1.77× cost. Spend the sub-query budget on *decomposition*, not paraphrase **[D3]** | low | native (declined) |
| **Personalized PageRank (HippoRAG)** | ❌ **defer** | Needs numpy/igraph adjacency build; marginal over 1-hop at 683 docs; discards edge typing unless weighted. Revisit at tens of thousands of pages **[D2]** | high | **needs-external-step** |
| **Community-detection GraphRAG / graph DB** | ❌ **skip** | Re-derives, worse and noisier, the typed graph mnemex already hand-owns; huge LOC/$ **[D2][D8]** | high | not-feasible |
| **RAPTOR summary trees** | ❌ **skip** | The hand-synthesized wiki *is* the summary-node layer RAPTOR constructs **[D3][D8]** | high | not-feasible |
| **Trained query router (TF-IDF+SVM)** | ❌ **skip** | Adds a model + training pipeline + English bias; do intent detection in the agent prompt **[D3]** | med | not-feasible |
| **Collection weighting in qmd** | ❌ **impossible** | `collections` is an OR-union filter with **no per-collection weight/fusion**; prefer a tier via two scoped calls or `includeByDefault=false`, not weighting **[D6]** | — | not-feasible |
| **`qmd context add` for ranking** | ❌ **misuse** | Display-only metadata; never embedded, never reranked. Do not budget it as contextual retrieval **[D6]** | — | not-feasible |

---

## 4. How mnemex BEATS each competitor

Winning moves cite the exploit list **[D7]** and the substrate dossier **[D8]**.

| Capability | claude-obsidian | llm-wiki-compiler | mnemex's winning move |
|---|---|---|---|
| **Rank fusion** | BM25 top-20, then vector only *reorders* it — a BM25 miss is unrecoverable | semantic top-30 only, **no lexical channel** | `qmd` runs **independent** BM25+Qwen3 channels fused by **RRF** → either-channel hits reach the reranker. Zero LOC **[D7]** |
| **"Reranker"** | nomic-embed **cosine** (a bi-encoder, no token interaction) mislabeled as rerank | ranking **discards cosine magnitude** — flat +0.5 per semantic hit (a boolean, not graded relevance) | real **qwen3 cross-encoder** over the fused pool; sees whole coherent pages, maximizing joint-attention **[D7]** |
| **Contextualization** | marquee contextual-prefix **gated OFF by default** → title+first-sentence stub | indexes **raw chunks, no contextualization** | the **synthesis tier** *is* maximal context — the structural endpoint of Anthropic's curve (whose full LLM-situate buys the 35→49% failure cut), reached without per-chunk prefixing; the raw breadcrumb is a cheap *partial* situating on top, not a claim to that number **[D1][D7][D8]** |
| **Typed graph at retrieval** | no synthesis graph at all | `graph.ts` is post-hoc **envelope decoration**, untyped, never influences ranking | **1-hop typed-edge expansion → SDK-reranked union** (edge weights + always-surface `Contradicts`); the cross-encoder over the union is the guardrail against neighbor-dumping. Neither can copy without a typed graph **[D2][D7][D8]** |
| **Cross-source comparison** | strong single-tier chunks, but no graph to enumerate the other side | synthesis tier, but weak retrieval, no raw to ground each side | read `Contrasted-with` edges → **deterministic** per-source decomposition across both tiers **[D3]** |
| **Multilingual / cross-lingual** | **nomic-embed (English-default)**; RU→EN returns ~nothing (BM25 can't bridge scripts, vector never runs alone) | voyage-3-lite / text-embedding-3-small (English-leaning); no cross-lingual eval | **Qwen3-Embedding by default** (119 langs, #1 MMTEB 70.58); same-language synthesis over cross-language raw; RU→EN is free **[D4][D7]** |
| **Provenance** | shreds pages into 500-tok overlapping chunks, dedups back — loses page coherence *and* locality | collapses chunks to page slugs, **no line-level spans** | **line-level `^[raw:Lstart-Lend]`** descent from synthesis to exact raw span for citation **[D7][D8]** |
| **Self-contained** | rerank **silently no-ops** if ollama unreachable or model unpulled → BM25-only in practice | semantic path **off without provider credentials**; model mismatch **nukes the store** | one durable, always-on `qmd` index; no daemon, no API key **[D7]** |
| **Recall measurable** | benchmark scores only **binary top-1/top-5** — blind to recall ceiling and total cross-lingual failure | **no retrieval-recall metric at all** | nDCG@10 + Recall@k + MRR + **RU cross-lingual bucket** + **no-answer bucket** + **router-accuracy** + bootstrap CI — numbers their harnesses *cannot produce* **[D5][D7]** |

---

## 5. Multilingual as a demonstrated moat

The advantage is **model-level and structural**, and it is invisible unless the eval measures
it — monolingual benchmarks *mask* cross-lingual bias (arXiv [2507.07543](https://arxiv.org/pdf/2507.07543), **[D4]**).

**Design.**

| Element | Move | Evidence / feasibility |
|---|---|---|
| **Default embedder** | Keep `QMD_EMBED_MODEL=Qwen3-Embedding-0.6B` (overrides qmd's weaker gemma-300M default) | 0.6B = 64.33 MMTEB vs BGE-M3 59.56 (+7.9%); 8B is #1 (70.58). One env line, **native** **[D4][D6]** |
| **Language-matched contextualization** | Breadcrumb/prefix in the **chunk's own language** (RU chunk → RU breadcrumb) | An English prefix on a Russian chunk adds ~50–100 tokens no RU query matches **and** inflates BM25 doc length → Okapi discounts the real RU terms, poisoning the Contextual-BM25 arm **[D1][D4]** |
| **Ingest-time cross-lingual bridge** | Synthesis pages in the owner's language wikilink+cite into source-language raw; the LLM does the cross-lingual mapping **once**, not per query | A curated synthesis *is* a high-quality translation → RU query hits a same-language page (strong BM25+dense) instead of fighting documented monolingual bias **[D4][D8]** |
| **Don't over-weight the lexical arm** | For known cross-lingual intent, treat BM25 contribution as ≈0; let dense carry recall | BM25 is near-zero cross-lingually without translation (arXiv [2511.19324](https://arxiv.org/html/2511.19324v1)); dense stays consistent **[D4]** |
| **Reranker is the cross-lingual last mile** | Keep qwen3-reranker on; ensure enough candidates reach it | Cross-encoder rerank lifted Recall@10 from 0% to 30–91% on hard cross-script pairs; Qwen3-reranker is natively multilingual **[D4]** |
| **HyDE in the corpus language** | *Optional* hedge — emit the hypothetical doc in the target-corpus language to give BM25 same-language terms | qmd's `hyde` sub-query type, gated to detected cross-lingual queries only **[D4]** |

**How the eval proves it (the money graph).** Add a dedicated **RU↔EN bucket**: Russian
questions whose answer lives in an English book (and, per Open Decision #5, one Russian source
page for RU→RU + EN→RU). Report **nDCG@10 + Recall@5/@10** for this bucket — **not** MIRACL's
Recall@100, which **saturates toward 1.0** on a few-book corpus and cannot discriminate at this
scale. Run three arms *and actually measure the baseline*: `qwen3-embedding` vs a **run**
nomic-embed/English baseline, reranker on vs off. D4 **predicts** the English-default stack
scores near-zero on RU-query→EN-doc — but that is a prediction to **confirm by running the
baseline**, not a finished chart. Once measured, that gap is a result neither competitor's
harness can even produce **[D4][D5][D7]**.

---

## 6. Evaluation plan that is hard to dismiss

Current harness (`eval/run.mjs`, n≈16, recall 0.94, home-brew `0.5·recall+0.5·citation`) is at
ceiling, has no significance, and uses a non-standard composite — the three things reviewers
dismiss as vibes **[D5]**. Fixes, almost all native to `qmd bench` + a ~40-LOC `stats.mjs`.

### Metrics
| Metric | Role | Source |
|---|---|---|
| **nDCG@10** | **headline** (rank-aware; MTEB/MIRACL/BEIR default) | compute from qmd's ranked hit lists **[D5]** |
| Recall@k, MRR, MAP | reported alongside, per bucket per backend | qmd bench emits recall/MRR; add nDCG/MAP in `run.mjs` **[D5]** |
| **Failure-rate framing** | present deltas as "1 − recall@k cut from X%→Y% (Z% reduction)" — Anthropic's axis, directly comparable | **[D1][D5]** |
| Citation *resolvability* (deterministic) | core, kept | existing `^[raw:...]` check |
| Citation *faithfulness* (LLM-judge) | **secondary, off the gate** | optional Claude pass over answer+cited lines **[D5]** |
| **Router decision accuracy** | **guardrail metric** — every query carries a **gold route**; measure whether the router gates graph on/off correctly (especially `simple-lookup → skip-graph`, which guards the no-regression claim against flat-RAG-wins-simple-lookup) | label routes in fixtures; compare router output to gold **[D3][D5]** |
| **Retire** `0.5·recall+0.5·citation` as headline | reviewers dismiss non-standard composites; keep only as internal convenience | **[D5]** |

### Buckets (stratified; report per-bucket, not just aggregate)
`exact/title` · `single-hop factual` · **`cross-source/multi-hop`** (the mechanism-attributable
lift for contextual+graph; the two known BASELINE misses are **dev-only** diagnostics — the
held-out slice contains **new, independently-authored** cross-source queries so Arm C is never
scored on the queries it was built to fix) · `paraphrase/semantic` · **`RU↔EN cross-lingual`** ·
**`no-answer / negative control`** (assert top score < `minScore` and the answer abstains —
proves the eval was built to find failures, not hide them) **[D5]**.

**Budget allocation (so significance is real, not asserted).** ~60 queries across 6 buckets is
≈10/bucket — too thin for a per-bucket bootstrap/permutation *p*. Concentrate the budget in the
**two decision buckets** (`cross-source` and `cross-lingual`, target **~20 each**) where the win
is claimed and significance is tested; run the easy buckets (`exact/title`, `single-hop`,
`paraphrase`) as smaller **ceiling checks only**, reported without a significance claim; keep
`no-answer` as a pass/fail control and routing as an accuracy figure **[D5]**.

### Baselines — the three-arm ablation (this is the relaunch graph)
| Arm | What it isolates |
|---|---|
| **A. plain hybrid** | qmd BM25+vector+RRF+rerank over un-prefixed pages/chunks (today's 0.938) |
| **B. + contextual breadcrumb** | Tier-2 only. *Honest question: does a breadcrumb add recall on top of an already-title-carrying, already-reranking hybrid?* |
| **C. + typed graph expansion** | Tier-3/4 on top of B, on the **held-out** cross-source queries. *Honest question: does the graph walk beat B on cross-source without regressing simple lookups (checked via router accuracy)?* |

Plus the **per-backend ablation** (bm25 0.375 / vector 0.656 / hybrid 0.938) mirroring
Anthropic's appendix — a ready-made credibility multiplier already free in qmd **[D5]**.

### Statistical honesty on a small corpus
- Grow to **~60 queries** (matches/exceeds claude-obsidian's 50-query gate, adds attribution
  it lacks), **weighted toward the two decision buckets** per the allocation above **[D5]**.
- **Bootstrap 95% CI** per metric (10k resamples) + **paired permutation test** on each
  arm-to-arm delta, report *p* — Smucker et al. (CIKM 2007): bootstrap is most powerful at
  small n. Report *p* **only where the bucket n supports it** (the two decision buckets); a
  ~40-LOC zero-dep `eval/stats.mjs` over the per-query arrays qmd already emits **[D5]**.
- **Freeze a held-out slice** (`split: dev|holdout` field): build Phase-2 on `dev`, score
  `holdout` **once**, quote it as the headline. Critically, the held-out **cross-source** queries
  are **new** — authored independently of the two known BASELINE misses (which stay in `dev`) —
  so Arm C's headline is not measured on the two queries it was engineered to pass **[D5]**.
- Where an easy bucket is already at ceiling, **say so** and let the two decision buckets carry
  the delta; **never** headline a per-bucket *p* the n can't support **[D5]**.
- **Corpus is contamination-safe** (pre-1930 public-domain books); the real risk is
  query/prompt tuning, which the held-out split controls **[D5]**.

---

## 7. Phased build order (value/effort, smallest shippable first)

Each step ships independently and keeps mnemex small. The **honest experimental question** is
stated so the eval, not the article, decides whether the step stays.

| Phase | Ship | LOC | Value/Effort | Honest question |
|---|---|---|---|---|
| **2a — credibility layer (THIS WEEK)** | (i) Confirm qwen3-reranker on by default over top-~20; (ii) formalize the **two-tier synthesis-first + provenance-descent** playbook in `apps/wiki-template/CLAUDE.md` §Query (near-zero code); (iii) upgrade `eval/`: nDCG@10/MRR/MAP, the 6 buckets, **router-accuracy**, `stats.mjs` (bootstrap CI + permutation), held-out split, grow to ~60 queries incl. **RU↔EN** and **no-answer** | ~40 (stats) + fixtures | **highest** — mostly eval, unblocks the relaunch | Are we even measuring the right thing? (retire the composite; expose per-backend + per-bucket + routing) |
| **2b — contextual raw** | ~40-line deterministic **breadcrumb** pass in `ingest-book.sh` after pandoc/marker conversion, **language-matched**; re-run eval → **arm B** | ~40 | medium — headroom is small over qmd's title+heading baseline; measure before believing | *Does a contextual breadcrumb add recall on top of an already-title-carrying, already-reranking hybrid?* (now measured, not asserted) |
| **2c — typed graph expansion + decomposition** | ~150–300 LOC wrapper on the `createStore` SDK: seed on qmd hits → parse typed sections → resolve `[[links]]` → `multi_get` neighbors → edge-weight → **`QMDStore.rerank()` union** (SDK, not MCP); + `Contrasted-with`-driven cross-source decomposition; intent router in the agent prompt, **its gating accuracy measured** → **arm C** | ~150–300 | high (cross-source class) | *Does the graph walk beat plain hybrid on the **held-out** cross-source bucket **without** regressing simple lookups (measured via router accuracy)?* |
| **2d — later / optional** | (a) `--context` Haiku-situate tier for **heading-less scanned PDFs** only; (b) optional LLM-judge **faithfulness** pass (secondary metric); (c) step-back sub-query playbook | small, gated | medium | *Is the synthetic-breadcrumb delta small enough that egress + a model dep pays for itself on scanned books?* |
| **Defer** | Personalized PageRank | — | low now | Only if the wiki grows to tens of thousands of pages **[D2]** |

**Permanent skips** (Section 3): late chunking, semantic chunking, community-detection
GraphRAG, RAPTOR, propositionizing raw, trained router, naive RAG-fusion, d3 web viewer.

---

## 8. Stay-small guardrails + explicit non-goals

**Guardrails.**
- **No new index, embedding runtime, graph DB, daemon, or API key.** `qmd` owns
  BM25+vector+RRF+rerank; mnemex adds only text, thin scripts, and eval. Tiers 3–4 call qmd
  **in-process** via the `createStore` SDK (same qmd engine, one SDK import — no new runtime,
  DB, or daemon) to reach the cross-encoder over the expanded union **[D6]**.
- **Total added footprint ≈ 400–600 LOC**: `stats.mjs` (~40), the breadcrumb pass (~40), the
  graph-walk wrapper (~150–300), fixtures/prompt edits. Repo stays well under its ~5k-LOC
  budget (`CLAUDE.md` working agreements).
- **Derived artifacts are gitignored and regenerable** (breadcrumbed `mnemex-raw`, any
  ctx shadow collection, `eval/.wiki/`). **No `mnemex-synth` collection** — synthesis-first
  routing is a page-type/path-glob scope inside `mnemex-wiki` **[D6]**.
- **The graph walk is a file-path operation** — regex typed sections, resolve `[[Page]]`, no
  language-specific NLP → multilingual-safe by construction **[D2][D8]**.
- **Router keeps most queries on the untouched ~1s qmd path**; only proven-to-benefit queries
  pay expansion cost — and the gate's accuracy is a **measured eval metric**, so the
  no-regression-on-easy-queries claim is shown, not asserted **[D2][D3][D5]**.
- **Depends on a lint-clean graph**: expansion silently drops edges on broken/renamed
  `[[links]]` or non-canonical section titles — `scripts/lint-citations.mjs` + the judgment
  lint must keep the graph machine-walkable **[D2]**.

**Non-goals (do not build).**
1. Reimplementing BM25 / reranker / embeddings — qmd owns them; do **not** port
   claude-obsidian's `bm25-index.py`/`rerank.py`/`retrieve.py` **[D6][D7]**.
2. Per-collection weighting/fusion — impossible in qmd (OR-union only); tier via scoped calls
   or `includeByDefault=false` **[D6]**.
3. A third `mnemex-synth` collection — synthesis pages already live in `mnemex-wiki`; scope by
   page-type/path-glob instead **[D6]**.
4. `qmd context add` as a ranking feature — display-only **[D6]**.
5. Late chunking — blocked by Qwen3 last-token pooling; file upstream, don't build **[D1][D6]**.
6. Chunking wiki pages into fragments — page/section is the atomic unit; descend to raw lines
   only for citation **[D7][D8]**.
7. Propositionizing / community-detecting / RAPTOR-ing the corpus — the hand-authored wiki
   already *is* those artifacts, at higher precision **[D1][D2][D3][D8]**.
8. Trained classifiers, d3 viewer, long-context "dump the whole book" (discards provenance,
   re-derives synthesis every call — the anti-pattern the system exists to kill) **[D3][D8]**.

---

## 9. Open decisions for the owner

Genuine forks — recommendation each, do not let me silently pick.

| # | Decision | Recommendation |
|---|---|---|
| 1 | **Breadcrumb mechanism:** inject at conversion time into `book.md` (native, line-stable because tokens are computed against the breadcrumbed file, but writes *derived* text into `raw/`) **vs** a gitignored `raw-ctx/` shadow collection (keeps `raw/` pristine, heavier ~150–250 LOC + invalidation) | **Breadcrumb-at-conversion.** It's the free, multilingual-safe win and provenance-consistent since it runs *before* any claim tokens exist. Breadcrumbs are built from the book's own headings (its own words), so `raw/` stays faithful. Reserve the shadow collection for the Haiku-situate fallback on heading-less scanned PDFs. |
| 2 | **Graph walk:** external script over qmd MCP/CLI results **vs** in-process `createStore` SDK | **Prototype Tier 3 over MCP, but ship Tiers 3–4 on `createStore`.** MCP `query`/`multi_get` run their own retrieval and expose **no way to rerank an externally-assembled union**. The cross-encoder over the union is reachable via **`store.internal.rerank(query, {file,text}[])`** — an *internal*, typed, **empirically-verified** method (not the fabricated public `QMDStore.rerank`; see the ⚠ correction). Guard it with `typeof store.internal?.rerank === 'function'` and fall back to deterministic union ordering. So the SDK is a **correctness** requirement for union-rerank; the only caveat is depending on an internal (non-README) API, mitigated by the feature-guard **[D6]**. |
| 3 | **Contextualize raw only, or wiki too?** | **Raw only.** Wiki pages are self-contextual. Contextualize wiki *tail* chunks later only if the eval shows long-page tails miss after qmd's chunking. |
| 4 | **LLM-situate tier now, or synthetic-breadcrumb v1?** | **Synthetic v1.** Measure the free-breadcrumb delta first (arm B). Wire the Haiku `--context` tier only if that delta is small **and** you have heading-less PDFs where breadcrumbs are unavailable **[D1]**. |
| 5 | **Eval corpus:** English-only, or add a Russian source page? | **Add one Russian public-domain source** + grow to ~60 queries, so the RU bucket exercises RU→RU and EN→RU, not just RU-query→EN-doc. Strongest, most defensible "we beat them" axis **[D4][D5]**. |
| 6 | **Router:** agent-prompt heuristic **vs** a tiny embedding-cue router | **Agent-prompt** — zero-dep, multilingual by construction; a trained TF-IDF/SVM router is English-biased and violates stay-small. Ship it **with** the routing-accuracy metric (§6) so the heuristic's gating is proven, not trusted **[D3][D5]**. |
| 7 | **Reranker candidate depth** (`candidateLimit`/-C) | Set/confirm **≈20–40** so graph neighbors and cross-lingual dense hits reach the reranker (top-20-before-rerank beats top-5/10) **[D1][D4]**. |

---

*Primary sources:* Anthropic Contextual Retrieval
([anthropic.com/engineering/contextual-retrieval](https://www.anthropic.com/engineering/contextual-retrieval)) ·
MS GraphRAG (arXiv [2404.16130](https://arxiv.org/abs/2404.16130)) · HippoRAG (arXiv [2405.14831](https://arxiv.org/abs/2405.14831)) ·
When-to-use-Graphs (arXiv [2506.05690](https://arxiv.org/html/2506.05690v3)) · PathRAG (arXiv [2502.14902](https://arxiv.org/abs/2502.14902)) ·
Qwen3-Embedding (arXiv [2506.05176](https://arxiv.org/html/2506.05176v1)) · Cross-Lingual Cost (arXiv [2507.07543](https://arxiv.org/pdf/2507.07543)) ·
Cross-lingual ranking (arXiv [2511.19324](https://arxiv.org/html/2511.19324v1)) · Semantic-chunking-not-worth-it (NAACL 2025,
[aclanthology.org/2025.findings-naacl.114](https://aclanthology.org/2025.findings-naacl.114/)) · Correctness≠Faithfulness (arXiv [2412.18004](https://arxiv.org/pdf/2412.18004)) ·
Smucker et al. CIKM 2007. *Local:* `eval/BASELINE.md`, `eval/run.mjs`, `eval/fixture.json`,
`eval/questions.jsonl`, `apps/wiki-template/CLAUDE.md`, `apps/wiki-template/scripts/ingest-book.sh`,
`packages/cli/src/search.ts`, `HANDOFF.md`.
