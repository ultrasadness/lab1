# Running the Assistant unattended with Claude Code or the Agent SDK

Research for ticket #6 on the map (#1). It answers: how can Claude Code, or the Claude Agent SDK, run the Assistant on the VM when a Discord message or a daily schedule triggers it, with no interactive window open?

- **Researched:** 2026-10-13, from Anthropic's primary sources (listed at the end, each with the date it showed or the date it was read).
- **Observed on the VM:** Claude Code `2.1.296`, Ubuntu 22.04.5 LTS on `aarch64` (an Oracle Cloud instance; the distribution is Ubuntu, not Oracle Linux), systemd 249, `crontab` present, Bun **not** installed.
- **Scope:** facts the runtime decision (#8) needs. This file does not pick the runtime.
- **Quotes vs inference:** passages in quotation marks are verbatim. Anything marked _Interpretation_ or _Unverified_ is mine, not Anthropic's.

## Answer in brief

1. **Headless runs are a first-class, documented mode.** `claude -p "<prompt>"` runs one agent turn loop with no terminal and exits with a status code. It has JSON or streaming-JSON output, resumes by session ID, takes a JSON Schema for structured output, has a dollar cap, and supports explicit permission modes. The Agent SDK (TypeScript `@anthropic-ai/claude-agent-sdk`, Python `claude-agent-sdk`) is a library that "spawns and supervises a `claude` CLI subprocess". It is the same engine with a programmatic layer on top.
2. **Rules in git apply on every run, as long as the run is not `--bare`.** A plain `claude -p` "loads the same context an interactive session would". That covers `CLAUDE.md`, `.claude/rules/*.md`, skills, hooks, `.mcp.json` servers and Claude Code's own auto memory. Two catches:
   - Auto memory is stored under `~/.claude/`, which is per machine and outside git.
   - `permissions.allow` rules in a project's `.claude/settings.json` are ignored in `-p` until the folder has been trusted once.
3. **Nothing waits for a human unless you build the wait.** In `-p` with no permission host, any call that would show a prompt is denied. To pause a run for an Approval, the documented tools are:
   - a `PreToolUse` hook that returns `"defer"` (the process exits, and you resume it later with `--resume`);
   - the SDK's `canUseTool` callback, which can stay pending indefinitely.

   To enforce a Hard limit deterministically, use deny rules or `PreToolUse` hooks. Text in `CLAUDE.md` is only "context, not enforced configuration".
4. **Authentication decides which features work.**
   - **Subscription login (`/login`):** the only credential that loads claude.ai connectors, which include Anthropic's hosted Gmail connector.
   - **`claude setup-token` (one-year token for scripts):** makes model requests only, so no connectors.
   - **Console API key:** works everywhere, including `--bare` mode, but no claude.ai connectors.
   - **`--bare` mode** reads only `ANTHROPIC_API_KEY` or an `apiKeyHelper`.
5. **Terms allow both routes for the person's own use, with limits.**
   - The Consumer Terms ban automated access "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it".
   - Anthropic's help centre says (update of 7 Oct 2026): "You can still use the Claude Agent SDK, `claude -p`, and third-party apps with your subscription limits."
   - Subscription OAuth is meant for "ordinary use of Claude Code and other native Anthropic applications", and Pro/Max limits "assume ordinary, individual usage".
   - An API key is the unambiguous route. Max plans now include $100 or $200 a month in API credits that cover `claude -p` and the Agent SDK when they run with an API key from the linked Console organization.
6. **Use the VM's own scheduler for the daily run.**
   - Claude's cloud routines run on Anthropic's machines from a fresh git clone, so they can't reach the VM's files or local MCP servers.
   - `/loop` exists only inside an open session, and its recurring tasks expire after seven days.
   - Desktop scheduled tasks need the GUI desktop app.

   That leaves cron or a systemd timer on the VM to start `claude -p`, or to start an SDK script.

## 1. Ways to run Claude unattended on this VM

| Option | What triggers it | Fits the Assistant? | Main constraints (source) |
| :-- | :-- | :-- | :-- |
| **A. `claude -p` per trigger**, started by our own Discord bot process and a systemd timer or cron job | The bot gets a message, or the timer fires; either one runs `claude -p ... --output-format json` in the repo directory | **Yes** | One process per run. Map each Discord thread to a session with `--session-id <uuid>`, then `--resume <id>`. Waiting for an Approval needs the `defer` pattern (§4). |
| **B. Agent SDK service** (Node 24 or Python 3) that holds the Discord connection and calls `query()` | The same, but in-process | **Yes** | Adds `canUseTool`, in-process hooks, streaming input and long-lived sessions. Still spawns the `claude` binary, which is "pinned to the SDK package version". |
| **C. Claude Code's Discord channel plugin**: one long-lived `claude --channels plugin:discord@claude-plugins-official` session | A DM to the bot is pushed into that open session | Possible, with caveats | "Research preview". Needs Bun. "Events only arrive while the session is open." Events "queue into the session and are processed in order", and "To process independent event streams concurrently, run separate sessions." Permission prompts can be relayed to Discord. The `--dangerously-load-development-channels` flag for a custom channel is ignored under `-p` or the SDK. Context grows across every message in the one session. |
| **D. Background sessions** (`claude --bg`, `claude agents`) | Dispatched from a script | Weak fit for a server | "Shutting down or restarting your machine stops running background sessions." The docs say nothing about starting the supervisor at boot. `--bg` can't be combined with `-p`. A script run in an untrusted folder fails with `Workspace not trusted`. Agent view is a research preview. |
| **E. Remote Control** (`claude remote-control` server, driven from the Claude iOS app) | The person, from the Claude app | Not the chosen phone surface (Discord is) | "API keys are not supported." Needs a `/login` subscription. A non-TTY start fails with `Workspace not trusted` unless the folder was trusted before. |
| **F. Cloud routines** (`/schedule`, claude.ai/code/routines) | Schedule, API POST, or GitHub event | **No**, for VM-local work | They run on Anthropic's cloud, or on a self-hosted environment that is "public beta on Team and Enterprise plans". Access to local files: "No (fresh clone)". Minimum interval is one hour. Needs a claude.ai subscription login. |
| **G. `/loop` and cron tools inside a session** | A timer inside an open session | **No**, for the daily run | "Tasks only fire while Claude Code is running and idle." "Recurring tasks automatically expire 7 days after creation." |
| **H. Desktop scheduled tasks** | A timer in the desktop app | **No** | They run only "while the desktop app is running and your computer is awake". The Linux desktop app is a GUI beta for Ubuntu/Debian. |

Sources: [headless], [sdk-hosting], [channels], [channels-ref], [agent-view], [remote-control], [routines], [self-hosted], [scheduled-tasks], [desktop-tasks], [desktop-quickstart].

## 2. Headless invocation (`claude -p`), the parts that matter here

All flags below appear in `claude --help` on the VM (2.1.296), apart from `--channels`, which the docs say is hidden while it is in preview.

- **Run and exit:** "Claude Code exits with code 0 on success and a non-zero code when the run fails". "When a failure happens inside the run, such as missing authentication, Claude Code prints the failure as the result on stdout." [headless]
- **Output:** `--output-format text|json|stream-json`. The `json` output carries `result`, `session_id` and "`total_cost_usd` and a per-model cost breakdown". These figures are "client-side estimates". `--json-schema '<schema>'` puts schema-conforming data in `structured_output`, which suits a Miner that must emit a Dossier or a Skip for each Launch. [headless]
- **Sessions:**
  - `--continue` resumes the most recent session in the directory.
  - `--resume <session-id>` resumes a specific session, "in any project on this machine".
  - `--session-id <uuid>` sets the ID up front.
  - `--fork-session` branches off a resumed session.
  - `--no-session-persistence` saves nothing.
  - Transcripts live under `~/.claude/projects/` and are swept after `cleanupPeriodDays`, which defaults to 30. [headless], [hooks]
- **Starting permission mode:** for "`claude -p` or the Agent SDK" it is "`default` in sessions that fetch feature flags" (the normal case on the Anthropic API). So set one explicitly: "pass the one you want". [permission-modes], [headless]
  - `dontAsk`: "Claude Code denies every call that would otherwise prompt, which is useful for locked-down CI runs", while still allowing what `--allowedTools` or `permissions.allow` covers.
  - `acceptEdits`: file writes plus common filesystem commands.
  - `auto`: a classifier reviews actions. It is available on "All plans" with Opus 4.6+, Sonnet 4.6+, Haiku 5.5 or Fable models.
  - `bypassPermissions` / `--dangerously-skip-permissions`: for "Isolated containers and VMs only"; run it as a non-root user.
- **No one to answer:** `--permission-prompts none`: "Anything that would prompt is denied unless a `PermissionRequest` hook allows it, Claude is told that nobody can approve the request and not to retry it, and the run continues." It also removes `AskUserQuestion`. Requires v2.1.259+. [headless]
- **Pre-approvals:** `--allowedTools "Bash(git commit *)" Read Edit ...` and `--disallowedTools` use the permission rule syntax. "Deny rules block in every mode, including `bypassPermissions`." [headless], [permission-modes]
- **Spend cap:** `--max-budget-usd <amount>` ("only works with --print"). [cli `--help`]
- **Stopping:** SIGTERM exits with code 143 and "leaves the turn that was in progress unfinished"; send SIGINT to end the turn cleanly. This matters to a supervisor that kills runs. [headless]
- **Skills in `-p`:** "User-invoked skills and custom commands work. Include `/skill-name` in the prompt string and Claude Code expands it before running." Terminal-only commands such as `/login` aren't available. [headless]
- **MCP startup:** with `--mcp-config` under `-p`, Claude Code waits for pending servers for up to `MCP_TIMEOUT` (30 s by default). The `system/init` event reports `mcp_servers` and `mcp_server_errors`, so a wrapper can fail a run when the browser or Gmail server didn't load. [headless]
- **`--bare`:** skips auto-discovery of hooks, skills, plugins, MCP, auto memory and `CLAUDE.md`. "`--bare` is the recommended mode for scripted and SDK calls, and will become the default for `-p` in a future release." In bare mode "Claude Code never reads OAuth credentials or the system keychain", so a subscription can't be used. [headless]

## 3. What loads on each run, and whether Rules carry over

Without `--bare`, "`claude -p` loads the same context an interactive session would, including anything configured in the working directory or `~/.claude`." [headless] For a run whose working directory is the repo:

| Input | Loads in `claude -p` (not bare)? | Notes (source) |
| :-- | :-- | :-- |
| `CLAUDE.md` / `.claude/CLAUDE.md` at the repo root and in parent directories | Yes, at launch | Subdirectory `CLAUDE.md` files load on demand when Claude touches files there. Files up to 4 MiB load in full; "target under 200 lines". [memory] |
| `.claude/rules/*.md` without `paths:` | Yes, at launch, "with the same priority as `.claude/CLAUDE.md`" | Rules with `paths:` load only when a matching file is read or edited. [memory] |
| `@imports` inside `CLAUDE.md` | Yes, up to four hops | An import that resolves **outside** the working directory needs a one-time approval dialog, which appears "at the start of an interactive session". _Unverified:_ how an unapproved external import behaves under `-p`. Keep Rules inside the repo or in `~/.claude/rules/`, which loads without the dialog. [memory] |
| Skills (`.claude/skills/<name>/SKILL.md`) | Descriptions load at start; full content loads on use | Invoke one explicitly with `/skill-name` in the prompt. [sdk-features], [headless] |
| Hooks in `.claude/settings.json` | Yes, **even in a never-trusted folder** | Listed as "Used" under `-p` in the workspace-trust table. [permissions] |
| `permissions.allow` in project `.claude/settings.json` | **No, until the folder is trusted** | "Not used. Claude Code prints a `this workspace has not been trusted` warning to stderr". Fix it by accepting the trust dialog once interactively, by setting `projects["<repo path>"].hasTrustDialogAccepted` to `true` in `~/.claude.json`, or by putting the rules in `~/.claude/settings.json`, `--settings` or `--allowedTools`. [permissions] |
| `.mcp.json` servers | Yes, "without asking" | "In `claude -p` runs, Agent SDK sessions, and cloud sessions, Claude Code can't show that prompt: it loads project-scoped servers without asking." [mcp] |
| Auto memory (`MEMORY.md`, first 200 lines or 25 KB) | Yes | It lives at `~/.claude/projects/<project>/memory/`. "Auto memory is machine-local." It is **not in git**. It can be turned off (`autoMemoryEnabled: false` or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`) or redirected with `autoMemoryDirectory`, which takes an absolute path. [memory] |
| Agent SDK `query()` | Same as the CLI by default | "Omitting `settingSources` is equivalent to `["user", "project", "local"]`." `settingSources: []` loads none of these. Auto memory and `~/.claude.json` load regardless. [sdk-features] |

**What this means for Rules.** Write each Rule as a file in the repo, as `CLAUDE.md` content or under `.claude/rules/`, and run Claude with the repo as its working directory and without `--bare`. Every later run then sees the Rule. Claude Code's auto memory is a second, competing store that captures "corrections you give Claude" outside git. The map should decide whether to turn it off or point it into the repo (see Surfaced). Instructions in these files are guidance only: "Claude treats them as context, not enforced configuration. To block an action regardless of what Claude decides, use a PreToolUse hook instead." [memory]

**`--bare` as a future default.** The docs say `--bare` "will become the default for `-p` in a future release". An Assistant that relies on auto-discovery should name its context explicitly so an upgrade can't silently drop its Rules. Either pass `--setting-sources`, `--append-system-prompt-file` and `--mcp-config`, or pin and test Claude Code upgrades. _Unverified:_ what opt-out flag will exist once the default changes.

## 4. Approvals, Hard limits and permissions in unattended runs

- **Pausing for an Approval with `claude -p` (the `defer` pattern):** "`"defer"` is for integrations that run `claude -p` as a subprocess and read its JSON output". It works like this:
  1. A `PreToolUse` hook returns `permissionDecision: "defer"`.
  2. "The process exits with `stop_reason: "tool_deferred"` and the pending tool call preserved in the transcript."
  3. The caller reads `deferred_tool_use`, which carries the tool's `id`, `name` and `input`, and shows it to the person, for example as a Walkthrough on Discord.
  4. Later the caller runs `claude -p --resume <session-id>`. The hook fires again and returns `allow`, with the approved input, or `deny`.

  Limits:
  - "There is no timeout or retry limit", but the session is subject to the 30-day transcript sweep.
  - "`"defer"` only works when Claude makes a single tool call in the turn."
  - On resume with `-p`, "Claude Code doesn't restore any other stored permission mode", so pass it again. [hooks]
- **Pausing for an Approval with the SDK:** `canUseTool` "pauses execution until you return a response", and "The callback can stay pending indefinitely." It "never fires for auto-approved tools", and the SDK docs recommend `defer` when "a user might take longer to respond than your process can reasonably stay running". [sdk-user-input]
- **Enforcing Hard limits:**
  - Deny rules hold in every mode.
  - `PreToolUse` hooks can block a call with exit code 2 or with `permissionDecision: "deny"`.
  - `PermissionRequest` hooks run "In sessions that can't show a prompt ... and if no hook returns a decision, it denies the tool call". [permission-modes], [hooks]
  - A no-payment Hard limit, for example, could be a deny rule plus a hook on the browser MCP tools, rather than a sentence in `CLAUDE.md`. _Interpretation._
- **Still not automatic in any mode:** explicit `ask` rules, `AskUserQuestion`, MCP tools marked `requiresUserInteraction`, and `rm` of critical paths. [permission-modes]

## 5. MCP servers for the browser and Gmail when headless

- **Scopes:** local (in `~/.claude.json` per project), project (`.mcp.json`, in git) and user. Stdio servers (for example a headless-browser MCP server) and HTTP servers are both supported. Claude Code "doesn't reconnect stdio servers automatically". [mcp]
- **OAuth can't happen inside a headless run:** "In non-interactive mode there's no `/mcp` panel, so Claude Code can't run the OAuth flow for you." Sign in once interactively with `/mcp` or `claude mcp login <name>`, which prints a URL you can open on another device. After that, "Authentication tokens are stored securely and refreshed automatically". [mcp]
- **claude.ai connectors (Anthropic's hosted Gmail connector):** "Connectors from claude.ai are fetched only when your active authentication method is a claude.ai subscription login." They don't load with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `apiKeyHelper`, or a `CLAUDE_CODE_OAUTH_TOKEN` from `setup-token`. Gmail "do[es]n't support local OAuth from Claude Code because the upstream identity provider only accepts the redirect URL that claude.ai registered". So an unattended Assistant can use the hosted Gmail connector **only** while running on the `/login` subscription credential. Otherwise it needs its own Gmail MCP server or API with its own Google OAuth. This is input for #4. [mcp], [authentication]

## 6. Agent SDK compared with the CLI

| | `claude -p` (CLI) | Agent SDK |
| :-- | :-- | :-- |
| Engine | The `claude` binary | Spawns the same `claude` binary over stdio. TypeScript and Python "bundle a native Claude Code binary", "pinned to the SDK package version". |
| Config loading (`CLAUDE.md`, rules, skills, hooks, `.mcp.json`) | Auto-discovered unless `--bare` | The same by default (`settingSources` omitted means user, project and local) |
| Waiting for a person | `defer` hook, then exit, then `--resume` | `canUseTool` callback (in-process and async) or `defer` |
| Hooks | Shell, HTTP, MCP-tool, prompt and agent hooks in `settings.json` | Those, plus in-process callback hooks. The TypeScript SDK supports extra hook events beyond Python. |
| Long-lived conversation | One process per run; resume by ID | TypeScript `streamInput()` / Python `ClaudeSDKClient` hold a session open; `SessionStore` mirrors transcripts |
| Structured results | `--output-format json`, `--json-schema` | Typed message objects, structured output |
| Session timeout | No built-in wall clock; use `--max-budget-usd` | "No top-level session timeout"; set `maxTurns` |
| Auth | Same credential precedence (§7) | Same environment variables ("`apiKeyHelper`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_AUTH_TOKEN` apply to the CLI and the surfaces that wrap it, including ... the Agent SDK"). The docs show API keys only. |
| Licence | Consumer or Commercial Terms, by account type | "Use of the Claude Agent SDK is governed by Anthropic's Commercial Terms of Service" |

Sources: [sdk-overview], [sdk-quickstart], [sdk-hosting], [sdk-features], [sdk-user-input], [authentication].

_Interpretation:_ the SDK adds a programmatic layer and removes nothing the Assistant needs. Its main advantage is that the Discord bot and the agent loop can share one process, with Approvals as awaited callbacks. Its cost is a long-running service to supervise, and Claude Code upgrades tied to SDK releases.

## 7. Authentication, terms and cost

### Credential precedence and lifetimes ([authentication])

The order, highest first:

1. A cloud provider (Bedrock, Vertex or Foundry environment variables)
2. `ANTHROPIC_AUTH_TOKEN`
3. `ANTHROPIC_API_KEY` ("In non-interactive mode (`-p`), the key is always used when present")
4. `apiKeyHelper`
5. `CLAUDE_CODE_OAUTH_TOKEN`
6. Anthropic profile or federation credentials
7. Subscription OAuth from `/login`

How each subscription credential behaves:

- **`claude setup-token`:** "For CI pipelines, scripts, or other environments where interactive browser login isn't available, generate a one-year OAuth token". "This token authenticates with your Claude subscription and requires a Pro, Max, Team, or Enterprise plan. It can only make model requests, so it can't establish Remote Control sessions or fetch claude.ai connectors." "Bare mode does not read `CLAUDE_CODE_OAUTH_TOKEN`."
- **`/login` credential:** stored on Linux at `~/.claude/.credentials.json` (mode 0600). Claude Code warns three days before expiry. "Renewing early matters most for sessions that run unattended."

### Terms, quoted exactly

**Consumer Terms of Service**, "Effective October 8, 2025" (applies to Free, Pro and Max). Under prohibited uses:

> "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise."

And:

> "You may not share your Account login information, Anthropic API key, or Account credentials with anyone else. You also may not make your Account available to anyone else."

**Claude Code: Legal and compliance**, read 2026-10-13:

> "Commercial Terms of Service - for Team, Enterprise, and Claude API users" / "Consumer Terms of Service - for Free, Pro, and Max users"

> "Claude Code usage is subject to the Anthropic Usage Policy. Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK."

> "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."

> "Developers building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider. Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users."

> "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice."

**Agent SDK overview / quickstart**, read 2026-10-13:

> "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead."

**Help centre, "Use the Claude Agent SDK with your Claude plan"** (marked "Updated this week" on 2026-10-13):

> "Update October 7, 2026: Claude Max and Team plans now include monthly API credits, which cover the Claude Agent SDK, `claude -p`, the Claude API, and Claude Managed Agents. You can still use the Claude Agent SDK, `claude -p`, and third-party apps with your subscription limits."

> "Update June 15, 2026: We've paused the previously-announced changes to Claude Agent SDK usage. For now, nothing has changed: Claude Agent SDK, `claude -p`, and third-party app usage still draw from your subscription limits."

**Help centre, "Monthly API credits for Max and Team plans"** (read 2026-10-13), FAQ:

> "API credits cover `claude -p` and the Claude Agent SDK when you run them yourself with an API key from your linked Claude Console organization, because that usage is billed as Agent SDK usage. When you're signed in with your Claude plan instead, `claude -p` and Agent SDK usage still draw from your plan's usage limits and don't use your API credits."

The same article also says: "Available on Max and Team plans ... Free, Pro, and Enterprise plans aren't eligible." "Doesn't roll over." "If the organization has no other credits, API requests stop until your next monthly credits arrive. Usage is never charged to your Claude plan."

_Interpretation._ Two reasons point to the person running the unmodified `claude` binary, or the SDK that runs it, on their own VM with their own subscription for their own Assistant being permitted:

- The 7 Oct 2026 help article explicitly keeps `claude -p` and SDK use on subscription limits.
- Anthropic documents `setup-token` for "scripts".

That reads as the "explicitly permit" carve-out in the Consumer Terms. The prohibitions target third parties offering claude.ai login, routing other people's requests, or intermediating credentials. None of these apply to a single-person Assistant. What stays open is that "ordinary, individual usage" has no published number, so a 24/7 bot-triggered workload carries some judgement risk. An API key, including the Max plan's monthly API credits, is the unambiguous route.

### Cost model ([pricing], [pro-max], [api-credits], [costs]; read 2026-10-13)

- **Subscription:**
  - Prices: Pro is $20 a month ($17 a month billed annually). Max is "From $100" (Max 5x at $100, Max 20x at $200).
  - Limits: "Both Pro and Max plans have a five-hour session limit and a weekly limit. ... These limits are shared across Claude and Claude Code". `claude -p` and SDK runs on the plan login draw from the same limits.
  - Overflow: optional usage credits continue past the limit at API rates. With `ANTHROPIC_API_KEY` set, Claude Code bills the API instead: "resulting in API usage charges rather than using your subscription's included usage."
- **API key, per token** (list price per million tokens, input/output):

  | Model | Input | Output |
  | :-- | :-- | :-- |
  | Opus 5.5 | $4 | $20 |
  | Sonnet 5.5 | $2 | $10 |
  | Haiku 5.5 (prompts up to 100K tokens) | $0.10 | $0.50 |
  | Fable 5.1 | $10 | $50 |

  Batch processing saves 50%; prompt-cache reads cost 5% (Opus, Sonnet) to 10% (Haiku) of the input price. Max 5x and 20x add $100 and $200 a month in API credits; Pro gets none.
- **Reference point:** Anthropic's figure of "around $13 per developer per active day" is for interactive enterprise coding, so it is not a forecast for the Assistant. Use the `total_cost_usd` in each run's JSON output, and `--max-budget-usd`, to measure and cap real runs.

## 8. Scheduling on the VM compared with Claude's own schedulers

- **Claude's own options** (comparison table from [scheduled-tasks]):

  | | Cloud routine | Desktop task | `/loop` |
  | :-- | :-- | :-- | :-- |
  | Runs on | Anthropic cloud | The machine | The machine |
  | Needs an open session | No | No | Yes |
  | Access to local files | "No (fresh clone)" | Yes | Yes |
  | Minimum interval | 1 hour | 1 minute | 1 minute |

  Routines also "draw down subscription usage the same way interactive sessions do" and need a claude.ai login. [routines]
- **On the VM:** a systemd timer, or cron, running `claude -p` (or `node`/`python` for the SDK) as the `ubuntu` user, with the repo as the working directory and credentials in that user's `~/.claude/` or in an environment file.
  - _Standard Linux practice, not from Anthropic's docs:_ a systemd **user** unit needs `loginctl enable-linger ubuntu` to run without a login session. `Persistent=true` on a timer catches up a run missed during downtime.
  - The always-on Discord bot (options A and B in §1) would be a systemd service with `Restart=always`. Restart and secrets details are already listed under "Running on the VM" on the map.

## 9. Usage Policy clauses that touch the Assistant's design

The Usage Policy page currently shows the version "Effective November 12, 2026". The version in force today, "Effective September 15, 2025" (the archived "Previous Version"), carries the same clauses quoted here.

Under "Do Not Abuse Our Platform" ("This includes using our products or services to:"):

> "Utilize automation in account creation or to engage in spammy behavior"

Under "Do Not Engage in Fraudulent, Abusive, or Predatory Practices":

> "Engage in actions or behaviors that circumvent the guardrails or terms of other platforms or services"

Additional use-case guideline (Nov 2026 text):

> "Agentic use cases must comply with the Usage Policy. Users are responsible for ensuring that agents they build or deploy, including actions those agents take through tools, browsers, or connected systems, comply with this Usage Policy."

_Interpretation:_ the first clause sits in a list about abusing Anthropic's platform, and may mean accounts on Anthropic's own services. Its literal wording, though, covers using Claude "to ... utilize automation in account creation". That is exactly what Registration does once the Assistant fills and submits signup forms. The map's existing Handoff and Hard-limit stance (no CAPTCHA solvers, walls become Handoffs) addresses the second clause. The first needs its own decision (see Surfaced).

## 10. Open risks and items not verified

- _Unverified:_ whether several concurrent `claude -p` processes sharing one `/login` credential race when they refresh the OAuth token.
- _Unverified:_ how an unapproved external `@import` behaves under `-p` (§3).
- _Unverified:_ whether the official Discord channel plugin keeps working as an unattended service under systemd and a pseudo-terminal or tmux. The docs only say to "run Claude in a background process or persistent terminal".
- _Unverified:_ which flag will opt out of `--bare` once it becomes the `-p` default.
- **Moving targets:** channels, routines, agent view and self-hosted environments are all research preview or beta. The subscription treatment of `claude -p` and the SDK changed twice in 2026 (the June credit plan was paused, then API credits arrived on 7 Oct), so re-check [sdk-plan] before committing.
- **Auto-updates:** Claude Code updates itself. An unattended service should pin a version or test upgrades. The exact mechanism wasn't researched here.

## Sources

Anthropic documentation pages carry no visible date. "Read" is the date fetched (2026-10-13). Legal pages show their effective dates.

- [headless]: Run Claude Code programmatically. https://code.claude.com/docs/en/headless (read 2026-10-13)
- [cli `--help`]: `claude --help` on the VM, Claude Code 2.1.296 (2026-10-13)
- [authentication]: Authentication. https://code.claude.com/docs/en/authentication (read 2026-10-13)
- [legal]: Legal and compliance. https://code.claude.com/docs/en/legal-and-compliance (read 2026-10-13)
- [permission-modes]: Choose a permission mode. https://code.claude.com/docs/en/permission-modes (read 2026-10-13)
- [permissions]: Configure permissions, "What runs before you trust a folder". https://code.claude.com/docs/en/permissions (read 2026-10-13)
- [memory]: How Claude remembers your project. https://code.claude.com/docs/en/memory (read 2026-10-13)
- [mcp]: Connect Claude Code to tools via MCP. https://code.claude.com/docs/en/mcp (read 2026-10-13)
- [hooks]: Hooks reference, "Defer a tool call for later" and "PermissionRequest". https://code.claude.com/docs/en/hooks (read 2026-10-13)
- [channels]: Push events into a running session with channels. https://code.claude.com/docs/en/channels (read 2026-10-13)
- [channels-ref]: Channels reference. https://code.claude.com/docs/en/channels-reference (read 2026-10-13)
- [agent-view]: Manage multiple agents with agent view. https://code.claude.com/docs/en/agent-view (read 2026-10-13; summarised by the fetch tool, not quoted from raw HTML)
- [remote-control]: Remote Control. https://code.claude.com/docs/en/remote-control (read 2026-10-13)
- [routines]: Automate work with routines. https://code.claude.com/docs/en/routines (read 2026-10-13)
- [self-hosted]: Self-hosted environments. https://code.claude.com/docs/en/self-hosted-environments (read 2026-10-13)
- [scheduled-tasks]: Run prompts on a schedule. https://code.claude.com/docs/en/scheduled-tasks (read 2026-10-13)
- [desktop-tasks]: Schedule recurring tasks in Claude Code Desktop. https://code.claude.com/docs/en/desktop-scheduled-tasks (read 2026-10-13)
- [desktop-quickstart]: Get started with the desktop app. https://code.claude.com/docs/en/desktop-quickstart (read 2026-10-13)
- [costs]: Manage costs effectively. https://code.claude.com/docs/en/costs (read 2026-10-13)
- [sdk-overview]: Agent SDK overview. https://code.claude.com/docs/en/agent-sdk/overview (read 2026-10-13)
- [sdk-quickstart]: Agent SDK quickstart. https://code.claude.com/docs/en/agent-sdk/quickstart (read 2026-10-13)
- [sdk-hosting]: Hosting the Agent SDK. https://code.claude.com/docs/en/agent-sdk/hosting (read 2026-10-13)
- [sdk-features]: Use Claude Code features in the SDK. https://code.claude.com/docs/en/agent-sdk/claude-code-features (read 2026-10-13)
- [sdk-user-input]: Handle approvals and user input. https://code.claude.com/docs/en/agent-sdk/user-input (read 2026-10-13)
- [consumer-terms]: Consumer Terms of Service, effective 2025-10-08. https://www.anthropic.com/legal/consumer-terms
- [commercial-terms]: Commercial Terms of Service, effective 2025-06-17. https://www.anthropic.com/legal/commercial-terms
- [aup]: Usage Policy, effective 2026-11-12, plus the previous version effective 2025-09-15. https://www.anthropic.com/legal/aup and https://www.anthropic.com/legal/archive/22742366-2ef0-4c7a-a833-6523f10d3944
- [sdk-plan]: Use the Claude Agent SDK with your Claude plan, update of 2026-10-07. https://support.claude.com/en/articles/15036540
- [api-credits]: Monthly API credits for Max and Team plans. https://support.claude.com/en/articles/17154008 (read 2026-10-13)
- [pro-max]: Use Claude Code with your Pro or Max plan. https://support.claude.com/en/articles/11145838 (read 2026-10-13)
- [pricing]: Claude pricing. https://claude.com/pricing (read 2026-10-13)
