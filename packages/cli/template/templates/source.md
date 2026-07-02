---
type: source
domain: tech              # tech | psychology | leadership | other
status: draft             # stub | draft | mature
created: YYYY-MM-DD
updated: YYYY-MM-DD
author: ["Last, First"]
year: YYYY
isbn: ""
language: en              # en | ru | ...
pages: 0
raw: "raw/books/<slug>/book.md"
aliases: []
tags: []
---

# <Book / Article Title> — <Author> (<Year>)

> One- or two-sentence framing of what this source is and why it matters in the wiki.

## Bibliographic

- **Author(s):**
- **Year:**
- **ISBN / DOI / URL:**
- **Edition:**
- **Language:**
- **Source file:** [[../../raw/books/<slug>/book.md]]

## Author's thesis

What is the author actually arguing? In 3–5 sentences.

## Table of contents

1. Chapter 1 — <title> — [[#Chapter-1-summary|summary ↓]]
2. Chapter 2 — <title>
3. ...

## Chapter summaries

### Chapter 1: <title>
- Main point:
- Key claims (with provenance):
  - "..." ^[raw/books/<slug>/book.md:120-134] → linked to [[Concept-Page]]
- Examples:
- Open questions:

### Chapter 2: <title>
...

## Key concepts introduced or developed

- [[Concept-A]] — how this source treats it
- [[Concept-B]] — how this source treats it

## Key entities mentioned

- [[Person-Name]] (role)
- [[Other-Source]] (referenced)

## Extracted claims

A flat list of citable claims. **Every claim MUST carry a provenance token** that resolves
to the exact lines in the raw source: `^[<raw-path>:Lstart-Lend]`. The line range points into
the immutable `raw/` file (stable line numbers), not the wiki page. The synthesis layer pulls
from here; `scripts/lint-citations.mjs` flags any claim missing or with a broken token.

- <claim> ^[raw/books/<slug>/book.md:412-418] → relevant to [[Concept-A]]
- <claim> ^[raw/books/<slug>/book.md:640-655] → relevant to [[Concept-B]]
- Chapter-only fallback when no line map exists: <claim> ^[<slug>#Ch.3]
- ...

## Contradictions / tensions

Three callout types — pick the one that fits; never silently overwrite a conflicting claim. Each
names both sides and ends with a boundary-conditioned `Resolution:` (see CLAUDE.md → Contradictions & tensions).

> [!warning] Contradiction — this source vs. [[Other-Source]]
> This source claims X ^[raw/books/<slug>/book.md:120-128]. [[Other-Source]] claims Y.
> **Resolution:** X holds when <condition>; Y holds when <condition>. See [[Synthesis-Page]].

> [!warning] Tension — <term> here vs. [[Other-Source]]
> Same term, different referent/scale — flag so they aren't conflated.

> [!note] Composition with [[Other-Source]]
> Complementary, not conflicting — one supplies substance, the other delivery.

## Owner notes

- *Free-form notes added by the human owner during reading.*
