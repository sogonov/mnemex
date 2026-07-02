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
- [ ] **Contextual breadcrumb (2b).** DESIGNED (`docs/methodology/contextual-retrieval-design.md`), not built. Language-matched breadcrumb at conversion time; re-run eval → arm B. Headroom expected small (qmd already carries title + heading hierarchy). Reference: `claude-obsidian/scripts/contextual-prefix.py`.
- [x] **Reranking** — already delivered by qmd (qwen3-reranker); confirmed the dominant lever. Nothing to build.
- [x] **Cross-lingual moat** — proven (RU→EN ≈83%), no build needed.
- 🅿️ **Typed-graph retrieval** — parked R&D (eval-only, unproven; see Progress section). Not a phase deliverable.

### Phase 3 — curation robustness (NEXT UP)
- [ ] **Lint as code** (highest-value, ~120 LOC): broken wikilinks, orphan pages, duplicate concepts. mnemex has **zero wikilink validation today** despite dense `[[...]]`. Add `scripts/lint-links.mjs` (fence-aware `[[...]]` extractor, `\p{L}`-safe) alongside `lint-citations.mjs`; wire into `mnemex lint`. Steal #10/#11 from the strategy doc.
- [ ] **Review queue** (slice): verbatim-body staging → human approve/reject before pages land in `wiki/`. Reference: `llm-wiki-compiler/src/commands/review-*.ts`. Take the small staging+policy slice, not the full concurrent-lock machinery.

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
