# Doc pairs

A doc the person reads has a Simplified Chinese side. A pair is three sibling files: `foo.md` (English), `foo.zh.md`
(Chinese) and `foo.i18n.yaml`, the pair's record. The pairs are the list in `scripts/check-docs.ts`, where
`docs/adr/` stands for every ADR in that directory, and `npm run check:docs`, which the pre-commit hook and CI run, keeps each pair
in step. The design follows DeepSeek Harness's `docs/i18n/README.md` (#82).

## Changing a paired doc

A commit that edits either side of a pair updates the other side in the same commit:

1. Edit one side.
2. Run `npm run check:docs`. It names each section that changed since the pair was recorded.
3. Patch only those sections of the other side, against the edited side's diff, so the rest of the translation
   stays as it was reviewed.
4. Run `npm run check:docs -- --write foo.md` to re-record the pair. The record's diff is your confirmation that
   both sides say the same thing. A green check means only that someone confirmed the pair at these contents and that
   it holds the table's renderings; the translation's quality is review's job.

## Writing the Chinese side

- It mirrors the English side: the same headings at the same depths in the same order, code blocks copied byte for
  byte (their comments stay English), and right after the H1 the line `[English](foo.md) | 中文`, answered by
  `English | [中文](foo.zh.md)` in the English side. Each section has as many list items on both sides, and the same
  inline code and link URLs.
- Glossary terms from `CONTEXT.md` stay in English, in their singular form (`三个 Dossier`), the way the person and
  agents talk. `CONTEXT.zh.md` explains each term in Chinese beside the English term.
- A phrase in the table of renderings, `RENDERINGS` beside `PAIRS` in `scripts/check-docs.ts`, takes the table's one
  rendering. The check fails a section whose English side uses the phrase and whose Chinese side lacks the rendering,
  naming the file, the section, the phrase and the rendering. It matches whole words in any case, hyphenated or not, in
  the singular or the plural, and reads neither inline code, code blocks nor link URLs. It reads a section as a whole,
  so a second rendering beside the right one is review's to catch.
- A link to another paired doc, such as from one ADR to another or to `CONTEXT.md`, points at that doc's `.zh.md`.
  An anchor names a heading of the doc it leads to, as GitHub writes it, so a Chinese heading's anchor is Chinese
  (`#后果`). The check fails a link to an English side, or to an anchor no heading has.
- Break a line inside a paragraph only where a space reads fine, as between a glossary term, its definition and its
  `_避免使用_` line: a line break inside Chinese text renders as a space. The check fails a break between two Chinese
  characters, punctuation included, unless the line ends in a full-width colon (`：`) or a hard line break.

## Adding to the table of renderings

A phrase belongs in the table when it is the project's own, is in at least three sections across at least two pairs,
and the Chinese sides render it one way throughout. Everyday technical words such as `host` or `repo`, and plain
English, stay out, because the wider the table, the more often a sound synonym gets refused. The person settled this
on #97.

Add `{ en, zh }` to `RENDERINGS`, run `npm run check:docs`, and read each failure:

- A real fault: fix the Chinese side and re-record the pair.
- A use in another sense: put its wording in the entry's `except`, as `gate` lets through "a gate between runs" (`关卡`
  in ADR 0001) and `bot check` lets through the verb in "the bot checks".

A word whose senses no wording tells apart stays with review: `token` is both a credential (`令牌`) and a model's unit
of text, which stays `token`.

## Adding a pair

A new ADR is a pair from its first commit, since `docs/adr/` is in `PAIRS`: give it the language link, write its
Chinese side and record the pair with `--write`. Any other new doc fails the check until it is in `PAIRS` or in
`UNPAIRED`, beside it in `scripts/check-docs.ts`. Which list is the person's call, so ask them before adding it to
either: a doc they read gets a Chinese side, while agent instructions, test fixtures and `docs/lab1.md` (the course's
brief, already Chinese) stay as they are.
