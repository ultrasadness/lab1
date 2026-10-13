# What the person's model plans permit the Assistant to do

Research for ticket #23 on the map (#1). It answers: for each model plan the person may provide, what do the provider's terms and usage policy permit the Assistant to do? For each plan it covers the **route** (may the plan serve the person's own unattended Assistant through a self-hosted gateway and a harness that isn't the provider's own app), the **Registration clause** (does the policy restrict using the model to automate account creation on other sites, or to act against other sites' terms), and **data** (retention, training, opt-outs, jurisdiction).

- **Researched:** 2026-10-13, from the providers' own terms, policies, help centres and developer docs, plus the source code of the two gateways. Each source is listed at the end with its effective date or the date it was read. A few OpenAI and Claude help pages block automated fetches; those were read from Internet Archive snapshots, and the snapshot date is given.
- **Stance already decided** (#8): the Assistant uses only routes the provider's terms permit. This file says, per route, **permitted**, **not permitted** or **unclear**, with the clause. It does not pick a plan, harness or gateway.
- **What the model will see:** public Product Hunt and Product-site text (Launches, Dossiers), the person's Profile (names, email addresses), signup-related Gmail (which can carry verification codes and links), and Reply drafts. Whoever handles model traffic can read all of it.
- **Quotes vs inference:** passages in quotation marks are verbatim. Anything marked _Interpretation_ or _Unverified_ is mine, not the provider's.
- **Claude Pro** was covered by the unattended-Claude research ([`docs/research/unattended-claude.md`](https://github.com/ultrasadness/lab1/blob/research/unattended-claude/docs/research/unattended-claude.md), §7 and §9, from #6). This file cites it, updates it where the sources changed, and answers the one question it left open (a Claude login served through a gateway to a non-Anthropic harness).

## Answer in brief

1. **ChatGPT Plus has two documented routes for an unattended Assistant, and the gateway route is not one of them.**
   - **Codex itself, headless on the VM:** `codex exec`, Codex app-server or the Codex SDK, signed in with the ChatGPT login. OpenAI documents copying `auth.json` to a headless machine and running CI on a ChatGPT login. It still calls an API key "the recommended default for automation".
   - **"Sign in with ChatGPT" (SIWC) in an open-source harness on the person's own VM:** plan usage through it launched alongside OpenAI's DevDay; its terms are dated 29 Sep 2026. OpenCode, OpenClaw, Pi and T3 are listed integrations, and OpenAI documents a self-hosted VM setup. The SIWC Terms require requests from "a remote runtime only that user controls", "express consent before background use", and "Do not provide general-purpose API access for other tools".
   - **Unclear, leaning not permitted:** new-api's `codex` channel and CLIProxyAPI's Codex login. Both run Codex's own OAuth client and present themselves to OpenAI as the Codex CLI, then expose the plan as a general API to any harness. No OpenAI clause permits this. OpenAI's Codex lead publicly promoted CLIProxyAPI with a ChatGPT login on 12 Jul 2026, before the SIWC Terms existed.
2. **DeepSeek sells no subscription. Its only paid product is the pay-as-you-go API.** That API may be used from any harness or gateway: DeepSeek's own docs walk through Claude Code, Codex, OpenCode and OpenClaw. The terms only require keeping the key private.
   - **Data:** stored in the People's Republic of China, kept "for as long as necessary" (no fixed period), and may be used for training unless the person opts out.
   - **Third-party "coding plans" that carry DeepSeek models** (e.g. Volcano Engine Ark) are other companies' products with their own terms. One comparable plan, Alibaba's, forbids automated use.
3. **OpenRouter is a plain API product: any harness or gateway may use it.** The catch is that each model's upstream terms come along with it:
   - "You may not violate the terms of service or policies of third-party providers that power the models on OpenRouter." A Claude model reached through OpenRouter brings Anthropic's Usage Policy with it.
   - OpenRouter stores no prompts unless the person opts in.
   - Per-request controls (`data_collection: "deny"`, `zdr`, `only`, `ignore`, `allow_fallbacks: false`) fix which upstream hosts may see the data. A DeepSeek model on OpenRouter can be served by any of 15 endpoints, run by hosts headquartered in the US, Singapore and China.
4. **Claude Pro: Claude Code, `claude -p` and the Agent SDK on the person's own login remain permitted (as in #6). Serving the login through CLIProxyAPI or new-api to a non-Anthropic harness is not permitted.**
   - Anthropic's legal page now adds: "developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."
   - CLIProxyAPI by default disguises other clients as Claude Code ("the Claude Code CLI disguise"). Anthropic said it "tightened our safeguards against spoofing the Claude Code harness" (9 Jan 2026), and it moved third-party harnesses off subscription limits onto paid "extra usage" (4 Apr 2026).
5. **Third-party relays ("中转") of unknown origin mostly run on breaches of upstream terms: resold or pooled accounts, region evasion.** They see every prompt and response in plaintext. A 2026 study of 428 relays found some injecting malicious code into agent tool calls and stealing planted credentials. Another found that some relays serve a different model from the one they advertise. No provider's terms make a relay a permitted route for its plan.
6. **For #15 (may the Assistant submit a Registration?), only Anthropic's Usage Policy has an account-creation clause:** "Utilize automation in account creation or to engage in spammy behavior". The other providers' policies only cover the act itself:
   - **OpenAI:** "deceit, fraud, scams, spam, or impersonation".
   - **DeepSeek:** "disrupt the normal order of the internet platform", plus rights of others.
   - **OpenRouter:** only passes through upstream terms.

   None of them restricts filling a form. A non-Anthropic model still leaves Anthropic's policy in play in three cases:
   - the harness is Claude Code (its licence is Anthropic's Commercial Terms, and "Claude Code usage is subject to the Anthropic Usage Policy");
   - OpenRouter or a relay routes to a Claude model;
   - the Assistant falls back to Claude.

## 1. Summary table

"Permitted" means a clause or official document allows it; "Not permitted" means a clause forbids it; "Unclear" means neither, or the sources conflict. Full quotes are in §2 to §6.

| Plan and route | Permitted? (key clause) | Registration clause (automating account creation on other sites; other platforms' terms) | Data handling |
| :-- | :-- | :-- | :-- |
| **ChatGPT Plus, Codex itself headless on the VM** (`codex exec`, app-server, SDK) with the ChatGPT login | **Permitted.** Documented "Use ChatGPT-managed auth in CI/CD (advanced)" for "users who need ChatGPT/Codex rate limits instead of API key usage". API key "still the recommended default for automation". | None. Usage Policies prohibit "deceit, fraud, scams, spam, or impersonation". Terms of Use: not "in a way that infringes, misappropriates or violates anyone's rights". | Individual plans: "we may use your content to train our models" unless "Improve the model for everyone" is off. Codex has a separate "Include environments" setting. Deleted content is removed "within 30 days". US company, California law. |
| **ChatGPT Plus, SIWC in an open-source harness** (OpenCode, OpenClaw, Pi, T3) on the person's VM | **Permitted, with conditions.** SIWC Terms §2: requests from "a remote runtime only that user controls", "express consent before background use", "Use the user's plan only for the application they connected". Plus five-hour limit is shared across apps. | Same as above. | Plan requests must set `store: false`. Training settings as above (_Unverified_ whether they cover SIWC requests). Plan use "does not by itself give the app or site access to your ChatGPT conversations or memories". |
| **ChatGPT Plus, new-api `codex` channel or CLIProxyAPI Codex login**, exposed as an API to any harness | **Unclear, leaning not permitted.** No clause permits it. Terms of Use: not "Automatically or programmatically extract data or Output". SIWC Terms (the stated rules for third-party plan use): "Do not impersonate OpenAI, another application", "Do not provide general-purpose API access for other tools". Against that, an OpenAI staff post (12 Jul 2026) promoted CLIProxyAPI. | Same as above. | As above, plus the gateway holds the ChatGPT tokens. |
| **DeepSeek API** (pay-as-you-go; the only paid DeepSeek product) via any harness or gateway | **Permitted.** Open Platform Terms: "for developing applications, services, or tools for internal organizational use or end users". Key: "do not share or publicly disclose your API key". | None on other sites. "Do not maliciously register accounts, including but not limited to frequent or bulk registration" (DeepSeek accounts). "Disrupt the normal order of the internet platform". | Stored "in People's Republic of China". Retention "as long as necessary", no period. Training on de-identified inputs unless "Improve the model for everyone" is off (_Unverified_ for API calls). PRC law. |
| **DeepSeek "coding plan"** | **No such DeepSeek product.** Third-party plans that include DeepSeek models have their own terms (_Unverified_). Alibaba's comparable plan: "Do not use the plan's API key for automated scripts, application backends, or other non-interactive scenarios." | Per reseller. | Per reseller. |
| **OpenRouter API key** via any harness or gateway | **Permitted.** Plain API product. Bound by each model's upstream "Model Terms". No "reselling API access to Models". | None of its own. "You may not violate the terms of service or policies of third-party providers", so Claude via OpenRouter brings Anthropic's clause. | No prompt storage unless opted in. Opt-in logging is kept "a minimum of 3 months". Upstream per host. Controls: `data_collection: "deny"`, `zdr: true`, `only`, `ignore`, `order`, `allow_fallbacks: false`. US company. |
| **Claude Pro, Claude Code / `claude -p` / Agent SDK** on the person's own login | **Permitted** (from #6). "You can still use the Claude Agent SDK, `claude -p`, and third-party apps with your subscription limits" (7 Oct 2026). "Third-party apps" means apps that "authenticate with your Claude subscription through the Agent SDK". | "Utilize automation in account creation or to engage in spammy behavior". "Circumvent the guardrails or terms of other platforms or services". Agents' actions "through tools, browsers, or connected systems" must comply. | Training opt-in setting: up to 5 years if on. Deleted chats purged "within 30 days". Flagged content up to 2 years. US company. |
| **Claude Pro via CLIProxyAPI or new-api** to a non-Anthropic harness | **Not permitted.** "... developers may not collect, store, or intermediate Claude.ai credentials or session tokens". OAuth is "designed to support ordinary use of Claude Code and other native Anthropic applications". Consumer Terms automation ban applies except API key or "where we otherwise explicitly permit it". | As above. | As above, plus the gateway holds the session tokens. |
| **Relay endpoint of unknown origin** | **Not a permitted route for any plan above.** Resale and sharing are banned upstream: OpenAI "lease, sell or distribute", Anthropic "make your Account available to anyone else", OpenRouter "reselling API access", SIWC "Pooling ... reselling". | Upstream policy still governs the model; the relay's own terms are unknown. | The relay sees and can log or alter everything: Profile, verification codes and links, Reply drafts, tool calls. |

## 2. ChatGPT Plus through the Codex (ChatGPT) login

### Routes and what the terms say

**Terms of Use** (individuals; "Effective: January 1, 2026"). Under "What you cannot do":

> "Automatically or programmatically extract data or Output (defined below)."

> "Interfere with or disrupt our Services, including circumvent any rate limits or restrictions or bypass any protective measures or safety mitigations we put on our Services."

> "Modify, copy, lease, sell or distribute any of our Services."

And under "Registration and access" (OpenAI's heading):

> "You may not share your account credentials or make your account available to anyone else and are responsible for all activities that occur under your account."

The Terms "include our Service Terms", and you "must comply with ... our ... Usage Policies, and any other documentation, guidelines, or policies we make available to you."

**Route A: Codex itself, headless on the VM.** OpenAI documents this. [codex-auth], [codex-noninteractive], [codex-cicd]

- The auth page says: "Use API key authentication for programmatic Codex CLI workflows, such as CI/CD jobs. Don't expose Codex execution in untrusted or public environments."
- For a headless machine it documents device-code sign-in (beta) or "Copy `~/.codex/auth.json` to `~/.codex/auth.json` on the headless machine."
- Non-interactive mode, "Use ChatGPT-managed auth in CI/CD (advanced)": "Read this if you need to run CI/CD jobs with a Codex user account instead of an API key, such as enterprise teams using ChatGPT-managed Codex access on trusted runners or users who need ChatGPT/Codex rate limits instead of API key usage."
- The CI/CD guide: "The right way to authenticate automation is with an API key. Use this guide only if you specifically need to run the workflow as your Codex account." and "This is an advanced workflow for enterprise and other trusted private automation."
- Codex **access tokens** for scripts and schedulers exist, but "Codex access tokens are currently supported for ChatGPT Business and Enterprise workspaces", so they are not available on Plus.

_Interpretation:_ OpenAI's own documentation of `codex exec` on a ChatGPT login for trusted private automation is the explicit permission that the "programmatically extract" clause yields to. The person's own VM fits "trusted private automation". "Permitted" here assumes the harness is Codex (CLI, app-server or SDK). An API key is the route OpenAI recommends.

**Route B: Codex with a gateway in the path.** [codex-auth], [codex-gw-siwc]

- For a custom model provider, "Set `requires_openai_auth = true` to use OpenAI authentication. You can then sign in with ChatGPT or an API key. This is useful when you access OpenAI models through an LLM proxy server."
- The workspace guide "Sign in with ChatGPT through a gateway" has the gateway forward the ChatGPT headers "unchanged" to `https://chatgpt.com/backend-api/codex`, and warns: "Your gateway can see request data and both credentials."

_Interpretation:_ a pass-through gateway on the VM, with Codex still the client and the person's own ChatGPT token, looks permitted. The detailed guide is written for managed workspaces. _Unverified:_ whether OpenAI intends it for Plus accounts.

**Route C: Sign in with ChatGPT (SIWC) in an open-source harness.** Plan usage through SIWC launched with OpenAI's DevDay announcements; the SIWC Terms are dated 29 Sep 2026.

- **Help centre** [oa-siwc-help]: "If you have a Go, Plus, or Pro plan, you can also choose to use your ChatGPT plan for AI requests in participating commercial apps and sites" and "Supported open-source tools remain available to all ChatGPT users."
- **Partner directory** [siwc-partners]: lists "Open-source integrations" OpenClaw, OpenCode, Pi and T3. Commercial apps with plan usage include Amp Code, Devin, Hermes Agent, Kilo Code and Warp.
- **Developer docs** [siwc-docs]:
  - "ChatGPT plan usage is available to all open-source partners and selected private clients."
  - "These docs explain ChatGPT plan usage for open-source and locally hosted apps. If you're interested in offering it in a paid or remotely hosted app, complete the interest form."
  - A **Self-hosted VMs** page: "Use this guide when you run an open-source app on a remote virtual machine (VM)." You complete OAuth on a machine with a browser, transfer the credential file over SSH, and "Let the VM own later refreshes." It also notes: "Host-specific usage attribution and revocation of ChatGPT plan access for transferred sessions are not yet available."
  - "For ChatGPT Plus users, the five-hour usage limit is shared across all apps where they use their ChatGPT plan, including private and open-source clients."
  - **Preview limits:** requests must "Set `store: false` and `stream: true`". Hosted tools (image generation, file search, Code Interpreter, hosted MCP) are unsupported.

**Sign in with ChatGPT Terms** (dated September 29, 2026) [siwc-terms]. They govern any app using SIWC and "incorporate the Terms of Use and our Service Terms".

> "Use your app's own name during sign-in and activation. Do not impersonate OpenAI, another application, or another open-source project."

> "Obtain and use SIWC access and refresh tokens ("Authentication Tokens") only through OpenAI's supported sign-in flow and as authorized by the user."

> "Keep account information and Authentication Tokens secure. Any persistent storage of Authentication Tokens must be local and under the user's control, not in a remote or managed environment."

> "User control. Requests must originate from the user's local runtime or a remote runtime only that user controls."

> "User authorization. Requests must be for the authenticated user and arise from their activity or expressly authorized automations or background processes. Obtain express consent before background use. Another user's activity must not trigger requests to the authenticated user's account."

> "Connected application only. Use the user's plan only for the application they connected. Do not provide general-purpose API access for other tools or unrelated requests."

Under "Prohibited activities" ("You must not enable or encourage:"):

> "Creating multiple accounts, splitting usage, rotating accounts, or otherwise bypassing usage limits."

> "Pooling, transferring, reselling, gifting, or sharing ChatGPT plan usage or Authentication Tokens, except for token handling expressly permitted by these Terms."

_Interpretation:_
- An open-source harness on the person's own VM fits these terms: a runtime "only that user controls", consent to background runs given by the person (who is both developer and user), and plan use only inside that harness.
- "Not in a remote or managed environment" sits uneasily with a cloud VM. OpenAI's own Self-hosted VMs page shows it accepts a user-controlled VM.
- _Unverified:_ whether the person's own private (not open-source) harness counts. The docs say "open-source and locally hosted apps" and "selected private clients". Using a listed open-source harness avoids that question.
- A gateway such as new-api offering the SIWC plan as a general OpenAI-compatible endpoint would breach "Connected application only".

### The gateway route: new-api's `codex` channel and CLIProxyAPI

Facts from the gateways' source, read 2026-10-13:

- **new-api** (`relay/channel/codex/adaptor.go`): sends requests to `/backend-api/codex/responses` with a stored ChatGPT `access_token` and `chatgpt-account-id`. If the client didn't set one, it sets `originator: codex_cli_rs`, the header the official Codex CLI sends. Its `service/codex_oauth.go` runs OAuth with the Codex CLI's public client ID. [new-api]
- **CLIProxyAPI**: offers "OpenAI Codex support (GPT models) via OAuth login" and "OpenAI Codex multi-account load balancing". Its config defaults to "forcing the official Codex User-Agent and Originator headers" (`disable-codex-cloaking: false`). Its Codex login also uses the Codex CLI's public client ID. [cliproxyapi]

_Interpretation:_ to OpenAI this traffic looks like the Codex CLI while any harness drives it. It is the pattern the SIWC Terms describe as "impersonate ... another application" plus "general-purpose API access for other tools". Those terms formally bind apps that integrate SIWC, which these gateways don't (they bypass it). Under the Terms of Use, the open questions are "programmatically extract data or Output" and "bypass any protective measures". No OpenAI document permits this route; one OpenAI staff post endorsed it (below). Hence **unclear, leaning not permitted**.

### Enforcement on record

- **12 Jul 2026, OpenAI's Codex lead endorses CLIProxyAPI (official staff post, not a policy).** Thibault Sottiaux on X: "If you aren't yet bold enough to install the Codex app, you can stay in the presence of your orange crab and point it at GPT 5.6 Sol. Takes 5 minutes. ... Step 1: Install CLIProxyAPI Step 2: Connect Step 3: Define following alias and enjoy claudex ... If this gets blocked, I owe you a reset." [tibo-post]
- **8 to 9 Aug 2026, Anthropic suspension reversed.** A developer who followed that recipe (unmodified Claude Code, local CLIProxyAPI, GPT behind it) reported his **Anthropic** account suspended "for 'suspicious signals'" [getman-repo], [getman-post]. A secondary report says Anthropic's Boris Cherny called it a different classifier, said Anthropic doesn't ban using its harness with other models, and had it unblocked. The same report says Sottiaux then reset weekly limits for paid ChatGPT and Codex users [explainx]. _Unverified:_ the Cherny and Sottiaux wording comes only from that report.
- **No OpenAI enforcement against Codex-token proxies found.** Searches found no OpenAI statement and no deadline for retiring Codex-client logins in third-party tools. OpenAI's community forum has user reports of Codex/ChatGPT bans with no stated cause [oa-forum-ban]. The SIWC launch is the documented replacement for third-party plan use. A Pi package project notes that "Pi 0.99 renamed `openai-codex` to **OpenAI Codex (legacy)** and recommends ChatGPT sign-in on the `openai` provider" [pi-note] (a project note, not OpenAI policy).
- **Region:** "Accessing or offering access to our services outside of the countries and territories listed below may result in your account being blocked or suspended." China and Hong Kong are not on the list. [oa-countries]

### Registration clause

The **Usage Policies** ("Effective: October 29, 2025") contain no clause on automating account creation on other sites. The nearest items, under "Empower people" and "Protect people", forbid use for:

> "deceit, fraud, scams, spam, or impersonation"

> "destruction, compromise, or breach of another's system or property, including malicious or abusive cyber activity or attempts to infringe on intellectual property rights of others"

> "circumventing our safeguards"

The Terms of Use add: not "Use our Services in a way that infringes, misappropriates or violates anyone's rights."

The **Service Terms** ("Updated: September 29, 2026"), §14 "Dots and Agentic Features", assign responsibility for OpenAI's own agentic features:

> "(a) Responsibility. You decide how to use dots and related agentic features, including what access, authority, and instructions you give them. You are responsible for actions they take and content they share on your behalf."

> "(b) Oversight. You are responsible for providing oversight appropriate to the task and its potential consequences. This includes setting clear instructions and appropriate limits and reviewing actions and communications."

_Interpretation:_
- A Registration under the person's own Signup identity, after their Approval, is not "impersonation" or "spam" on its face.
- Breaching a Product's terms that ban bot-made accounts is not named, unlike in Anthropic's policy. It could still be argued to "violate anyone's rights" (a contractual right of the Product).
- Nothing in OpenAI's text restricts filling a form.

### Data

- **Training** [oa-training] (help article, "Updated: 11 days ago" in the 10 Oct 2026 snapshot): "When you use our services for individuals, such as ChatGPT and Codex, we may use your content to train our models. ... To opt out, turn off Improve the model for everyone under Settings > Data controls in ChatGPT, or select Do not train on my content in our Privacy Portal." Also: "Either option is sufficient for ChatGPT conversations and Codex tasks." And: "Codex has a separate Include environments setting in Codex settings for allowing training on full environments. Changing your settings in ChatGPT or the Privacy Portal does not change that setting." Feedback (thumbs up/down) can put the whole conversation into training even after opting out.
- **Retention** [oa-privacy] (Privacy Policy, "Updated: February 6, 2026"): deleted content is removed "within 30 days unless we need to retain it for longer". Temporary Chats "will be automatically deleted within 30 days". Content tied to a policy ban, or under legal hold, may be kept longer. _Unverified:_ how long requests from `codex exec` on a ChatGPT login are kept server-side. SIWC requests run with `store: false`.
- **API comparison** (relevant if the person uses an OpenAI API key, or OpenRouter routes to OpenAI) [oa-api-data]: "data sent to the OpenAI API is not used to train or improve OpenAI models (unless you explicitly opt in to share data with us)". "abuse monitoring logs are generated for all API feature usage and retained for up to 30 days".
- **Jurisdiction:** OpenAI OpCo, LLC; "California law will govern these Terms" (EEA, Swiss and UK residents have separate terms).

## 3. DeepSeek

### What DeepSeek sells

- **The DeepSeek app and web chat** are free.
- **The DeepSeek Open Platform API** is **pay-as-you-go**: top up a balance and pay per million tokens, with off-peak rates "half of the peak rates" [ds-pricing].
- **No DeepSeek subscription or coding plan** appears in DeepSeek's docs, pricing page or terms (read 2026-10-13).
- **"DeepSeek coding plans" sold elsewhere** are other companies' products. Examples: Volcano Engine / BytePlus ModelArk "Coding Plan", Baidu Qianfan "TokenPlan" (listed with "DeepSeek V4" in CLIProxyAPI's README), and the reseller Atlas Cloud. Their terms govern them. _Unverified:_ their automation clauses.
- **Example of a comparable plan's terms:** Alibaba Cloud's Coding Plan (it carries Qwen, GLM, Kimi and MiniMax, not DeepSeek) says "This plan is for interactive use in programming tools such as Claude Code, Qoder, Qoder CN, and OpenClaw" and "Do not use the plan's API key for automated scripts, application backends, or other non-interactive scenarios." Violations "may result in subscription suspension or API key revocation" [aliyun-coding-plan].

### Route

- **Open Platform Terms of Service** ("Release date: April 22, 2026 / Effective date: April 29, 2026") [ds-platform-tos]:
  - They cover use of the API "as an individual developer or on behalf of an enterprise developer ... for developing applications, services, or tools for internal organizational use or end users."
  - §2.2: "Please keep your created API key securely, prevent any form of leakage, do not share or publicly disclose your API key with others, and do not expose it in browser or other client-side code."
- **DeepSeek's docs** [ds-docs]:
  - "If you use tools like Claude Code, GitHub Copilot, or OpenCode, you can use DeepSeek as the backend model directly — no code required."
  - Their "Agent Integrations" section has pages for Claude Code, Codex, OpenCode, OpenClaw and Hermes.
  - The API speaks both OpenAI and Anthropic formats.
- **new-api** ships a `deepseek` channel.

So the API through new-api and any harness is **permitted**. Nothing in the terms restricts unattended or automated use of the API.

### Registration clause

**Terms of Use** ("Last Update: March 27, 2026"), which the Open Platform Terms sit under [ds-tou]:

> §2.3 "Do not maliciously register accounts, including but not limited to frequent or bulk registration. Do not transfer, lend, rent, or provide your account to others in any form."

> §3.2 "Users shall not use the Service to engage in, facilitate, or promote any activities violating laws or regulations, infringing on the legal rights or interests of others or seek unjust benefits, nor shall you disrupt the normal order of the internet platform."

> §3.6(4) "Without DeepSeek's authorization, copying, transferring, leasing, lending, selling, or sub-licensing the entire or part of the Services."

The Open Platform Terms §3.1 repeat the duty of "not disrupting the normal order of the internet platform".

_Interpretation:_
- §2.3 is about DeepSeek's own accounts.
- No clause addresses automating Registrations on other sites, or acting against other sites' terms.
- "Disrupt the normal order of the internet platform" is broad wording that echoes Chinese internet regulation, where it is commonly aimed at operations such as bulk registration. One person's Registrations under their own identity are not that on their face.
- Nothing restricts filling a form.

### Data

- **Location:** "To provide you with our services, we directly collect, process and store your Personal Data in People's Republic of China." [ds-privacy] ("Last Update: Feb 10, 2026").
- **Retention:** "We retain Personal Data for as long as necessary to provide our Services and for the other purposes set out in this Privacy Policy." No period is published, for the app or for the API.
- **Training:** among the policy's purposes is "to train and improve our technology, such as our machine learning models and algorithms". The Terms of Use §4.3: "Under the premise of secure encryption technology processing, strict de-identification rendering, and irreversibility to identify specific individuals, we may, to a minimal extent, use Inputs and Outputs to provide, maintain, operate, develop or improve the Services ... If you refuse to allow us to process the data in the manner described above, you can opt out by turning off "Improve the model for everyone"." The Open Platform "and the chat service use the same account". _Unverified:_ whether the app toggle covers API calls. No zero-retention option is documented for the API.
- **Disclosure:** DeepSeek "may access, preserve, and share" personal data "with law enforcement agencies, public authorities ... if we have good faith belief that it is necessary to: comply with applicable law, legal process or government requests". §3.3: DeepSeek "has the right to use technical means to review the behavior of users".
- **Jurisdiction:** Hangzhou DeepSeek Artificial Intelligence Co., Ltd.; "governed by the laws of the People's Republic of China in the mainland".

## 4. OpenRouter

### Route

The Terms of Service ("Last Updated: August 31, 2026") [or-terms] describe "a large language model aggregator" that customers may also build on ("to the extent you incorporate the Service into your own products and services"). Any harness or gateway calling it with the person's API key is **permitted** (new-api has an `openrouter` channel). The conditions that matter:

> §5.1 "By accessing or using any Model through the Service, you agree, and will ensure that your Authorized Users and customers agree, to comply with the applicable terms for each Model ("Model Terms")"

> §5.5 "OpenRouter may suspend, restrict, disable, or terminate your ... access to any Model if we reasonably believe that you ... has violated, or may violate, any Model Terms, or if we are required or requested to do so by the applicable Model Provider."

> §5.7 Restricted Models: you may not "use the Service to access, or to use the Service in conjunction any other third-party tools to access, Restricted Models, including without limitation by using virtual private networks and proxies"

§7, Prohibited Conduct:

> "create a false identity, misrepresent your identity, or create multiple accounts as a single user, for purposes of bypassing or circumventing use limits on the Site or Service or for any other reason;"

> "access the Site or Service for purposes of reselling API access to Models or otherwise developing a competing service;"

> "post, upload, or distribute any Input or other content that is unlawful, or is not in compliance with the Terms of Service for the Model or Provider you are using;"

The provider-routing docs [or-routing]: "You may not violate the terms of service or policies of third-party providers that power the models on OpenRouter." The "Model Terms" link points at each provider's terms. For example, Anthropic's endpoint lists Anthropic's Commercial Terms, under which customers "may only use the Services in compliance with these Terms, including (a) the Usage Policy" [commercial-terms]. OpenAI's lists `openai.com/policies/row-terms-of-use/`. DeepSeek's lists the DeepSeek Terms of Use. [or-providers]

### Registration clause

OpenRouter has no clause of its own about automating Registrations on other sites. Its own account rule ("create multiple accounts as a single user") is about OpenRouter accounts. It flows down each upstream's policy, so:

- **A Claude model via OpenRouter** carries Anthropic's "Utilize automation in account creation" and "terms of other platforms" clauses.
- **GPT via OpenRouter** carries OpenAI's Usage Policies.
- **DeepSeek models** carry the terms of whichever host serves them.

_Interpretation:_ choosing OpenRouter does not by itself avoid Anthropic's clause; the model chosen does.

### Data and what OpenRouter passes upstream

- **OpenRouter itself** [or-data]: "OpenRouter does not store your prompts or responses, *unless* you opt in". There are two opt-ins:
  - **Private Input & Output Logging:** "retained for a minimum of 3 months, and may be retained beyond 3 months at OpenRouter's discretion unless you request deletion" [or-logging].
  - **"OpenRouter Use of Inputs/Outputs":** a 1% discount in exchange for use "to improve the product". Opting in to prompt logging also grants a "perpetual, irrevocable" licence that includes to "license or sell your User Content in anonymized form" (Terms §6.2).
  - **Metadata** (tokens, latency) is always stored. A small anonymous sample of prompts is categorised "by model with a zero-data-retention policy".
  - Privacy Policy: "OpenRouter does not use your Inputs or Outputs for model training." [or-privacy]
- **Passed upstream:**
  - The prompt and response go to the selected provider, which "may, depending on their own terms and data practices, retain and use your Inputs and Outputs for their own purposes, such as model training and improvement" [or-privacy].
  - The `user` field: "When a provider requires a user identity, OpenRouter folds it into the hashed identity sent upstream and never forwards it raw. If omitted, requests use an account-level identity, so provider policy blocks can affect the whole account." [or-api]
  - OpenRouter tries to pass "the country of your originating request" (Terms §6.8).
- **Controls** [or-routing], [or-zdr], [or-provider-logging]:
  - **Per request:**
    - `provider.data_collection: "deny"` ("use only providers which do not collect user data")
    - `provider.zdr: true` (only Zero Data Retention endpoints)
    - `only` / `ignore` / `order` (pick hosts)
    - `allow_fallbacks: false` (no silent fallback to another host)
  - **Account-wide:** the same as privacy settings, including separate "may train" toggles for paid and free models, and ZDR per model group (Anthropic, OpenAI, Google, SpaceXAI, others).
  - "If OpenRouter is not able to establish or ascertain a clear policy for a provider or endpoint, we take a conservative stance and assume that the endpoint both retains and trains on data".
  - ZDR "does not apply to plugins and tools", such as web search.
- **Who actually serves a DeepSeek model:** on 2026-10-13, `deepseek/deepseek-v4-pro` had 15 endpoints. Their hosts, by headquarters listed in OpenRouter's provider API: US (Parasail, GMICloud, DigitalOcean, Cloudflare, DeepInfra, Novita, Venice, AtlasCloud, Azure), Singapore (SiliconFlow; Alibaba, with data centres in Singapore and China), China (StreamLake, Baidu), and one not stated (Reka). DeepSeek's own endpoint was not among them [or-endpoints]. Without `only`/`ignore`, the host, and with it the jurisdiction and retention, can change from request to request.
- **Jurisdiction:** OpenRouter, Inc., New York; binding arbitration. Regional EU/US routing exists only on Business and Enterprise plans.

## 5. Claude Pro (update to the unattended-Claude research)

### What has changed since #6's §7 and §9

- **Legal and compliance page** (read 2026-10-13) [cc-legal]. It now adds, after the passage #6 quoted:

  > "Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."

  It also gains a section on hosting Claude Code: "The Claude Code binary must not be modified", and each end user must "authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential". It confirms the end-user case: the restriction does not "prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription".
- **What "third-party apps" means in the 7 Oct 2026 help note** ("You can still use the Claude Agent SDK, `claude -p`, and third-party apps with your subscription limits"). The 14 May 2026 version of the same article listed what the planned credit would cover, including "Third-party apps that authenticate with your Claude subscription through the Agent SDK" [sdk-plan-may]. _Interpretation:_ the October line covers apps built on the Agent SDK. It does not cover harnesses that call Anthropic's API directly with a subscription token.
- **Usage Policy** (#6 §9): the clauses #15 relied on are unchanged in the version effective 12 Nov 2026. That version also carries, under "Do Not Abuse Our Platform":

  > "Intentionally bypass or interfere with capabilities, restrictions, or guardrails established within our products, including by circumvention of the account sign-up or log-in process or by instructing the model to produce harmful outputs (e.g., jailbreaking or prompt injection), without prior authorization from Anthropic"

  > "Access, facilitate, or provide others (including end users) with access to our products or services in violation of our Supported Regions Policy"

  And under "Do Not Engage in Deceptive Campaigns or Artificial Activity": "Create or operate fake personas, accounts, media outlets, or organizations, ... (e.g., sockpuppets, astroturfing, fake reviews, or bots that claim to be human)". [aup]

### May a Claude Pro login be served through CLIProxyAPI or new-api to a non-Anthropic harness?

**Not permitted.** The clauses:

- **Legal page:** "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications." Also "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users." And the new sentence on not collecting, storing or intermediating session tokens. [cc-legal]
- **Consumer Terms** (effective 8 Oct 2025): no access "through automated or non-human means, whether through a bot, script, or otherwise", "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it." [consumer-terms]
- **The explicit permissions on record** cover Claude Code, `claude -p`, the Agent SDK, and apps that authenticate through the Agent SDK (above). A gateway that re-serves the token to another harness is none of these.

What the gateways do (from source, read 2026-10-13) [cliproxyapi]:

- CLIProxyAPI offers "Claude Code support via OAuth login" and "Claude Code multi-account load balancing". It runs its own OAuth flow with Claude Code's public client ID and stores the resulting tokens.
- By default it disguises non-Claude-Code clients. The config comment reads: "the Claude Code CLI disguise and system prompt replacement"; "Default false keeps the per-client "auto" behavior (cloak only non-Claude-Code clients)". There is also optional "per-auth fingerprint pinning".
- new-api's own `claude` channel takes API keys. To serve a Pro login it would sit behind CLIProxyAPI. [new-api]

_Interpretation:_ the Pro route through a gateway means software outside Anthropic's flow collecting and storing session tokens, and spoofing Claude Code. That is the specific behaviour the legal page, the January safeguards and the Usage Policy's "circumvention of the ... log-in process" address. The person is the end user, not a "third-party developer offering login". But no Anthropic text permits the route, and the Consumer Terms default is a ban.

**The reverse direction is different:** Claude Code as the harness with a gateway to non-Claude models.

- It is unsupported, not banned: "Anthropic doesn't endorse, maintain, or audit third-party gateway products, and doesn't support routing Claude Code to non-Claude models through any gateway." [cc-gateway]
- Claude Code's licence is "© Anthropic PBC. All rights reserved. Use is subject to Anthropic's Commercial Terms of Service." [cc-license] The legal page says "Claude Code usage is subject to the Anthropic Usage Policy."
- _Interpretation:_ with Claude Code as the harness, Anthropic's Usage Policy arguably binds the Assistant's actions whichever model is behind it.

### Enforcement timeline (Claude subscriptions in other harnesses)

| Date | Event | Source type |
| :-- | :-- | :-- |
| 9 Jan 2026 | Anthropic's Thariq Shihipar: "tightened our safeguards against spoofing the Claude Code harness". Tools such as OpenCode lost subscription access. Some accounts auto-banned by abuse filters, then reinstated. | Staff post, reported by VentureBeat [vb-jan] |
| 19 Feb 2026 | Claude Code legal docs changed to bar OAuth in third-party tools. Anthropic called it "a docs cleanup". | Press reports only [alt-feb] |
| 4 Apr 2026 | Subscribers emailed that they would "no longer be able to use your Claude subscription limits for third-party harnesses including OpenClaw"; usage moves to paid extra usage. Boris Cherny: "subscriptions weren't built for the usage patterns of these third-party tools". The API returned: "Third-party apps now draw from your extra usage, not your plan limits." | Email and staff posts, via TechCrunch [tc-apr]; error text in a GitHub issue [gh-45048] |
| 13–14 May 2026 | Announced: from 15 June, Agent SDK, `claude -p` and Agent-SDK-based third-party apps move to a separate monthly credit. | Help article snapshot [sdk-plan-may] |
| 15 Jun 2026 | That change paused: "nothing has changed". | Help article [sdk-plan] |
| 8–9 Aug 2026 | Anthropic suspension of a user running unmodified Claude Code against GPT through CLIProxyAPI; reported reversed as a classifier false positive. | User's own report [getman-repo]; secondary account of staff replies [explainx] |
| 7 Oct 2026 | Max and Team get monthly API credits (Pro excluded). Subscription limits still cover the Agent SDK, `claude -p` and Agent-SDK-based apps. | Help article [sdk-plan], [api-credits] |

_Unverified:_ whether the 4 Apr 2026 extra-usage rule still applies to harnesses outside the Agent SDK. No reversal for them was found.

### Data (Claude Pro, consumer)

- **Training on (opt-in setting):** Anthropic "may retain your data in a de-identified format for up to 5 years in our model training pipelines".
- **Deleted chats:** "Deleted from our back-end storage systems within 30 days".
- **Flagged chats:** inputs and outputs kept "for up to 2 years and trust and safety classification scores for up to 7 years".
- These rules apply when consumer accounts "use Claude Code". [claude-retention] (page dated 1 Jul 2026)

## 6. Third-party relay endpoints ("中转") of unknown origin

**What they are.** Services that sell access to frontier models, usually OpenAI-compatible, often far below list price, and often where the upstream doesn't sell.

- CLIProxyAPI's own README carries sponsor relays advertising "Claude Code / Codex / Gemini official channels at 38% / 2% / 9% of original price", "prices as low as 7% of the official price", and "Economy mode starts at just 5% of the official price" [cliproxyapi].
- One academic paper calls them "shadow APIs": "third-party services that claim to provide access to official model services without regional limitations via indirect access" [shadow-apis].

**Legitimacy relative to upstream terms (facts, then interpretation).**

- **Pooled subscriptions breach the sharing clauses:**
  - OpenAI: "You may not share your account credentials or make your account available to anyone else", and no "lease, sell or distribute".
  - Anthropic: "You also may not make your Account available to anyone else".
  - SIWC: no "Pooling, transferring, reselling ... Authentication Tokens".
- **Resold API keys breach resale clauses:** OpenRouter "reselling API access to Models"; DeepSeek "copying, transferring, leasing, lending, selling, or sub-licensing".
- **Region evasion breaches region rules:** OpenAI's supported-countries rule; Anthropic's "Access, facilitate, or provide others ... in violation of our Supported Regions Policy".
- **Anthropic's account of the market** (23 Feb 2026): labs "use commercial proxy services which resell access to Claude and other frontier AI models at scale". "These services run what we call "hydra cluster" architectures: sprawling networks of fraudulent accounts". "In one case, a single proxy network managed more than 20,000 fraudulent accounts simultaneously, mixing distillation traffic with unrelated customer requests to make detection harder." [anthropic-distill]
- _Interpretation:_ a relay may in principle resell a cloud contract it is entitled to resell, but that can't be verified from outside. The Assistant's stance (only routes the provider's terms permit) can't be met by a route whose upstream standing is unknown. Upstream bans also make relays volatile: "By the time of writing, 4 of the 17 providers have already ceased operations" [shadow-apis].

**What a relay can see and do.**

- **Everything in plaintext:** routers "operate as application-layer proxies with full plaintext access to every in-flight JSON payload, yet no provider enforces cryptographic integrity between client and upstream model" [agent-is-mine]. For the Assistant that is the Profile, every signup email the Assistant reads (verification codes and links), Reply drafts, Dossiers, and every tool call the model returns.
- **Measured malicious behaviour:** "Across 28 paid routers purchased from Taobao, Xianyu, and Shopify-hosted storefronts and 400 free routers collected from public communities, we find 1 paid and 8 free routers actively injecting malicious code, 2 deploying adaptive evasion triggers, 17 touching researcher-owned AWS canary credentials, and 1 draining ETH from a researcher-owned private key." [agent-is-mine] (arXiv 2604.08407, 9 Apr 2026)
- **Model substitution:**
  - Audits of three shadow APIs found "performance divergence reaching up to 47.21%" and "identity verification failures in 45.83% of fingerprint tests" [shadow-apis] (arXiv 2603.01919, 2 Mar 2026).
  - A separate audit flagged "7 of 28 endpoints across six platforms as statistically inconsistent with their references" [kbf] (arXiv 2605.29524, 28 May 2026).
- _Interpretation:_ a relay that rewrites a tool call could make the Assistant's browser click a link or submit a form, or make it run a command on the VM. That reaches past the Approval and Hard-limit controls, which trust the model's output stream.

## 7. Inputs for #15 (may the Assistant submit a Registration?)

#15's current line is "the Assistant fills, the person submits". It rests on Anthropic's "Utilize automation in account creation" and "circumvent the guardrails or terms of other platforms or services" clauses. Across the plans:

| Policy | Clause on automating Registrations on other sites | Clause on acting against other sites' terms | Restricts filling? |
| :-- | :-- | :-- | :-- |
| Anthropic Usage Policy (Claude Pro; Claude via OpenRouter, Bedrock or a relay; arguably any model when Claude Code is the harness) | "Utilize automation in account creation or to engage in spammy behavior" | "Engage in actions or behaviors that circumvent the guardrails or terms of other platforms or services" | Not in its wording; #15 kept filling allowed |
| OpenAI Usage Policies and Terms of Use (ChatGPT Plus, Codex, SIWC; GPT via OpenRouter) | None. Nearest: "deceit, fraud, scams, spam, or impersonation" | None by name. Nearest: "infringes, misappropriates or violates anyone's rights" | No |
| DeepSeek Terms of Use and Open Platform Terms | None. "Do not maliciously register accounts" covers DeepSeek accounts | None by name. Nearest: "disrupt the normal order of the internet platform", "infringing on the legal rights or interests of others" | No |
| OpenRouter Terms | None of its own; flows down upstream "Model Terms" | Flows down | No |
| Relay | Unknown terms of its own; upstream policy still governs the model | Unknown | Unknown |

Facts the decision would weigh (not a decision):

- **Where #15's reason for "the person submits" comes from.** The reason was Anthropic's clause. No other provider's text has an equivalent. A route with a non-Anthropic model and a non-Anthropic harness (e.g. Codex, or OpenCode via SIWC or with DeepSeek) is not bound by that clause.
- **Things that keep Anthropic's clause in play:** Claude Code as the harness (licence plus "Claude Code usage is subject to the Anthropic Usage Policy"); OpenRouter's Auto Router or model fallbacks reaching a Claude model; any fallback to Claude.
- **Other platforms' terms remain whatever the model:**
  - GitHub-style "registered by bots or other automated methods" bans still bind the Product relationship itself. #15's Handoff for such Products rests on the Product's terms as well as Anthropic's clause.
  - _Interpretation:_ under OpenAI's "violates anyone's rights" or DeepSeek's "rights or interests of others", submitting where a Product bans bot-made accounts is arguable, not clearly allowed.
- **No provider's policy restricts filling a form.**

## 8. Open risks and items not verified

- _Unverified:_ whether a private, self-written harness may use SIWC plan usage. The docs say "open-source and locally hosted apps" and "selected private clients". The listed open-source harnesses are clearly in scope.
- _Unverified:_ whether SIWC's "storage ... not in a remote or managed environment" could be read against a cloud VM. OpenAI's Self-hosted VMs guide suggests not.
- _Unverified:_ whether OpenAI will act against Codex-client tokens used by gateways now that SIWC exists. No statement or deadline was found. The only official-staff signal (12 Jul 2026) was permissive and predates the SIWC Terms.
- _Unverified:_ server-side retention for `codex exec` requests on a ChatGPT login. Whether ChatGPT data controls apply to SIWC requests (the docs say plan use doesn't expose conversations, but say nothing on training).
- _Unverified:_ whether DeepSeek's "Improve the model for everyone" opt-out covers API calls. API retention period. DeepSeek publishes neither.
- _Unverified:_ the automation terms of third-party coding plans that carry DeepSeek models (Volcano Engine / BytePlus Ark, Baidu Qianfan, Atlas Cloud). Their docs pages returned no body text to the fetch tool. Alibaba's comparable plan forbids non-interactive use.
- _Unverified:_ whether Anthropic's 4 Apr 2026 extra-usage rule still applies to harnesses outside the Agent SDK. The exact wording of Anthropic staff replies in the August 2026 suspension case (secondary source only).
- **Region:** OpenAI and Anthropic each list supported countries, and Anthropic's Usage Policy bars access "in violation of our Supported Regions Policy". This file did not establish where the person and the VM are; that decides whether ChatGPT Plus or Claude Pro is usable at all.
- **OpenRouter host drift:** without `only`/`ignore` and `allow_fallbacks: false`, a request can land on a host in another jurisdiction with different retention.
- **The self-hosted gateway is itself a data holder.** new-api and CLIProxyAPI on the VM see all traffic and hold provider credentials. OpenAI's gateway guide: "Your gateway can see request data and both credentials."
- **Moving targets:** the subscription treatment of third-party tools changed at least five times in 2026 at Anthropic, and once (SIWC, 29 Sep 2026) at OpenAI. Re-check before committing.

## Sources

"Read" is the date fetched. Pages read from the Internet Archive give the snapshot date. Legal pages show their own effective or updated dates.

**OpenAI**
- [oa-terms]: Terms of Use, "Effective: January 1, 2026". https://openai.com/policies/row-terms-of-use/ (Internet Archive snapshot 2026-10-10)
- [oa-usage]: Usage Policies, "Effective: October 29, 2025". https://openai.com/policies/usage-policies/ (snapshot 2026-10-08)
- [oa-service-terms]: Service Terms, "Updated: September 29, 2026", §4, §14, §15. https://openai.com/policies/service-terms/ (snapshot 2026-10-06)
- [siwc-terms]: Sign in with ChatGPT Terms, dated September 29, 2026. https://openai.com/policies/sign-in-with-chatgpt-terms/ (snapshot 2026-10-07)
- [oa-siwc-help]: Using your ChatGPT plan in other apps and sites. https://help.openai.com/en/articles/20001542 (snapshot 2026-10-10, "Updated: 3 days ago")
- [siwc-partners]: Sign in with ChatGPT (partners). https://learn.chatgpt.com/docs/sign-in-with-chatgpt (read 2026-10-13)
- [siwc-docs]: Sign in with ChatGPT developer docs (quickstart, overview, self-hosted VMs, accounts and sessions, preview limitations). https://developers.openai.com/siwc/llms-full.txt (read 2026-10-13)
- [codex-auth]: Codex Authentication. https://learn.chatgpt.com/docs/auth (read 2026-10-13)
- [codex-noninteractive]: Non-interactive mode. https://learn.chatgpt.com/docs/non-interactive-mode (read 2026-10-13)
- [codex-cicd]: Maintain Codex account auth in CI/CD (advanced). https://learn.chatgpt.com/docs/auth/ci-cd-auth (read 2026-10-13)
- [codex-tokens]: Access tokens. https://learn.chatgpt.com/docs/enterprise/access-tokens (read 2026-10-13)
- [codex-gw-siwc]: Sign in with ChatGPT through a gateway. https://learn.chatgpt.com/docs/enterprise/sign-in-with-chatgpt-through-a-gateway (read 2026-10-13)
- [codex-pricing]: Codex pricing and usage limits. https://learn.chatgpt.com/docs/pricing (read 2026-10-13)
- [oa-training]: How your data is used to improve model performance. https://help.openai.com/en/articles/5722486 (snapshot 2026-10-10)
- [oa-privacy]: Privacy Policy, "Updated: February 6, 2026". https://openai.com/policies/row-privacy-policy/ (snapshot 2026-10-12)
- [oa-api-data]: Data controls in the OpenAI platform. https://developers.openai.com/api/docs/guides/your-data (read 2026-10-13)
- [oa-countries]: Supported countries and territories. https://developers.openai.com/api/docs/supported-countries (read 2026-10-13)
- [tibo-post]: Thibault Sottiaux on X, 2026-07-12 01:40 UTC. https://x.com/thsottiaux/status/2076119366647894371 (text read via the fxtwitter mirror API, 2026-10-13)
- [pi-note]: jvm/pi-mono issue #165, "Clarify legacy provider support and assess OpenAI ChatGPT migration", opened 2026-10-08. https://github.com/jvm/pi-mono/issues/165 (read 2026-10-13; project note)
- [oa-forum-ban]: OpenAI community forum, "Codex Account Just Got Banned". https://community.openai.com/t/codex-account-just-got-banned-i-have-no-idea-why-please-help/1382716 (found via search 2026-10-13; user report)

**DeepSeek**
- [ds-platform-tos]: DeepSeek Open Platform Terms of Service, released 2026-04-22, effective 2026-04-29. https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html (read 2026-10-13)
- [ds-tou]: DeepSeek Terms of Use, "Last Update: March 27, 2026". https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html (read 2026-10-13)
- [ds-privacy]: DeepSeek Privacy Policy, "Last Update: Feb 10, 2026". https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html (read 2026-10-13)
- [ds-docs]: DeepSeek API Docs, Your First API Call and Agent Integrations. https://api-docs.deepseek.com/ (read 2026-10-13)
- [ds-pricing]: Models & Pricing. https://api-docs.deepseek.com/quick_start/pricing (read 2026-10-13)
- [aliyun-coding-plan]: Alibaba Cloud Model Studio, Coding plan overview. https://help.aliyun.com/en/model-studio/coding-plan (read 2026-10-13; no update date shown)

**OpenRouter**
- [or-terms]: Terms of Service, "Last Updated: August 31, 2026". https://openrouter.ai/terms (read 2026-10-13)
- [or-privacy]: Privacy Policy, "Last Updated: August 31, 2026". https://openrouter.ai/privacy (read 2026-10-13)
- [or-data]: Data Collection. https://openrouter.ai/docs/guides/privacy/data-collection (read 2026-10-13)
- [or-provider-logging]: Provider Logging. https://openrouter.ai/docs/guides/privacy/provider-logging (read 2026-10-13)
- [or-zdr]: Zero Data Retention. https://openrouter.ai/docs/guides/features/zdr (read 2026-10-13)
- [or-logging]: Input & Output Logging. https://openrouter.ai/docs/guides/features/input-output-logging (read 2026-10-13)
- [or-routing]: Provider Routing, including "Terms of Service". https://openrouter.ai/docs/guides/routing/provider-selection (read 2026-10-13)
- [or-api]: API reference, `user` parameter. https://openrouter.ai/docs/llms-full.txt (read 2026-10-13)
- [or-endpoints]: `GET /api/v1/models/deepseek/deepseek-v4-pro/endpoints`. https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-pro/endpoints (read 2026-10-13)
- [or-providers]: `GET /api/v1/providers` (terms URLs and headquarters). https://openrouter.ai/api/v1/providers (read 2026-10-13)

**Anthropic**
- [unattended-claude]: Running the Assistant unattended with Claude Code or the Agent SDK (#6), §7 and §9. https://github.com/ultrasadness/lab1/blob/research/unattended-claude/docs/research/unattended-claude.md
- [cc-legal]: Claude Code, Legal and compliance. https://code.claude.com/docs/en/legal-and-compliance (read 2026-10-13)
- [cc-gateway]: Claude Code, Other LLM gateways. https://code.claude.com/docs/en/llm-gateway (read 2026-10-13)
- [cc-license]: Claude Code `LICENSE.md`. https://github.com/anthropics/claude-code/blob/main/LICENSE.md (read 2026-10-13)
- [commercial-terms]: Commercial Terms of Service, "Effective June 17, 2025", §D.2. https://www.anthropic.com/legal/commercial-terms (read 2026-10-13)
- [consumer-terms]: Consumer Terms of Service, effective 2025-10-08. https://www.anthropic.com/legal/consumer-terms (read 2026-10-13)
- [aup]: Usage Policy, "Effective November 12, 2026" (previous version in force until then). https://www.anthropic.com/legal/aup (read 2026-10-13)
- [sdk-plan]: Use the Claude Agent SDK with your Claude plan, notes of 2026-06-15 and 2026-10-07. https://support.claude.com/en/articles/15036540 (read 2026-10-13; snapshot 2026-10-10)
- [sdk-plan-may]: The same article as published 2026-05-14 (Internet Archive snapshot 20260514002546)
- [api-credits]: Monthly API credits for Max and Team plans. https://support.claude.com/en/articles/17154008 (cited via #6)
- [claude-retention]: How long do you store my data? https://privacy.claude.com/en/articles/10023548-how-long-do-you-store-my-data (read 2026-10-13; page dated 2026-07-01)
- [anthropic-distill]: Detecting and preventing distillation attacks, 2026-02-23. https://www.anthropic.com/news/detecting-and-preventing-distillation-attacks (read 2026-10-13)
- [gh-45048]: anthropics/claude-code issue #45048, opened 2026-04-08 (API error text). https://github.com/anthropics/claude-code/issues/45048 (read 2026-10-13)

**Reports (secondary; dates as published)**
- [vb-jan]: VentureBeat, "Anthropic cracks down on unauthorized Claude usage by third-party harnesses and rivals", 2026-01-09. https://venturebeat.com/ai/anthropic-cracks-down-on-unauthorized-claude-usage-by-third-party-harnesses/
- [alt-feb]: AlternativeTo, "Anthropic officially bans using subscription authentication for third-party Claude use", 2026-02-20. https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use
- [tc-apr]: TechCrunch, "Anthropic says Claude Code subscribers will need to pay extra for OpenClaw usage", 2026-04-04. https://techcrunch.com/2026/04/04/anthropic-says-claude-code-subscribers-will-need-to-pay-extra-for-openclaw-support/
- [getman-repo]: alexgetmancom/claude-proxy README (suspension warning), 2026-08-08. https://github.com/alexgetmancom/claude-proxy
- [getman-post]: Alex Getman on X, 2026-08-08. https://x.com/alexgetmancom/status/2086092971024253117 (via fxtwitter mirror)
- [explainx]: explainx.ai, account of the August 2026 suspension and staff replies, 2026-08-09. https://www.explainx.ai/blog/tibo-boris-claude-proxy-suspension-harness-freedom-august-2026

**Gateways (source code, read 2026-10-13)**
- [new-api]: QuantumNous/new-api, `README.md` notice, `relay/channel/codex/adaptor.go`, `service/codex_oauth.go`, `relay/channel/claude/`. https://github.com/QuantumNous/new-api
- [cliproxyapi]: router-for-me/CLIProxyAPI, `README.md`, `config.example.yaml` (cloaking options), `internal/auth/codex/openai_auth.go`, `internal/auth/claude/anthropic_auth.go`, `internal/runtime/executor/claude_executor_cloaking.go`. https://github.com/router-for-me/CLIProxyAPI

**Research on relays**
- [agent-is-mine]: Liu et al., "Your Agent Is Mine: Measuring Malicious Intermediary Attacks on the LLM Supply Chain", arXiv 2604.08407, 2026-04-09. https://arxiv.org/abs/2604.08407
- [shadow-apis]: "Real Money, Fake Models: Deceptive Model Claims in Shadow APIs", arXiv 2603.01919, 2026-03-02. https://arxiv.org/abs/2603.01919
- [kbf]: "KBF: Knowledge Boundary as Fingerprint for Language Model and Black-Box API Auditing", arXiv 2605.29524, 2026-05-28. https://arxiv.org/abs/2605.29524
