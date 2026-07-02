# LLM Wiki — Operating Manual

This directory is a **persistent, LLM-maintained knowledge base** built on Andrej Karpathy's LLM Wiki pattern (https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

You are reading this because you are an LLM agent (Claude Code, Cowork, or similar) operating inside this wiki. **This file is your operating manual.** Read it fully before touching any files here.

The owner of this wiki is the human; you are the librarian. Your job is everything tedious about maintaining a knowledge base — summarizing, cross-referencing, filing, lint, bookkeeping. The owner curates sources, asks questions, and directs the analysis.

---

## Core idea

Most LLM+documents setups are RAG: chunk → embed → retrieve at query time → generate. Knowledge is never accumulated; the LLM rediscovers it on every question.

This wiki is the opposite: **knowledge is compiled once and then kept current.** When a new source arrives, you (the LLM) read it, extract what matters, and integrate it into the existing wiki — updating entity pages, revising topic summaries, flagging contradictions. Future questions search the **already-synthesized** wiki, not raw sources.

The wiki is a compounding artifact. Every ingest makes it richer. Every good answer is filed back in as a new page.

---

## Three layers

### `raw/` — immutable sources
Original materials. You read these but **never modify them**.

- `raw/books/` — full book texts, converted to markdown (PDF/EPUB → .md). One subdirectory per book: `raw/books/<slug>/{book.md, meta.yaml, cover.jpg}`.
- `raw/articles/` — single-file articles, blog posts, papers. Naming: `YYYY-MM-DD__<slug>.md`.
- `raw/assets/` — images, diagrams, PDFs that pages reference.

### `wiki/` — LLM-owned synthesis
Markdown files you write and maintain. The owner reads; you write. Subfolders by **type of page** (not by topic — topics emerge through wikilinks and tags).

- `wiki/entities/` — concrete things: people, companies, books, libraries, tools (e.g. `Eric-Evans.md`, `Daniel-Kahneman.md`).
- `wiki/concepts/` — abstract ideas, patterns, frameworks (e.g. `Bounded-Context.md`, `Cognitive-Dissonance.md`).
- `wiki/sources/` — one page per ingested source. Bridge between `raw/` and the rest of the wiki. Contains: meta (author, year, ISBN), TOC, chapter-by-chapter summary, extracted claims with locations, key entities/concepts mentioned (as wikilinks).
- `wiki/syntheses/` — cross-source analyses, comparisons, evolving theses. Born from queries. Examples: `DDD-vs-Clean-Architecture.md`, `What-makes-a-good-tech-lead.md`.

### Schema layer (this file + templates)
- `CLAUDE.md` — this file. Operating manual.
- `templates/` — page templates you use when creating new pages.
- `index.md` — content catalog. Updated on every ingest.
- `log.md` — chronological journal. Appended after every operation.
- `hot.md` — a ~500-word rolling orientation cache: what was read recently, which threads are open, what to read next. Refreshed on every ingest and read first on every query. Cheap cross-session memory so you don't re-derive context each session.

---

## Naming conventions

**Pages:** `Title-Case-With-Dashes.md` for entities and concepts (e.g. `Bounded-Context.md`, not `bounded_context.md`). This makes wikilinks readable: `[[Bounded-Context]]`.

**Sources:** match the book or article's natural identity: `Domain-Driven-Design-Evans-2003.md`, `Thinking-Fast-and-Slow-Kahneman-2011.md`.

**Raw books:** `raw/books/<author-lastname>-<short-title>-<year>/book.md`. Example: `raw/books/evans-ddd-2003/book.md`.

**Slugs:** lowercase, kebab-case, no diacritics. Non-Latin titles are transliterated (`myshlenie-bystroe-i-medlennoe`).

---

## Frontmatter (YAML)

Every wiki page starts with YAML frontmatter. This is read by Obsidian's Dataview plugin and by you when answering queries.

```yaml
---
type: concept            # entity | concept | source | synthesis
domain: tech             # tech | psychology | leadership | other (can be a list)
status: stub             # stub | draft | mature
sources: 3               # how many sources reference this page
created: 2026-05-22
updated: 2026-05-22
tags: [ddd, architecture]
aliases: ["DDD", "Domain Driven Design"]
---
```

`aliases` is **important** — it solves the "duplicate concepts under slightly different names" problem flagged in the gist comments. Always check existing aliases before creating a new concept page.

---

## Provenance — claim-level citations

Every extracted claim must be traceable to the exact place in the raw source it came from. This
is what separates a synthesis you can trust from one you have to re-check by hand. The rule:

