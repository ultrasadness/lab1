# PROTOTYPE, throwaway: Walkthrough and Approval on Discord

Answers [How should a Walkthrough and its Approval look on Discord?](https://github.com/ultrasadness/lab1/issues/12). Kept as a primary source; not production code.

**Verdict: A's forum and A's card, with C's place for what needs you.** The person tried all three in their own server and preferred A or C to B, because a post or thread per Product keeps things organized, where B's single DM stream doesn't. They then chose:

- a forum with one post per Product, tagged by outcome, as the record;
- a `#needs-you` channel (C's inbox, renamed so "Inbox" stays out of it) holding the full Walkthrough card and everything else waiting on them, each card shrinking to one line once handled;
- A's full card, with consequences first and every field;
- per-field Edit and a Correct pop-up, all inside Discord;
- one-tap Approve.

They noticed no difference worth designing around in the notification checks. The full answer is on the issue.

**Plan:** three variants of a Product's journey (Dossier → Walkthrough → Approval → Registration → walls → Reply draft → proposed Rule), posted by a throwaway discord.js bot into the person's private server and tried on the iPhone, picked from `#proto-control`.

| Variant | Where things live | Walkthrough | Approve | Edit / Correct | Progress |
|---|---|---|---|---|---|
| **A** | forum `#a-products`, one post per Product, tags for outcomes | the whole thing on one card: consequences first, every field with **Edit** beside it | one tap | Edit per field (one-field pop-up); Correct pop-up | its own status message, edited in place |
| **B** | the bot's DM, one stream | a short card: who, which address, which terms, what happens; **Details** expands it | a confirming pop-up with a required tick | Edit: all fields in one pop-up; Correct pop-up | the Walkthrough card itself turns into the Registration |
| **C** | `#c-inbox` holds only what needs you; `#c-products` has a thread per Product | only what differs from a standard Registration; the full copy sits in the thread | one tap in the inbox | **Edit** opens a tailnet page; Correct by replying in the thread | a status message in the thread; inbox cards shrink to one line once done |

The five fictional Products (on `.example` domains), one per path:

- **Inkwell:** clean, then a Reply draft from the founder.
- **Larkspur:** a bot check, then Take over or Hand off.
- **Quill CRM:** the page check fails, so a Submit tap with a screenshot.
- **Tessellate:** an amended Walkthrough on page 2.
- **Relay:** the form wasn't seen, so the Walkthrough carries only the standard keys, then the waitlist.

`#proto-control` also simulates the events a real run can't be made to produce on demand, such as 14 days passing or an edit in Gmail. It has notification checks too, for the questions the [Discord research](https://github.com/ultrasadness/lab1/blob/research/discord-bot/docs/research/discord-bot.md) left open on iOS.

Names and addresses (`Alex Example`, `you+<product>@gmail.com`) are placeholders, not facts about the person. Nothing registers, sends or reads mail; all state is in memory and lost on restart.

## Run

```sh
./run.sh        # serve the tailnet page on :8446 and start the bot
./run.sh down   # remove the :8446 serve
```

Needs `~/.config/lab1/discord-bot-token` (mode 600). The bot must be in exactly one server, and Community must be on for variant A. The server's owner is taken to be the person. `shots/` holds the Submit tap screenshots, rendered once with `make-shots.cjs` in the Takeover rig's Playwright image.

---

# PROTOTYPE, throwaway: the Miner's day list on Discord

Answers [How does the day's list of Dossiers and Skips look on Discord?](https://github.com/ultrasadness/lab1/issues/29). It reuses this folder's bot setup and `kit.mjs`, but runs as its own bot, `day.mjs`, with its own `prototype-29` category. Kept as a primary source; not production code.

**Verdict: C, with the Day's line only in the title and summary.** The person tried the variants and chose C overall: a forum post per Miner day, every Launch on show, a message per band and a Correct button on every line, posted silently. Seeing "line 7" on every Skip made them ask where the line came from, so Skip lines drop it (`Skip · fit 6 · reason`); the post's title and summary carry the line and why it sits there. A was rejected because one message can't hold a busy day under Discord's 4,000-character cap, and B because of its pages and its @mention. The full answer is on the issue.

**Plan:** three variants of one Miner day, posted into the person's private server and tried on the iPhone, picked from `#proto-29`:

| Variant | Where | Shape | Correct | Notifies |
|---|---|---|---|---|
| **A** | `#a-miner`, its own channel | one message per day; every Launch is a line of text, grouped into Dossiers, near misses, further off, far off, not Products | two select menus (25 options each); picking a Launch opens the one-field pop-up | no, silent |
| **B** | `#needs-you` | one card per day; ten lines a page with Back / Next; **Done** shrinks it to one line | a button on every line | yes, one @mention |
| **C** | `#c-days`, a forum with a post per day | a summary with the Dossier links, then one message per band, every Launch on show | a button on every line | no, silent |

Every variant shows the Day's line and why it is where it is, links each Dossier line to its post in `#products`, and ends with "Data sourced from Product Hunt", linked to that day's leaderboard.

**The data is real.** It covers every Featured Launch from Oct 11–14, 2026 (27, 19, 29 and 48 a day), read through the Product Hunt API, with the hand-judged stand-in fits and reasons from the [Miner threshold prototype](https://github.com/ultrasadness/lab1/blob/prototype/miner-threshold/prototypes/miner-threshold.html) (`days.json`). The Day's line follows #9: the ⌈√N⌉-th best Fit, never below 7.

**Stubs:** Corrections don't re-judge. A corrected Skip comes back as a Dossier at the line + 1, with a new post. A corrected Dossier comes back at fit 3 and is withdrawn. Either way, a stand-in proposed Interest scope change lands in `#needs-you`. Walkthroughs are not posted; #12 already settled them.

## Run

```sh
./run.sh day              # start the day-list bot (stop #12's bot first: both answer taps)
PREPOST=A,C node day.mjs  # the same, posting Oct 14 in those variants on start
SELFTEST=1 node day.mjs   # post every variant for every day, correct a Skip and a Dossier in each, without @mentions, then reset
```

---

# PROTOTYPE, throwaway: a Dossier in its Product post, and in git

Answers [How does a Dossier read in its Product post, and how is it kept in git?](https://github.com/ultrasadness/lab1/issues/33). It reuses this folder's bot setup and `kit.mjs`, but runs as its own bot, `dossier.mjs`, with its own `prototype-33` category. Kept as a primary source; not production code.

**Plan:** three variants of the Dossier as the first message of its Product post, each in its own forum, picked from `#proto-33`, plus three layouts of the same Dossiers in git, read on GitHub:

| Variant | Where | Shape | Citations | Buttons |
|---|---|---|---|---|
| **A** | `#a-products` | one card: Register, What it is, For you, Offers, Note, Launches | footnote numbers on every claim, the sources listed once at the foot (¹ is always the Launch) | Add Offer · Correct |
| **B** | `#b-products` | a row per claim | the claim's source as a link button beside it, any others in small text below | Add Offer · Correct |
| **C** | `#c-products` | a short verdict: a one-line gist, how to register, the first Offer | a short inline link after each line; the full Dossier is in git | Full Dossier ↗ · Add Offer · Correct |

| Git layout | Files | Holds more than the message? | Registration lines | Your notes |
|---|---|---|---|---|
| **1 · one file** | `products/<domain>.md` | yes: what each source said, quoted | a section in the same file | the last section, below a line the bot never crosses |
| **2 · folder** | `products/<domain>/dossier.md`, `registration.md`, `notes.md` | no: `dossier.md` mirrors the message | their own file, appended | their own file, the bot never writes it |
| **3 · by date** | `dossiers/<day>-<domain>.md`, `registrations.md`, `notes/<domain>.md` | yes, as in 1 | one log for every Product | a file per Product |

All three are generated into `dossier-git/` by `node dossier-git.mjs`; `dossier-git/README.md` links each file.

**The Dossiers are real.** Seven of the 14 Dossier Launches of Oct 11–14, 2026, picked to cover each case: Edgee Mod for Claude Code (Oct 11), Codemind (Oct 12), Xiryn (Oct 13; no account, so no Walkthrough), and Inferock, Tiden, Hindsight and Acyclic (Oct 14). Claude wrote them by hand (`dossiers.mjs`) from what the Assistant may read: the Launch and its Maker comment through API v2, then the landing, pricing and signup pages, rendered read-only in the Takeover rig's Playwright image on Oct 16. Between them they show an Offer needing no card (Inferock, Codemind, Hindsight), an Offer for the person to act on (Inferock's failed-call credits), the fixed no-Offer line (Edgee, Xiryn, Tiden, Acyclic), a predicted Handoff (Acyclic is Google or GitHub only), and a trial whose card need isn't stated (Tiden). None of the 14 was waitlisted.

**Stubs:** the Registrations and their milestone lines; Add Offer and Correct edit the Dossier in place but re-read nothing; **Re-Launch Hindsight** adds a made-up Nov 4 Launch with a new Offer and posts a silent line in the post. Each post follows its Dossier with one stand-in for the Walkthrough copy and the status message, which #12 settled. The addresses (`you+<product>@gmail.com`) are placeholders.

**Measured (SELFTEST, Oct 16):** every Dossier fits easily. A runs 1,146–1,849 characters, B 1,086–1,888, C 732–1,135, out of Discord's 4,000, with 183–424 of them in link URLs. B is bound by components instead: 24–33 of Discord's 40, three for every claim row, so a Dossier with two more Offers or re-Launches than Inferock would not fit.

## Run

```sh
./run.sh dossier              # regenerate dossier-git/, then start the Dossier bot (stop the other bots first: all answer taps)
SELFTEST=1 node dossier.mjs   # post every variant, add an Offer and a Correction to Inferock in each, re-Launch Hindsight, then reset
```
