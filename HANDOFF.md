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

## Roadmap — phased, each phase ships on its own

Ruthless scoping is the point: "merge everything" kills solo projects. Ship each phase.

### Phase 1 — cheap credibility (do first; unblocks the relaunch)
- [ ] **Claim-level provenance.** Add `^[<source-slug>.md:Lstart-Lend]` (or chapter ref) to extracted claims. Touch: `apps/wiki-template/templates/{source,concept}.md`, `apps/wiki-template/CLAUDE.md` (instruct the agent to cite source location), and add a lint rule that flags malformed/missing citations.
- [ ] **Mini eval harness.** 15–20 fixed Q&A over a small known corpus (e.g. 3–4 public-domain books). Script measures retrieval recall + share of answers with a correct citation. Output a single number. Put under `eval/` (new dir) + a `mnemex eval` CLI command or a standalone script. This is the graph the relaunch article needs.

### Phase 2 — retrieval quality (the real upgrade; the article's money graph)
- [ ] **Contextual Retrieval.** At ingest, generate a 1–2 sentence contextual prefix per chunk and index the *prefixed* text in qmd. Keep multilingual (Qwen). Re-run the Phase-1 eval → produce a before/after recall delta.
- Reference implementation to study: `claude-obsidian/scripts/contextual-prefix.py`.

### Phase 3 — curation robustness
- [ ] **Review queue.** Write candidate pages to a staging area; human approves before they land in `wiki/`. Directly fixes the "model silently halts/halucinates" failure mode. Reference: `llm-wiki-compiler/src/commands/review-*.ts`.
- [ ] **Lint as code** (not model-only): broken wikilinks, orphan pages, duplicate concepts (via aliases registry), unflagged contradictions.

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