> **Every extracted claim, evidence-table row, and source-attributed definition carries a
> provenance token that resolves to the raw source lines.**

**Token format:** `^[<raw-path>:Lstart-Lend]`

- `<raw-path>` is the path to the immutable raw file, relative to the wiki root — e.g.
  `raw/books/evans-ddd-2003/book.md`. Use the raw file, **not** the wiki page: raw line numbers
  are stable because you never edit `raw/`.
- `Lstart-Lend` is an inclusive line range in that file, `Lstart <= Lend`.
- Full example: `^[raw/books/evans-ddd-2003/book.md:412-418]`.
- **Chapter fallback** (only when the raw file has no usable line map, e.g. a scanned book):
  `^[<slug>#Ch.3]` — e.g. `^[evans-ddd-2003#Ch.3]`. Prefer line ranges; the eval rewards them.

**Where it's mandatory:**
- `wiki/sources/*` — every bullet under **Extracted claims**, and every "Key claim" in the
  chapter summaries.
- `wiki/syntheses/*` — the `Location` column of the **Evidence** table.
- `wiki/concepts/*` — the source-attributed line in **Definition** (and each variant if sources
  differ).

**How to find the lines:** when reading the raw file, note the line numbers of the passage you're
citing (`Read` shows them; `qmd get <file>:<line>` slices around a line). Cite the tightest range
that contains the claim — a paragraph, not a chapter.

`scripts/lint-citations.mjs` enforces this: it flags claims with no token, malformed tokens, and
tokens whose raw file is missing or whose line range is out of bounds. Run it before finishing an
ingest (see **Lint** below).

---

## Operations

### Ingest (when the owner adds a source)

When a new file appears in `raw/` (or the owner asks you to ingest something):

1. **Read the source.** For books, read the whole thing — don't skim. For long books, you may need multiple passes.
2. **Discuss key takeaways** with the owner in 3–5 bullet points before writing anything. Wait for direction on what to emphasize.
3. **Create a source page** in `wiki/sources/` using `templates/source.md`. Fill in: bibliographic meta, TOC, chapter-by-chapter summary, list of extracted claims **each with a `^[raw-path:Lstart-Lend]` provenance token** (see **Provenance** above — this is mandatory, lint enforces it), list of key entities and concepts mentioned (as wikilinks).
4. **Update or create entity pages** for people, books, companies, tools mentioned. Use `templates/entity.md`.
5. **Update or create concept pages** for ideas, patterns, frameworks. Use `templates/concept.md`. **Before creating a new concept page, search `index.md` and all `aliases:` fields for synonyms.** If a similar concept exists, extend the existing page or add an alias rather than creating a duplicate.
6. **Update `index.md`** — add new pages to their category section.
7. **Append a log entry** to `log.md` with format `## [YYYY-MM-DD HH:MM] ingest | <source title>` followed by a one-line summary and list of pages touched.
8. **Flag contradictions.** If a new source conflicts with an existing claim, add a `> [!warning] Contradiction` / `> [!warning] Tension` / `> [!note] Composition` callout (whichever fits) on the relevant page, naming both sides with citations and a boundary-conditioned `Resolution:` line. Never silently overwrite. See **Contradictions & tensions** below.
9. **Refresh `hot.md`.** Update the ~500-word rolling orientation file: what was just ingested, which threads it opened or closed, what to read next. This is cheap cross-session memory (see **Schema layer**).

A single ingest typically touches **10–15 wiki pages**. That's correct — it's the bookkeeping you exist to do.

> **Tip for large books — the two-phase ingest pattern.** Splitting the ingest into
> (1) a content phase delegated to a sub-agent (read source + write source/entity/concept
> pages, but NOT index.md/log.md/meta.yaml) and (2) a short bookkeeping phase done by the
> parent (update index.md counts, append log.md, flip meta.yaml `llm_ingested: true`)
> avoids socket timeouts that long single-agent ingests hit on the finalization steps.
> See `../docs/methodology/two-phase-ingest.md`.

### Query (when the owner asks a question)

1. **Read `hot.md` then `index.md` first** — `hot.md` gives you cross-session orientation (what was read recently, open threads); `index.md` locates the relevant pages.
2. **Route by intent — it changes the strategy.** Don't run the same heavy search for every question:
   - *simple lookup / definition* → one search, take the top concept/synthesis page. Don't over-expand.
   - *concept / "how does X work"* → synthesis-first (step 3), then walk the graph (step 4).
   - *cross-source / comparison* → decompose: follow the concept's `Contrasted-with` links and issue **one sub-query per source**, then union the results — this deterministically pulls in the *other side* of the comparison.
   - *verbatim quote / fact-check* → retrieve the wiki page, then descend to `raw/` via its provenance token.
