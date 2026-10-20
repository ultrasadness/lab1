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
   both sides say the same thing. A green check means only that someone confirmed the pair at these contents; the
   translation's quality is review's job.

## Writing the Chinese side

- It mirrors the English side: the same headings at the same depths in the same order, code blocks copied byte for
  byte (their comments stay English), and right after the H1 the line `[English](foo.md) | 中文`, answered by
  `English | [中文](foo.zh.md)` in the English side.
- Glossary terms from `CONTEXT.md` stay in English, in their singular form (`三个 Dossier`), the way the person and
  agents talk. `CONTEXT.zh.md` explains each term in Chinese beside the English term.
- A link to another paired doc, such as from one ADR to another or to `CONTEXT.md`, points at that doc's `.zh.md`.
  The check fails a link that points at its English side instead.
- Break a line inside a paragraph only where a space reads fine, as between a glossary term, its definition and its
  `_避免使用_` line: a line break inside Chinese text renders as a space.

## Adding a pair

A new ADR is a pair from its first commit, since `docs/adr/` is in `PAIRS`: give it the language link, write its
Chinese side and record the pair with `--write`. For any other doc, first add its English side to `PAIRS` in
`scripts/check-docs.ts`. Agent instructions stay English only: `CLAUDE.md` (which `AGENTS.md` links to),
`.claude/skills/` and `docs/agents/`. So do test fixtures. `docs/lab1.md`, the course's brief, is already Chinese and
stays as received.
