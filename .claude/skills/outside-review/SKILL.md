---
name: outside-review
description: Review a ticket's commits with Codex, a different model, in a sandbox that hides every credential.
disable-model-invocation: true
---

An outside review: Codex, a model other than the one that wrote the code, reviews a ticket's commits. `review.sh` does the mechanics. It gathers the ticket, its spec and the spec's other open tickets, runs Codex read-only inside `bwrap` with every credential folder hidden and an empty environment, and audits every command Codex ran. Your part is pinning the review and checking what comes back.

1. **Pin the review**: a ticket number and a base commit; the head defaults to `HEAD`. Take them from the person's message. When the base is missing, propose the commit just before the ticket's first one and confirm it. Done when the ticket, base and head are named.

2. **Run** `.claude/skills/outside-review/review.sh <ticket> <base> [<head>]` in the background, with `OUT` set to a new folder in your scratchpad; a review takes 5 to 10 minutes. Done when it exits. Exit 2 is a bad argument. Exit 3 means a credential folder wasn't hidden and no review ran: report that and stop.

3. **Read `audit.md`** in `OUT`. It flags any command that reached past the repo and `OUT`, read the environment, used the network or tried to change something. Flagged commands go first in your report.

4. **Check every finding** in `review.md` against the code: read the cited lines and the path that reaches them, then mark the finding confirmed, plausible or wrong. Check each "owned by a later ticket" line against `siblings.md`. Done when every finding has a verdict.

5. **Report**:
   - confirmed bugs, worst first, each with file:line and its failure scenario;
   - plausible ones, saying what would settle each;
   - findings owned by later tickets, with the ticket;
   - what Codex found sound, and what nobody verified.

   The fixes wait until the person asks for them.