3. **Search synthesis-first.** With the search MCP (`mnemex-search`, powered by qmd — `brain.query`), issue typed sub-queries (keyword + semantic). Prefer `wiki/syntheses/` and `wiki/concepts/` pages — they are the **pre-compiled context** (a synthesis page already situates its claims, so it retrieves better than a raw chunk). The index is multilingual, so a Russian question can land on a Russian synthesis page that cites an English source. Without the MCP, use `Grep`/`Read`.
4. **Walk the typed graph, then descend to raw.** From the best page, follow its **typed links** (`Builds-on` / `Subsumes` / `Contrasted-with` / `Contradicts` / `See also`) to pull in neighbors that flat search misses — and **always surface `Contradicts` / `Contrasted-with`** so you present the tension, not one side. For a direct quote or fact-check, follow the page's `^[raw:Lstart-Lend]` token down to the exact lines in `raw/`. Pull only the neighbors the question needs — don't dump the whole neighborhood into the answer.
5. **Answer only from the wiki, cite every claim, and abstain when the wiki is thin.** This is the contract that makes the answer trustworthy:
   - Ground every non-trivial claim in a `[[Source-Page]]` link (add the `^[raw:Lstart-Lend]` provenance token when quoting or fact-checking).
   - **Attribute, don't generalize** — "Evans argues…", "Kahneman shows…", never "it's known that…" or "best practice says…".
   - **If the wiki doesn't cover it, say so explicitly** ("the wiki has nothing on this — answering from general knowledge") rather than bluffing. Absence is a useful signal about what to read next.
   - **Surface disagreement, don't resolve it silently** — if two sources conflict, name both and explain the tension (see **Contradictions & tensions**). Don't pick a side without saying you did.
   - **Answer in the language the owner asked in.** Match the question's language (the retrieval layer is multilingual by default).
6. **Offer to file the answer.** If the synthesis is non-trivial — a comparison, a thesis, a "how do these books agree" — propose creating a new page in `wiki/syntheses/`. Don't let valuable analysis disappear into chat history.

### Lint (periodic health check)

When the owner asks for lint, or proactively after every ~20 ingests:

**Code lint (deterministic — run the scripts, or `mnemex lint` which runs both):**

- `scripts/lint-citations.mjs` — claim-level provenance across `wiki/sources/` and `wiki/syntheses/`:
  claims with **no** token, **malformed** tokens, and tokens whose raw file is missing or line range
  is out of bounds.
- `scripts/lint-links.mjs` — wikilink integrity across all of `wiki/`: **broken** `[[links]]`
  (resolve to no page, by basename or alias), **duplicate** names (one basename/alias owned by 2+
  pages — an ambiguous `[[link]]` target, the "same concept under two names" trap), and **orphan**
  pages (no inbound link from another page). Fence-aware, alias-aware, Unicode-safe (Cyrillic titles
  resolve). Orphans are advisory (exit 0); `--strict` fails on them too.

`mnemex lint` exits non-zero on any hard finding (broken/duplicate; orphans only under `--strict`).
Run it at the end of every ingest and fix what it reports.

**Judgment lint (you do this by reading — the fuzzy calls a script can't make):**

- Find **contradictions** between pages that aren't already flagged.
- Find **stale claims** (a `source: 1` page where the only source has been superseded by newer reading).
- Find **near-duplicate concepts** — pages with *similar* (not byte-identical) titles or overlapping
  meaning that `lint-links` can't catch. Propose merges. (Exact basename/alias collisions are already
  caught by `lint-links`; this is the semantic layer above it.)
- Find **implicit concepts** — terms used on 3+ pages with no concept page of their own.
- For each **orphan** `lint-links` flags, decide per page: delete, integrate, or accept (a fresh stub
  legitimately has no inbound links yet).
- Report findings as a list. Don't fix without owner approval.

---

## Domain-specific guidance

### Technical sources (DDD, architecture, code)

- Code examples go in fenced blocks with language tag.
- For patterns, always include a `When to use` and `When NOT to use` section.
- Diagrams: text descriptions in the page, image files in `raw/assets/`, referenced by relative path.
- Cross-reference between patterns aggressively: a `[[Bounded-Context]]` page should link to `[[Aggregate-Root]]`, `[[Ubiquitous-Language]]`, etc.
- When answering coding questions, **cite the book and chapter**, not just the concept name.

