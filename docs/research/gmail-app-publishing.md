# Publishing the Gmail OAuth app: what Google asks for, and the cheapest way to provide it

Research for [What must the Gmail OAuth app provide before Google lets it publish, and what's the cheapest way to provide it?](https://github.com/ultrasadness/lab1/issues/27) on the map [Growing personal assistant: the way to a build-ready spec](https://github.com/ultrasadness/lab1/issues/1).

- **Researched:** 2026-10-14, from Google's Cloud help, developer docs and policies, the Public Suffix List, and GitHub, Tailscale and Firebase docs. The [Sources](#sources) table gives each page's own "last updated" date, or says it is undated.
- **Starting point:** the [Gmail research](https://github.com/ultrasadness/lab1/blob/research/gmail-access/docs/research/gmail-access.md), §1.3, and the first-hand result from [Check that API drafts edit in Gmail iOS and that tokens outlive 7 days](https://github.com/ultrasadness/lab1/issues/17): **Publish app** was disabled, with the note "must complete the config on branding page" [T17].
- **The app:** External user type, Desktop client, only `gmail.readonly` + `gmail.compose` (both restricted [P11]), one user (the Signup mailbox, which also owns the Cloud project [T17]). It will never be submitted for verification.
- **Tags:** quotes are verbatim. **[unverified]** means no primary source states it; it rests on forum reports or on nothing, and needs a hands-on check. **[inferred]** is my reading of primary sources that don't say it outright. **[design]** is a recommendation, not a fact.
- Nothing external was changed. The only live lookups were read-only `gh api` calls about the person's GitHub account.

## Answer in brief

- **Publish app needs four Branding fields, not verification.** Hovering the disabled button shows "Valid app name, support email, homepage url, and privacy policy url" [F1]. Each URL's domain must be listed under Authorized domains, or the console refuses the URL [P1, F5]. Terms of service are probably optional for publishing [F1, F4], although Google's help groups them with the links "required for all external production apps" [P1]. Logo, Search Console proof, the **Verify Branding** check, scope justification, demo video and the security assessment belong only to verification [P1, P5, P13]. The tooltip wording comes from forum posts, not from a Google page **[unverified]**, but it matches what ticket 17 hit.
- **Search Console proof is not needed just to publish.** Google files domain ownership under brand verification [P5, P13], says to check Search Console "if your app needs to go through verification" [P1], and the console's Project Checkup lists it as a recommended action [P7]. Forum users published after adding a home page, a privacy URL and an authorized domain, with no Search Console step [F1, F4]. No Google page says outright "you may publish with an unproven domain" **[unverified]**.
- **An authorized domain is a "top private domain": the label just below a public suffix** [P13]. `github.io` and `ts.net` are both on the Public Suffix List [P28]. So `ultrasadness.github.io` and `<tailnet>.ts.net` are top private domains in their own right, and each can stand alone as an authorized domain **[inferred]**. `google.com` is not a public suffix, so a Google Sites page would need `google.com` authorized. Google Cloud Support said in 2019 that "Using a Google domain will not work" [F5].
- **The cheapest working host is GitHub Pages, from a new small public repo** **[design]**. The account is on GitHub Free [G1], and Free serves Pages only from public repos [P29]. Publishing makes that repo, its commit history and the `ultrasadness` name in the URL public. **Firebase Hosting** (`<site-id>.web.app`, also on the PSL) is the no-GitHub alternative inside the same Google project, free on the Spark plan [P33, P34]. **Tailscale Funnel** would work in principle but opens a port on the VM to the whole internet [P31]. **Google Sites** doesn't work without a domain you own.
- **Once published, the one user can still click through.** For personal use, "users will be allowed to click through 'unverified app' warning screens during sign-in" [P4]. The unverified app is capped at 100 new users over the project's lifetime [P2]. The click-through is gone if the Signup mailbox ever joins Advanced Protection, which lets "only verified third-party apps" reach Gmail data [P24].
- **The refresh token should then outlive 7 days, but only a token from a new consent.** Google ties the 7-day expiry to "Testing" status alone [P17]. Its Google Health API guide says that "Once your app is moved to 'In Production' status, refresh tokens generally don't expire unless they are revoked or remain unused for a prolonged period (typically six months)" [P19]. No Google page says whether publishing extends a token issued while in Testing. The current token still dies on 2026-10-21 **[inferred]**. The day-8 check stays the proof.
- **An Internal audience is impossible here.** Internal needs a Cloud Organization, which comes only with Workspace or Cloud Identity on a domain you own [P2, P25, P26]. Even then, only members of that organization may authorize [P2], and a consumer `@gmail.com` Signup mailbox never is.
- **Changed in 2025–2026:** unused OAuth clients are deleted after six months (policy added 2025-10-27) [P16, P9]. Client secrets have been shown only once since mid-2025 [P9]. Brand verification is now a self-serve check with draft and published branding (undated in Google's docs) [P1, P13]. Publish app gated on a home page and privacy URL is first reported in forums from August 2026 [F1–F4], so the gate itself may be new **[unverified]**. The 7-day Testing rule, the 100-user cap and the personal-use exception read the same as in the Gmail research.

## 1. What gates Publish app, and what only verification needs

### 1.1 The gate

- Google's help says only: "A project's publishing status is considered **In production** after selecting the **Publish app** button" [P2]. No Google page lists the button's preconditions.
- The Branding help says of the home page, privacy policy and terms links: "These links are required for all external production apps. You will not be able to submit your app for verification if it is missing these links." It also calls them "recommended" in the sentence before [P1].
- **What the console shows** (forum reports, **[unverified]** against any Google page):
  - Next to the disabled button: "To publish your app, you must complete the configuration on the Branding page." [F2, F3; T17 saw the same]. In the reported cases, app name, support email and developer contact were filled, and the home page, privacy and terms URLs were empty [F2].
  - The tooltip on the button: "Valid app name, support email, homepage url, and privacy policy url" [F1, 2026-08-27]. That poster put the home page URL into both fields, added the domain under Authorized domains, saved, and Publish app became active. A second user confirmed it [F1].
  - A separate reply: "Terms of service can stay empty" [F4, 2026-08-28].
- The Branding page itself saves with those links empty and shows no missing field [F1, F2, F4]. That is why ticket 17 found nothing flagged until it tried to publish.

### 1.2 Field by field

| Branding field | Needed for Publish app | Needed only for verification | Sources |
|---|---|---|---|
| App name | Yes | Shown to users only once verified: "The app name will be displayed on the OAuth consent screen only if your app has been verified" | F1, P1 |
| User support email | Yes. It must be the signed-in user's address or a Google Group they manage, so in practice the Signup mailbox | — | F1, P1 |
| Developer contact email | Asked for when the app is first set up, so already present | Google sends project notices there | P8, P21 |
| App logo | No | Yes. On an External production app, an uploaded logo "will go through the verification process" before it shows | P1, P13 |
| Home page URL | **Yes** | Must be public, "hosted on a verified domain you own", describe the app and link the privacy policy | F1, F4, T17; P5, P13 |
| Privacy policy URL | **Yes** | Same domain as the home page, linked from it, and must disclose how Google user data is used | F1, F4, T17; P5, P13 |
| Terms of service URL | Probably not | "optional terms of service" in the brand verification guide | F1, F4; P13; but see P1 |
| Authorized domains | **Yes, in effect.** Every link's domain must be listed, or the console rejects the URL with "Invalid domain: URL must be hosted on a domain listed in the 'Authorized domains' section" (a 2018 report) | Each must also be proven owned in Search Console | P1, F1, F5; P5, P13 |
| Search Console ownership | No **[unverified]** | Yes | P1, P5, P7, P13, F1 |
| Verify Branding / Publish branding | No | Yes: brand verification. "You must have a published branding status before you can request verification for data access (scopes)" | P1, P13, F3 |
| Data Access (declared scopes) | No | Yes: scope verification | P3, P10 |

**[design]** Leave the logo empty, and don't click **Verify Branding**. Without verification, "only your application domain will be visible to users" [P1], which is all the one user needs to see.

### 1.3 Why Google's policy and its console disagree

- Google's OAuth policy defines a "production" app as one that "isn't for personal use", and personal use means "not shared with anyone else or will be used by fewer than 100 people (all of whom are known personally to you)" [P16].
- The home page rule is written for production apps only: "Every production app that uses OAuth 2.0 must have a publicly accessible home page" [P16, P14].
- So, by the policy, this app is not a "production" app and owes no home page. The console still calls the status "In production", and it gates the button on the home page and privacy URLs anyway. The cheapest course is to satisfy the console.
- The data rules apply either way: "All apps that integrate with Google APIs are required to comply with Google's API Services User Data Policy regardless of whether they have been verified" [P4]. See §6.

## 2. Authorized domains, the Public Suffix List and Search Console

### 2.1 What may be listed

- "All domains used in your project, whether in the branding page or client configuration pages must be pre-registered here." "After you add an Authorized Domain, you can use any of its subdomains or pages" [P1].
- Google verifies "the domain component available for registration on a public suffix: the 'top private domain.'" Its example: a home page at `https://sub.example.com/product` means proving `example.com` [P13]. The console asks for the top private domain when given a subdomain [F6].
- The Clients page applies the Public Suffix List to redirect URIs and origins ("Host TLDs ... must belong to the public suffix list") [P9]. A Desktop client registers no redirect URIs, since it uses a loopback address. So for this app, the authorized domain exists only to cover the Branding links **[inferred]**.

### 2.2 The free hosts against the Public Suffix List

The PSL (version 2026-10-07) lists these in its private-domains section [P28]:

| Suffix | On the PSL? | Top private domain for a page there | Who can control it |
|---|---|---|---|
| `github.io` | Yes, submitted by GitHub | `ultrasadness.github.io` | Only the `ultrasadness` account |
| `ts.net` (and `*.c.ts.net`) | Yes, submitted by Tailscale | `<tailnet>.ts.net` (e.g. `tail1234.ts.net`) | Only that tailnet |
| `web.app`, `firebaseapp.com` | Yes, submitted by Google | `<site-id>.web.app` | Only the Firebase project that owns that site |
| `google.com` (Google Sites at `sites.google.com/view/...`) | **No** | `google.com` | Google |

**[inferred]** Because each private suffix acts like a TLD, `ultrasadness.github.io`, `<tailnet>.ts.net` and `<site-id>.web.app` can each be listed as an authorized domain. No Google page names them. Practitioners list `<user>.github.io` this way [F7], and a Firebase project's own `<project>.firebaseapp.com` has to be authorized wherever Firebase Auth uses it as a redirect host [P1, P37]. Bare `github.io` or `ts.net` can't be listed, since a public suffix is not a top private domain.

### 2.3 Search Console is a verification step, not a publishing step

- Domain ownership appears under "Brand verification requirements": "You must verify that you own all domains listed in your Authorized domains section" [P5]. The brand verification and policy guides say the same [P13, P14].
- The Branding help ties it to verification: "If your app needs to go through verification, please go to the Google Search Console to check if your domains are verified" [P1].
- The console's Project Checkup has a "Domain verification" check. Its results are "warning - recommended action" or "success" [P7].
- One Branding help sentence reads the other way: "If you have verified the domain with Google, you can use any Top Private Domain as an Authorized Domain" [P1]. In 2019, a Google Cloud Support reply on a forum also said "You will first have to verify your domain and only then can you proceed with OAuth Consent Screen" [F5]. The 2026 reports show the console accepting an unproven domain and publishing [F1, F4]. **[unverified]** until the person tries it.
- If proof were ever wanted, a `github.io` page can only become a Search Console **URL-prefix** property, through an HTML file or meta tag. Domain properties need DNS records [P27], which nobody can add under `github.io`. Whether Google's OAuth review accepts a URL-prefix property as proof of a top private domain is not documented **[unverified]**. It doesn't matter for an app that is never verified.

## 3. Free hosts compared

| Host | Authorized domain | Works for Publish? | What it makes public | Cost and upkeep |
|---|---|---|---|---|
| **GitHub Pages**, project site from a new public repo | `ultrasadness.github.io` | Yes **[inferred]** (§2.2) | The repo with every file and commit, including each commit's author name and email. The account name `ultrasadness` in the URL. It would be the account's first public repo (it has none today [G1]). GitHub logs visitors' IPs [P29] | Free. "GitHub Pages is available in public repositories with GitHub Free ... and in public and private repositories with GitHub Pro" [P29]. This repo is private and the account is on Free [G1], so the pages need their own public repo or Pro. Allowed for personal sites, not for running a business [P30]. No server |
| **Google Sites** | would have to be `google.com` | **No** | — | Works only with a custom domain you already own, which isn't free. Google Cloud Support: "Using a Google domain will not work. You will have to use your own custom one." [F5, 2019] |
| **Tailscale Funnel** | `<tailnet>.ts.net` | Probably **[inferred]** | A port on the VM, reachable "for anyone to access—even if they don't use Tailscale" [P31]. The machine and tailnet names, which already sit in the public Certificate Transparency ledger once HTTPS certificates exist [P32]. Listing `<tailnet>.ts.net` also authorizes every machine name in the tailnet | Free on all plans, but beta. Needs MagicDNS, HTTPS and a `funnel` node attribute in the tailnet policy. "Funnel can only listen on ports 443, 8443, and 10000", and a port can't be Serve and Funnel at once [P31]. The tailnet root already serves another app and the Takeover view has its own Serve port ([ADR 0006](https://github.com/ultrasadness/lab1/blob/main/docs/adr/0006-registration-browser-in-its-own-container-driven-through-fixed-actions.md)), so at most one of the three ports may be free. The pages are up only while the VM and its web server are |
| **Firebase Hosting** on the OAuth project | `<site-id>.web.app` | Yes **[inferred]** (§2.2) | The site ID (the default site is named after the project ID; extra sites take a chosen, globally unique ID [P35]) and the pages. Nothing on GitHub, nothing on the VM | Free on the Spark plan: "No-cost up to 10 GB" storage and "360 MB/day" transfer [P34]. "every Firebase project has subdomains at no cost on the web.app and firebaseapp.com domains" [P33]. Needs Firebase added to the project and one deploy with the Firebase CLI. Cloud Shell has `npm` [P36], so `npx firebase-tools` could run there instead of on the VM **[unverified]** |
| *Own domain (for comparison)* | `example.com` | Yes | Whatever is on the site, plus the domain's WHOIS/RDAP record | Not free (a yearly registration). The only route that would also pass verification |

Other free static hosts on the PSL (`pages.dev`, `netlify.app`, `gitlab.io`, `codeberg.page` [P28]) would work by the same rule, but each needs a new account with another company.

## 4. After publishing: the warning, the cap and the token

### 4.1 The unverified-app warning

- "Google will display an **Unverified apps** warning message if your project's OAuth clients request authorization of scopes considered sensitive or restricted before your project has completed verification for those scopes" [P2].
- For personal use: "you and your limited number of users can continue using the app without going through verification (users will be allowed to click through 'unverified app' warning screens during sign-in)" [P4]. The brand and restricted-scope guides say the same: users "might be comfortable with advancing through the unverified app screen" [P13, P15]. Apps Script's guide: the unverified flow "allows these users to authorize unverified apps and use them, but only after confirming they understand the risks" [P22].
- **Two sentences still read as stricter, and the docs never reconcile them** (already noted in the Gmail research, §1.3):
  - Restricted scopes "require you to go through a scope verification process before you request the scopes from any Google Account" [P15].
  - The project "may be subject to verification ... before it may request authorization of sensitive or restricted scopes" [P2].
- **Where the click-through is not offered:**
  - Advanced Protection: "only verified third-party apps can access sensitive data on your Google Account" [P24].
  - A Workspace admin's app controls [P2], which don't apply to a consumer Gmail.
  - The 100-user cap, once used up: "Google sign-in being disabled for your users" [P10].
  - Google's Apps Script guide also names a hard "This app is blocked" screen for unverified sensitive or restricted scopes [P23]. Its triggers aren't documented. Even the ordinary unverified screen's presence "depends on what account the app is published from and what account is attempting to use the app" [P22]. Here the Signup mailbox owns the project and is its only user. That should be the most favourable case **[unverified]**.

### 4.2 The 100-user cap

- "100 new users in total, after the app presents the unverified app screen". It "applies over the entire lifetime of the project, and it cannot be reset or changed" [P2, P3].
- One user uses one place. Re-consent by the same account should not count as a new user **[inferred]**.
- Every app, verified or not, also has a rate limit on new authorizations, set by "application history, developer reputation, and riskiness" [P12]. One user never meets it.
- Once published, the app is "available to any user with a Google Account", and the test-user list no longer applies [P2, P6]. Anyone holding the client ID could start a consent for their own account and use up places. That costs the Assistant nothing below 100.

### 4.3 Refresh token lifetime

- The 7-day rule is tied to Testing: "A Google Cloud Platform project with an OAuth consent screen configured for an external user type and a publishing status of 'Testing' is issued a refresh token expiring in 7 days" [P17]. "Authorizations by a test user will expire seven days from the time of consent" [P2].
- For a published app, Google's Health API setup guide (2026-10-09) says it plainly: "Published Mode: Once your app is moved to 'In Production' status, refresh tokens generally don't expire unless they are revoked or remain unused for a prolonged period (typically six months)." The same guide calls its new clients "unverified ... with a cap of 100 users for both testing and production purposes" [P19]. That is the same situation as this app, though the guide is written for Health API scopes (also restricted [P11]), not Gmail.
- **The current token is not rescued.** Nothing says publishing extends a token issued under Testing. The Signup mailbox's token from 2026-10-14 10:09 UTC should still die at 2026-10-21 10:09 UTC [T17] **[inferred]**. Publish first, then consent again, then run the day-8 check (`gmail_spike.py consent`, then `install-cron`, as ticket 17 left it).
- **A quick early signal [unverified]:** the code-exchange response can carry `refresh_token_expires_in`, "only set when the user grants time-based access" [P18]. The Data Portability API documents it as 604800 seconds (7 days) for a Testing app [P20]. Whether a Gmail token in Testing carries it is not documented. At the new consent, record only whether the field is present and its number. Never record the token, which is a Secret. If it is absent, that is a good sign. The day-8 refresh is still the proof.
- **What still kills a published token** [P17]:
  - The user revokes access.
  - The token goes unused for six months.
  - "The user changed passwords and the refresh token contains Gmail scopes".
  - More than 100 live refresh tokens for one account and client, which silently drops the oldest.
  - New since 2025-10-27: an OAuth client "inactive for at least 6 months" may be deleted. Google emails 30 days before, and a deleted client can be restored for 30 days [P16, P9]. An Assistant that refreshes every few minutes never trips either.
- "Time-based access" (users picking 30 or 180 days) exists "in select Google products", for example the Data Portability API [P18, P20]. Nothing documents it for Gmail scopes.

## 5. An Internal audience is not available

- "Projects associated with a Google Cloud Organization can configure **Internal** users", and "An `org_internal` authorization error is displayed when authorization is requested from users outside the Google Cloud project's parent" [P2]. The setup guide: Internal "is only available for apps created under a Google Workspace Organization" [P6].
- "An organization resource is available for Google Workspace and Cloud Identity customers", and "An organization resource is associated with exactly one domain" [P25]. Cloud Identity Free needs "your company's domain name and the administrator username and password to your domain registrar" [P26].
- So a project owned by a personal Gmail has no organization and can't pick Internal. Even with a bought domain and Cloud Identity, Internal would admit only that organization's accounts. The Signup mailbox is a consumer `@gmail.com` account and could never be one of them.

## 6. What the pages should say, and what they must leave out [design]

The pages are public, and they are the one public statement about how this app uses Gmail data. The User Data Policy binds the app whether or not it is verified [P4]. So the privacy page has to be true.

- **Home page:** the app name, exactly as entered on the Branding page. One paragraph: a personal assistant that reads one Gmail account its owner keeps for signups, and drafts replies in it. It is not offered to anyone else. A link to the privacy page.
- **Privacy page:**
  - Which Google data it accesses (`gmail.readonly`, `gmail.compose`) and for which one account.
  - Where data is kept (the owner's own server).
  - That message content is sent to the model providers the Assistant runs on, to classify mail and draft replies. That is a transfer, and an honest policy names it.
  - No sale and no ads. On model training, the page can only promise what the model routes really do (see the last bullet).
  - How to revoke access (`https://myaccount.google.com/connections`).
  - The sentence Google's FAQ suggests: "{App's} use of information received from Google APIs will adhere to Google API Services User Data Policy, including the Limited Use requirements." [P10]
- **Terms page:** personal use only, not offered to the public, no warranty. It is optional for publishing, but costs one more small page and removes the doubt in §1.1.
- **Keep off the pages:** the Signup mailbox address, the person's name, the VM's address or tailnet names, and any link to the private `lab1` repo. The consent screen shows the support email only to whoever consents, which is the person.
- **Limited Use and models:** Google's FAQ says Google user data "may not be used to train or improve foundational or frontier models or be stored in conjunction with such models". It allows only "a personalized model to execute a user-facing feature" [P10]. The User Data Policy binds unverified apps too [P4]. So every model route that sees Signup mailbox mail would need to keep that mail out of training. Which routes do is not settled here.

## 7. Recommended path [design]

1. The person creates a small **public** repo on the `ultrasadness` account holding only the pages, and turns on Pages for it. The agent can draft the three files. The pages then live at `https://ultrasadness.github.io/<repo>/`. If the person would rather keep GitHub out, use Firebase Hosting on the same Cloud project instead (§3).
2. On the Branding page: app name; support email (the Signup mailbox); home page, privacy and terms URLs on the new site; authorized domain `ultrasadness.github.io` (or `<site-id>.web.app`). No logo, and no Verify Branding.
3. On Data Access, declare exactly `gmail.readonly` + `gmail.compose`. The unverified screen appears whether or not they are declared [P3], so this only keeps the console's record matching what the app asks for.
4. On Audience, click **Publish app**. If the Verification Center then says verification is needed, leave it. An unverified app keeps working under the 100-user cap [P3, P4].
5. Consent again as the Signup mailbox, clicking through the unverified-app screen. Grant exactly the two scopes. Note whether `refresh_token_expires_in` came back.
6. Run the day-8 refresh check. Only that proves the token outlived 7 days.

## Unverified, to settle by doing

1. Publish app becomes active with app name, support email, home page URL, privacy URL and an unproven authorized domain, and terms left empty (§1).
2. The console accepts `ultrasadness.github.io` (or `<site-id>.web.app`) as an authorized domain without Search Console (§2).
3. The published app lets the Signup mailbox click through the unverified-app screen for `gmail.readonly` + `gmail.compose`, rather than showing "This app is blocked" (§4.1).
4. The new refresh token still refreshes after day 8, and whether `refresh_token_expires_in` appears (§4.3).
5. Whether Google ever fetches or checks the pages of an unverified published app. Nothing documents it. The forum workaround pointed both links at one page and still published [F1].

## Sources

Read on 2026-10-14. Google's support.google.com pages carry no date (only "©2026 Google"). Developer pages carry "Last updated".

| # | Source | Owner | Date |
|---|---|---|---|
| P1 | [Manage OAuth App Branding](https://support.google.com/cloud/answer/15549049) (same text at [10311615](https://support.google.com/cloud/answer/10311615)) | Google Cloud Help | undated |
| P2 | [Manage App Audience](https://support.google.com/cloud/answer/15549945) | Google Cloud Help | undated |
| P3 | [Unverified apps](https://support.google.com/cloud/answer/7454865) | Google Cloud Help | undated |
| P4 | [When is verification not needed](https://support.google.com/cloud/answer/13464323) | Google Cloud Help | undated |
| P5 | [Verification requirements](https://support.google.com/cloud/answer/13464321) | Google Cloud Help | undated |
| P6 | [Submitting your app for verification](https://support.google.com/cloud/answer/13461325) | Google Cloud Help | undated |
| P7 | [Google Auth Platform Overview](https://support.google.com/cloud/answer/15548748) (Project Checkup) | Google Cloud Help | undated |
| P8 | [Get started with the Google Auth Platform](https://support.google.com/cloud/answer/15544987) | Google Cloud Help | undated |
| P9 | [Manage OAuth Clients](https://support.google.com/cloud/answer/15549257) (secret visibility: "April 2025 … June 2025 … November 2025"; unused client deletion) | Google Cloud Help | undated |
| P10 | [OAuth verification FAQ](https://support.google.com/cloud/answer/13463817) (user cap, Internal, Limited Use and AI) | Google Cloud Help | undated |
| P11 | [Restricted Scopes](https://support.google.com/cloud/answer/13464325) | Google Cloud Help | undated |
| P12 | [OAuth Application Rate Limits](https://support.google.com/cloud/answer/9028764) | Google Cloud Help | undated |
| P13 | [Submit for brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification) | Google for Developers | 2026-08-19 |
| P14 | [Comply with OAuth 2.0 policies](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance) | Google for Developers | 2026-08-19 |
| P15 | [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) | Google for Developers | 2026-08-19 |
| P16 | [OAuth 2.0 Policies](https://developers.google.com/identity/protocols/oauth2/policies) (changelog: 2025-10-27 unused client deletion; 2025-12-15; 2026-08-05) | Google for Developers | last modified 2026-08-05 |
| P17 | [Using OAuth 2.0 to Access Google APIs: refresh token expiration](https://developers.google.com/identity/protocols/oauth2#expiration) | Google for Developers | 2026-05-26 |
| P18 | [OAuth 2.0 for iOS & Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app) (time-based access, `refresh_token_expires_in`) | Google for Developers | 2026-09-14 |
| P19 | [Google Health API: Set up Google Cloud and OAuth](https://developers.google.com/health/setup) ("Token behavior during testing") | Google for Developers | 2026-10-09 |
| P20 | [Data Portability API: Use time-based access](https://developers.google.com/data-portability/user-guide/time-based) | Google for Developers | 2025-02-24 |
| P21 | [Configure the OAuth consent screen and choose scopes](https://developers.google.com/workspace/guides/configure-oauth-consent) | Google for Developers | 2026-09-03 |
| P22 | [Apps Script: OAuth client verification](https://developers.google.com/apps-script/guides/client-verification) | Google for Developers | 2026-09-03 |
| P23 | [Apps Script: Authorization for Google services](https://developers.google.com/apps-script/guides/services/authorization) | Google for Developers | 2026-09-03 |
| P24 | [Common questions with Advanced Protection Program](https://support.google.com/accounts/answer/7539956) | Google Account Help | undated |
| P25 | [Set up a Google Cloud organization resource](https://cloud.google.com/resource-manager/docs/creating-managing-organization) | Google Cloud | 2026-10-13 |
| P26 | [Set up Cloud Identity as a Google Cloud administrator](https://cloud.google.com/identity/docs/set-up-cloud-identity-admin) | Google Cloud | 2026-10-13 |
| P27 | [Verify your site ownership](https://support.google.com/webmasters/answer/9008080) | Search Console Help | undated |
| P28 | [Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat) (`github.io`, `ts.net`, `*.c.ts.net`, `web.app`, `firebaseapp.com`, `pages.dev`, `netlify.app`, `gitlab.io`, `codeberg.page` in the private section; no `google.com`) | Mozilla / PSL | VERSION 2026-10-07 |
| P29 | [What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) and [Creating a GitHub Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site) ("publicly available on the internet, even if the repository for the site is private") | GitHub Docs | undated |
| P30 | [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) | GitHub Docs | undated |
| P31 | [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) | Tailscale Docs | last validated 2026-01-20 |
| P32 | [Enabling HTTPS](https://tailscale.com/kb/1153/enabling-https) (Certificate Transparency) and [Tailnet names](https://tailscale.com/kb/1217/tailnet-name) | Tailscale Docs | last validated 2025-12-10 / 2026-01-05 |
| P33 | [Firebase Hosting](https://firebase.google.com/docs/hosting) | Firebase | 2026-10-14 |
| P34 | [Firebase pricing](https://firebase.google.com/pricing) (Hosting on Spark) | Firebase | undated |
| P35 | [Share project resources across multiple sites](https://firebase.google.com/docs/hosting/multisites) (site IDs) | Firebase | 2026-10-13 |
| P36 | [How Cloud Shell works](https://cloud.google.com/shell/docs/how-cloud-shell-works) (preinstalled tools) | Google Cloud | 2026-10-09 |
| P37 | [Best practices for signInWithRedirect](https://firebase.google.com/docs/auth/web/redirect-best-practices) (`<project>.firebaseapp.com` as the default auth domain) | Firebase | 2026-10-14 |
| T17 | [Check that API drafts edit in Gmail iOS and that tokens outlive 7 days](https://github.com/ultrasadness/lab1/issues/17), resolution, and [`results.md`](https://github.com/ultrasadness/lab1/blob/task/gmail-checks/docs/tasks/gmail-checks/results.md) | this repo (first-hand) | 2026-10-14 |
| G1 | `gh api user` (read-only): plan `free`, 0 public repos; `ultrasadness/lab1` is private with no Pages site | GitHub API | 2026-10-14 |
| F1 | [Cannot publish due to error message "Your app's OAuth configuration is incomplete…"](https://discuss.google.dev/t/cannot-publish-due-to-error-message-your-apps-oauth-configuration-is-incomplete-you-must-enter-the-missing-information-to-proceed-please-visit-the-branding-page-to-finish-configuring-your-app-even-though-all-required-fields-are-complete/392229) (tooltip text, workaround) | Google Developer forums, users, not staff | 2026-08-25 to 08-28 |
| F2 | ["Publish app" disabled for External/Testing personal-use OAuth app](https://discuss.google.dev/t/google-auth-platform-publish-app-disabled-for-external-testing-personal-use-oauth-app/402925) | Google Developer forums | 2026-10-09 |
| F3 | [Cannot publish app — "Publish app" button disabled, Branding page complete](https://discuss.google.dev/t/cannot-publish-app-publish-app-button-disabled-branding-page-complete-pii-removed-by-staff/401276) | Google Developer forums | 2026-10-02 |
| F4 | [Erro ao criar uma credencial OAuth no Google Console](https://community.n8n.io/t/erro-ao-criar-uma-credencial-oauth-no-google-console/310066) (community reply) | n8n community | 2026-08-28 |
| F5 | [Google APIs - Android - OAuth Credentials Consent](https://groups.google.com/g/google-cloud-dev/c/dVF8RRLRlIk) (Cloud Platform Support replies) | Google Groups | 2018-12-18 to 2019-07-24 |
| F6 | [GCP oauth consent screen - subdomain can not be setted](https://discuss.google.dev/t/gcp-oauth-consent-screen-subdomain-can-not-be-setted/134439) | Google Developer forums | 2023-11-01 |
| F7 | Practitioner setups listing `<user>.github.io` as the authorized domain, outcome not reported: [charlie60507/transaction_bot#74](https://github.com/charlie60507/transaction_bot/pull/74), [Osasuwu/like-current-song#126](https://github.com/Osasuwu/like-current-song/issues/126) | GitHub | 2026-10-07 / 2026-09-20 |
