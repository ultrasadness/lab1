
## Publishing · 2026-10-14 02:39 UTC

- Can't click the publish app button saying must complete the config on branding page before

## What consent looked like · 2026-10-14 10:00 UTC

- (nothing noted)

## Consent · 2026-10-14 10:09 UTC

- Route: pasted redirect address
- Granted scopes: https://www.googleapis.com/auth/gmail.compose, https://www.googleapis.com/auth/gmail.readonly
- Exactly gmail.readonly + gmail.compose: yes
- Consented as: <signup>@gmail.com
- Refresh token stored in /home/ubuntu/lab1-gmail-spike/token.json (0600); value not shown
- Consented at 2026-10-14 10:09 UTC; start historyId 1892

## What consent looked like · 2026-10-14 10:09 UTC

- nothing

## Mail 'wayfinder test 1' arrived · 2026-10-14 10:15 UTC

- Found via history.list (historyTypes=messageAdded)
- Message 1a139e903ebec581 in thread 1a139e903ebec581, labels UNREAD,CATEGORY_PERSONAL,SPAM
- From: <name> <<everyday>>

## Authentication-Results on 'wayfinder test 1' · 2026-10-14 10:15 UTC

- Authentication-Results headers: 1 in format=full, 1 in format=raw
- #1 (topmost first) authserv-id mx.google.com, dmarc=pass: `mx.google.com; dkim=pass header.i=@2925.com header.s=dkim2026 header.b="kr/aL9Hn"; spf=pass (google.com: domain of <everyday> designates 171.43.196.29 as permitted sender) smtp.mailfrom=<everyday>; dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=2925.com`
- full and raw agree on the topmost header: yes
- ARC-Authentication-Results headers: 1

## Reply draft created through the API · 2026-10-14 10:15 UTC

- Draft id r8236380912370904555, message id 1a139e937b04345a
- In the test mail's thread: yes
- In-Reply-To and References point at <b4fb4d706446abf5@959a3f86186233fa>

## Reply draft after editing in Gmail iOS · 2026-10-14 10:17 UTC

- Draft id kept: yes (r8236380912370904555)
- Message id 1a139e937b04345a → 1a139eaa3a05113a (changed: yes)
- Thread kept: yes
- In-Reply-To kept: yes
- References still hold it: yes
- Subject: Re: wayfinder test 1; MIME multipart/alternative; labels DRAFT
- Body changed from the API's text: yes
- Body now: `Reply draft created through the Gmail API at 2026-10-14 10:15 UTC. / Done with edited.`

## Reply draft in Gmail iOS · 2026-10-14 10:17 UTC

- YAall good

## Reply draft sent from Gmail iOS · 2026-10-14 10:18 UTC

- Draft gone after sending: NO (still a draft: not sent yet?)
- Sent message 1a139eb837277c64 is in the test thread: yes
- Same message id as the last saved draft version: no
- In-Reply-To intact: yes
- References intact: yes
- From: <name> <<signup>@gmail.com>; To: <name> <<everyday>>
- Body sent: `Reply draft created through the Gmail API at 2026-10-14 10:15 UTC. / Done with edited.`
- History since the draft was created (all types, oldest first): messageDeleted 1a139e937b04345a [DRAFT]; messageAdded 1a139ea6cce1d3a0 [DRAFT]; messageDeleted 1a139ea6cce1d3a0 [DRAFT]; messageAdded 1a139eaa3a05113a [DRAFT]; messageDeleted 1a139eaa3a05113a [DRAFT]; messageAdded 1a139eab91daafa0 [DRAFT]; messageDeleted 1a139eab91daafa0 [DRAFT]; messageAdded 1a139eb837277c64 [SENT]

## Reply draft sent from Gmail iOS · 2026-10-14 10:18 UTC

