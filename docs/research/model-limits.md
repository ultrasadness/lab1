# Limits and prices of the model routes, Product Hunt and Gmail at the Assistant's volume

Research for ticket #36 on the map (#1). It answers: what usage limits, prices and rate limits apply to each route the Assistant uses, and what happens at each limit? It then checks those facts against the ticket's expected volume. It feeds [What may each kind of run spend, and what happens when a budget runs out?](https://github.com/ultrasadness/lab1/issues/39), which decides the budgets. This file sets none.

- **Researched:** 2026-10-16, from the providers' own pricing pages, docs and help centres, OpenRouter's own API and model pages, and the source code of new-api, CLIProxyAPI (CPA) and OpenAI's Codex client. Each source is listed at the end with the date read.
- **Quotes vs inference:** passages in quotation marks are verbatim. Anything marked _Interpretation_, _Assumption_ or _Unverified_ is mine, not the source's.
- **Routes covered:** ChatGPT Plus through CPA, OpenRouter, DeepSeek's direct API, the Shanghai AI Lab endpoint, the new-api gateway in front of all of them, plus the Product Hunt and Gmail APIs.
- **Role constraints already decided:** the mail and conversation roles use only ChatGPT Plus through CPA and OpenRouter with `data_collection: "deny"` ([ADR 0010](https://github.com/ultrasadness/lab1/blob/main/docs/adr/0010-mail-text-reaches-only-mail-cleared-roles-on-routes-that-dont-train.md)). No role that prepares a Registration maps to a Claude model ([ADR 0005](https://github.com/ultrasadness/lab1/blob/main/docs/adr/0005-plain-code-submits-a-registration-after-a-page-check.md)). The Miner may use any provider.

## Answer in brief

1. **ChatGPT Plus through CPA: OpenAI publishes estimates per five hours and no weekly figure.**
   - Plus costs $20 a month. Usage counts against a five-hour window and a weekly window at once, and "you need allowance remaining in both to continue" (help article, quoted from search excerpts because the page blocks automated reads).
   - The five-hour estimates for Plus, in "local messages", are: GPT-6.1 Sol 15–160, GPT-6 Sol 15–150, GPT-6 Luna 350–3,000 and GPT-6 Astra 5–45. "These estimates are not fixed message limits." The weekly limit is only "Weekly limits may also apply", with no number.
   - Usage depends on "model choice, context, reasoning, tool use, retrieval, and caching". Fast mode uses included usage at 2.5×.
   - **At the limit:** OpenAI's backend answers HTTP 429 with `error.type: "usage_limit_reached"` and a reset time. CPA then cools the whole credential until that time, and answers every request with 429 `model_cooldown` and a `Retry-After` header in seconds. new-api passes the 429 on, and by default doesn't try another channel.
2. **OpenRouter: each candidate model has a list price, OpenRouter adds no markup on inference, and free variants are capped by request count.**
   - **Free variants:** 20 requests a minute and 50 a day, or 1,000 a day once at least 10 credits have been bought.
   - **Under `data_collection: "deny"`:** DeepSeek's own endpoint drops out of both DeepSeek models, because OpenRouter marks it `training: true`. Every other endpoint of the 13 candidate models stays. Of the 14 free variants that support tools, 10 drop out and 4 remain.
   - **Errors:** an account without enough credit gets HTTP 402, and a platform rate limit gets HTTP 429.
3. **DeepSeek's direct API: two models, an off-peak half price, and a concurrency limit only.**
   - **Prices per 1M tokens, peak:** `deepseek-flash` (V4.1 Flash) costs $0.30 input on a cache miss and $1.20 output. `deepseek-v4-pro` (V4-Pro-0813) costs $1.32 and $3.96. "Off-peak rates are half of the peak rates."
   - **Peak hours:** "01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public holidays". The Miner's 01:00 Pacific start is 08:00 or 09:00 UTC, inside a weekday peak window.
   - **Limits:** 2,500 (Flash) and 500 (Pro) concurrent requests per account, with HTTP 429 beyond them. HTTP 402 means the balance has run out.
4. **The Shanghai AI Lab endpoint: the lab's public Intern API publishes only a default rate limit.** Its docs say "By default, each user is limited to 30 requests per minute". Per-account RPM, TPM and monthly input and output token caps show only to a signed-in user. Its console text disagrees with the docs (10 or 50 RPM, 5,000 TPM). No prices are published. _Unverified:_ that this is the person's endpoint, because the repo doesn't record its URL.
5. **new-api: a key's quota is a lifetime pool of notional dollars, with 500,000 quota units to $1 and no reset.**
   - **Charging:** each request is charged after it finishes as (input + output × completion ratio, with cache adjustments) × model ratio × group ratio, using ratios the admin sets. Plus traffic is charged the same way.
   - **Reservation:** while a key has more than $10 left, nothing is reserved up front. Below that, the estimated input cost is reserved. The final charge can take a key below zero.
   - **What a client sees:** HTTP 403 `pre_consume_token_quota_failed` when the reservation doesn't fit, then HTTP 401 "Invalid token" once the remaining quota is 0 or less.
6. **Product Hunt API v2: 6,250 complexity points per 15 minutes per application, with HTTP 429 beyond them.** The token ticket (#20) measured a flat 100 points per request, which is about 62 requests per window. A day costs 1–3 requests.
7. **Gmail API: 6,000 quota units per minute per user and 1,200,000 per minute per project.**
   - **Costs per call:** `history.list` 2, `messages.get` 20, `drafts.create` 10, `drafts.delete` 10, `drafts.get` 20, `drafts.list` 5, `drafts.send` 100, `drafts.update` 15.
   - **Daily threshold:** a project may use 80,000,000 units a day before charges, which Google says it plans to bring in "later in 2026" with at least 90 days' notice.
8. **Rough fit at the ticket's volume** (run sizes are assumptions; see §8):
   - **Paid per-token routes** carry it for about $0.44 to $91 a week, depending on the model and the run sizes.
   - **OpenRouter's free variants** carry it by request count only after the 10-credit purchase.
   - **Plus:** the daily Miner batch fits one five-hour estimate. Whether a full week fits can't be established, because OpenAI publishes no weekly figure.
   - **Shanghai AI Lab:** its per-minute limit is no obstacle, but its monthly caps are unknown.
   - **Product Hunt and Gmail:** at most about 14% of Product Hunt's 15-minute window (a 3-day catch-up) and about 5% of Gmail's per-minute quota in a busy minute.

## 1. Summary table

| Route | Price | Limit | Window | What a client sees at the limit |
| :-- | :-- | :-- | :-- | :-- |
| ChatGPT Plus through CPA | $20/month flat; extra ChatGPT credits purchasable (price not published) | Estimates only: GPT-6.1 Sol 15–160, GPT-6 Luna 350–3,000 local messages per five hours; weekly limit unpublished | Five-hour window from the first message after the last one ended, plus a weekly window | OpenAI: 429 `usage_limit_reached`, `resets_at`. CPA: 429 `model_cooldown`, `Retry-After`. new-api: passes the status and message on |
| OpenRouter, paid models | Provider list price, no inference markup; fee on credit purchases | No platform request cap on paid variants; upstream providers may rate-limit | None | 402 at zero credit or an exhausted key limit; 429 from an upstream provider after OpenRouter's own fallbacks |
| OpenRouter, free variants (`:free`) | $0 | 20 req/min; 50 req/day, or 1,000 req/day with ≥10 credits bought | Per minute; per UTC day | 429 `rate_limit_exceeded`, with `X-RateLimit-*` headers |
| DeepSeek direct API | Per 1M tokens (§4); off-peak half price | Concurrency: 2,500 (`deepseek-flash`), 500 (`deepseek-v4-pro`) per account | Concurrent requests | 429 above concurrency; 402 "Insufficient Balance" |
| Shanghai AI Lab (Intern API) | None published | Docs: 30 req/min per user by default; per-account RPM, TPM, monthly input and output tokens | Per minute; per month | Error code -20053 "Exceeded frequency limit (req/min or tokens/min)" |
| new-api key quota | Notional; set by the admin's ratios | The key's `remain_quota` | Lifetime, no reset | 403 `pre_consume_token_quota_failed`, then 401 "Invalid token" |
| Product Hunt API v2 | Free for non-commercial use | 6,250 complexity points | 15 minutes, per application | 429 until reset; `X-Rate-Limit-Reset` |
| Gmail API | No charge below thresholds | 6,000 units/min per user; 1,200,000/min per project; 80M/day per project before charges | Per minute; per day | 403 `userRateLimitExceeded` or `rateLimitExceeded`; 429 for concurrency, bandwidth or sending |

## 2. ChatGPT Plus through CPA

### Limits and how they are counted

**Codex pricing page** [codex-pricing] (no date on the page; read 2026-10-16). It also covers ChatGPT Work: "ChatGPT Work and Codex share usage."

- **Plus plan:** "$20 /month", "Power a few focused coding sessions each week", "GPT-6.1 Sol and GPT-6 Luna", "Flexibly extend usage with ChatGPT credits".
- **Five-hour estimates:** "The estimates below show local messages per five-hour period for Plus and Standard Business." The Plus column reads:

  | Model | Local messages per five hours (Plus) |
  | :-- | :-- |
  | GPT-6 Astra | 5–45 |
  | GPT-6.1 Sol | 15–160 |
  | GPT-6 Sol | 15–150 |
  | GPT-6 Luna | 350–3,000 |

- "These estimates are not fixed message limits; check your usage dashboard for current limits and reset times."
- **Weekly:** "Local messages and cloud chats share your plan's usage allowance. Weekly limits may also apply." No weekly number is published.
- **What counts:** "The number of messages you can send depends on the model used, size and complexity of your tasks, and whether you run them locally or in the cloud." Also: "Model choice, context, reasoning, tool use, retrieval, and caching all affect usage, so prompt length alone isn't a reliable estimate."
- **Speed modes:** Fast mode uses "2.5x" of included subscription usage (and 2× purchased credits).
- **Credit rates** ("Standard speed, quoted in credits per million input tokens, cached input tokens, and output tokens"): GPT-6.1 Sol 50 / 2.5 / 250, GPT-6 Sol 50 / 5 / 250, GPT-6 Luna 2.5 / 0.25 / 12.5, GPT-6 Astra 250 / 25 / 1,250. "A typical GPT-5.6 Sol task may use 2-15 credits." "Credit prices alone don't determine included subscription usage; check your usage dashboard for current limits."
- **Credits:** "ChatGPT Plus and Pro users who reach their usage limit can purchase additional credits to continue working without needing to upgrade their existing plan." "Credit purchase prices and applicable discounts depend on your plan or agreement." No price for Plus appears on any OpenAI page found. Forum posts mention $40 per 1,000 credits, but that is unverified.
- **Retired model:** "GPT-5.5 retires from Codex with ChatGPT sign-in on October 14, 2026, at noon PDT (19:00 UTC)."

**Help article "Managing usage with GPT-6 Astra in Work and Codex"** [oa-astra-help]. The page returned HTTP 403 to automated fetches on 2026-10-16, and the Internet Archive has no snapshot. The passages below are from search-engine excerpts of the page on 2026-10-16, not a direct read:

- "Depending on your plan, usage limits may apply over a five-hour window and a weekly window. Where both apply, you need allowance remaining in both to continue."
- The five-hour window starts with the first message in Work or Codex after the previous window ends. "You may reach the five-hour limit before five hours have passed, even if you still have weekly usage remaining."
- "Check Settings → Usage for your current allowance and reset times."
- "Purchased instant resets are available to eligible personal ChatGPT Plus and Pro accounts, depending on your account and billing country." A reset refreshes both windows.

**Shared allowance.** The Sign in with ChatGPT docs say: "For ChatGPT Plus users, the five-hour usage limit is shared across all apps where they use their ChatGPT plan, including private and open-source clients" (quoted in the provider-terms research [provider-terms], read 2026-10-13). _Interpretation:_ if CPA signs in to the same ChatGPT account the person uses for Codex or ChatGPT Work, the Assistant and the person draw from one allowance. ADR 0001 says CPA holds "its own ChatGPT Plus login", but not whether that is a separate account.

### What a client sees at the limit, layer by layer

1. **OpenAI's Codex backend** (from OpenAI's own Codex client, `openai/codex` at `0df4aa6`, 2026-10-16) [codex-src]:
   - A limit hit is HTTP 429 with `error.type` = `"usage_limit_reached"`, plus `plan_type`, `resets_at` (Unix seconds) and `limit_window_minutes` (`codex-rs/codex-api/src/api_bridge.rs`).
   - Normal responses carry `x-codex-primary-used-percent`, `-primary-window-minutes` and `-primary-reset-at`, and the same three for `secondary` (`rate_limits.rs`). Codex's own tests use 300 and 10,080 minutes as example window lengths (`api_bridge_tests.rs`). _Interpretation:_ these are the five-hour and weekly windows. The code reads the lengths from the server, so they are not fixed in the client.
   - The Codex CLI shows a Plus user: "You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits", followed by when to try again (`protocol/src/error.rs`).
   - The pricing page adds: "If you reach your usage limits during an active turn, the agent will be able to continue working on that turn, subject to fair use limits." _Unverified:_ what a "turn" means for requests that arrive through CPA, where each model call is a separate request.
2. **CPA** (`router-for-me/CLIProxyAPI` `main` at `e7003d2`, 2026-10-16; latest release v8.0.31) [cpa-src]:
   - `usage_limit_reached` maps to HTTP 429, and the credential is cooled until `resets_at` (or `resets_in_seconds`). "Transient per-minute rate limits (rate_limit_error/rate_limit_exceeded) are intentionally excluded, as they should be retried rather than cooled down." (`internal/runtime/executor/codex_executor_terminal.go`)
   - **Scope:** by default the cooldown covers the whole credential, across all models. `model-level-cooling: true` would "scope Codex usage_limit_reached quota cooldowns to the requested model rather than cooling down the entire credential across all sibling models. Default: false" (`config.example.yaml`).
   - **While cooling**, CPA answers HTTP 429 with a `Retry-After` header in seconds and the body `{"error":{"code":"model_cooldown","message":"All credentials for model <m> are cooling down …","reset_time":…,"reset_seconds":…}}` (`sdk/cliproxy/auth/selector.go`).
   - **Retries:** CPA retries 403, 408, 429, 500, 502, 503 and 504 across credentials, and waits a limited time for a cooldown to end. The example config sets `request-retry: 3` and `max-retry-interval: 30` seconds. With one Plus credential and a reset hours away, the 429 goes straight back to new-api.
3. **new-api** (`QuantumNous/new-api` `main` at `09109ec`, 2026-10-16; the same lines checked at release `v1.0.0-rc.44`) [newapi-src]:
   - An upstream error keeps its status code, and its body becomes an OpenAI-format error (`service/error.go`).
   - **Retrying another channel:** this happens only if `RetryTimes` is above 0, and its default is 0 (`common/constants.go`). When it is above 0, 429 is in the default retry ranges (which include 409–499), so the request moves to another channel the key's group allows (`setting/operation_setting/status_code_ranges.go`, `service/relay_error.go`).
   - **Disabling the channel:** automatic disabling is off by default (`AutomaticDisableChannelEnabled = false`). Even when it is on, it triggers only on status 401 or on keywords such as "You exceeded your current quota", and neither matches CPA's 429.
   - These are code defaults. _Unverified:_ the settings on the person's install.

## 3. OpenRouter

### Model prices, and which endpoints survive `data_collection: "deny"`

**How the candidates were chosen** (mine, not a recommendation): for each family the person's plans already touch (OpenAI GPT, DeepSeek), and for the other large families on OpenRouter (Anthropic, Google, Qwen, Moonshot, Z.ai, MiniMax, Xiaomi), I took the newest general model with tool calling, plus a cheaper tier where the family has one.

**Where the data comes from:** prices are per endpoint, from the endpoint records OpenRouter embeds in each model's providers page (`https://openrouter.ai/<model>/providers`) [or-model-pages]. The "training" and "retains prompts" flags come from the same records (`data_policy`). All of it was read on 2026-10-16. Prices are USD per 1M tokens, and ranges run across the endpoints that pass `deny`.

| OpenRouter model | Endpoints passing / all | Input | Output | Cache read | Model owner's own endpoint | Roles open to it under the ADRs |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `openai/gpt-6.1-sol` | 8 / 8 (OpenAI, Azure, Bedrock; all US) | 1.00–12.00 | 5.00–60.00 | 0.05–0.60 | OpenAI standard 2.00 / 10.00 / 0.10; flex 1.00 / 5.00; fast 4.00 / 20.00; ultrafast 12.00 / 60.00 | All four |
| `openai/gpt-6-luna` | 7 / 7 (OpenAI, Azure, Bedrock; US) | 0.05–0.20 | 0.25–1.00 | 0.005–0.02 | OpenAI standard 0.10 / 0.50 / 0.01 | All four |
| `deepseek/deepseek-v4-pro-0813` | 22 / 23 (20 hosts; endpoints by headquarters: 15 US, 3 SG, 2 CN, 1 ID, 1 not stated) | 0.25–1.65 | 0.75–5.00 | 0.008–0.25 | DeepSeek 0.66 / 1.98 / 0.022: **excluded** (`training: true`) | All four, through other hosts |
| `deepseek/deepseek-v4.1-flash` | 34 / 35 (29 hosts, mostly US) | 0.036–0.60 | 0.18–2.40 | 0.002–0.06 | DeepSeek 0.15 / 0.60 / 0.003: **excluded** (`training: true`) | All four, through other hosts |
| `qwen/qwen3.8-flash` | 2 / 2 (Alibaba Cloud Int., SG) | 0.15 | 0.47 | 0.016 | Same | All four |
| `qwen/qwen3.7-plus` | 2 / 2 (Alibaba Cloud Int., SG) | 0.32 | 1.28 | 0.064 | Same | All four |
| `moonshotai/kimi-k3` | 25 / 25 (20 hosts) | 0.29–4.50 | 8.25–28.00 | 0.165–1.20 | Moonshot 3.00 / 15.00 / 0.30 | All four |
| `z-ai/glm-5.3` | 46 / 46 (38 hosts, 8 countries) | 0.06–2.80 | 1.51–8.80 | 0.057–0.56 | Z.ai 1.40 / 4.40 / 0.26 | All four |
| `minimax/minimax-m3` | 14 / 14 (13 hosts) | 0.22–0.60 | 0.88–2.40 | 0.045–0.06 | MiniMax 0.30 / 1.20 / 0.06 | All four |
| `xiaomi/mimo-v2.6-pro` | 4 / 4 (3 US, 1 CN) | 0.43–0.435 | 0.87 | 0.0036–0.004 | Xiaomi 0.435 / 0.87 / 0.0036 | All four |
| `google/gemini-3.8-flash` | 7 / 7 (Google AI Studio, Vertex) | 0.375–1.35 | 1.875–6.75 | 0.0375–0.135 | AI Studio standard 0.75 / 3.75 (shown with a 50% discount flag) | All four |
| `anthropic/claude-haiku-5.5` | 10 / 10 (Anthropic, Bedrock, Vertex, Azure, Claude on AWS) | 0.10–0.11 | 0.50–0.55 | 0.01–0.011 | Anthropic 0.10 / 0.50 / 0.01 | Miner, mail, conversation; **not** Registration preparation (ADR 0005) |
| `anthropic/claude-sonnet-5.5` | 8 / 8 (same hosts) | 2.00–2.20 | 10.00–11.00 | 0.10–0.11 | Anthropic 2.00 / 10.00 / 0.10 | Miner, mail, conversation; **not** Registration preparation |

Notes on the table:

- **Discounts:** some endpoint prices carry a `discount` field and already include it: Baidu Qianfan 81%, StreamLake 50%, GMICloud 20–40%, NovitaAI 25–50% and others on the DeepSeek, GLM and MiniMax models. _Interpretation:_ these are temporary promotions, so the low end of a range may not last.
- **DeepSeek naming:** OpenRouter's `deepseek/deepseek-v4-pro` slug (no date) serves "DeepSeek V4 Pro 0423". The model DeepSeek's own API now calls `deepseek-v4-pro` is V4-Pro-0813, which OpenRouter lists as `deepseek/deepseek-v4-pro-0813`.
- **Observation, unverified:** DeepSeek's own endpoint on OpenRouter showed $0.66 / $1.98 for V4-Pro-0813 and $0.15 / $0.60 for V4.1 Flash. Those are DeepSeek's off-peak list prices, and I read them during off-peak hours (Friday, about 17:00 UTC). Whether OpenRouter switches to the peak price wasn't checked.
- **Retention:** many endpoints that pass are still marked `retainsPrompts: true`, for example every Alibaba endpoint and OpenAI's own. ADR 0010 allows retention for abuse monitoring.

**Free variants (`:free`).** OpenRouter lists 14 free variants that support tools. On 2026-10-16:

- **Pass `deny` (4):** `google/gemma-4-26b-a4b-it:free` and `google/gemma-4-31b-it:free` (Google AI Studio), `cohere/north-mini-code:free` (Cohere) and `dots-studio/dots-3-note-preview:free` (AtlasCloud). All four are marked `retainsPrompts: true`.
- **Drop out (10):** each has a single endpoint marked `training: true`. They are five NVIDIA Nemotron variants (three of them showed a non-zero `status`), Thinking Machines `inkling` and `inkling-small`, Poolside `laguna-s-2.1` and `laguna-xs-2.1`, and Liquid `lfm-2.5-2.6b`.

### What `deny` filters on: the docs disagree

- **The Provider Routing guide** [or-routing] describes the field as "Control whether to use providers that may store data". Under it, `allow` means "allow providers which store user data non-transiently and may train on it", and `deny` means "use only providers which do not collect user data".
- **The Provider Logging guide** [or-provider-logging] says: "If you opt out of training in your account settings, OpenRouter will not route to providers that train." It also says: "OpenRouter does not have routing rules that change based on data retention policies of providers".
- **The endpoint records** keep the two apart: `training` and `retainsPrompts`.
- **What I counted:** the counts above treat `training: false` as passing `deny`. _Unverified:_ whether `deny` also drops `retainsPrompts: true` endpoints. Settling it needs an authenticated call to `GET /api/v1/models/user`, which lists models after the account's privacy filters, or one test request per model with `allow_fallbacks: false`.

### Limits and errors

From the API limits page [or-limits], read 2026-10-16. The table's values are template variables, read from the page source: `FREE_MODEL_RATE_LIMIT_RPM=20`, `FREE_MODEL_NO_CREDITS_RPD=50`, `FREE_MODEL_HAS_CREDITS_RPD=1e3`, `FREE_MODEL_CREDITS_THRESHOLD=10`.

- **Free variants:**

  | Credits purchased (all time) | Requests per minute | Requests per day |
  | :-- | :-- | :-- |
  | Less than 10 | 20 | 50 |
  | At least 10 | 20 | 1,000 |

  "The `limit` tier is selected by all-time credits purchased." The higher ceiling starts "one credit below the table's threshold (currently 9 credits)". Days are UTC.
- **Paid variants:** switching to the paid variant gives "no platform-level request cap". An upstream provider's own 429 is retried on other providers "automatically before the error reaches you".
- **Errors:**
  - Platform limits return 429 `{"error":{"code":429,"message":"Rate limit exceeded","metadata":{"error_type":"rate_limit_exceeded"}}}` with `X-RateLimit-Limit`, `-Remaining` and `-Reset`. A mid-stream limit arrives as an SSE event with `finish_reason: "error"`.
  - Credit limits return 402, with `metadata.limit_source` set to `openrouter_credits`, `openrouter_key_limit` or `openrouter_in_flight_budget`. "If your account has a negative credit balance, you may see 402 errors, including for free models."
  - Guardrail and workspace budgets (daily, weekly or monthly, reset at 00:00 UTC) return 403 with `resets_at`. An exhausted per-key credit limit (`openrouter_key_limit`) is described under both the 402 and the 403 sections of the same page.
- **In-flight budget:** for some prepaid accounts, the estimated cost of running requests can't exceed "a fraction of your current credit balance". Low balances and newer accounts are the ones affected.
- **Fees:** "We pass through the pricing of the underlying providers; there is no markup on inference pricing (however we do charge a fee when purchasing credits)" [or-faq]. The fee's percentage didn't render on the page, so it is not established here.

## 4. DeepSeek direct API

From Models & Pricing [ds-pricing], read 2026-10-16 (no date on the page):

| | `deepseek-flash` (DeepSeek-V4.1-Flash) | `deepseek-v4-pro` (DeepSeek-V4-Pro-0813) |
| :-- | :-- | :-- |
| Context / max output | 1M / 384K | 1M / 384K |
| Input, cache hit (peak / off-peak) | $0.006 / $0.003 | $0.044 / $0.022 |
| Input, cache miss (peak / off-peak) | $0.30 / $0.15 | $1.32 / $0.66 |
| Output (peak / off-peak) | $1.20 / $0.60 | $3.96 / $1.98 |
| Concurrency limit | 2,500 | 500 |

- **Off-peak:** "Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public holidays. All other hours are off-peak, including weekends and Chinese public holidays in full."
  - _Interpretation:_ the Miner starts at 01:00 Pacific (#9), which is 08:00 UTC in summer time and 09:00 UTC in winter time. Weekday Miner runs on DeepSeek therefore start in a peak window and pay full price until 10:00 UTC. Weekend runs are off-peak.
- **Legacy names:** "The legacy names deepseek-v4-flash and deepseek-v4-flash-vision-exp are still accepted, but the corresponding models have been retired, their requests are served by the DeepSeek-V4.1-Flash model and billed at the Flash price."
- **Billing:** "the expense = number of tokens × price", deducted from the topped-up balance, with any granted balance used first. "DeepSeek reserves the right to adjust them."

From Rate Limit & Isolation [ds-rate] and Error Codes [ds-errors], read 2026-10-16:

- **Concurrency is the only limit:**
  - "A request counts as one concurrent connection from the time it is sent until the model response is complete."
  - "Concurrency limits are calculated at the account level, regardless of which API Key is used."
  - "when the concurrency limit is exceeded, you will receive an HTTP 429 error code."
  - Higher concurrency can be requested, and "There is no additional cost for capacity expansion."
- **Slow starts:** while a request waits, the server sends empty lines (non-streaming) or `: keep-alive` comments (streaming). "If the request has not started inference after 10 minutes, the server will close the connection."
- **Errors:**
  - 402: "Insufficient Balance. Cause: You have run out of balance."
  - 429: "Rate Limit Reached. Cause: You are sending requests too quickly, or have exceeded a concurrency or QPS limit."
  - 503: "Server Overloaded".

## 5. The Shanghai AI Lab endpoint

The repo describes it only as "the Shanghai AI Lab endpoint (probably its own copies of open-weight models; no written terms)" (#8). Nothing in the repo or the issues records its URL, and this research didn't look in new-api's database, which holds provider keys. The lab's public API is the **Intern API** (书生 API), at `https://chat.intern-ai.org.cn/api/v1/chat/completions`, and it serves the lab's own Intern models. _Unverified:_ that this is the person's endpoint.

What the Intern API publishes, read 2026-10-16:

- **Docs, Chat Completions page** [intern-chat-doc]: "API Rate Limit: By default, each user is limited to 30 requests per minute. If you require a higher request limit, you can apply for an upgraded rate limit configuration at Rate Limiting Policy." The Chinese page says the same: "默认每用户 每分钟限制30次".
- **The error at the limit:** "-20053 Exceeded frequency limit (req/min or tokens/min)". No HTTP status is documented for it. Other codes are -20004 "非白名单用户" (not a whitelisted user) and A0211 "Token expired".
- **The console's Rate Limiting Policy page** [intern-console] shows a per-account table after sign-in. Its text names four limits:
  - "RPM (requests per minute)";
  - "TPM (tokens per minute): The number of tokens generated by the model per minute";
  - "Input Tokens per Month";
  - "Output Tokens per Month".

  It then shows "Your current API rate-limiting policy is:". The numbers are per account and weren't visible without signing in.
- **A contradiction in the console:** the form for requesting higher limits says "The default TPM for InternLM ChatAPI is 5000" and "The default RPM for InternLM ChatAPI is 10". A second Chinese string set in the same bundle says "浦语 ChatAPI 默认 RPM 为 50". Both disagree with the docs' 30 per minute.
- **Other published facts:** the API "is currently in public testing", with "an application review system". "All API Tokens are valid for 6 months." Models include `intern-s2`, `intern-s1-pro`, `intern-s1` and `intern-s1-mini` [intern-models]. "Intern-S2-Preview-397B will be decommissioned on October 31, 2026."
- **Prices:** none are published anywhere in the docs or the console text.

## 6. new-api: how a key's quota is counted and what a client sees when it runs out

From `QuantumNous/new-api` `main` at `09109ec` (2026-10-16). The key lines are identical at release `v1.0.0-rc.44` (2026-10-12), the newest release. The VM runs rc.22, due to be upgraded to "a pinned newer version" (#8) [newapi-src].

**The unit.**

- `QuotaPerUnit = 500 * 1000.0 // $0.002 / 1K tokens` (`common/constants.go`). So $1 is 500,000 quota units.
- A model ratio of 1 means "$0.002 / 1K tokens", which is $2 per 1M input tokens (`setting/ratio_setting/model_ratio.go`).
- The repo ships default ratios for `gpt-5.6-*`, but not for the GPT-6 models. A model with no ratio fails with "Model {{.Model}} has not been priced by the administrator yet", unless the admin turns on self-use mode.

**The charge for each request** (`service/text_quota.go`), computed after the response:

> `promptQuota := baseTokens.Add(cachedTokensWithRatio)…`; `completionQuota := dCompletionTokens.Mul(dCompletionRatio)`; `quotaCalculateDecimal := promptQuota.Add(completionQuota).Mul(ratio)`, where `ratio := dModelRatio.Mul(dGroupRatio)`

- In words: (uncached input + cached input × cache ratio + output × completion ratio) × model ratio × group ratio. A per-request price (`ModelPrice × QuotaPerUnit × group ratio`) replaces this when the admin prices a model per call.
- _Interpretation:_ the charge for traffic through the CPA channel is whatever ratio the admin sets, even though Plus is a flat fee. The quota is a notional spend cap, not the plan's real allowance.

**Reservation before the request** (`service/billing_session.go`, `relay/helper/price.go`, `setting/operation_setting/quota_setting.go`):

- **Trust bypass:** if the key has more than `TrustQuotaUSD` left (default **$10**) and so does the user's wallet, "trusted without pre-consume": nothing is reserved.
- **Otherwise:** new-api reserves the estimated prompt tokens × `PreConsumeMultiplier` (default **1**) × model ratio × group ratio. Output isn't reserved.
- The reservation is atomic: "检查与扣减在同一操作中完成，并发请求不可能同时通过检查后超扣" (check and deduct are one operation, so concurrent requests can't both pass the check and overspend).

**Settlement** (`service/quota.go`, `model/token.go`): the final charge runs `remain_quota - ?` with no floor. The last request can take a key below zero, and that request still completes.

**No reset.** A key has `RemainQuota`, `UsedQuota`, `UnlimitedQuota` and `ExpiredTime`, but no reset period (`model/token.go`). Reset periods (`never`, `daily`, `weekly`, `monthly`, `custom`) exist only on user-level subscription plans (`model/subscription.go`). _Interpretation:_ a daily or weekly budget per key would need something outside new-api to top the key up or reset it.

**What a client sees when a key runs out:**

| When | HTTP | Body |
| :-- | :-- | :-- |
| The reservation doesn't fit the key's remaining quota | 403 | OpenAI-format error, code `pre_consume_token_quota_failed`, message "token quota is not enough, token remain quota: …, need quota: …". It isn't retried on another channel (`ErrOptionWithSkipRetry`) |
| The user's wallet can't cover the reservation | 403 | code `insufficient_user_quota`, "Insufficient user quota, remaining quota: …" |
| The key's `remain_quota` is already 0 or less (also expired or disabled keys) | 401 | `{"error":{"message":"Invalid token …","type":"new_api_error","code":""}}`. Without Redis, the key's status also becomes "exhausted" (4) |

_Interpretation:_ to Pi, an exhausted key looks the same as a wrong key (401 "Invalid token"). Only a 403 names the quota. The sequence is:

1. While a key has more than $10 left, requests run with no reservation.
2. Below $10, each request reserves its estimated input cost. One whose estimate is more than what's left gets the 403.
3. One that fits runs and is charged in full, which can take the key to zero or below.
4. After that, every request gets the 401.

## 7. Product Hunt API v2 and Gmail API

### Product Hunt

From the rate-limit docs [ph-rate] (undated; read 2026-10-16):

- "The application has quota of 6250 complexity points for every 15 minutes." "Complexity of each request is calculated based on the fields requested." Other `/v2/*` endpoints allow 450 requests per 15 minutes.
- "Rate limiting is applied per application." Over the limit, "the API will return status 429 (Too Many Requests) until the rate limiting period is reset."
- Response headers: `X-Rate-Limit-Limit`, `X-Rate-Limit-Remaining`, and `X-Rate-Limit-Reset` ("Seconds until the rate limit is reset"). "We may on occasion adjust the rate limit depending on API traffic."
- The page's example for a non-GraphQL endpoint shows `X-Rate-Limit-Limit: 900`, which doesn't match the stated 450. This doesn't affect GraphQL.
- **Measured from the VM on 2026-10-14** (#20): every request cost a flat 100 points "whatever the fields or page size", so about 62 requests fit a window. Pages cap at 20 Launches, so a day's Featured Launches take 1–3 requests.

### Gmail

From Usage limits [gmail-quota] ("Last updated 2026-09-10 UTC"; read 2026-10-16):

| Limit | Value |
| :-- | :-- |
| Per minute per project | 1,200,000 quota units |
| Per minute per user per project | 6,000 quota units |
| Per day per project (billing threshold) | 80,000,000 quota units |

| Method | Units | | Method | Units |
| :-- | --: | :-- | :-- | --: |
| `history.list` | 2 | | `drafts.create` | 10 |
| `messages.get` | 20 | | `drafts.delete` | 10 |
| `messages.list` | 5 | | `drafts.get` | 20 |
| `watch` | 100 | | `drafts.list` | 5 |
| `getProfile` | 1 | | `drafts.send` | 100 |
| | | | `drafts.update` | 15 |

- **The daily threshold:** "Usage under this threshold doesn't incur extra charges and your Google Cloud account isn't billed. Google will share full billing details later in 2026 with at least 90 days' notice before any changes take effect. You can't request an increase on this daily threshold limit." And: "Exceeding the quota request limits is planned to incur charges to your Google Cloud billing account later in 2026."
- **Errors** [gmail-errors] ("Last updated 2026-09-15 UTC"):
  - 403 with reason `userRateLimitExceeded` ("User Rate Limit Exceeded"), `rateLimitExceeded` or `dailyLimitExceeded`.
  - 429 "Too many requests: Too many concurrent requests for user", or mail-sending and bandwidth limits.
  - "You can't increase per-user limits." Backoff should "Start retry periods at least one second after the error."
- **No conflict with earlier research:** the Gmail research (#4) cited `history.list` at 2 units and 6,000 units per minute per user, which still holds. It didn't cite `messages.get` or the `drafts.*` costs.

## 8. Does each route cover the expected volume?

### The volume, and what this estimate rests on

**Facts** from the map and the tickets:

- 3–6 Miner judging runs a day, each judging up to 8 Featured Launches (#9).
- 1–6 Walkthrough preparations a day (#39, from four real days).
- About 1M tokens a week for the Rule carry-over check at 50 Rules, run on every provider of a role (#14, #26). _Interpretation:_ I read 1M as the whole weekly check. If it means 1M per provider, add 1M for each extra provider.
- One 1-token probe request a day to each provider (ADR 0009).
- Mail runs and conversation runs aren't in the ticket's volume, so they are left out.

**Assumptions**, because nothing has been measured yet. Each is a range:

| Run | Input tokens (context resent each turn) | Output tokens (with reasoning) | Requests (model turns) |
| :-- | --: | --: | --: |
| Miner judging run (≤8 Launches, ≤4k tokens of Rules) | 50k–150k | 5k–20k | ~9 |
| Walkthrough preparation (reads the signup page) | 150k–600k | 10k–40k | 10–30 |
| Rule carry-over check | 90% of its tokens | 10% | ≈10k tokens per case run per provider |

**Weekly totals** (low = 3 Miner runs and 1 Walkthrough a day at the low sizes; high = 6 and 6 at the high sizes):

- **Low:** 21 Miner runs and 7 Walkthroughs, about **3.0M input and 0.28M output** tokens.
- **High:** 42 Miner runs and 42 Walkthroughs, about **32.4M input and 2.6M output** tokens.

The script that does the arithmetic is reproduced at the end of §8. Input is priced as uncached, so prompt caching only lowers these figures.

### Route by route

**Pay-per-token routes, list price with no caching:**

| Route | Low volume | High volume | Facts it rests on |
| :-- | --: | --: | :-- |
| GPT-6 Luna, or Claude Haiku 5.5, on OpenRouter | $0.44/week | $4.55/week | $0.10 / $0.50 per 1M |
| Qwen3.8 Flash on OpenRouter | $0.58/week | $6.09/week | $0.15 / $0.47 |
| DeepSeek V4.1 Flash direct, off-peak / peak | $0.61 / $1.23 | $6.43 / $12.86 | $0.15–0.30 / $0.60–1.20 |
| MiniMax M3 on OpenRouter | $1.23/week | $12.86/week | $0.30 / $1.20 |
| MiMo V2.6 Pro on OpenRouter | $1.54/week | $16.37/week | $0.435 / $0.87 |
| DeepSeek V4-Pro direct, off-peak / peak | $2.52 / $5.05 | $26.57 / $53.14 | $0.66–1.32 / $1.98–3.96 |
| GPT-6.1 Sol, or Claude Sonnet 5.5, on OpenRouter | $8.75/week | $91.00/week | $2.00 / $10.00 |

- **Rate limits** don't bind any paid route at this volume. The background lane runs one run at a time (#8). DeepSeek allows 500–2,500 concurrent requests. OpenRouter's paid variants have no platform cap.
- **Where a DeepSeek weekday sits:** most weekday Miner runs fall in DeepSeek's peak window (§4), so a weekday is nearer the peak column.
- **Probes** are 7 requests a week per provider: negligible everywhere.

**OpenRouter free variants.**

- At the assumed turn counts, a day is about **37–234 requests**, plus the Rule check's runs on the day it runs.
- Only the low end (37) fits under the **50 a day** an account gets without the 10-credit purchase. The whole range fits inside the **1,000 a day** it gets after.
- 20 requests a minute allows one request every 3 seconds. _Interpretation:_ a fast agent loop could brush against that.
- Under `deny`, only 4 free variants remain (§3).

**ChatGPT Plus through CPA: partly established.**

- **Credit yardstick:** at Codex credit rates on GPT-6.1 Sol, with half the input cached, a Miner run comes to about 2.6–8.9 credits (3.8–12.5 with no caching). A Walkthrough comes to 6.4–26 credits (10–40 with no caching). That is near OpenAI's "typical … task may use 2-15 credits". On GPT-6 Luna the same runs are 0.1–1.3 credits.
- **The daily Miner batch:** 3–6 runs, all starting at 01:00 Pacific, fall in one five-hour window. That is below the low end of the GPT-6.1 Sol estimate (15 local messages) and far below GPT-6 Luna's (350). _Interpretation:_ this treats one run as roughly one "local message", which OpenAI doesn't define in API terms.
- **The weekly Rule check:** it is up to ~50 short case runs (~10k tokens each) per provider, in one burst. If each counts as a message, 50 exceeds the GPT-6.1 Sol low estimate of 15 per five hours. If usage counts by tokens, the ~0.5M tokens are about 35 credits on GPT-6.1 Sol with no caching, a few typical tasks.
- **A whole week:** this can't be established. OpenAI publishes no weekly number, says "credit prices alone don't determine included subscription usage", and the allowance may be shared with the person's own Codex and ChatGPT Work use.
- **At the limit:** what happens is §2's chain. The route returns 429 until the reset, which can be hours away (five-hour window) or days away (weekly).

**Shanghai AI Lab (if it is the Intern API): partly established.**

- **Per minute:** 30 requests a minute (docs), or 10 (console form), is above the Assistant's one-run-at-a-time pace. A Miner run of ~9 requests in several minutes fits.
- **Tokens per minute:** if the 5,000 TPM hint applies, it counts generated tokens. A run producing 20k output tokens would then need at least 4 minutes.
- **Per month:** the monthly input and output caps are per account and unpublished, so whether a month of Miner and Walkthrough runs fits can't be established.

**new-api.** It is not a capacity limit but a cap the person sets. At the volumes above, a key priced at list rates would burn roughly the dollar figures in the table. The numbers depend on the ratios the admin configures, including any ratio given to Plus traffic.

**Product Hunt.**

- A day costs 1–3 requests, which is 100–300 points: 1.6–4.8% of one 15-minute window.
- A 3-day catch-up (#26) is 3–9 requests, at most 900 points or about 14%.
- About 62 requests fit a window, so the Miner's reads don't come near the limit unless it adds per-Launch queries well beyond these.

**Gmail.**

- **Polling:** `history.list` every 2 minutes (the Gmail research's design) is 720 calls and 1,440 units a day, 2 units in any minute.
- **A busy minute:** 10 `messages.get`, one `drafts.get`, one `drafts.send` and one poll come to 322 units, about 5% of the 6,000 per-user minute.
- **The daily project threshold** of 80M units is far off.

### The arithmetic

```python
MINER = {"low": (50_000, 5_000), "high": (150_000, 20_000)}   # assumption: (input, output) per run
WALK  = {"low": (150_000, 10_000), "high": (600_000, 40_000)} # assumption
# weekly runs: low = 3 Miner + 1 Walkthrough a day; high = 6 + 6
# rule check: 1M tokens/week, 90% input / 10% output (assumption)
tin  = miner_runs * MINER[s][0] + walk_runs * WALK[s][0] + 900_000
tout = miner_runs * MINER[s][1] + walk_runs * WALK[s][1] + 100_000
cost = tin / 1e6 * price_in + tout / 1e6 * price_out           # list price, no cache
credits = (0.5 * i * c_in + 0.5 * i * c_cached + o * c_out) / 1e6  # Codex yardstick, half input cached
```

## 9. Facts not established, and open risks

- **Plus weekly limit:** no number is published, and neither is the exact unit included usage is counted in. _Unverified:_ whether a request through CPA counts as a "local message", or by tokens and credits.
- **Plus credit price:** OpenAI says it "depend[s] on your plan". Only forum reports ($40 per 1,000 credits) were found.
- **The OpenAI help article** returned 403 to automated fetches and has no archive snapshot. Its passages here come from search-engine excerpts.
- **Whether CPA's login shares an allowance** with the person's own Codex or ChatGPT Work use depends on whether it is the same ChatGPT account, which the repo doesn't say.
- **Which endpoint "the Shanghai AI Lab endpoint" is:** its URL isn't recorded in the repo. If it is the Intern API, its per-account RPM, TPM and monthly caps need a signed-in look, and the docs and console disagree on the default RPM (30, 10 or 50). No prices are published.
- **What OpenRouter's `deny` filters on:** training only, or also prompt retention. The docs read both ways (§3).
- **OpenRouter's credit-purchase fee** percentage didn't render on its FAQ.
- **OpenRouter prices move:** several low prices are temporary discounts, and endpoints come and go. Re-read before pricing a role.
- **Run sizes in §8 are assumptions.** The first real Miner and Walkthrough runs through the bot's forwarder, which counts tokens exactly (ADR 0009), would replace them.
- **new-api settings on the person's install** (`RetryTimes`, automatic disabling, `TrustQuotaUSD`, `PreConsumeMultiplier`, model and group ratios) weren't read. §2 and §6 give the code defaults.
- **Not researched:** how Pi reacts to 401, 403, 429 or 402. That decides whether a run fails fast or retries into the same wall.
- **The Gmail charges** Google plans "later in 2026" have no published rates yet.

## Sources

"Read" is the date fetched. Code is cited at the commit read.

**OpenAI**
- [codex-pricing]: Pricing (ChatGPT Work and Codex), including Plus estimates, credit rates and "What happens when you hit usage limits?". https://learn.chatgpt.com/docs/pricing (https://developers.openai.com/codex/pricing redirects here; no date on page; read 2026-10-16)
- [oa-astra-help]: Managing usage with GPT-6 Astra in Work and Codex. https://help.openai.com/en/articles/20001516-managing-usage-with-gpt-6-astra-in-work-and-codex (HTTP 403 to automated fetch and no Internet Archive snapshot on 2026-10-16; quoted from search-engine excerpts, 2026-10-16)
- [provider-terms]: What the person's model plans permit the Assistant to do (#23), quoting the Sign in with ChatGPT developer docs (https://developers.openai.com/siwc/llms-full.txt, read 2026-10-13). https://github.com/ultrasadness/lab1/blob/research/provider-terms/docs/research/provider-terms.md
- [codex-src]: openai/codex at `0df4aa67` (2026-10-16): `codex-rs/codex-api/src/api_bridge.rs`, `codex-rs/codex-api/src/rate_limits.rs`, `codex-rs/codex-api/src/api_bridge_tests.rs`, `codex-rs/protocol/src/error.rs`. https://github.com/openai/codex

**CLIProxyAPI**
- [cpa-src]: router-for-me/CLIProxyAPI `main` at `e7003d2a` (2026-10-16; latest release v8.0.31, 2026-10-16): `internal/runtime/executor/codex_executor_terminal.go`, `sdk/cliproxy/auth/selector.go`, `config.example.yaml`. https://github.com/router-for-me/CLIProxyAPI

**new-api**
- [newapi-src]: QuantumNous/new-api `main` at `09109ec3` (2026-10-16). Key lines also checked at tag `v1.0.0-rc.44` (2026-10-12). Files: `common/constants.go`, `model/token.go`, `model/subscription.go`, `middleware/auth.go`, `middleware/utils.go`, `service/billing_session.go`, `service/quota.go`, `service/text_quota.go`, `service/error.go`, `service/relay_error.go`, `service/channel.go`, `relay/helper/price.go`, `setting/ratio_setting/model_ratio.go`, `setting/operation_setting/quota_setting.go`, `setting/operation_setting/status_code_ranges.go`, `setting/operation_setting/operation_setting.go`, `i18n/locales/en.yaml`. https://github.com/QuantumNous/new-api

**OpenRouter**
- [or-limits]: API Limits, including free usage limits, credit limits, budgets and 429 handling. https://openrouter.ai/docs/api/reference/limits (read 2026-10-16; table values read from the page's own constants)
- [or-routing]: Provider Routing, "Requiring Providers to Comply with Data Policies". https://openrouter.ai/docs/guides/routing/provider-selection (via https://openrouter.ai/docs/llms-full.txt, read 2026-10-16)
- [or-provider-logging]: Provider Logging. https://openrouter.ai/docs/guides/privacy/provider-logging (via llms-full.txt, read 2026-10-16)
- [or-faq]: FAQ, "Pricing and fees". https://openrouter.ai/docs/faq (read 2026-10-16)
- [or-models]: `GET https://openrouter.ai/api/v1/models` (read 2026-10-16)
- [or-model-pages]: Providers pages with embedded endpoint records (`pricing`, `data_policy`, `provider_info.headquarters`), read 2026-10-16, for: `openai/gpt-6.1-sol`, `openai/gpt-6-luna`, `openai/gpt-6-sol`, `deepseek/deepseek-v4-pro`, `deepseek/deepseek-v4-pro-0813`, `deepseek/deepseek-v4.1-flash`, `qwen/qwen3.8-flash`, `qwen/qwen3.7-plus`, `moonshotai/kimi-k3`, `z-ai/glm-5.3`, `minimax/minimax-m3`, `xiaomi/mimo-v2.6-pro`, `google/gemini-3.8-flash`, `anthropic/claude-haiku-5.5`, `anthropic/claude-sonnet-5.5`, and the 14 tool-capable `:free` variants. https://openrouter.ai/<model>/providers
- [or-providers]: `GET https://openrouter.ai/api/v1/providers` (read 2026-10-16)

**DeepSeek**
- [ds-pricing]: Models & Pricing. https://api-docs.deepseek.com/quick_start/pricing (no date on page; read 2026-10-16)
- [ds-rate]: Rate Limit & Isolation. https://api-docs.deepseek.com/quick_start/rate_limit (read 2026-10-16)
- [ds-errors]: Error Codes. https://api-docs.deepseek.com/quick_start/error_codes (read 2026-10-16)

**Shanghai AI Lab (Intern API)**
- [intern-chat-doc]: Chat Completions API, rate limit and common errors. https://internlm.intern-ai.org.cn/docEn/docs/Chat and https://internlm.intern-ai.org.cn/doc/docs/Chat (no date on page; read 2026-10-16)
- [intern-models]: Models. https://internlm.intern-ai.org.cn/docEn/docs/Models (read 2026-10-16)
- [intern-console]: Rate Limiting Policy and API application pages, text read from the console's own bundle `https://internlm.intern-ai.org.cn/js/index.24e37ee4.js`. Page: https://internlm.intern-ai.org.cn/api/strategy (read 2026-10-16)

**Product Hunt**
- [ph-rate]: API v2 rate limits. https://api.producthunt.com/v2/docs/rate_limits/headers (undated; read 2026-10-16)
- [#20]: Create a read-only Product Hunt developer token, resolution (measured 2026-10-14). https://github.com/ultrasadness/lab1/issues/20

**Google**
- [gmail-quota]: Gmail API usage limits, "Last updated 2026-09-10 UTC". https://developers.google.com/workspace/gmail/api/reference/quota (read 2026-10-16)
- [gmail-errors]: Resolve errors, "Last updated 2026-09-15 UTC". https://developers.google.com/workspace/gmail/api/guides/handle-errors (read 2026-10-16)

**This repo**
- The map, #1; [#8](https://github.com/ultrasadness/lab1/issues/8) (plans and gateway); [#9](https://github.com/ultrasadness/lab1/issues/9) (Miner runs of up to 8 from 01:00 Pacific); [#14](https://github.com/ultrasadness/lab1/issues/14) (Rule carry-over, ~1M tokens a week at 50 Rules); [#26](https://github.com/ultrasadness/lab1/issues/26) (run caps, 3-day catch-up); [#39](https://github.com/ultrasadness/lab1/issues/39) (volume); ADRs [0001](https://github.com/ultrasadness/lab1/blob/main/docs/adr/0001-pi-in-a-container-behind-the-gateway.md), [0005](https://github.com/ultrasadness/lab1/blob/main/docs/adr/0005-plain-code-submits-a-registration-after-a-page-check.md), [0009](https://github.com/ultrasadness/lab1/blob/main/docs/adr/0009-the-bot-runs-as-its-own-user-and-holds-every-token-outside-the-containers.md), [0010](https://github.com/ultrasadness/lab1/blob/main/docs/adr/0010-mail-text-reaches-only-mail-cleared-roles-on-routes-that-dont-train.md).
- Gmail research (#4): https://github.com/ultrasadness/lab1/blob/research/gmail-access/docs/research/gmail-access.md
