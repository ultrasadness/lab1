# What a Discord bot can offer for Approvals and editing on iOS

Research for [#5](https://github.com/ultrasadness/lab1/issues/5), part of the map [#1](https://github.com/ultrasadness/lab1/issues/1). It feeds [#12](https://github.com/ultrasadness/lab1/issues/12), "How should a Walkthrough and its Approval look on Discord?".

- **Researched:** 2026-10-13.
- **Baseline:** Discord's developer docs are published from [`discord/discord-api-docs`](https://github.com/discord/discord-api-docs). Everything below was read at commit `3714862` (2026-10-09). The docs moved from `discord.com/developers/docs/...` to `docs.discord.com/developers/...`, and the old URLs redirect. Each source in the [Sources](#sources) list has its own last-changed date.
- **Scope:** reading only. No bot or application was created, so nothing here was tested on a phone. Claims I could not confirm in a primary source are marked **Unverified** and collected in [Unverified and open items](#unverified-and-open-items).

## Answer in brief

1. **Hosting fits the VM with no inbound port.** A bot keeps an outbound WebSocket to the Gateway and receives taps and form submissions as `INTERACTION_CREATE` events. It answers them with outbound HTTPS calls. Discord's other delivery route, an Interactions Endpoint URL, needs a public HTTPS endpoint, and the two routes are mutually exclusive, so we would leave it unset.
2. **An Approval can be one tap, tied to one exact version.** A button's `custom_id` (1–100 characters) comes back with each tap, together with the tapping user and the message the button sits on. So the button can carry a Walkthrough or Reply draft id plus a hash of the version shown. The bot checks the user id and the hash, then edits the message in place to lock it. Buttons in a message never expire on Discord's side, but the bot has to answer each tap within **3 seconds**.
3. **Editing is done in modals (pop-up forms), and they have tight limits.** A modal has at most **5** top-level components and a title of at most 45 characters. A text input holds at most **4000 characters** and can be pre-filled. Since 2025–2026, modals can also hold select menus, radio groups, checkboxes and file uploads. A modal can only open as the *immediate* answer to a tap or command. It cannot open after a deferred answer or from another modal's submit.
4. **Progress works by editing one message, with one new message when the person must act.** Editing a status message is cheap, and the `SUPPRESS_NOTIFICATIONS` flag makes a message show a badge without a push. A forum channel gives one post per Product, with up to 20 tags that could mark Registration outcomes, but forums need the server's Community setting turned on. Plain threads in a text channel are the lighter option.
5. **Notifications are controlled by iOS settings and the person's Discord settings.** iOS **Show Previews** has the options Always, When Unlocked (the default) and Never, and it can be set for Discord alone. Discord sends no push while its app is open and in focus.
6. **Discord is not a private channel.** Text is not end-to-end encrypted: it is encrypted in transit (TLS) and at rest. Discord's May 2026 blog post says it has "no current plans" to change that. Messages stay until someone deletes them. Backups last 30–45 days, and legal obligations can keep data longer. Discord scans content for safety. Anyone with the bot token can read everything the bot can see. **Passwords, verification codes, magic links, tokens and payment details must never be sent to Discord.**
7. **Both libraries are current.** discord.js 14.27.0 (Node ≥18, released 2026-07-15) and discord.py 2.7.1 (Python ≥3.8, released 2026-03-03) both support Components V2 (Discord's newer message layout system) and every current modal component.

## 1. What the person sees and taps on iOS

### Message layouts

A bot message can use the legacy layout (message text, embeds, and up to 5 rows of buttons or selects) or **Components V2**, which arrived on 2025-04-22. To use V2, a message sets the flag `IS_COMPONENTS_V2` (`1 << 15`). The flag cannot be removed afterwards. With it set:

- `content` and `embeds` stop working. Text goes into **Text Display** components (Markdown, mentions allowed) inside **Containers** (a group with an optional accent colour bar, which can be blurred as a spoiler) and **Sections** (1–3 Text Displays plus a button or thumbnail beside them).
- A message holds at most **40 components** in total. This replaced the old limit of 10 top-level components and 10 per Container on 2025-04-29.
- Attachments only show if a **File** component or a Media Gallery exposes them.

A Walkthrough could be one Container with a Section per key field, a red-accented Text Display for consequences, and a final row of buttons. That design belongs to #12.

**Unverified:** the docs give no total character limit for the Text Displays in one V2 message. Plan for long Dossiers to go out as an attached `.md` file in a File component, or to be split across messages, rather than counting on any particular number.

### Interactive components and their limits

| Component (type id) | Where | Key limits |
|---|---|---|
| Button (2) | message | Up to 5 per action row. Label up to 80 characters; Discord's design guidance is 34–38. Styles: Primary, Secondary, Success, **Danger** ("irreversible consequences"), Link (URL up to 512 characters, sends no interaction to the bot), Premium. Has a `disabled` flag. |
| String Select (3) | message, modal | Up to 25 options. Labels, values and descriptions up to 100 characters each. Placeholder up to 150 characters. `min_values` and `max_values` from 0 to 25. |
| User / Role / Mentionable / Channel Select (5–8) | message, modal | Same 25 limits. Can be pre-set with `default_values`. |
| Text Input (4) | modal only, inside a Label | `style` 1 (single line) or 2 (paragraph). `min_length` / `max_length` up to **4000**. Pre-filled `value` up to **4000**. Placeholder up to 100 characters. `required` defaults to true. |
| Label (18) | modal | Label text up to 45 characters, description up to 100. Wraps one input. Replaces "action row + text input", which is now deprecated. |
| File Upload (19) | modal | 0–10 files. Can be filtered by type, e.g. `image` or `.pdf` (up to 10 types, since 2026-08-05). The per-file size cap is the user's upload limit in that channel. |
| Radio Group (21) | modal | 2–10 options, exactly one chosen. |
| Checkbox Group (22) | modal | 1–10 options, with `min_values` / `max_values`. |
| Checkbox (23) | modal | One yes/no. **Cannot be required.** The docs suggest a single-option Checkbox Group with `required` for that. |
| Text Display (10) | message, modal | Markdown text. In a modal it gives context above the inputs (since 2025-09-10). |

Every interactive component has a `custom_id` of 1–100 characters that comes back unchanged with each interaction. Discord's docs say it "can be used flexibly to maintain state".

### Modals

- A modal opens only as the interaction response of type `MODAL` (9). The docs list it as "not available for `MODAL_SUBMIT` and `PING` interactions". In practice, one tap opens one modal, so a form cannot lead straight into a second form. A modal also has to be the *first* response, sent within 3 seconds. The bot cannot defer, think, and then open a modal. *(The deferral point is an inference: the 3-second initial-response rule plus `MODAL` being a response type.)*
- Structure: `custom_id` (1–100 characters), `title` (up to **45 characters**), and **1–5 components**.
- Each submission arrives as a new `MODAL_SUBMIT` interaction carrying every value. It has its own 3-second and 15-minute clocks, and the bot can answer with `UPDATE_MESSAGE` to rewrite the message whose button opened the modal.
- **Unverified:** the docs do not say how long a modal can stay open on the phone before submitting fails.
- Dates: Label and String Select in modals arrived 2025-08-25; the other selects and Text Display 2025-09-10; File Upload 2025-10-15; Radio Group, Checkbox Group and Checkbox 2026-02-12.

### Ephemeral replies

The flag `EPHEMERAL` (`1 << 6`) makes an interaction reply visible only to the person who tapped. The bot can edit or delete such a reply through the interaction token for 15 minutes. Ephemeral messages reach the bot through the `DIRECT_MESSAGES` intent and carry no `guild_id`. In a private server whose only human member is the person, "only you can see this" adds little privacy. It is still useful for short-lived notices ("Saved", "That Walkthrough changed, see the new version") that shouldn't clutter a Product's thread. **Unverified:** whether ephemeral messages survive an app restart. The developer docs don't say, so the Personal database must not depend on them.

### Starting tasks

- **Slash commands.** Since 2026-09-11, string options accept multi-line input, and autocomplete uses fuzzy matching. This covers commands like "run the Miner now" or "draft a reply".
- **Message context-menu commands** let the person long-press a message and pick an app action. The limit rose from 5 to 15 per type on 2026-03-03. One use: a long-press "Correct this" on a Skip or Dossier that opens a modal for the Correction.
- **Buttons** on any message.
- **Plain messages** in a thread. The bot can read their text in DMs with the bot, in messages that mention it, or anywhere once the `MESSAGE_CONTENT` privileged intent is on (see §5).

## 2. Making an Approval exact

The glossary says an Approval "covers only what was shown". Here is what Discord gives us to enforce that.

- **Who tapped.** Every interaction carries `member` (in a server) or `user` (in a DM). The bot can ignore any tap that isn't from the person's user id.
- **What they tapped.** Component interactions carry `data.custom_id` and the full `message` object the component was attached to. A `custom_id` such as `approve:wt-0042:3f9c2a71d0b4` (kind, Walkthrough id, short content hash) is well under 100 characters. On each tap the bot compares the hash with the Walkthrough's current version. If the Walkthrough was edited after it was shown, the tap is refused and the new version is shown instead.
- **Locking the message.** The bot can answer with `UPDATE_MESSAGE` (7), which edits the message the button sits on. For example, it can disable the buttons and add "Approved 14:03 by you" in the same response, so a second tap is impossible. Each edit to a Walkthrough should produce a new message or new buttons with a new hash, which makes the old buttons stale.
- **Extra friction for consequential steps.** The Danger button style is meant for irreversible actions. For a Registration submit, the Approval button could open a modal that repeats the consequences in a Text Display and requires a single-option Checkbox Group ("Submit to *Product* as *Signup identity*"). That gives two deliberate acts. Whether it is worth the friction is a question for #12.
- **Timing.**
  - Discord: the bot must answer **within 3 seconds** or the token is invalidated. After a valid initial answer, the token works for **15 minutes** of follow-ups and edits. Buttons themselves have no documented expiry, so an Approval can wait for days.
  - Library: discord.py `View`s default to `timeout=180.0` seconds, and only views with `timeout=None` and a `custom_id` on every item are persistent across restarts (checked in the 2.7.1 source). A long-lived Approval message must use persistent views, or `DynamicItem`, or a raw `custom_id` router. discord.js handles every interaction in one global `interactionCreate` listener, so there is no per-message timeout unless a collector is used.
- **When the bot is down.** The Gateway delivers interactions only to a connected client. A tap made while the bot is disconnected cannot be answered within 3 seconds, so it fails and the person taps again later. *(Inference from the docs. The client's exact error text is not documented.)*
- **Audit trail.** The interaction (user id, message id, `custom_id`, timestamp from the snowflake id) is enough to record the Approval in the Personal database. Discord's own message history should not be the record, since messages can be deleted and Discord keeps them on its own terms (§6).

## 3. Editing Walkthrough fields and Reply drafts

- **Walkthrough fields.** One modal holds at most 5 inputs. A Walkthrough with more than 5 editable fields needs either several "Edit fields 1–5 / 6–10" buttons or a String Select *in the message* listing the fields. Picking an option in a message select is itself a component interaction, and a modal is a valid reply to it, so choosing "Signup identity" can open that field's modal directly. Selects *inside* a modal only collect values. Values go in pre-filled, so the person changes only what is wrong. Short fields (name, Signup identity choice) suit a short Text Input, a String Select or a Radio Group.
- **Reply drafts.**
  - One paragraph Text Input holds at most **4000 characters**, pre-filled. A typical founder reply fits. One modal could hold "Subject" (short input) plus "Body" (paragraph input).
  - A draft over 4000 characters would have to be split across inputs (5 × 4000 at most), which is awkward on a phone.
  - Another route: the person writes an instruction in the thread ("shorter, drop the second paragraph"), and the Assistant regenerates and shows a new version for Approval.
- **Attachments.** File Upload in a modal (0–10 files) lets the person send a screenshot or document, for example the result of a Handoff, straight into the flow.
- **Edits are separate from Approvals.** Submitting an edit modal changes the draft. It should **not** count as Approval. The edited version is shown again with fresh Approval buttons. *(This is a design consequence of the glossary, not a Discord rule.)*

## 4. Watching progress: messages, threads and forum posts

- **Live status.** The bot can edit its own messages (`content`, `embeds`, `components`, some flags) at any time. One status message per run or per Registration, edited as steps finish, keeps the thread short.
- **Edits and threads.** Editing does not count as thread activity. Activity is "sending a message, unarchiving a thread, or changing the auto-archive time".
- **Edits and notifications.** **Unverified:** the docs do not say whether editing a message (including adding a mention) sends a push. Design as if edits are silent and post a *new* message when the person needs to act.
- **Quiet messages.** With `SUPPRESS_NOTIFICATIONS` (`1 << 12`), a message "will not trigger push and desktop notifications", only a badge. The flag can be set on normal messages and on interaction replies. It suits step-by-step chatter. An "Approval needed" message would be sent without it and with an @mention of the person.
- **One place per Product.** There are three options.
  - **Thread per Product in a text channel.** Threads don't count towards the 500-channel cap. Each server has a cap on *active* threads; the developer docs give no number. In archived threads, nobody can edit messages, react or use commands, but sending a message unarchives the thread. `auto_archive_duration` can be 60, 1440, 4320 or 10080 minutes, and per the threads doc it "now controls how long the thread stays in the channel list". The bot should unarchive a thread before editing in it.
  - **Forum channel, one post per Product.** A forum post is a thread shown as a card. A forum channel can have up to **20 tags**, which could mark Registration outcomes (*registered*, *waitlisted*, *handed off*, *abandoned*) and Dossier versus Skip, and on iOS the list can be filtered by tag. Pinned posts never auto-archive. **Forums require Community to be enabled on the server** (Forum Channels FAQ). Community brings its own setup steps.
  - **Bot DM.** Simplest notifications and no Message Content intent needed, but **no threads in a DM**, so everything shares one stream.
- **Ordering and volume.** For a private two-member server, Discord's server and thread caps are far away: 500 channels, 1000 members per thread, and the "no push for all messages" rule only applies to servers over 2,500 members.

## 5. Hosting the bot from the VM

- **Connection.**
  - Connect to `wss://gateway.discord.gg/?v=10&encoding=json`, heartbeat at the interval Discord sends, Identify, and Resume after drops using `resume_gateway_url` and the last sequence number. A resumed session replays missed events, but replayed taps will have passed their 3-second window.
  - Interactions arrive as `INTERACTION_CREATE`, and "if you are receiving Interactions over the gateway, you **have to respond via HTTP**".
  - Both directions are **outbound** HTTPS/WSS. No inbound port, no public URL and no Tailscale Funnel are needed. Tailscale plays no part in the Discord path.
- **Limits that matter for a single-user bot.**
  - **Identify: 1000 per 24 hours.** At the limit, "all active sessions for the app will be terminated, the bot token will be reset". A crash-restart loop without backoff could exhaust this, so process supervision must back off. This is a note for "Running on the VM".
  - **Gateway send limit:** 120 events per 60 seconds per connection, or disconnection.
  - **HTTP global limit:** 50 requests per second per bot. Interaction endpoints (callback, follow-ups, edits through the token) are **not** bound by it.
  - **Per-route limits** are not published as numbers, and "should not be hard coded". Read the `X-RateLimit-*` headers. Both libraries already do this.
  - **Invalid-request limit:** 10,000 responses with status 401, 403 or 429 per 10 minutes per IP leads to a temporary Cloudflare ban.
  - Throttling status-message edits to one every few seconds keeps well inside all of this. **Unverified:** the exact per-channel edit limit.
- **Intents.**
  - Buttons, selects, modals and slash commands need **no** privileged intent; their data comes in the interaction.
  - Reading the person's free-text messages in a server channel or thread needs `MESSAGE_CONTENT`. Without it, `content`, `embeds`, `attachments` and `components` come back empty, except in DMs with the bot, in messages that mention the bot, and in the bot's own messages.
  - Since **2026-06-10**, apps reaching fewer than 10,000 users switch privileged intents on with a toggle in the Developer Portal, with no review.
  - The gateway page's intents section still describes the older "100+ guilds / verification" rule. The changelog and the new review guide are the newer sources.
- **Uploads.** Since 2026-09-03 the default per-file limit for bots and interaction responses is **20 MiB** (it was 10 MiB), and a request can be at most 25 MiB. Discord's support caps page, last edited 2026-03-02, still says 10 MB, which predates the change.
- **Libraries.** Either library fits Node 24 or Python 3 on arm64. Both are pure JS/Python apart from optional voice and compression extras.

  | Library | Latest | Runtime | Components V2 and modal support |
  |---|---|---|---|
  | discord.js | 14.27.0 (npm, 2026-07-15), with `@discordjs/builders` ^1.14.1 | `engines.node >=18`, so Node 24 is fine | `ContainerBuilder`, `SectionBuilder`, `TextDisplayBuilder`, `LabelBuilder`, `FileUploadBuilder`, `RadioGroupBuilder`, `CheckboxGroupBuilder`, `CheckboxBuilder`, `ModalBuilder` (checked in the builders 1.14.1 type definitions). v15 is in dev builds only. |
  | discord.py | 2.7.1 (PyPI, 2026-03-03) | `requires_python >=3.8` | 2.6: `ui.LayoutView` for V2, plus `ui.Label` and `ui.Select` in modals. 2.7: `ui.RadioGroup`, `ui.CheckboxGroup`, `ui.Checkbox`. `ui.file_upload` is present in the 2.7.1 source. |

  The choice should follow the runtime decision (#8). Neither library is a constraint.

## 6. What Discord keeps and who can read it

| Question | What the primary sources say |
|---|---|
| End-to-end encryption? | **Not for text.** Voice and video calls are E2EE by default as of early 2026 (the DAVE protocol). Discord's 2026-05-18 blog post: "We have no current plans to extend E2EE to text messages." The privacy policy (effective 2025-09-29) says information is "encrypted both in transit and at rest", which is transport and storage encryption: Discord can read it. |
| How long are messages kept? | For as long as the account is active, unless deleted. "Deleted content will also be deleted from Discord's systems, but we may retain content longer if we have a legal obligation". Database backups last **30–45 days**. "Public posts may also be retained for 180 days to two years" for training models that detect policy violations. *(Source: "How long Discord keeps your information", edited 2026-09-22.)* |
| Does Discord look at content? | Yes, for safety. The privacy policy mentions "proactively scanning attachments and other content for illegal or harmful activity", machine-learning systems, and transcriptions during investigations. |
| Who else can read it? | Members of the server who can see the channel: only the person, in a private server. Anyone with the **bot token**, which can read everything the bot can see. That makes the token a VM secret as sensitive as the Gmail credentials. Anyone holding the person's unlocked phone or Discord session. The lock screen, if Show Previews is set to *Always*. |
| What can the bot delete? | Its own messages, always. The person's messages only with `MANAGE_MESSAGES`. Deleting still leaves the backup window and any legal hold. |
| Developer Policy limits | Clause 21: "Do not use message content obtained through the APIs to train machine learning or AI models (including large language models) unless express permission is granted by Discord." Passing the person's messages to a model to *act* on them is not training. Turning Corrections into git-tracked Rules is also not model training. Still, nothing should forward Discord content into any provider's training opt-in. |

Taken together, this suggests a never-send list, for the map to settle:

- passwords and per-site derived passwords;
- verification codes, magic sign-in links, password-reset links, and OAuth or API tokens, all of which act as credentials;
- payment details (already a Hard limit);
- anything outside the Profile's "everyday facts only".

Reply drafts and the founder mail they answer *will* pass through Discord if the person edits and approves them there. That trade-off is the map's to accept or limit.

## 7. Richer surfaces, and why they are a poor fit

- **Activities** (web apps in an iframe inside Discord, on iOS too) could give a full editing screen, and `LAUNCH_ACTIVITY` (12) can open one from a button. But in production they load through Discord's proxy from a **publicly reachable** HTTPS URL configured in the Developer Portal. That means exposing a web server on the VM to the internet, against the "no inbound port" posture. Not recommended unless a later ticket decides otherwise.
- **Link buttons** to a Tailscale-only page (`https://<vm>.<tailnet>.ts.net/...`) send no interaction and open outside Discord. The phone is on the tailnet and the VM needs no public port. This could be an escape route for long Reply drafts, or for Handoffs that involve secrets, which then never pass through Discord. **Unverified:** how the iOS Discord app handles such links (in-app browser or Safari, and any "leaving Discord" prompt).

## Unverified and open items

- No total character limit for Text Displays in one Components V2 message is documented.
- No documented time limit for how long a modal can stay open before submitting.
- Whether editing a message, or adding a mention in an edit, sends a push notification.
- What text an iOS push shows for a Components V2 message, which has no `content`: probably the first Text Display, but undocumented. Design so that nothing in any message is secret.
- Whether ephemeral messages survive an app restart.
- The exact per-channel edit and send limits, which are deliberately unpublished.
- The current active-thread cap per server, which the developer docs mention without a number.
- How the iOS client opens link buttons to tailnet URLs.
- Nothing was tested on a real iPhone. #12's prototype is where the layout and notification behaviour get checked.

## Sources

Discord developer documentation (`docs.discord.com`, from `discord/discord-api-docs` at commit `3714862`, 2026-10-09). The date after each entry is the file's last change.

- [Component Reference](https://docs.discord.com/developers/components/reference) (2026-10-06): component types, limits, `IS_COMPONENTS_V2` rules, the 40-component limit, Label, File Upload, Radio Group, Checkbox Group and Checkbox.
- [Using Modal Components](https://docs.discord.com/developers/components/using-modal-components) (2026-09-29).
- [Receiving and Responding to Interactions](https://docs.discord.com/developers/interactions/receiving-and-responding) (2026-09-21): 3 seconds and 15 minutes, callback types, the modal object (title up to 45, 1–5 components), Gateway delivery with HTTP replies, global-rate-limit exemption, follow-ups.
- [Message resource](https://docs.discord.com/developers/resources/message) (2026-10-06): flags (`EPHEMERAL`, `SUPPRESS_NOTIFICATIONS`, `IS_COMPONENTS_V2`), content up to 2000, embed limits, the 25 MiB request size, edit rules, Message Content intent effects.
- [API Reference: Uploading Files](https://docs.discord.com/developers/reference#uploading-files) (2026-09-18): the 20 MiB default.
- [Gateway](https://docs.discord.com/developers/events/gateway) (2026-09-17): connecting, Identify limit, resuming, intents, Message Content intent, 120 events per 60 seconds.
- [Rate Limits](https://docs.discord.com/developers/topics/rate-limits) (2026-02-10): 50 requests per second global, headers, the invalid-request limit, interaction exemption.
- [Threads](https://docs.discord.com/developers/topics/threads) (2026-02-18) and [Channel resource](https://docs.discord.com/developers/resources/channel) (2026-09-21): archiving, thread caps, forum channels, `available_tags` limited to 20.
- [Change Log](https://docs.discord.com/developers/change-log): Components V2 (2025-04-22), raised component limits (2025-04-29), Label and select in modals (2025-08-25), more modal components (2025-09-10), File Upload (2025-10-15), Radio Group, Checkbox Group and Checkbox (2026-02-12), context menu limit raised to 15 (2026-03-03), privileged intent threshold (2026-06-10), file type filters (2026-08-05), upload limit raised to 20 MiB (2026-09-03), multi-line slash options (2026-09-11), Activities launched from interactions (2024-08-26).
- [Activities: Local Development / URL Mapping](https://docs.discord.com/developers/activities/development-guides/local-development) and [Activities: Mobile](https://docs.discord.com/developers/activities/development-guides/mobile).
- [Discord Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy) (effective 2024-07-08): clause 21.

Discord policy and support:

- [Privacy Policy](https://discord.com/privacy) (effective 2025-09-29, updated 2025-08-29).
- [How long Discord keeps your information](https://support.discord.com/hc/en-us/articles/5431812448791-How-long-Discord-keeps-your-information) (edited 2026-09-22).
- [Every Voice and Video Call on Discord Is Now End-to-End Encrypted](https://discord.com/blog/every-voice-and-video-call-on-discord-is-now-end-to-end-encrypted) (2026-05-18) and [End-to-End Encryption for Audio and Video](https://support.discord.com/hc/en-us/articles/25968222946071-End-to-End-Encryption-for-Audio-and-Video).
- [[Mobile] Notifications Settings 101](https://support.discord.com/hc/en-us/articles/218892547--Mobile-Notifications-Settings-101) (edited 2026-07-31): iOS settings, Show Previews, no push while the app is in focus, per-server settings.
- [Forum Channels FAQ](https://support.discord.com/hc/en-us/articles/6208479917079-Forum-Channels-FAQ) (edited 2024-10-24): Community required.
- [Discord Account Caps, Server Caps, and More](https://support.discord.com/hc/en-us/articles/33694251638295) (edited 2026-03-02).
- [Using Apps on Discord](https://support.discord.com/hc/en-us/articles/21334461140375-Using-Apps-on-Discord) (edited 2024-09-24).

Apple:

- [Change notification settings on iPhone](https://support.apple.com/guide/iphone/change-notification-settings-iph7c3d96bab/ios) (iPhone User Guide, iOS 27 selector): Show Previews (Always, When Unlocked, Never) can be set for each app.

Libraries:

- [npm: discord.js 14.27.0](https://www.npmjs.com/package/discord.js) and [@discordjs/builders 1.14.1](https://www.npmjs.com/package/@discordjs/builders): versions and engines from the npm registry, builder classes from the published `index.d.ts`.
- [PyPI: discord.py 2.7.1](https://pypi.org/project/discord.py/), [discord.py changelog](https://discordpy.readthedocs.io/en/stable/whats_new.html), and the source at tag [`v2.7.1`](https://github.com/Rapptz/discord.py/tree/v2.7.1/discord/ui) (`View` default timeout, the `file_upload` module).