- Draft gone after sending: NO (still a draft: not sent yet?)
- Sent message 1a139eb837277c64 is in the test thread: yes
- Same message id as the last saved draft version: no
- In-Reply-To intact: yes
- References intact: yes
- From: <name> <<signup>@gmail.com>; To: <name> <<everyday>>
- Body sent: `Reply draft created through the Gmail API at 2026-10-14 10:15 UTC. / Done with edited.`
- History since the draft was created (all types, oldest first): messageDeleted 1a139e937b04345a [DRAFT]; messageAdded 1a139ea6cce1d3a0 [DRAFT]; messageDeleted 1a139ea6cce1d3a0 [DRAFT]; messageAdded 1a139eaa3a05113a [DRAFT]; messageDeleted 1a139eaa3a05113a [DRAFT]; messageAdded 1a139eab91daafa0 [DRAFT]; messageDeleted 1a139eab91daafa0 [DRAFT]; messageAdded 1a139eb837277c64 [SENT]

## Reply draft sent from Gmail iOS · 2026-10-14 10:19 UTC

- Draft gone after sending: NO (still a draft: not sent yet?)
- Sent message 1a139eb837277c64 is in the test thread: yes
- Same message id as the last saved draft version: no
- In-Reply-To intact: yes
- References intact: yes
- From: <name> <<signup>@gmail.com>; To: <name> <<everyday>>
- Body sent: `Reply draft created through the Gmail API at 2026-10-14 10:15 UTC. / Done with edited.`
- History since the draft was created (all types, oldest first): messageDeleted 1a139e937b04345a [DRAFT]; messageAdded 1a139ea6cce1d3a0 [DRAFT]; messageDeleted 1a139ea6cce1d3a0 [DRAFT]; messageAdded 1a139eaa3a05113a [DRAFT]; messageDeleted 1a139eaa3a05113a [DRAFT]; messageAdded 1a139eab91daafa0 [DRAFT]; messageDeleted 1a139eab91daafa0 [DRAFT]; messageAdded 1a139eb837277c64 [SENT]

## Reply draft sent from Gmail iOS · 2026-10-14 10:20 UTC

- yes. but thebles even if the mail is received.

## Plus-address From on an API send · 2026-10-14 10:20 UTC

- Asked for From: <signup>+wayfinder@gmail.com
- Sent copy's From: <signup>+wayfinder@gmail.com
- Plus-address kept in the Sent copy: yes

## Plus-address From, as received · 2026-10-14 10:21 UTC

- <signup>+wayfinder@gmail.com

## Spam and history.list · 2026-10-14 10:23 UTC

- Mail 1a139effbb96bb21 arrived with labels UNREAD,IMPORTANT,CATEGORY_PERSONAL,INBOX
- Filed in Spam: NO: the block didn't divert it, so this run says nothing about Spam
- history.list, no filter: messageAdded 1a139effbb96bb21 [UNREAD,IMPORTANT,CATEGORY_PERSONAL,INBOX]
- history.list, historyTypes=messageAdded: messageAdded 1a139effbb96bb21 [UNREAD,IMPORTANT,CATEGORY_PERSONAL,INBOX]
- history.list, labelId=SPAM: nothing reported
- history.list, labelId=INBOX: messageAdded 1a139effbb96bb21 [UNREAD,IMPORTANT,CATEGORY_PERSONAL,INBOX]
- All records since the checkpoint: labelRemoved 1a139e903ebec581 [UNREAD]; messageAdded 1a139effbb96bb21 [UNREAD,IMPORTANT,CATEGORY_PERSONAL,INBOX]

## Token refresh · 2026-10-14 10:23 UTC

- Token age: 0.01 days since consent
- Refresh: ok (scope: https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.readonly)

## Day-8 check · 2026-10-14 10:23 UTC

- Not scheduled: the app is still in Testing (publishing needs Branding links), so this token expires 7 days after consent. After publishing: consent again, then install-cron.

## Where the throwaway client lives · 2026-10-14 10:23 UTC

- Google Cloud project barium-nation-511668-t0, owned by the Signup mailbox (https://console.cloud.google.com/home/dashboard?project=barium-nation-511668-t0); .env and token.json in /home/ubuntu/lab1-gmail-spike. To delete: https://console.cloud.google.com/iam-admin/settings?project=barium-nation-511668-t0 → Shut down, then remove its access at https://myaccount.google.com/connections and delete /home/ubuntu/lab1-gmail-spike.