### Psychology / self-improvement

- Distinguish **claim** from **evidence**. Psychology has lots of "popular truths" that don't replicate. Note when a claim is supported by studies cited in the source vs. asserted as folk wisdom.
- Use `> [!note]` callouts for the author's main thesis, `> [!example]` for case studies the author gives.
- Build entity pages for cited researchers (Kahneman, Tversky, etc.) so cross-book references compound.

---

## Relationships (avoid the "everything is `related`" trap)

When linking concepts, prefer typed sections over bare wikilinks. Conventions:

- `## See also` — loose association.
- `## Subsumes` — this concept contains the linked ones.
- `## Contrasted with` — the linked concept is an alternative or opposite.
- `## Builds on` — the linked concept is a prerequisite.
- `## Contradicts` — the linked source disagrees with claims on this page.

This is the fix for the "Similar, contains, contradicts — all collapsed into one word" problem from the gist comments.

---

## Contradictions & tensions (never overwrite a conflicting claim — hold the conflict)

When a new source disagrees with something already in the wiki, the worst thing you can do is
silently overwrite. The value of a compounding library is that it *remembers the disagreement*
and, where possible, resolves it with boundary conditions. Three distinct callout types — do not
collapse them:

- **`> [!warning] Contradiction — A vs. B`** — a genuine conflict: the two sources make claims that
  cannot both be true as stated.
- **`> [!warning] Tension — A vs. B`** — same word or metaphor, *different referent or scale*; not a
  real contradiction, but worth flagging so the reader doesn't conflate them.
- **`> [!note] Composition with [[X]]`** — the new source *layers* with an existing page
  (complementary, not conflicting) — one supplies substance, the other delivery, etc.

Every one of these names **both sides with attribution**, states each claim, and — this is the part
that makes the library worth more than the sum of its books — ends with a **`Resolution:`** clause
giving the **boundary condition**: *when A holds vs. when B holds*. A resolution without boundaries
("they're both kind of right") is a non-answer.

```markdown
## Contradictions / tensions

> [!warning] Contradiction — [[Voss-2016]] vs. [[Fisher-Ury-2011]]
> Fisher-Ury: "separate the people from the problem" — deal with emotion separately.
> Voss: emotion is the *substrate* of the deal; it can't be separated.
> **Resolution:** Voss holds when the counterpart is emotional or asymmetrically informed
> (most real negotiations); Fisher-Ury holds when both sides are rational and the merits are
> knowable (treaty drafting, sophisticated M&A). They layer: Fisher-Ury on substance, Voss on
> delivery. See [[Principled-vs-Tactical-Negotiation]].
```

Where the callout lives: on the most-affected page (concept or source), and — if the resolution
is non-trivial — promoted into a `wiki/syntheses/` page that both sources link to. During a query,
when two sources conflict, reproduce the tension for the owner; never pick a side without saying so.

---

## Levels (avoid flat hierarchy)

Tag pages with `status:` in frontmatter:

- `stub` — placeholder; created because something linked to it but no real content yet.
- `draft` — has content from 1–2 sources, not yet stable.
- `mature` — synthesized from 3+ sources, owner has reviewed.

This gives a sense of which pages are heavyweight anchors vs. lightweight references. Heavyweight pages may grow their own sub-pages (e.g. `Domain-Driven-Design.md` plus `Domain-Driven-Design-Strategic.md`, `Domain-Driven-Design-Tactical.md`).

---

## Working agreements

- **Never edit `raw/`.** It's the source of truth.
- **Never silently overwrite contradictory claims** — flag them.
- **Never create a concept page without checking `index.md` for synonyms.**
- **Always update `index.md` and append to `log.md`** as part of any ingest. These are not optional bookkeeping; they're how the system stays navigable.
- **When unsure, ask the owner.** This file co-evolves with the wiki; if a convention is missing or wrong, propose an update to `CLAUDE.md`.

---

## Tools

If the search MCP server is connected (`mnemex-search`, powered by qmd), you have hybrid BM25 + vector search over `wiki/` and `raw/` via `brain.query` / `brain.get` / `brain.multi_get` / `brain.status`. Use it for any non-trivial query.

If filesystem access is available (Cowork / Claude Code with direct file access), you can `Read`/`Grep`/`Glob` directly.

To download and ingest books into `raw/books/`, the `@mnemex/library-mcp` server provides search + download tools for Project Gutenberg and Anna's Archive. The conversion script lives at `scripts/ingest-book.sh` (run `scripts/setup-converters.sh` once to install pandoc/calibre/etc).
