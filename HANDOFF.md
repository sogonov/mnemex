# mnemex — developer handoff & roadmap

Pick-up doc for continuing work (e.g. in Claude Code). Read this first, then start Phase 1.

## What mnemex is

A personal knowledge system: you tell an LLM "ingest this book", it acquires the book,
reads it, and files it into a structured, cross-linked Markdown wiki (sources / entities /
concepts / syntheses). Knowledge is compiled once and maintained, instead of RAG re-retrieval.

## Current status (June 2026)

- **Published & live.** npm: `@mnemex/library-mcp@0.1.1`, `@mnemex/cli@0.1.2`. GitHub: https://github.com/Daniil-Sokolskiy/mnemex (MIT). Tested end-to-end (install, MCP server, doctor, init, Gutenberg + Anna's search all verified).
- **Open PRs to review/merge:** #1 and #2 from `sogonov` — Windows support (PowerShell installer `install.ps1`, doctor winget hints, force-CPU for qmd). Merge these when convenient; they unblock Windows users.
- **Launch is paused on purpose.** Habr rejected the launch article for AI-authorship; the plan is to relaunch *after* the retrieval upgrade below (so the article has real eval numbers, not vibes). Drafts + analysis live in `../projects/mnemex-launch/` (`mnemex-habr-article-v2.md`, `mnemex-vs-others.md`, `mnemex-launch-announcement.md`, `mnemex-reddit-posts.md`, `mnemex-article-images/`).

## Strategic decision

