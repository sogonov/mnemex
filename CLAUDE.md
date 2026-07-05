# CLAUDE.md — repo development guide

This file orients an AI agent (Claude Code etc.) working **on the mnemex codebase**.

> ⚠️ Do not confuse this with `apps/wiki-template/CLAUDE.md`. That one is a **product
> artifact** — the operating manual copied into every user's wiki to tell the agent how to
> maintain *their* knowledge base. THIS file is about developing mnemex itself.

## Start here

Read **`HANDOFF.md`** — it has current status, the strategic decision, and the phased roadmap.
We are keeping mnemex and absorbing the best ideas from two competitors while staying small.
Current task: **Phase 1** (claim-level provenance + a mini eval harness).

## Orientation

- Monorepo, pnpm workspaces. Build: `pnpm install && pnpm -r build`. TypeScript strict.
- `packages/library-mcp/` — MCP server that searches/downloads books (Gutenberg + Anna's via Playwright) and ingests them. Entry: `src/index.ts`.
- `packages/cli/` — the `mnemex` CLI (`init`/`doctor`/`mcp install`/`setup-search`/`reindex`/`search`).
- `apps/wiki-template/` — the wiki scaffold + operating manual + scripts.
- Search delegates to external `qmd` (BM25 + vector, Qwen multilingual embeddings).
- Open PRs #1/#2 (`sogonov`) add Windows support — review/merge.

## Working agreements

- Keep the surface small. The moat is **book acquisition + multilingual + whole-book methodology**, not engine size. Don't reimplement competitors' 28k-LOC engines wholesale.
- Each roadmap phase must ship independently. Don't start Phase 2 before Phase 1 lands.
- Verify changes by building (`pnpm -r build`) and, where relevant, a real run.
- **MCP stdio hygiene.** The MCP servers speak JSON-RPC over **stdout** — never write anything else there. Logs go to `process.stderr` (see `packages/library-mcp/src/index.ts:472`); no `console.log` in a server path; capture child-process output (`execFile` buffers by default), never inherit it into the parent's stdout. A stray stdout write corrupts the protocol.
