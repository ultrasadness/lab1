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