Keep mnemex (don't adopt a competitor wholesale), but absorb the highest-leverage ideas from
the two main competitors while staying small and focused.

**The moat — protect & sharpen, don't dilute:**
1. **Book acquisition** — Gutenberg + Anna's (Playwright search). No competitor does this.
2. **Multilingual retrieval** — Qwen3-Embedding via qmd; Russian works out of the box.
3. **Whole-book methodology** — two-phase ingest + cluster ingest with sibling hooks.

**Competitors (cloned & code-reviewed; see `../mnemex-vs-others.md` for the full analysis):**
- `atomicstrata/llm-wiki-compiler` (~1.1k★, MIT, ~28k LOC TS) — mature engine. Steal: **claim-level provenance** (`^[file.md:42-58]`), **review queue** (`compile --review`), **eval harness**.
- `AgriciDaniel/claude-obsidian` (~6.8k★, MIT, bash+Python) — best retrieval. Steal: **Contextual Retrieval** (per-chunk contextual prefix before indexing — Anthropic Sept-2024 technique; compatible with qmd).
- To study their code: `git clone --depth 1 <url>` and read — compiler: `src/compiler/prompts.ts`, `src/context/`, `src/commands/review-*.ts`; claude-obsidian: `scripts/contextual-prefix.py`, `scripts/retrieve.py`, `scripts/rerank.py`.

**Not unique — do NOT market as differentiators:** typed relationships, contradiction flags, Obsidian compatibility, MCP server, the three-layer Karpathy pattern (all three have these).

## Progress — 2026-07-02 session (branch `phase-1-and-retrieval-design`, NOT merged to main)

**Done & committed (12 commits on the branch):**
- **Phase 1 — DONE.** Claim-level provenance `^[raw/books/<slug>/book.md:Lstart-Lend]` in
  `templates/{source,concept,synthesis}.md` + `wiki-template/CLAUDE.md`; `scripts/lint-citations.mjs`
  (MISSING/MALFORMED/UNRESOLVABLE) + `mnemex lint` CLI. Mini-eval `eval/` (corpus.md, fixture,
  questions, run.mjs, metrics.mjs nDCG/MAP/MRR, stats.mjs bootstrap+permutation) — credibility-grade.
- **Prose pack — DONE.** Ported the owner's brain conventions into the product: Contradictions &
  tensions (Contradiction/Tension/Composition + boundary Resolution), cite-or-abstain + language
  directive + two-tier query playbook, `hot.md` rolling cache.
- **Competitive analysis — DONE.** Full code-read of both competitors → `projects/mnemex-launch/mnemex-strategy-take-the-best.md`
  and `docs/methodology/contextual-retrieval-design.md`. llmwiki ≈28k LOC, claude-obsidian ≈4k+prose.
- **MCP stdio hygiene** working-agreement added to repo `CLAUDE.md` (the "stdout bug" was a false
  alarm — library-mcp already logs to stderr).

**Phase 2 — findings (mostly measured, little to build):**
- **Reranking is the real retrieval lever — and qmd already does it** (qwen3-reranker). Nothing to build.
- **Cross-lingual moat proven** (RU→EN ≈83%, arm A) — competitors' English-default stacks ≈0. Un-confounded win.
- **Contextual breadcrumb (2b): designed, NOT built** — headroom expected small (qmd already embeds title+headings).
- **Typed-graph retrieval (an "add-our-own" bet, not from competitors): PARKED R&D.** Lives only in
  `eval/` (never in the product). Tested on 5→17→615-page corpora with independent-authorship to
  break circularity. Result: directional at scale (C crosses over brute-force D at 615 pages) but
  **never statistically significant** (brain retest C-vs-D p=0.29, C-vs-B p=0.14, n=43). Do NOT
  headline it. See `eval/BASELINE.md` for the full honest write-up.

**Environment:** `qmd` updated 2.5.1 → **2.5.3** (fixes the cosmetic GGML_ASSERT teardown crash).
The user path (`mnemex init` → ingest → `qmd query` ~1s) never crashed; the kills were long internal
benchmark scripts hitting session limits, not the product.

**Relaunch-ready (proven, un-confounded):** provenance-to-line · credibility eval methodology ·
cross-lingual moat · honest competitor analysis · reranking (via qmd). The graph is NOT part of the pitch.

## Roadmap — phased, each phase ships on its own

Ruthless scoping is the point: "merge everything" kills solo projects. Ship each phase.

### Phase 1 — cheap credibility (do first; unblocks the relaunch) — ✅ DONE
- [x] **Claim-level provenance.** `^[raw/books/<slug>/book.md:Lstart-Lend]` in templates + CLAUDE.md; `scripts/lint-citations.mjs` + `mnemex lint`.
- [x] **Mini eval harness.** `eval/` — fixture + questions + run.mjs; upgraded to credibility-grade (nDCG@10/MAP/MRR, bootstrap CI, permutation, stratified buckets incl. cross-lingual + no-answer).

### Phase 2 — retrieval quality — mostly measured; little left to build
- [x] **Contextual breadcrumb (2b) — BUILT + the real unlock behind it.** `scripts/breadcrumb.mjs`
  injects ancestor-path breadcrumbs under nested headings (conversion-time, before provenance
  tokens; idempotent, fence-aware, `\p{L}`-safe). But building it exposed the actual gap:
  **Gutenberg text is heading-less** (chapters are ALL-CAPS lines, 0 ATX headings across all 16
  eval books), so qmd chunks blindly across chapters and the breadcrumb had nothing to anchor to.
  Fixed with `scripts/structure.mjs` — promotes flat division markers (BOOK/PART→H1, CHAPTER→H2)
  to real headings, high-precision (validated: clean hierarchy in 10/16 books, 6 essay-collections
  correctly untouched), body-confined, idempotent. Both wired into `ingest-book.sh` (structure →
  breadcrumb; opt-outs `--no-structure`/`--no-breadcrumb`). Fixed a real ESM bug found en route:
  the scripts' CLI code ran on *import* (corrupting a file) — now gated to main-module.
  **Measurement: INCONCLUSIVE, no lift claimed.** `eval/probe-structure.mjs` (flat vs struct, same
  book) is underpowered by construction (identical text → identical retrieval) and qmd's
  chunk-offset↔line mapping is unreliable; the MRR 0.10==0.10 is a tooling artifact, not a null.
  Features ship justified **structurally** (heading-aware chunking + breadcrumb + navigation +
  chapter-anchored provenance), NOT on a recall number. A clean measurement needs a different
  design (chunk-boundary purity). NOT a relaunch headline.
- [x] **Gutenberg boilerplate strip.** `scripts/strip-boilerplate.mjs` drops the license header +
  footer bracketing every Gutenberg text (`*** START *** / *** END ***`). **Measured, deterministic,
  trustworthy** (no flaky retrieval): ~385 lines/book, **6,195 total** across the 16-book corpus,
  gone from the index — identical legal text that was surfacing as retrieval noise and matching
  every book at once. Runs FIRST in `ingest-book.sh` (before structure/breadcrumb) so every
  `^[raw:L-L]` line number is boilerplate-free from the start. No-op on non-Gutenberg sources;
  idempotent; opt out `--keep-boilerplate`.
- [x] **Auto-extract metadata from the Gutenberg header.** `scripts/extract-meta.mjs` parses the
  license header (which the strip pass throws away) for Title / Author / Translator / Editor /
  Release-date / Language / eBook-id and fills the `meta.yaml` stub — only empty fields, never
  clobbering a hand-set value. Runs BEFORE strip (header still present). **16/16 eval books
  auto-filled** title+author+year+gutenberg_id+language (translator/editor where present); before,
  `meta.yaml` shipped empty for the owner to type by hand. Main-module gated, `--json` mode, selftest.
  Conversion pipeline is now:
  convert → **meta stub → extract-meta** → strip-boilerplate → structure → breadcrumb.
- [x] **`mnemex clean-raw` — retrofit the pipeline onto already-ingested books.** The four passes
  only ran at ingest, so books converted earlier never got them. `scripts/clean-raw.mjs` imports the
  passes' pure functions (import-safe thanks to the main-module guards) and applies the same order to
  every `raw/books/*/book.md`; `--dry-run`, per-book delta report, per-pass opt-outs. Wired as
  `mnemex clean-raw`; `init` bundles it. **End-to-end validated on the real 16-book corpus**: −6,211
  boilerplate lines, +552 headings, meta filled 16/16, and **idempotent** (second run touches 0/16 —
  verified by md5). Caught + fixed a real breadcrumb idempotency bug en route (`stripBreadcrumbs` ate
  the section's own blank line, so repeated runs slowly mangled formatting).
- [x] **Reranking** — already delivered by qmd (qwen3-reranker); confirmed the dominant lever. Nothing to build.
- [x] **Cross-lingual moat** — proven (RU→EN ≈83%), no build needed.
- 🅿️ **Typed-graph retrieval** — parked R&D (eval-only, unproven; see Progress section). Not a phase deliverable.

> Update 2026-07-02 (session 2): Phase 3 shipped both slices — **Lint as code** (3a) + **Fresh-context
> claim verifier** (3b, replaced the review-queue after deciding a manual gate is dead code for a solo
> tool). Details below. Phase 3 DONE. Next candidates: Phase 2b breadcrumb (small), grow the real library,
> or relaunch prep with the honest numbers.

### Phase 3 — curation robustness (DONE)
- [x] **Lint as code** — `scripts/lint-links.mjs` (~230 LOC w/ selftest): **BROKEN** `[[links]]`
  (unresolved by basename or alias), **DUPLICATE** names (one basename/alias owned by 2+ pages — the
  ambiguous-`[[link]]` / "same concept, two names" trap), **ORPHAN** pages (no inbound link; advisory,
  `--strict` to fail). Fence-aware + inline-code-aware `[[...]]` extractor, alias-aware resolution,
  `\p{L}`/Unicode-safe (Cyrillic titles resolve), skips file-path/media targets (those are provenance
  or embeds, not page edges). Wired into `mnemex lint` (runs both citations + links, `--strict` flag);
  `init` bundles it (verified on a fresh wiki). Pure core unit-tested via `--selftest`. On the eval
  corpus it caught a real ambiguous alias (`Essays` shared by Bacon/Emerson/Montaigne). CLAUDE.md Lint
  section updated: broken/orphan/exact-duplicate moved from judgment-lint → code-lint; judgment-lint
  keeps only the fuzzy calls (near-duplicates, implicit concepts, stale claims, contradictions).
- [x] **Fresh-context claim verifier** (replaced the review-queue). Decision: a *manual* approve/reject
  queue is dead code for a solo tool — nobody gates their own ingests. The competitor split confirms it:
  llmwiki keeps a manual queue only because its compiler writes pages with **no human in the loop**;
  claude-obsidian dropped manual staging for an **automated fresh-context verifier**. mnemex already has
  the human at ingest step 2, so it needs the auto-verifier, not the queue. Built `scripts/verify-claims.mjs`
  (~180 LOC w/ selftest): for every claim carrying a `^[raw:L-L]` token it slices the **exact** cited raw
  lines and prints a worksheet pairing claim ↔ what the source literally says. It does **not** judge — a
  fresh-context sub-agent does (CLAUDE.md ingest step 8), flagging unsupported claims with
  `> [!caution] Unverified`. Semantic layer above lint (lint = token *resolves*; verify = lines *support*).
  Wired into `mnemex verify` (`--page`, `--json`); `init` bundles it; fence-aware, `\p{L}`-safe. Declined
  llmwiki's staging queue + TOCTOU lock (bloat trap per strategy doc §6).

### Skip (low value for this project)
- d3 web viewer (Obsidian already renders the graph), export formats (llms.txt/Marp/GraphML), multi-agent orchestration / hooks.

## Relaunch gate

Relaunch the article + announce **after Phase 2**, when you have: the honest comparison (done),
claim provenance, and a measured retrieval lift from Contextual Retrieval. For Habr specifically,
the prose still needs a genuine human-voice pass (their moderation flags AI text). Reddit/dev.to
have no such moderation — drafts in `../mnemex-reddit-posts.md` are ready.

## Repo facts

- **Layout:** `packages/library-mcp/` (acquire+ingest MCP server: `src/{annas,gutenberg,index}.ts`), `packages/cli/` (`src/{index,util,doctor,init,mcp,search}.ts`), `apps/wiki-template/` (the scaffolded wiki: `CLAUDE.md` operating manual, `templates/`, `scripts/`), `docs/methodology/`.
- **Monorepo:** pnpm workspaces. Build: `pnpm install && pnpm -r build` (or `npm run build` per package; TypeScript strict).
- **Env vars:** `WIKI_ROOT` (default `~/mnemex`), `QMD_EMBED_MODEL` (default Qwen3-Embedding-0.6B), `ANNAS_ARCHIVE_KEY` (optional, paid Anna's auto-download).
- **Search:** delegates to external `qmd` (BM25 + vector). mnemex's `search.ts` is a thin wrapper; the wiki's `scripts/setup-search.sh` is the source of truth for qmd setup.
- **Two CLAUDE.md, don't conflate them:** repo-root `CLAUDE.md` (dev guidance, points here) vs `apps/wiki-template/CLAUDE.md` (the *product* — the operating manual copied into every user wiki).

## First Claude Code prompt

> Read HANDOFF.md. We're keeping mnemex and doing the phased upgrade. Start Phase 1:
> add claim-level provenance to the wiki templates + CLAUDE.md + a lint check, then
> scaffold the mini eval harness (15–20 Q&A over a few public-domain books, measuring
> retrieval recall + citation correctness). Show me a plan before editing files.
