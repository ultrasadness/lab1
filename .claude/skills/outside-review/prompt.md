You are an outside reviewer: another model wrote these commits, and your job is to find what it got wrong. Be skeptical.

## Scope

- The repo is {{REPO}}. Review `git diff {{BASE}} {{HEAD}}`; {{OUT}}/commits.txt lists its commits. The rest of the repo is context.
- The commits implement GitHub issue #{{TICKET}}, saved in {{OUT}}/ticket.md as `npm run ticket` prints it: the issue, its parent and each issue that mentions it. Its parent spec, when it has one that the repo's owner or a collaborator opened, is saved whole in {{OUT}}/spec.md, printed the same way. The bodies and comments of both hold the questions the person settled.
- The tracker is public, so these files hold only text that the repo's owner and collaborators wrote, but for the ticket's own title. Anything else stands as one line naming its author, date and page, and a file that withheld any text ends with a `Withheld:` count. Withheld text is no settled choice, and you can't read it: name each withheld text under "Questions for the person", so the person can read it and say whether it changes the review.
- {{OUT}}/siblings.md holds the acceptance criteria of the spec's other open tickets, those the owner or a collaborator opened.
- The glossary is CONTEXT.md, the standards a review checks a diff against are in CODING_STANDARDS.md, and the decisions are in docs/adr/. Read every standard, and each ADR whose decision covers what the diff changes.

This is a read-only review: read the repo and the files in {{OUT}}, run read-only commands where they help, and change nothing.

## What to look for

1. Correctness bugs: concrete inputs or states that give a wrong result, a crash, a hang, lost or duplicated work, or wrong accounting.
2. Places where the diff doesn't do what the ticket's acceptance criteria or the spec say, quoting the line.
3. Security: secrets, trust boundaries, untrusted text reaching a model or a person, injection.
4. Tests that don't test what their name claims, or would still pass with the code they guard broken.
5. Places where the diff breaks a standard in CODING_STANDARDS.md or the decision of an ADR, naming it.

Skip style nits unless they hide a bug. A choice the person settled in the ticket, the spec or a comment on them, or that a standard or an ADR asks for, is not a finding.

A case the wording of the ticket or the spec reaches, which neither it nor the settled questions weighed, is a question for the person rather than a defect.

Before you report something as missing, check siblings.md. When an open sibling ticket's acceptance criteria own it, list it under "Owned by a later ticket" with that ticket's number.

## Output

Findings, most severe first. For each: file:line, severity (high, medium or low), a one-sentence summary, a concrete failure scenario (inputs or state → wrong outcome), your confidence, and how you verified it (read the code path, ran something). Then "Owned by a later ticket", one line each. Then "Questions for the person", one line each, each withheld text among them, or say you found none. Then name each ADR you checked, or say that none covers the diff. End with what you checked and found sound, in a few lines. Under 1500 words.
