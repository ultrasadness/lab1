---
name: outside-review
description: Review a ticket's commits with Codex, a different model, in a sandbox that hides every credential.
disable-model-invocation: true
---

An outside review: Codex, a model other than the one that wrote the code, reviews a ticket's commits. `review.sh` does the mechanics. It gathers the ticket, its spec and the spec's other open tickets, runs Codex read-only inside `bwrap` with the home folder and `/tmp` hidden but for what it needs, and an empty environment, and audits every command Codex ran. Your part is pinning the review and checking what comes back. A Claude session's code review runs it beside its two reviewers, as the Code review section of `CLAUDE.md` says, and the person can start it alone with `/outside-review`.

1. **Pin the review**: a ticket number and a base commit; the head defaults to `HEAD`. Take them from the person's message. When the base is missing, propose the commit just before the ticket's first one and confirm it. Done when the ticket, base and head are named.

2. **Run** `.claude/skills/outside-review/review.sh <ticket> <base> [<head>]` in the background, with `OUT` set to a new folder in your scratchpad; a review takes 3 to 10 minutes. Done when it exits, which wakes you. Exit 2 is a bad argument. Exit 3 means a folder wasn't hidden and no review ran, and exit 4 means the diff holds only docs, so Codex didn't start: report that and stop. Exit 137 means Codex ran past its 20 minutes and left no review, and any other exit is a failure the script explains: report it with what the script printed, read `audit.md` as step 3 says when `OUT` holds one, and stop. A warning that the worktree changed goes in your report.

3. **Read `audit.md`** in `OUT`. It flags any command that reached past the repo and `OUT`, read the environment, used the network, reached for Docker or sudo, or tried to change something. Flagged commands go first in your report. When it says the run is unaudited, say so there too.

4. **Check every finding** in `review.md` against the code: read the cited lines and the path that reaches them, then mark the finding confirmed, plausible or wrong. A finding you mark wrong cites the code that shows it: you may be the session that wrote this code, and this check is where that bias gets back in. Check each "owned by a later ticket" line against `siblings.md`. Done when every finding has a verdict.

5. **Report** every finding in Codex's own words, under its verdict:
   - confirmed bugs, worst first, each with file:line and its failure scenario;
   - plausible ones, saying what would settle each;
   - wrong ones, each with the code that shows it, so the person can overrule you;
   - findings owned by later tickets, with the ticket;
   - Codex's questions for the person;
   - the ADRs Codex checked, what it found sound, and what nobody verified.

   When the person started this with `/outside-review`, the fixes wait until they ask for them.
