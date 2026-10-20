# Mail text reaches only mail-cleared roles, on routes whose terms bar training

English | [中文](0010-mail-text-reaches-only-mail-cleared-roles-on-routes-that-dont-train.zh.md)

Google's Limited Use rules bind the Gmail OAuth app even though it is never verified. Gmail data "may not be used to train or improve foundational or frontier models", and the app's public privacy page has to say how it is used, truthfully. So text from Signup mailbox mail, and anything a model writes from it, reaches only runs of the **mail-cleared** mail role. That role uses only routes that qualify: written terms for that exact route saying inputs aren't used to train or improve models, by default or through an opt-out that is set. Retention for abuse monitoring is allowed. This narrows the "any data may go to any provider except Secrets" of [Which agent harness and model does the Assistant run on?](https://github.com/ultrasadness/lab1/issues/8). Decided in [Which model routes may read Signup mailbox mail under Google's Limited Use rules?](https://github.com/ultrasadness/lab1/issues/30). The conversation role was mail-cleared too, until [How does the person ask the Personal database a question from Discord?](https://github.com/ultrasadness/lab1/issues/37) limited it to the Personal database and renamed it the question role.

## Which runs read mail

- **Mail-cleared runs:** mail runs (matching a mail to a Registration, classifying it, choosing which code placeholder to fill), Reply draft runs, Rule cases that replay stored mail, and a Walkthrough built from an invite mail.
- **The bot's Gmail interface is the only way mail text enters the Pi container**, and it gives that text only to runs of a mail-cleared role.
- **The Personal database keeps only states, dates and Gmail message IDs from mail**, never quoted or summarised mail text. So the Miner, first-time Walkthrough preparation and question runs stay open to any provider.
- **Question runs never search the Signup mailbox.** They read only the Personal database. If they ever gain mail search, the question role goes back into the `mail` group.
- **A Rule kept from a Correction on a mail item is the person's own statement, not Gmail data**, and may load in any scope. Its proposal quotes no mail text and names no sender or address, which the person checks when keeping it.

## Which routes qualify

- **Today two qualify:**
  - ChatGPT Plus through CPA, with "Improve the model for everyone" off and the Privacy Portal's "Do not train on my content" request made. OpenAI says either one covers "Codex tasks", and CPA's requests present as the Codex CLI's. That coverage is inferred, not verified.
  - OpenRouter, with `data_collection: "deny"` on every request.
- **Not qualifying:**
  - DeepSeek's direct API: no API opt-out is written down.
  - The Shanghai AI Lab endpoint: no written terms.
  - Any relay whose own terms don't pass.
  - [ADR 0001](./0001-pi-in-a-container-behind-the-gateway.md)'s fallback, Pi's official ChatGPT sign-in, qualifies only once someone checks that OpenAI's opt-outs cover its requests.
- **Two providers when there are two; one is enough to keep running.** Losing one posts a Discord notice. Mail-cleared runs wait when no qualifying provider answers, and never fall back to one that doesn't qualify. A verification mail missed that way leaves its Registration _handed off_.

## Enforcement

- **A new-api group `mail`** holds only qualifying channels, and the mail role's key is bound to it. A token's group fixes which channels may serve it. Cross-group retry exists only for the `auto` group, so it never applies here.
- **OpenRouter's deny** is set by new-api's parameter override on the OpenRouter channel, not by the forwarder. The forwarder can't tell which upstream new-api picks, and the ChatGPT backend may reject a field it doesn't know.
- **`ops/upgrade role` refuses a channel in `mail`** unless `ops/pins` records its qualifying basis: the clause, its URL, the date read, and the opt-outs set. The pins check compares the OpenRouter override with the running one.

## Opt-outs, and noticing one switched back on

- **Set:**
  - On the ChatGPT account CPA signs in to: both settings above.
  - On OpenRouter: both "may train" toggles off (paid and free models), Input & Output Logging off, and "OpenRouter Use of Inputs/Outputs" off. The per-request deny makes these a second layer.
  - On the person's Discord account: "Use data to improve Discord" off.
- **Noticed:**
  - Each opt-out is recorded in `ops/pins` with the date it was last confirmed.
  - `ops/token <provider>` and `ops/upgrade role` ask the person to confirm it.
  - A Discord reminder every 90 days lists them with a "Still off" button. Nothing pauses.
  - Every 6 months, a reminder asks for each qualifying route's training terms to be read again against the recorded clause.

## Storage

- **Every copy of mail text on the VM expires after 90 days.** That covers the raw-input store, run transcripts, and backups.
- **The exception is a mail Rule's case fixture.** It sits in a local fixture store on the VM, outside git, and is kept until its Rule retires. The Rule points to it by ID. This amends [ADR 0002](./0002-rules-are-files-proven-by-their-own-case.md). If the VM is lost, those fixtures go with it, and their Rules are flagged for a new case from later mail.
- **new-api's own log file holds no request or reply text** (checked on 15 Oct 2026: access lines, usage records, errors). The exception is a channel test, whose reply is logged in full. Content logging stays off, and no channel test is ever run on mail.

## The privacy page

Its text is in the resolution of [Which model routes may read Signup mailbox mail under Google's Limited Use rules?](https://github.com/ultrasadness/lab1/issues/30). Its source lives with the code and ships through `ops/upgrade`. It describes model providers by the test above rather than by name, and it names Discord and GitHub. Any change to this ADR's line changes the page first.

## Considered Options

- **Every role mail-cleared:** nothing to track, but the Miner and Registration preparation would lose every route that doesn't qualify.
- **Marking each run that receives mail-derived text:** the most flexible, but every stored text would need a mark saying where it came from.
- **Requiring zero data retention:** drops ChatGPT Plus, whose server-side retention isn't known, and leaves OpenRouter's ZDR endpoints as the only provider.
- **Any route not known to train:** can't be stated honestly on a public page.
- **Mail Rule fixtures in git:** GitHub would hold Gmail text permanently, and the page would have to say so. Google's API Terms also bar permanent copies of API content.
- **Naming the providers on the page:** true today, but stale after every `ops/upgrade role`.
