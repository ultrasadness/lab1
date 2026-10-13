# Gmail access: reading, Reply drafts, and never handling an email twice

Research for [#4](https://github.com/ultrasadness/lab1/issues/4) on the map [#1](https://github.com/ultrasadness/lab1/issues/1).
All sources were read on 2026-10-13. Each source's own "last updated" date is in the [Sources](#sources) table.
Terms follow `CONTEXT.md`. A claim tagged **[unverified]** has no primary source behind it and needs a hands-on check before the spec relies on it. A claim tagged **[design]** is a recommendation built from the sourced facts, not a fact itself.

## Answer in brief

- **Route: use the Gmail API, not IMAP/SMTP.** An app password unlocks the whole mailbox, including permanent deletion. Google calls app passwords "not recommended" and revokes them when the password changes [S9, S10]. IMAP with OAuth needs the broadest scope, `https://mail.google.com/` [S12]. The Gmail API can be held to just **`gmail.readonly` + `gmail.compose`** [S1, S13–S19].
- **Both of those scopes are _restricted_** [S1]. Every Gmail scope that can read message bodies or create drafts is restricted, so there is no lighter tier to fall back to. Google's "personal use" exception covers an app whose only users are the developer and a few people they know, so no verification or security assessment is needed [S3, S5].
- **Testing mode gives a token that dies in 7 days** [S2, S4]. To avoid weekly re-consent, set the consent screen to External and its publishing status to **In production**, and leave the app unverified. The person clicks through the "unverified app" warning once. This combination is not stated as one recipe in any doc **[unverified]**.
- **The headless VM can't use the device flow for Gmail.** Google's device flow doesn't allow Gmail scopes [S6]. Desktop clients must use a loopback redirect [S7]. The one-time consent therefore needs a browser on some other device, with a workaround (see [1.4](#14-consenting-from-a-headless-vm)).
- **Drafts suit the Approval model.** A draft's ID is stable, but its message ID changes on every edit. `drafts.send` deletes the draft when it sends, and it can send replacement content in the same call [S20, S21]. So an Approval can be tied to the exact message ID that was shown. Nothing documents that API-created drafts open for editing in the Gmail iOS app **[unverified]**: that needs a spike.
- **Notice new mail by polling `history.list`; Pub/Sub can come later.** Push notifications need a Pub/Sub topic, a `watch` call at least every 7 days, and fallback polling anyway, because notifications "might be delayed or dropped" [S24, S25]. Pub/Sub delivers at least once, so duplicates happen [S26]. Polling costs 2 quota units per call against 6,000 units per minute per user [S27].
- **Never handling twice comes from a local ledger keyed by Gmail message ID.** The message ID is immutable [S28]. Labels can't be the source of truth: putting a label on a message needs `gmail.modify`, which also allows trashing [S16, S17].
- **Plus-address routing needs no Gmail filters.** Mail to `you+<product>@gmail.com` lands in the normal inbox [S30, S31]. The Assistant can match the `Delivered-To`/`To` header against its Registration records. Filters through the API need another restricted scope, `gmail.settings.basic` [S1, S19]. Threading a reply needs `threadId`, RFC 2822 `In-Reply-To`/`References`, and a matching `Subject` [S22].
- **Outlook.com only works through OAuth now.** Basic auth ended on 2024-09-16 [S33]. Graph (`Mail.ReadWrite`, `Mail.Send`) and IMAP/SMTP with XOAUTH2 both support personal accounts, and the device-code flow works on a headless VM [S34–S37]. Two catches: a new app registration has needed an Entra directory since June 2024, which in practice means an Azure signup [S38, S39], and Gmail drops "Send mail as" for third-party addresses in January 2027 [S32].

## 1. Access route

### 1.1 Gmail API vs IMAP/SMTP

| | Gmail API (OAuth) | IMAP/SMTP + app password | IMAP/SMTP + OAuth (XOAUTH2) |
|---|---|---|---|
| Credential on the VM | Refresh token for the scopes the person granted | 16-digit app password: "gives a less secure app or device permission to access your Google Account" [S9] | Refresh token for `https://mail.google.com/` [S12] |
| Least privilege | Yes. `gmail.readonly` + `gmail.compose` can't trash or delete messages (`messages.trash` needs `gmail.modify` or full scope) [S16, S17] | No. The protocol allows expunging mail | No. The scope covers "Read, compose, send, and permanently delete all email" [S1] |
| Google's stance | The supported path | "App passwords aren't recommended and are unnecessary in most cases" [S9, S10] | Apps that don't fully use the scope are told to move to the Gmail API with narrower scopes [S12] |
| Prerequisites | A Google Cloud project, OAuth client and consent screen | 2-Step Verification. Not offered if 2SV uses security keys only, or with Advanced Protection [S9] | Same as the Gmail API, plus the broadest restricted scope |
| What revokes it | Password change (when the token holds Gmail scopes), 6 months unused, revocation by the user, and the Testing 7-day expiry [S2] | Password change [S9] | Same as the Gmail API |
| Change detection | `history.list` cursor, or `watch` + Pub/Sub [S23–S25] | IMAP IDLE, plus `X-GM-MSGID`/`X-GM-THRID`, which are the decimal forms of the API's hex IDs [S11] | Same as app password |
| IMAP availability | n/a | "IMAP access is always turned on in Gmail" (since January 2025) [S10] | Same |

**[design]** Use the Gmail API. The Hard limits say "no deleting … without its own Approval". The API is the only route where the credential itself can't delete or trash mail.

### 1.2 Scopes per operation

From the method reference pages ("Requires one of the following OAuth scopes"):

| Operation | Accepted scopes | Source |
|---|---|---|
| Read history (`history.list`) | `mail.google.com`, `gmail.modify`, `gmail.readonly`, `gmail.metadata` | S14 |
| Start push (`users.watch`) | same as `history.list` | S15 |
| Read a message (`messages.get`) | includes `gmail.readonly`; `gmail.compose` alone can't read mail **[inferred from scope descriptions]** | S1, S28 |
| Create a draft (`drafts.create`) | `mail.google.com`, `gmail.modify`, `gmail.compose` | S13 |
| List drafts (`drafts.list`, supports Gmail search `q`) | `mail.google.com`, `gmail.modify`, `gmail.compose`, `gmail.readonly` | S18 |
| Send a draft (`drafts.send`) | `mail.google.com`, `gmail.modify`, `gmail.compose` | S21 |
| Send a message (`messages.send`) | `mail.google.com`, `gmail.modify`, `gmail.compose`, `gmail.send` | S29 |
| Label a message (`messages.modify`) | `mail.google.com`, `gmail.modify` (the page also lists `gmail.modify.restricted`, which the scopes page doesn't define) | S16 |
| Create a label (`labels.create`) | `mail.google.com`, `gmail.modify`, `gmail.labels` | S19b |
| Trash a message (`messages.trash`) | `mail.google.com`, `gmail.modify` | S17 |
| Create a filter (`settings.filters.create`) | `gmail.settings.basic` only (max 1,000 filters) | S19 |

Scope tiers [S1]: **restricted** are `mail.google.com`, `gmail.readonly`, `gmail.compose`, `gmail.modify`, `gmail.metadata`, `gmail.insert` and `gmail.settings.basic`. **Sensitive** is `gmail.send`. **Non-sensitive** is `gmail.labels`.

**Minimal set [design]:** `gmail.readonly` + `gmail.compose`. Add `gmail.modify` only if the spec wants labels on messages (see [§4](#4-never-handling-twice)). `gmail.compose` can delete drafts: `drafts.delete` "immediately and permanently deletes the specified draft" [S20b]. That only touches drafts, but the spec should say whether deleting the Assistant's own drafts falls under the Hard limit.

### 1.3 Consent screen, verification and token lifetime

- **Testing status:** an External consent screen in Testing "is issued a refresh token expiring in 7 days", unless the only scopes are name, email and profile [S2]. "Authorizations by a test user will expire seven days from the time of consent", and Testing allows at most 100 test users [S4].
- **Personal-use exception:** restricted-scope verification is not needed under "Personal use" when "you are the only user of your app or if your app is used by only a few users, all of whom are known personally to you" [S5]. The Cloud help page puts it as: "If the app is for your personal use (fewer than 100 users) … you and your limited number of users can continue using the app without going through verification", and users "will be allowed to click through 'unverified app' warning screens" [S3].
- **Unverified apps:** an unverified app shows the "unverified app" screen and is capped at 100 new users [S8]. The same restricted-scope page also says restricted scopes "require you to go through a scope verification process before you request the scopes from any Google Account" [S5]. That sentence sits next to the personal-use exception, and the docs never reconcile the two.
- **[unverified] The working recipe:** External consent screen, published In production, never submitted for verification, with the person as the only user. Practitioners widely report that this gives refresh tokens without the 7-day expiry (S2 attaches the expiry only to Testing status), behind a click-through warning. Confirm in the setup spike that the "Advanced → continue" path is offered for restricted Gmail scopes.
- **Other ways a token dies** [S2]: the user revokes access; the token goes unused for 6 months; the user "changed passwords and the refresh token contains Gmail scopes"; or there are more than 100 refresh tokens for one account and client, in which case the oldest is silently invalidated. **[design]** The Assistant should treat `invalid_grant` as a Handoff ("re-consent needed") and stop mail work instead of retrying.
- The **Internal** user type only works inside a Google Workspace or Cloud Identity organization [S3, S4], so a personal Gmail can't use it.

### 1.4 Consenting from a headless VM

- Google's device flow (TV / limited-input) "is supported only for" `email`, `openid`, `profile`, two Drive scopes and two YouTube scopes. **No Gmail scopes** [S6].
- Desktop ("installed app") clients must use a **loopback IP redirect**. Custom URI schemes are gone, and the manual copy/paste (OOB) flow "is no longer supported". Loopback is deprecated for the Android, iOS and Chrome app client types [S7].
- Workable patterns **[unverified for this setup]**:
  1. From any machine with a browser, run `ssh -L <port>:127.0.0.1:<port>` to the VM, then open the consent URL there. The loopback redirect lands on the VM's listener through the tunnel.
  2. Open the consent URL on the iPhone. The redirect to `http://127.0.0.1:<port>/?code=…` fails to load, but the code stays in the address bar. The person pastes that URL into Discord, and the Assistant exchanges the code using the same `redirect_uri` and PKCE verifier. This is a long-standing practitioner workaround that no Google doc covers.
  3. A Web-application client with an HTTPS redirect on a Tailscale Funnel hostname. Whether Google accepts that hostname as a redirect URI was not checked.
- Consent is needed again only after one of the token-death events in §1.3.

## 2. Reply drafts and the Gmail iOS app

### 2.1 Draft semantics (sourced)

- "Email drafts represent unsent messages with the `DRAFT` system label applied" [S20].
- A draft's `id` is "the immutable ID of the draft" [S20b]. The guide says the draft resource "provides a stable ID because the underlying message IDs change every time the message is replaced" [S20].
- `drafts.update` destroys the draft's message and replaces it with the new MIME message [S20].
- `drafts.send` "can send a draft as-is or with updates": pass the draft `id` and set `message.raw` to the new MIME. When it sends, "the draft is automatically deleted" and a new message with its own ID and the `SENT` label is returned [S20, S21].

### 2.2 Do Assistant drafts show up in Gmail on iOS?

- **[unverified]** Drafts live server-side as messages with the `DRAFT` label [S20], so any Gmail client, iOS included, should list them under Drafts. Neither Google's Gmail Help nor the API docs state this for API-created drafts on iOS, and the search found no official page. Still to check: whether opening an API draft (with `threadId`, `In-Reply-To` and `References` set) in the iOS app keeps it threaded, and whether saving from iOS keeps the same draft `id`.

### 2.3 Sending exactly the approved version

The glossary says an Approval "covers only what was shown". Two shapes fit the sourced facts **[design]**:

- **A. The person sends from Gmail iOS.** The Assistant never sends. The person's tap on Send *is* the Approval of exactly what they see. The Assistant then sees a new `SENT` message in the thread through history and moves the Registration forward. This is the strongest guarantee, but `gmail.compose` is still needed to create the draft, and it can also send.
- **B. The person approves in Discord and the Assistant sends.** The Assistant runs `drafts.get` (`format=raw`), shows the exact text and records the draft's current **message ID** with the Approval. To send, it calls `drafts.send` with the draft `id` **and** `message.raw` set to the approved bytes. Gmail then sends the approved content even if the person edits the draft again in between, and deletes the draft [S20]. If a fresh `drafts.get` shows a different message ID, the draft was edited after the Approval, so the Assistant asks again instead of sending.

Either way, Gmail deletes the draft once it sends [S20], so a retried `drafts.send` on the same draft ID should fail instead of sending twice **[inferred; error code not documented]**.

### 2.4 Threading a Reply draft

To join an existing thread, three conditions must hold [S22]:

- "The requested `threadId` must be specified" on the draft's message.
- "The `References` and `In-Reply-To` headers must be set in compliance with the RFC 2822 standard."
- "The `Subject` headers must match."

`rfc822msgid:` search finds a message by its `Message-ID` header [S31].

## 3. Noticing new mail

| | Poll `history.list` | `users.watch` + Pub/Sub |
|---|---|---|
| Mechanism | Store a `historyId`, then ask for all records newer than it [S23, S14] | Gmail publishes `{"emailAddress", "historyId"}` to a topic, and the Assistant still calls `history.list` to learn what changed [S24] |
| Setup | None beyond OAuth | Create a topic, grant publish to `gmail-api-push@system.gserviceaccount.com`, and make a pull or webhook subscription [S24]. A pull subscription needs no public endpoint |
| Upkeep | none | Call `watch` at least every 7 days ("We recommend calling `watch` once per day"). The subscription expires after 31 days of inactivity by default [S24, S26] |
| Reliability | Complete within the history window | "in rare situations, notifications might be delayed or dropped", so the docs advise falling back to periodic `history.list` [S24]. At most one notification per second per user; extra ones are dropped [S24]. Delivery is at least once, so duplicates occur [S26] |
| Cost | `history.list` = 2 units. Limit: 6,000 units per minute per user, 1,200,000 per minute per project [S27] | `watch` = 100 units [S27]. Pub/Sub pricing and billing requirements **[unverified]**: the pricing page didn't render |

History facts:

- Records are "typically available for at least one week and often longer", but the window "might be significantly shorter". An out-of-range `startHistoryId` returns HTTP 404, and "your client must perform a full sync" [S23, S14].
- History IDs increase over time but are "not contiguous", with random gaps [S14].
- `historyTypes` can be `messageAdded`, `messageDeleted`, `labelAdded` or `labelRemoved`. A `labelId` filter is available [S14].

**[design]** Poll `history.list` every few minutes with `historyTypes=messageAdded`. Run a bounded full sync (search `after:<last-check-date>`, deduplicated against the ledger) when the API returns 404. Avoid `labelId=INBOX` unless the spec accepts missing signup mail that lands in Spam. Add Pub/Sub only if latency matters. Polling every 2 minutes costs about 1,440 units a day, which is negligible.

## 4. Never handling twice

Sourced building blocks:

- A Gmail message `id` is "the immutable ID of the message" [S28]. The same ID appears over IMAP as `X-GM-MSGID` [S11].
- Draft IDs are stable, and a draft's message ID changes on each edit [S20].
- `history.list` and Pub/Sub both repeat or skip changes. Pub/Sub can redeliver "even after an acknowledgment request … returns successfully" [S26]. Notifications can be dropped [S24]. History can run out [S23].
- Labelling a message needs `gmail.modify` [S16], which also unlocks `messages.trash` [S17].

**[design]** The ledger:

1. Keep a durable ledger on the VM (part of the Personal database, or a store beside it), keyed by Gmail message ID, with states such as `seen → classified → drafted(draftId) → approved(draftMessageId, sha256 of raw) → sent(sentMessageId)` or `ignored`.
2. Process each history batch, write the ledger, and only then advance the stored `historyId`. A crash replays the batch, and the ledger makes the replay harmless.
3. Before `drafts.create`, write a `drafting` intent. When recovering a crash, look for an existing draft in that `threadId` with `drafts.list` before creating a new one.
4. Before any send, check the ledger. On an unknown result, such as a timeout, look in the thread for a new `SENT` message before retrying.
5. Gmail labels (for example `Assistant/handled`) are an optional human-visible mirror and never the source of truth. They cost `gmail.modify`.

## 5. Plus-address routing and threading

- Gmail aliases: add "+" and a word after the username, and all variants arrive in the same inbox. Google's example is `yourname+work@gmail.com` [S30, S31b]. Google warns: "Aliases aren't private and sometimes they're visible to others" [S30].
- Search operators include `deliveredto:` ("emails delivered to a specific email address"), `to:`, `list:`, `rfc822msgid:` and `in:anywhere` (which includes Spam and Trash) [S31].
- Filters can label mail per alias [S30, S31b]. Creating filters through the API needs `gmail.settings.basic` (restricted, max 1,000) [S1, S19].
- **[design]** Use no filters. The Assistant reads `Delivered-To`/`To`, extracts the `+<product>` tag and looks up the Registration. For plain-address fallback signups, there is no tag to read, so it matches on the sender domain recorded with the Registration.
- **[unverified]** Replying **from** `you+<product>@gmail.com`: the alias section doesn't cover sending from a plus-address, and nothing says whether Gmail keeps or rewrites a plus-address `From` on an API send. "Send mail as" covers "Another Gmail address" you own, after a confirmation step [S30]. Test this in the spike.

## 6. Outlook.com as a second Signup identity

- **Basic auth is gone:** from **2024-09-16**, "Basic Authentication no longer available to access any Outlook account" over POP, IMAP or SMTP. Modern auth (OAuth) is required [S33].
- **Route 1, Microsoft Graph mail API:** the API serves "Outlook mail data in a personal or organization account" [S34]. `createReply` makes a reply draft and lists `Mail.ReadWrite` for "Delegated (personal Microsoft account)" [S35]. Changes are tracked per folder with `delta` and a saved `@odata.deltaLink` [S36]. Message IDs change on move unless the app sends `Prefer: IdType="ImmutableId"` [S34, S37]. Webhook subscriptions for messages exist [S40], but they need a reachable notification URL **[not checked]**, so a VM would poll `delta`.
- **Route 2, IMAP/SMTP with XOAUTH2:** "available for both Microsoft 365 … and Outlook.com users". The scopes are `https://outlook.office.com/IMAP.AccessAsUser.All` and `https://outlook.office.com/SMTP.Send`, plus `offline_access` [S41].
- **Headless consent works:** the device authorization grant accepts `/common` or `/consumers` [S42]. Unlike Google, it needs no browser on the VM.
- **Tokens:** refresh tokens last 90 days by default and "replace themselves with a fresh token upon every use". A password change by the user revokes password-based public-client tokens [S43].
- **The catch is app registration.** A Microsoft moderator answered on 2024-06-06: "starting June 2024, all applications must be registered in a directory", created "by joining the M365 Developer Program or signing up for Azure" [S38]. The official quickstart lists "An Azure account that has an active subscription" as a prerequisite [S39]. Users report that Azure signup asks for a credit card **[unverified; secondary]**.
- **The no-API alternative is forwarding.** Outlook.com can forward all mail and keep a copy, but it requires 2-step verification. Forwarded mail arrives as if from the Outlook account; a *redirect* rule keeps the original sender [S44]. Gmail can't send *as* the Outlook address after **January 2027**: "Gmail will no longer support the 'Send as' feature for third-party email addresses" [S32]. Gmail is also changing Gmailify and POP fetching [S45] (secondary coverage dates the shutdown to 2026).

**[design]** If the spec keeps Outlook, prefer Graph with the device-code flow and immutable IDs. Reuse the same ledger design, keyed by immutable message ID. Forwarding into Gmail only works if Reply drafts for Outlook signups can come from Gmail, which defeats the purpose of a separate identity.

## Unverified, to settle in a spike

1. An In-production, unverified consent screen with `gmail.readonly` + `gmail.compose` offers the click-through and issues a refresh token that outlives 7 days.
2. The iPhone copy-the-redirect-URL consent workaround works (§1.4).
3. API-created reply drafts appear in Gmail iOS, stay threaded after an edit there, and keep their draft ID.
4. A plus-address `From:` survives an API send, or needs a send-as alias.
5. The error `drafts.send` returns for an already-sent (deleted) draft.
6. Pub/Sub billing and free tier, if push is ever wanted.
7. Whether an Entra directory for Outlook really requires an Azure card.

## Sources

| # | Source | Owner | Last updated (page) |
|---|---|---|---|
| S1 | [Choose Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) | Google | 2026-09-10 |
| S2 | [Using OAuth 2.0 to access Google APIs: refresh token expiration](https://developers.google.com/identity/protocols/oauth2#expiration) | Google | 2026-05-26 |
| S3 | [When is verification not needed](https://support.google.com/cloud/answer/13464323) | Google Cloud Help | undated (read 2026-10-13) |
| S4 | [Manage App Audience](https://support.google.com/cloud/answer/15549945) | Google Cloud Help | undated |
| S5 | [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) | Google | 2026-08-19 |
| S6 | [OAuth 2.0 for TV and limited-input devices: allowed scopes](https://developers.google.com/identity/protocols/oauth2/limited-input-device) | Google | 2026-09-14 |
| S7 | [OAuth 2.0 for iOS & desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app) | Google | 2026-09-14 |
| S8 | [Unverified apps](https://support.google.com/cloud/answer/7454865) | Google Cloud Help | undated |
| S9 | [Sign in with app passwords](https://support.google.com/accounts/answer/185833) | Google Account Help | undated |
| S10 | [Add Gmail to another email client](https://support.google.com/mail/answer/7126229) | Gmail Help | undated (mentions January 2025) |
| S11 | [Gmail IMAP extensions](https://developers.google.com/workspace/gmail/imap/imap-extensions) | Google | 2026-09-15 |
| S12 | [OAuth 2.0 mechanism (XOAUTH2) for IMAP/SMTP](https://developers.google.com/workspace/gmail/imap/xoauth2-protocol) | Google | 2026-09-15 |
| S13 | [users.drafts.create](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/create) | Google | 2026-04-15 |
| S14 | [users.history.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list) | Google | 2026-04-15 |
| S15 | [users.watch](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch) | Google | 2026-04-15 |
| S16 | [users.messages.modify](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/modify) | Google | 2026-05-06 |
| S17 | [users.messages.trash](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/trash) | Google | 2026-04-15 |
| S18 | [users.drafts.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/list) | Google | 2026-04-15 |
| S19 | [users.settings.filters.create](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.filters/create) | Google | 2026-04-15 |
| S19b | [users.labels.create](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels/create) | Google | 2026-04-15 |
| S20 | [Working with drafts](https://developers.google.com/workspace/gmail/api/guides/drafts) | Google | 2026-09-10 |
| S20b | [users.drafts resource](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts) | Google | 2026-04-15 |
| S21 | [users.drafts.send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/send) | Google | 2026-04-15 |
| S22 | [Managing threads](https://developers.google.com/workspace/gmail/api/guides/threads) | Google | 2026-09-10 |
| S23 | [Synchronizing clients with Gmail](https://developers.google.com/workspace/gmail/api/guides/sync) | Google | 2026-09-15 |
| S24 | [Push notifications](https://developers.google.com/workspace/gmail/api/guides/push) | Google | 2026-09-15 |
| S25 | [Sending email](https://developers.google.com/workspace/gmail/api/guides/sending) | Google | 2026-09-10 |
| S26 | [Pub/Sub subscription overview](https://docs.cloud.google.com/pubsub/docs/subscription-overview) | Google Cloud | 2026-10-09 |
| S27 | [Gmail API usage limits](https://developers.google.com/workspace/gmail/api/reference/quota) | Google | 2026-09-10 |
| S28 | [users.messages resource](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages) | Google | 2026-05-06 |
| S29 | [users.messages.send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send) | Google | 2026-04-15 |
| S30 | [Send emails from a different address or alias (incl. "Use Gmail aliases")](https://support.google.com/mail/answer/22370) | Gmail Help | undated |
| S31 | [Refine searches in Gmail (search operators)](https://support.google.com/mail/answer/7190) | Gmail Help | undated |
| S31b | [Tips to optimize your Gmail inbox: task-specific addresses](https://support.google.com/a/users/answer/9308648) | Google Workspace Learning Center | undated (Workspace examples) |
| S32 | Same page as S30: January 2027 "Send as" notice | Gmail Help | undated |
| S33 | [Modern Authentication needed to sync Outlook email in non-Microsoft apps](https://support.microsoft.com/en-us/office/modern-authentication-methods-now-needed-to-continue-syncing-outlook-email-in-non-microsoft-email-apps-c5d65390-9676-4763-b41f-d7986499a90d) | Microsoft Support | 2024-06-10 |
| S34 | [Use the Outlook mail REST API (Graph)](https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview) | Microsoft Learn | 2026-09-02 |
| S35 | [message: createReply](https://learn.microsoft.com/en-us/graph/api/message-createreply) | Microsoft Learn | 2026-06-19 |
| S36 | [Get incremental changes to messages in a folder (delta)](https://learn.microsoft.com/en-us/graph/delta-query-messages) | Microsoft Learn | 2025-08-06 |
| S37 | [Obtain immutable identifiers for Outlook resources](https://learn.microsoft.com/en-us/graph/outlook-immutable-id) | Microsoft Learn | 2025-08-06 |
| S38 | [Q&A: requirement to create all applications inside a directory](https://learn.microsoft.com/en-us/answers/questions/1663127/question-regarding-notification-about-being-requir) | Microsoft moderator answer | 2024-06-06 |
| S39 | [How to register an app in Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app) | Microsoft Learn | 2026-06-15 |
| S40 | [Graph change notifications overview](https://learn.microsoft.com/en-us/graph/api/resources/change-notifications-api-overview) | Microsoft Learn | 2026-04-07 |
| S41 | [Authenticate an IMAP, POP or SMTP connection using OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth) | Microsoft Learn | 2025-10-17 |
| S42 | [OAuth 2.0 device authorization grant](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code) | Microsoft Learn | 2026-06-15 |
| S43 | [Refresh tokens in the Microsoft identity platform](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens) | Microsoft Learn | 2026-06-15 |
| S44 | [Turn on or off automatic forwarding in Outlook.com](https://support.microsoft.com/en-us/outlook/turn-on-or-off-automatic-forwarding-in-outlook-com) | Microsoft Support | undated |
| S45 | [Add another email account on your computer](https://support.google.com/mail/answer/21289) ("We're making changes to Gmailify and POP support"); dates from secondary coverage, e.g. [The Register, 2026-01-05](https://www.theregister.com/2026/01/05/gmail_dropping_pop3/) | Gmail Help / press | undated / 2026-01-05 |

No projects or credentials were created and no authenticated requests were sent; everything above comes from reading public documentation.
