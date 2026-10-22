# Hooks and CI

English | [中文](hooks-and-ci.zh.md)

What checks each commit and push, for both packages: the root's (the bot, our Pi extension and the scripts) and
`browser/`'s (the browser service). In a fresh clone, turn on the hooks in `.githooks/` once with
`git config core.hooksPath .githooks`.

## Hooks

- **pre-commit** refuses a commit on any branch but `main` in the main checkout. Then it checks a copy of what is
  staged: each package's typecheck, run with that package's own dependencies, then the doc-pair check
  (`docs/agents/doc-pairs.md`). It refuses the commit when one fails. Without a package's dependencies, it refuses
  every commit and says how to install them. It runs no tests: the root's take about a minute, and the browser
  service's build an image.
- **post-checkout** runs `npm ci` for each package in a worktree that `git worktree add` has just made, from npm's
  cache where it can, so the typechecks have their dependencies. It installs them rather than linking the main
  checkout's `node_modules`: `npm ci` or `npm uninstall` through such a link would change the main checkout's own.
  When an install fails, it says so, and the worktree is made anyway.
- **commit-msg** refuses a message with a GitHub closing keyword before an issue reference, such as `Closes #88`,
  even with a line break or a blank line between them: GitHub would close the issue as soon as the commit reaches
  `main`, but a ticket closes by hand once it has landed (**Close** in `docs/agents/issue-tracker.md`). Write the
  reference as `(#88)` instead.
- **pre-push** refuses a push that moves `main` to a commit unless GitHub Actions has run on it and every run has
  passed: GitHub Free has no branch protection for a private repo, so nothing on the server would refuse it. The hook
  asks GitHub through `gh`, so `gh` must be signed in.

## Claude Code hooks

`.claude/settings.json` gives every Claude Code session in this repo three hooks of its own, scripts in
`.claude/hooks/` run with Node:

- **reply-language** (on Stop) sends a turn's last reply back to be written again when it is in English, as the
  Language section of `CLAUDE.md` asks. It leaves out code, inline code, links and bold spans, which hold titles, and
  takes a reply of at least 40 Latin letters to be English when Han characters make up under 15% of its letters and
  characters. A reply already sent back once ends the turn.
- **note-language** (after every tool call) judges the notes Claude wrote the person before tool calls in the turn by
  the same rule, and names each English one back to Claude once, so that the next note is in Chinese. The transcript
  is written a message or more behind, so a note is named a tool call or more after it.
- **review-committed** (on the Skill tool) refuses a code-review skill while the checkout holds work not yet
  committed, or a branch that lacks commits `main` has, and says to commit or to rebase first, as the Code review
  section of `CLAUDE.md` asks.

A session reads them from the checkout it started in, so a change to them counts once it is on `main`. A running
session picks up a change to `.claude/settings.json` there at once, as the #48 retro found, and runs each script as it
then is.

## CI

GitHub Actions runs two workflows on every push and pull request, so a slow or failing browser run doesn't hide the
bot's result:

- **Bot** (`.github/workflows/bot.yml`): the root's typecheck, the doc-pair check and the root's tests. The job's
  summary lists the slowest tests and the run's total (`scripts/slowest-tests.ts`), so a test nearing its 60 seconds,
  or the job its 15 minutes, shows before it fails.
- **Browser** (`.github/workflows/browser.yml`): `npm ci`, the typecheck and the tests in `browser/`. The tests build
  the image and start it through Docker Compose. The runner is amd64, so they test the pinned digest's amd64 image,
  where the VM runs its arm64 one.

## Tests

The root's `npm test` runs the tests of the hooks and checks:

- `scripts/pre-commit.test.ts`, `scripts/post-checkout.test.ts` and `scripts/commit-msg.test.ts` commit, or add a
  worktree, in a throwaway repo. `scripts/pre-push.test.ts` pushes from one, with a fake `gh` that needs `jq`.
- `scripts/reply-language.test.ts`, `scripts/note-language.test.ts` and `scripts/review-committed.test.ts` run each
  Claude Code hook as a session would, on a throwaway transcript or repo. `scripts/slowest-tests.test.ts` runs the CI summary on a run's output.
- `scripts/doc-pairs.test.ts` runs the doc-pair check on throwaway pairs.
- `scripts/bounded-waits.test.ts` fails on a `spawnSync`, `execSync` or `execFileSync` call whose own arguments
  name no `timeout`: a synchronous child process blocks the event loop, so no other timer can end it (**Every wait
  has a bound** in `CODING_STANDARDS.md`).
- `scripts/bot-imports.test.ts` fails on a module `bot/src` imports that is neither Node's own (`node:`) nor one of
  the bot's files: the bot has no npm dependencies of its own (`bot/README.md`), and `graphql` is for the tests and
  the schema capture alone.
- `scripts/bot-test-imports.test.ts` fails on a file under `bot/test/`, outside `bot/test/harness/`, that imports a
  file under `bot/src`: a test reaches the bot only through the harness (`bot/README.md`), and one that imports from
  `bot/src` asserts on how the bot builds something.
