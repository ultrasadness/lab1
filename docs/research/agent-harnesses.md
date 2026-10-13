# Agent harnesses that can run the Assistant through a custom model provider

Research for ticket #22 on the map (#1). It answers: which agent harnesses can run the Assistant's agent loop unattended on the VM, using models that the person's self-hosted gateway serves as a custom provider? It also covers a requirement added while the ticket was open: the harness must work with models from **at least two** of the person's providers through the gateway (a ChatGPT Plus plan through a Codex login, a DeepSeek plan, OpenRouter, and an unnamed third-party relay).

- **Researched:** 2026-10-13, from primary sources: official docs, source code at a named tag or `main`, release notes and package registries. Each source is listed at the end with the date it showed or the date it was read.
- **Observed on the VM** (2026-10-13): Ubuntu 22.04.5 LTS on `aarch64`, Node v24.20.0, Python 3.10.12, Docker. Codex CLI `codex-cli 0.162.1` at `~/.local/bin/codex`. Claude Code `2.1.296`. In Docker: `new-api` (image label `v1.0.0-rc.22`, built 2026-07-26, arm64), `gpt-load`, `postgres`, `redis`, `caddy`. `bubblewrap` 0.6.1 is installed; `socat` is not; `kernel.apparmor_restrict_unprivileged_userns = 0`.
- **Builds on:** [`docs/research/unattended-claude.md`](https://github.com/ultrasadness/lab1/blob/research/unattended-claude/docs/research/unattended-claude.md) (ticket #6). Claude Code facts already there are cited, not repeated. This file adds only what changes when Claude Code talks to a gateway and to non-Claude models.
- **Scope:** technical capability only. Whether the providers' terms allow serving a subscription through a gateway is a separate ticket. This file does not pick a harness.
- **Quotes vs inference:** passages in quotation marks are verbatim (a few are translated, and marked so). Anything marked _Interpretation_ or _Unverified_ is mine, not the source's.

## Answer in brief

1. **Each harness speaks a fixed set of wire APIs, and that decides how much the gateway must translate.**
   - **Codex CLI speaks only the OpenAI Responses API.** `wire_api`: "`responses` is the only supported value". Chat Completions support was removed in February 2026.
   - **Claude Code speaks only the Anthropic Messages format**, or Bedrock/Vertex formats. Anthropic "doesn't support routing Claude Code to non-Claude models through any gateway".
   - **OpenCode, the OpenAI Agents SDK, the Vercel AI SDK and Pydantic AI pick a wire API per model.** Each can call a Chat Completions, Responses or Anthropic Messages endpoint, so a gateway can pass each provider through in its native format.
2. **Every candidate can reach at least two of the person's providers, but at different cost.**
   - **OpenCode and the three SDKs** reach all four providers without any format translation.
   - **Codex** needs Responses from every provider. DeepSeek and OpenRouter now serve a stateless Responses API of their own. But the new-api build on the VM (rc.22) answers a Responses request for its DeepSeek channel with "not implemented". DeepSeek Responses routing arrived in new-api on 2026-07-31, five days after the build that runs on the VM.
   - **Claude Code** reaches DeepSeek through DeepSeek's own Anthropic endpoint and OpenRouter through its "Anthropic Skin", and GPT models through CLIProxyAPI's Messages-to-Codex translator. All three are outside what Anthropic supports. OpenRouter's own guide says Claude Code "is only guaranteed to work with the Anthropic first-party provider".
3. **Unattended runs: every candidate has a one-shot command or API, but caps differ.**
   - **`codex exec`:** JSONL events, `--output-schema`, `exec resume <id>`, and token counts on `turn.completed`. It exits 1 on error. There is no turn cap and no spend cap.
   - **`opencode run`:** JSON events, `--session`/`--continue`, and per-message tokens and cost. It has a per-agent `steps` cap but no spend cap. Structured output exists only through its SDK.
   - **The SDKs** have turn or step caps: Agents SDK `max_turns` (default 10), AI SDK `isStepCount(20)` by default, Pydantic AI `UsageLimits` including `cost_limit`.
4. **Rules from git load automatically in the three CLIs, and each also has a machine-local store that competes with them.**
   - **Codex** loads `AGENTS.md` (32 KiB cap) and `.agents/skills`. Its competing stores are `~/.codex/AGENTS.md`, `~/.codex/rules/default.rules`, and Memories (off by default).
   - **OpenCode** loads `AGENTS.md`, with `CLAUDE.md` as fallback, plus `instructions` globs and skills. Its competing stores are `~/.config/opencode/AGENTS.md` and `~/.claude/CLAUDE.md`.
   - **Claude Code** has auto memory (see #6).
   - **The SDKs** load nothing on their own. The Assistant's code decides what goes in the prompt.
5. **Hard limits: only Codex enforces a shell sandbox by default.**
   - **Codex:** its Linux sandbox (bubblewrap + seccomp) works on this VM. A probe run under `codex sandbox` could not write a file or reach the network. Codex adds shell-command `forbidden` rules (experimental), `PreToolUse` hooks that also cover MCP tools ("a useful guardrail, not a complete enforcement boundary"), and MCP tool allow and deny lists.
   - **OpenCode:** "does **not** sandbox the agent". Its permissions "default to `"allow"`", and `opencode run` auto-rejects anything set to `ask`.
   - **Claude Code:** deny rules and hooks (#6), plus an optional bubblewrap sandbox for Bash that needs `socat`, which is not installed.
   - **The SDKs:** have no built-in shell. The Assistant's own tool code is the limit.
6. **The two gateways cover different ground.**
   - **new-api** (AGPL-3.0) serves a ChatGPT plan through its "ChatGPT Subscription (Codex)" channel. You paste in the OAuth JSON; the channel serves Responses only. new-api exposes Chat Completions, Responses, Messages and Gemini. Its cross-format converter (RelayKit) arrived after the VM's build. It grades Chat⇄Responses "good" and anything⇄Claude "fair", and by default it reports losses as diagnostics rather than failing.
   - **CLIProxyAPI** is "CPA" (its own ecosystem uses that abbreviation) and is MIT-licensed. It runs its own OAuth logins for Codex, Claude Code and others. It exposes Chat Completions, Responses and Messages, and translates them for OpenAI-compatible upstreams such as OpenRouter and DeepSeek. It has shipped two major versions in 2026 and no longer counts usage itself.
7. **What could change under the Assistant:**
   - The newest Pydantic AI needs Python 3.11, and the VM has 3.10.
   - OpenCode 2 is rolling out with a new plugin API and a new permission format.
   - Codex ships a stable release every one to two days.
   - The new-api on the VM is 384 commits behind its latest release candidate.
   - Codex refuses `model_provider` settings in a repo's `.codex/config.toml`, so the gateway setting has to live on the machine, not in git.

## 1. Comparison

Abbreviations: **Resp** = OpenAI Responses API, **Chat** = OpenAI Chat Completions, **Msgs** = Anthropic Messages. "Gateway" means new-api or CLIProxyAPI on the VM.

| Criterion | Codex CLI 0.162.1 | OpenCode 1.19.0 | Claude Code 2.1.296 + gateway | OpenAI Agents SDK (py 0.23.1 / js 0.20.0) | Vercel AI SDK (`ai` 7.0.138) | Pydantic AI 2.55.0 | Hand-rolled loop |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| One-shot run | `codex exec "<prompt>"` | `opencode run "<prompt>"`, or `opencode serve` plus SDK | `claude -p` (see #6) | `Runner.run()` | `generateText` / `ToolLoopAgent` | `agent.run()` / `run_sync()` | Your process |
| Failure signal | Exit 1 when an error was seen (source) | `process.exitCode = 1` on a session error (source) | Exit non-zero (see #6) | Exceptions such as `MaxTurnsExceeded` | Exceptions; `finishReason` | Exceptions such as `UsageLimitExceeded` | Yours |
| JSON / schema output | `--json` JSONL events; `--output-schema <file>` | `--format json` events; JSON Schema only via SDK `format` | `--output-format json`, `--json-schema` (see #6) | Typed `output_type` | `Output.object` alongside tools | Typed `output_type` | Yours |
| Resume a session | `codex exec resume <id>` / `--last` | `--session <id>`, `--continue`, `--fork` | `--resume <id>` (see #6) | `SQLiteSession`; `RunState.to_json()` | You store messages | `message_history` / `conversation=` | Yours |
| Usage reporting | Tokens on `turn.completed`, no cost | Tokens and cost on each message | `total_cost_usd` estimate (see #6); unknown for non-Claude IDs | `context_wrapper.usage` (tokens, requests) | Per-step usage | `RunUsage` incl. cost | Gateway logs |
| Turn / spend caps | None in `exec --help`; budget features "under development" | Per-agent `steps`; no spend cap | `--max-budget-usd` (see #6) | `max_turns` (default 10) | `stopWhen`, default `isStepCount(20)` | `UsageLimits` (requests, tools, tokens, `cost_limit`) | Yours; gateway quotas |
| Wire APIs spoken | **Resp only** | Chat, Resp, Msgs (per provider package) | **Msgs only** (or Bedrock/Vertex formats) | Resp or Chat; others via LiteLLM/any-llm (beta) or the AI SDK adapter (js) | Chat, Resp, Msgs, more (per provider) | Chat, Resp, Msgs, more (per provider) | Any |
| **Works with ≥2 providers through the gateway** | **Yes, if every provider is reached as Resp.** ChatGPT native; DeepSeek and OpenRouter have native Resp; the VM's new-api rc.22 can't send Resp to its DeepSeek channel | **Yes**, natively per provider; also has its own ChatGPT Plus/Pro login | **Technically yes, unsupported by Anthropic.** DeepSeek and OpenRouter serve Msgs; GPT via CPA's translator | **Yes**; Anthropic only through an adapter | **Yes** | **Yes**; `FallbackModel`; `openai-codex:` uses a ChatGPT plan directly | **Yes**, you write the adapters |
| Translation risk through a gateway | High for non-OpenAI models (Resp→Chat drops reasoning items and Codex-only tools unless the gateway handles them) | Low if the gateway passes formats through | High: thinking, `context_management`, `output_config` and tool fields must survive Msgs→other | Low on Chat; hosted tools need OpenAI Resp | Low | Low | Low |
| Rules from git (auto-loaded) | `AGENTS.md` chain (32 KiB), `.agents/skills`; `.codex/` only if the project is trusted | `AGENTS.md` (else `CLAUDE.md`), `instructions` globs, skills | `CLAUDE.md`, `.claude/rules`, skills (see #6) | Nothing | Nothing | Nothing (the 0.x harness `RepoContext` loads repo instructions) | Nothing |
| Competing machine-local memory | Memories (off by default), `~/.codex/AGENTS.md`, `~/.codex/rules/default.rules` | `~/.config/opencode/AGENTS.md`, `~/.claude/CLAUDE.md` fallback | Auto memory (see #6) | None (sandbox agents have optional memory) | None | None | None |
| Deterministic Hard limits | `forbidden` shell rules (experimental), `PreToolUse` hooks incl. MCP, MCP allow/deny lists, admin `requirements.toml` | `deny` permission rules, plugin `tool.execute.before` | Deny rules, `PreToolUse` hooks (see #6) | Your tool code; `needs_approval` | Your tool code | Your tool code; `requires_approval` | Your code |
| Sandbox for shell and writes | **bwrap + seccomp by default; works on this VM** (probe) | **None** ("does not sandbox the agent") | Optional bwrap sandbox for Bash; needs `socat` (missing) | `SandboxAgent` with Unix-local or Docker clients | None | Harness can swap in a hosted sandbox (Modal, E2B, Sprites) | None unless you add one |
| MCP (Playwright browser) | stdio + HTTP; `required = true` fails the run if a server won't start | Local (stdio) and remote | Yes (see #6) | stdio, Streamable HTTP, SSE | `@ai-sdk/mcp`; stdio "for local development only" | Yes (`MCPServerStdio` etc.) | Official MCP SDKs |
| Fit on this VM | Installed; arm64 build runs | linux-arm64 binary and npm package | Installed | Python ≥3.10 ✓; Node ✓ | Node ≥22 ✓ | **2.55.0 needs Python ≥3.11** (2.54.0 is the last for 3.10) | ✓ |
| Licence / release pace | Apache-2.0; 14 stable releases 22 Sep – 9 Oct 2026 | MIT; ~30 releases Jul–Oct; OpenCode 2 tagged since 11 Sep | Anthropic terms (see #6) | MIT; 0.x | Apache-2.0; v5, v6 and v7 lines all patched 12 Oct | MIT; 2.x releases most weeks | — |
| Upgrade traps | Releases every 1–2 days; unknown model IDs fall back to generic metadata | v2 changes plugin API and permission format | `--bare` to become the `-p` default (see #6); gateway must forward new betas | 0.x API churn | Major versions yearly | Python floor raised in a minor release | You own all of it |

_Interpretation:_ "Works with ≥2 providers" is easiest where the harness can call each provider in that provider's own format: OpenCode and the SDKs. Codex and Claude Code each make one wire format compulsory. That leaves either the providers (DeepSeek, OpenRouter) or the gateway to bridge formats, and each bridge loses something (§9.6).

## 2. Codex CLI (`codex exec`)

### 2.1 Unattended runs

- **Command:** `codex exec [OPTIONS] [PROMPT]` ("Run Codex non-interactively"). The prompt can also come from stdin. "While `codex exec` runs, Codex streams progress to `stderr` and prints only the final agent message to `stdout`." `-o <file>` writes the last message to a file. [codex-noninteractive], [codex `--help`]
- **Events:** with `--json`, "`stdout` becomes a JSON Lines (JSONL) stream". "Event types include `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.*`, and `error`." `turn.completed` carries `usage` with `input_tokens`, `cached_input_tokens`, `output_tokens` and `reasoning_output_tokens`. It carries no cost figure. [codex-noninteractive]
- **Structured output:** "use `--output-schema` to request a final response that conforms to a JSON Schema." A missing or invalid schema file exits 1 before the run. [codex-noninteractive], [codex-exec-src]
- **Exit codes:** the docs don't list them. In the source, the run ends with `if error_seen { std::process::exit(1); }`. Bad input (no prompt, unreadable schema, no git repo) also exits 1. [codex-exec-src]
- **Approvals default to off in `exec`.** Source comment: "Default to never ask for approvals in headless mode." `--ask-for-approval` offers `on-request` and `never`. In config, `untrusted` "is unsupported, and `on-failure` is deprecated". [codex-exec-src], [codex `--help`], [codex-config-ref]
- **Sandbox default:** "By default, `codex exec` runs in a read-only sandbox." `--sandbox workspace-write` allows edits. [codex-noninteractive]
- **Sessions:** `codex exec resume <SESSION_ID> [PROMPT]` or `--last`; `codex exec fork`; `--ephemeral` saves nothing. [codex `exec resume --help`]
- **Git:** "Codex requires commands to run inside a Git repository to prevent destructive changes." `--skip-git-repo-check` overrides it. [codex-noninteractive]
- **Caps:** `codex exec --help` (0.162.1) has no turn-count, timeout or spend flag. `codex features list` on the VM shows `rollout_budget` and `token_budget` as "under development", both off. _Interpretation:_ a wall-clock limit has to come from outside, for example systemd's `RuntimeMaxSec=` or `timeout`, and a spend limit from the gateway's quotas (§9.7).
- **Auth:** "`codex exec` reuses saved CLI authentication by default." The docs call API keys the right default for CI and say "Treat `~/.codex/auth.json` like a password: it contains access tokens." [codex-noninteractive]

### 2.2 Custom provider (the gateway)

- **Responses only.** `model_providers.<id>.wire_api`: "`responses` is the only supported value, and it is the default when omitted." [codex-config-ref]
  - **History:** the Codex team's deprecation notice (9 Dec 2025) says "the Codex team is deprecating support for the `chat/completions` API. Full removal is slated for early February 2026." and "In February 2026, this will transition to a hard error as support is fully removed." [codex-chat-deprecation]
  - **Removal:** PR #10157, "chore: nuke chat/completions API", merged on 2026-02-03. [codex-pr-10157]
- **Provider block:** "A model provider defines how Codex connects to a model (base URL, wire API, authentication, and optional HTTP headers)." Fields include `base_url`, `env_key`, `experimental_bearer_token` ("discouraged; use `env_key`"), `auth.command`, `http_headers` and `supports_websockets`. Custom IDs "can't reuse the reserved built-in provider IDs: `openai`, `ollama`, and `lmstudio`." [codex-config-advanced], [codex-config-ref]
- **The provider can't live in the repo.** "Codex ignores the following keys in project-local `.codex/config.toml` and prints a startup warning when it sees them". The list includes `model_provider`, `model_providers`, `openai_base_url` and `profile`. The gateway therefore has to be configured in `~/.codex/config.toml`, a `--profile` file, or `-c` flags. [codex-config-advanced]
- **Unknown model names get generic settings.** In the source, a model slug Codex doesn't know logs "Unknown model {slug} is used. This will use fallback model metadata." That fallback assumes a 272,000-token context window and no supported reasoning levels, sets no `apply_patch` tool type, and sends a reasoning-summary parameter. [codex-model-info-src]
  - **Override:** `model_catalog_json` is an "Optional path to a JSON model catalog loaded on startup". [codex-config-ref]
  - **CLIProxyAPI's Codex guide** goes further: it marks `model_catalog_url` and `[features] api_key_model_discovery = true` as "Required for Codex v0.156.0 and later". On the VM, `api_key_model_discovery` is stable and on by default. [cpa-codex-client], [codex `features list`]
- **What survives a gateway:**
  - **Tool calls.** Codex sends Responses-native tool shapes: function tools plus custom tools such as `apply_patch`, and `exec`/shell tools. A gateway that converts to Chat has to turn these into function tools and back. new-api added that in rc.41 ("Keep Responses custom tools when converting to Chat Completions, so tools such as `exec` and `apply_patch` are no longer dropped"), and CLIProxyAPI has a dedicated `shell_tool.go` for it. [newapi-releases], [cpa-src]
  - **Reasoning.** Codex sends reasoning items back on later turns. Chat Completions has no field for them. DeepSeek's thinking mode then fails with "The `reasoning_content` in the thinking mode must be passed back to the API." CLIProxyAPI fixed this in June 2026 (issue #3710). [cpa-3710]
  - **Streaming.** Codex can use a Responses WebSocket transport (`supports_websockets`). new-api added a WebSocket relay in rc.38, and in rc.44 it sends a close frame "so Codex sees a normal close". [codex-config-ref], [newapi-releases]
  - **Structured output.** `--output-schema` travels as a Responses `text.format`. DeepSeek's Responses API lists `format` as "fully supported". _Unverified:_ what happens to `text.format` after a gateway converts Responses to Chat.
- **Local OSS providers:** `--oss` with Ollama or LM Studio. "If neither is set, the interactive CLI prompts you to choose; `codex exec` exits with an error." [codex-config-advanced]

### 2.3 Rules from git

- **`AGENTS.md`:** "Starting at the project root (typically the Git root), Codex walks down to your current working directory." In each directory it reads `AGENTS.override.md`, then `AGENTS.md`, then any `project_doc_fallback_filenames`. It stops once "the combined size reaches the limit defined by `project_doc_max_bytes` (32 KiB by default)." [codex-agents-md]
  - _Interpretation:_ the 32 KiB cap applies to the whole chain, so a growing set of Rules can be truncated silently. Raise the cap, or keep Rules in skills.
  - _Unverified:_ the page doesn't say outright that `codex exec` builds the same chain. It says Codex "builds an instruction chain when it starts (once per run".
- **Skills:** Codex "scans `.agents/skills` in every directory from your current working directory" up to the repo root. It also reads `$HOME/.agents/skills` and `/etc/codex/skills`. "Codex detects skill changes automatically." Skills load on use (progressive disclosure) and can be invoked with `$skill-name`. [codex-skills]
- **Trust gate:** "For security, Codex loads project-scoped config files only when the project is trusted." Also, "Untrusted projects skip project-scoped `.codex/` layers, including project-local config, hooks, and rules." Trust is set per path with `projects.<path>.trust_level`. [codex-config-advanced], [codex-config-ref]
  - _Interpretation:_ `AGENTS.md` and `.agents/skills` sit outside `.codex/`, so Rules kept there load either way. Hooks and `forbidden` rules kept in the repo need the repo to be trusted first. This is the same catch that #6 found for Claude Code's `permissions.allow`.
- **Machine-local stores that compete with Rules in git:**
  - Global `~/.codex/AGENTS.md` (or `AGENTS.override.md`). [codex-agents-md]
  - `~/.codex/rules/default.rules`: commands the person allow-lists in the TUI are written there. [codex-rules]
  - **Memories:** "Local Codex memories are off by default." When on, they live "under your Codex home directory", which is outside git. Codex builds them from "eligible prior chats", and a memory can carry a Correction outside git. `features.memories` is off on the VM. [codex-memories], [codex `features list`]

### 2.4 Hard limits and sandboxing

- **OS sandbox:** on Linux, Codex "uses `bwrap` plus `seccomp` by default."
  - **Network:** "the default `workspace-write` sandbox mode keeps network access turned off unless you enable it in your configuration."
  - **Writable area:** "The workspace includes the current directory and temporary directories like `/tmp`."
  - **Git:** "`<writable_root>/.git` is protected as read-only whether it appears as a directory or file." [codex-security]
  - _Interpretation:_ with `workspace-write` the agent can edit Rule files but can't commit them. A git commit of Rules would have to be done by the wrapper after the run, or approved specially.
- **Verified on this VM:** `codex sandbox <probe>`, with the default policy, could not write into a scratch directory ("Read-only file system") and could not reach `https://example.com`. The same probe run outside the sandbox did both. Ubuntu 22.04 does not restrict unprivileged user namespaces (`apparmor_restrict_unprivileged_userns = 0`).
- **Shell-command rules:** "Use rules to control which commands Codex can run outside the sandbox." Its three decisions are `allow`, `prompt` and "`forbidden`: Block the request without prompting". When several rules match, the most restrictive wins. "Rules are experimental and may change." Admins can enforce entries through `requirements.toml`. [codex-rules]
  - _Unverified:_ whether `forbidden` still applies under `danger-full-access`. The docs don't say.
- **Hooks:** `PreToolUse` covers "Shell commands, `apply_patch`, MCP tools, and other local function tools", but not hosted tools such as web search. A hook blocks a call with `"permissionDecision": "deny"` or exit code 2. "Treat tool hooks as a useful guardrail, not a complete enforcement boundary." "Non-managed hooks must be reviewed and trusted before they run." `--dangerously-bypass-hook-trust` skips that check for one run. [codex-hooks]
  - The `exec` source handles `HookStarted` and `HookCompleted` events, so hooks do run under `codex exec`. [codex-exec-src]
  - _Unverified:_ whether an untrusted hook is skipped silently or fails the run.
- **MCP tool control:** each server takes `enabled_tools` (allow list) and `disabled_tools` (deny list), plus `default_tools_approval_mode` and per-tool `approval_mode` (`auto | prompt | writes | approve`). [codex-config-ref]
  - _Unverified:_ what a `prompt` MCP tool does under `exec`, where approvals are `never`.
  - _Unverified:_ whether MCP server processes run inside the Codex sandbox.

### 2.5 Tools

- **MCP:** servers are configured under `mcp_servers.<id>` in config.toml (`codex mcp add|list|get|login`). `required`: "When true, fail startup/resume if this enabled MCP server cannot initialize". The non-interactive docs add that a required server that fails to start makes `codex exec` exit with an error rather than run without it. [codex-config-ref], [codex-noninteractive]
- **Built-in tools:** shell (`unified_exec`), `apply_patch`, `view_image`, and web search (`--search` turns on "the native Responses `web_search` tool"). Codex also has built-in browser and computer-use features (`browser_use`, `computer_use`), both stable and on by default per `codex features list`. [codex `--help`], [codex `features list`]
  - _Unverified:_ whether those built-in browser features need a desktop app or an OpenAI model.

### 2.6 Fit

- **Platform:** installed and running on this arm64 VM.
- **Licence:** Apache-2.0.
- **Release pace:** 14 stable releases from 0.156.0 (22 Sep 2026) to 0.162.1 (9 Oct 2026), and the last 100 GitHub releases include 86 pre-releases. [codex-releases]
- **Docs:** the URLs moved from `developers.openai.com/codex/...` to `learn.chatgpt.com/docs/...` (308 redirects seen on 2026-10-13).
- _Interpretation:_ at this pace, pin a version for the Assistant and upgrade on purpose. Defaults such as `--full-auto` (now deprecated) and the sandbox implementation (moved to `bwrap` in 0.115) have changed in place before. [codex-security]

## 3. OpenCode

The current stable release is **1.19.0** (`npm` `latest`, 11 Oct 2026). **OpenCode 2** has been tagged since 11 Sep 2026 (`v2.0.27` on 12 Oct). The website banner reads "New OpenCode v2 is now available", and the 1.19.0 notes say "Run `opencode upgrade --major` to upgrade to OpenCode 2." This section describes v1 unless noted. [opencode-releases], [opencode-cli]

### 3.1 Unattended runs

- **Command:** `opencode run` will "Run opencode in non-interactive mode by passing a prompt directly." Its flags include:
  - `--format`: "default (formatted) or json (raw JSON events)".
  - `--model provider/model`, `--agent`, `--session`/`-s`, `--continue`/`-c`, `--fork`, `--file`, `--attach <url>`.
  - `--auto`: "Auto-approve permissions that are not explicitly denied". [opencode-cli]
- **No prompts in `run`:** without `--auto`, a permission set to `ask` is answered automatically with `reject`, and the CLI prints "permission requested: … (…); auto-rejecting". Non-interactive runs also deny the `question`, `plan_enter` and `plan_exit` permissions. [opencode-run-src]
- **Exit codes:** not documented. In the source, a `session.error` event sets `process.exitCode = 1`, and argument errors call `process.exit(1)`. [opencode-run-src]
- **Usage:** session messages carry `cost` and `tokens` (input, output, reasoning, cache). [opencode-schema-src] _Unverified:_ how cost is priced for a custom gateway model with no price configured.
- **Caps:** per-agent `steps` will "Control the maximum number of agentic iterations an agent can perform before being forced to respond with text only." If unset, "the agent will continue to iterate until the model chooses to stop or the user interrupts the session." There is no spend cap. [opencode-agents]
- **Structured output:** only through the SDK or server, not the `run` flags. "The model will use a `StructuredOutput` tool to return validated JSON matching your schema", with `retryCount` defaulting to 2 and a `StructuredOutputError` after that. [opencode-sdk]
- **Server mode:** `opencode serve` is "a headless OpenCode server for API access". Its SECURITY.md says auth is opt-in through `OPENCODE_SERVER_PASSWORD`, and "Without this, the server runs unauthenticated (with a warning)." [opencode-cli], [opencode-security]

### 3.2 Custom provider

- **Per-provider wire API:** "`@ai-sdk/openai-compatible` for OpenAI-compatible providers (for `/v1/chat/completions`)". "If your provider/model uses `/v1/responses`, use `@ai-sdk/openai`." "You can customize the base URL for any provider by setting the `baseURL` option", which also covers the Anthropic provider. Each provider entry takes `apiKey` as `{env:VAR}`, `headers`, and `limit.context`/`limit.output`. [opencode-providers]
- **Its own ChatGPT login:** the OpenAI provider has a "**ChatGPT Plus/Pro** option and it'll open your browser and ask you to authenticate." So OpenCode can use the ChatGPT plan without a gateway. _Unverified:_ whether that login completes on a headless VM.
- _Interpretation:_ because each provider picks its own wire API, a gateway can pass DeepSeek, OpenRouter and the relay through in their native formats. Nothing is translated, so nothing is lost.

### 3.3 Rules from git

- **Instructions:**
  - "Place an `AGENTS.md` in your project root for project-specific rules." `CLAUDE.md` is used "if no `AGENTS.md` exists".
  - The `instructions` field in `opencode.json` takes files and globs, for example `"docs/guidelines.md"` and `".cursor/rules/*.md"`. They are combined with `AGENTS.md`. [opencode-rules]
- **Skills:** "Skills are loaded on-demand via the native `skill` tool". OpenCode reads them from `.opencode/skills/`, the Claude-compatible and `.agents` paths, and their global equivalents. [opencode-skills]
- **Machine-local competitors:**
  - `~/.config/opencode/AGENTS.md`.
  - `~/.claude/CLAUDE.md`, used "if no `~/.config/opencode/AGENTS.md` exists".
  - `OPENCODE_DISABLE_CLAUDE_CODE=1` turns off all `.claude` loading. [opencode-rules]
  - _Not found_ in the pages read: an auto-memory feature like Claude Code's or Codex's.

### 3.4 Hard limits

- **No sandbox, by design.** SECURITY.md: "OpenCode does **not** sandbox the agent. The permission system exists as a UX feature to help users stay aware of what actions the agent is taking". It continues: "If you need true isolation, run OpenCode inside a Docker container or VM." [opencode-security]
- **Permissions:**
  - `allow`, `ask` or `deny` per tool (`edit`, `bash`, `webfetch`, `external_directory`, `doom_loop`), with wildcard patterns for bash commands.
  - The "last matching rule" wins.
  - "Most permissions default to `"allow"`."
  - The page doesn't mention MCP tools. Those are switched off through `tools` globs instead. [opencode-permissions], [opencode-mcp]
- **Plugins as hooks:** `tool.execute.before` can block a call by throwing, as in the docs' `.env` example. [opencode-plugins] _Unverified:_ whether this hook sees MCP tools and subagents.
- **OpenCode 2 changes the enforcement surface:**
  - "V1 plugin implementations do not run in V2."
  - "V2 uses one ordered `permissions` array"; "`bash` is now `shell`, `task` is now `subagent`, and `write` and `patch` are now `edit`".
  - "Rename the singular `provider` map to `providers`."
  - "OpenCode 1 and OpenCode 2 both use the `opencode` command and are no longer installed side by side by default." [opencode-v2-migrate]

### 3.5 Tools and fit

- **MCP:** local servers (`type: "local"`, a `command`, and a tool-listing `timeout` that "Defaults to 5000 (5 seconds)") and remote servers with automatic OAuth. [opencode-mcp]
- **Platform:** `opencode-linux-arm64.tar.gz` ships with each release; the npm package lists `cpu: arm64, x64`. No Bun is needed to run the release binary. [opencode-releases]
- **Licence and pace:** MIT, about 30 releases between 27 Jul and 11 Oct 2026.
- **Updates:** the 1.19.0 notes say "updates are no longer installed automatically". [opencode-releases]

## 4. Claude Code pointed at a gateway

Unattended runs, Rules loading, Approvals, Hard limits and MCP are in #6 ([unattended-claude.md](https://github.com/ultrasadness/lab1/blob/research/unattended-claude/docs/research/unattended-claude.md)). This section covers what a gateway and non-Claude models change.

- **Format:** a gateway "must expose at least one of" Anthropic Messages (`/v1/messages`, selected by `ANTHROPIC_BASE_URL`), Bedrock InvokeModel or Vertex rawPredict. No OpenAI format is listed. [cc-gateway-protocol]
- **Non-Claude models are unsupported:** "Anthropic doesn't endorse, maintain, or audit third-party gateway products, and doesn't support routing Claude Code to non-Claude models through any gateway." [cc-gateway]
- **Credentials:**
  - **`ANTHROPIC_AUTH_TOKEN`** is sent as `Authorization: Bearer`. While it is set, "requests carry that credential in place of a developer's claude.ai subscription login". [cc-gateway], [cc-gateway-connect]
  - **`--bare`:** Anthropic auth is "strictly ANTHROPIC_API_KEY or apiKeyHelper via --settings". [claude `--help`]
  - **What stops working:** Remote Control "is also disabled while `ANTHROPIC_BASE_URL` points at a non-Anthropic host". #6 found that claude.ai connectors, such as the hosted Gmail connector, don't load with a gateway token. [cc-gateway-connect]
- **What a gateway must carry through:**
  - **Model fields.** "Request fields for a model ID Claude Code doesn't recognize, such as a gateway alias" include "Everything current Claude models accept on the Claude API, including adaptive reasoning, effort, and context management". So a gateway that maps a Claude-looking alias to DeepSeek or GPT receives `thinking: {"type": "adaptive"}`, `output_config` and `context_management`, and has to drop or translate them. [cc-gateway-protocol]
  - **Beta fields.** `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` removes "Context management", "beta tool schema fields, such as `strict` and `defer_loading`", "The structured-output `output_config.format` field" and "MCP tool search". It does not remove the adaptive `thinking` field or effort. [cc-gateway-protocol]
  - **No capability overrides.** The `ANTHROPIC_DEFAULT_*_MODEL_SUPPORTED_CAPABILITIES` variables "have no effect behind an `ANTHROPIC_BASE_URL` gateway". [cc-gateway-protocol]
  - **Streaming.** "If your gateway buffers a response until it is complete, Claude Code stalls." Claude Code expects every event "through the final `message_delta` and `message_stop` events". [cc-gateway-protocol]
  - **Errors.** "The retry logic matches on the upstream's error wording, so forward error response bodies unmodified." A gateway that "rewrites the upstream error" for context limits breaks auto-compaction. [cc-gateway-protocol], [cc-gateway-connect]
- **Background model:** with `ANTHROPIC_AUTH_TOKEN`, background tasks such as session titles use "The main model" unless `ANTHROPIC_DEFAULT_HAIKU_MODEL` is set. [cc-gateway-protocol]
- **Model discovery** (`CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`) keeps only IDs that contain `claude` or `anthropic`. Other names must be mapped with the model variables. [cc-gateway-protocol]
- **`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`** stops traffic that bypasses the gateway, and it "disables auto-updates", which is useful for pinning a version. [cc-gateway-connect]
- **Sandbox:** the optional Bash sandbox "covers shell commands only. Claude's file tools, MCP servers, and hooks run outside it". On Linux it "relies on `bubblewrap` and `socat`". bubblewrap is on the VM; socat is not. It is "off by default". [cc-sandboxing]
- **Non-Claude providers that serve Messages:**
  - **DeepSeek:** an Anthropic-compatible base URL, `https://api.deepseek.com/anthropic`. It maps `claude-opus*` to `deepseek-v4-pro` and `claude-sonnet*`/`claude-haiku*` to `deepseek-flash`. `thinking` is "Supported, but `budget_tokens` is ignored"; `output_config`: "Only `effort` is supported"; `mcp_servers` is ignored; `mcp_tool_use` blocks are "Not supported". [deepseek-anthropic]
  - **OpenRouter:** "OpenRouter exposes an input that is compatible with the Anthropic Messages API". But "Claude Code with OpenRouter is only guaranteed to work with the Anthropic first-party provider" and "may not work correctly with other providers." [openrouter-claude-code]
  - _Unverified:_ how `--max-budget-usd` and `total_cost_usd` price a non-Claude model behind an alias.

## 5. OpenAI Agents SDK (Python `openai-agents` 0.23.1, JS `@openai/agents` 0.20.0)

- **Wire APIs:**
  - `OpenAIResponsesModel` (the default) or `OpenAIChatCompletionsModel`.
  - Any OpenAI-compatible endpoint, through `AsyncOpenAI(base_url=...)` or `set_default_openai_api("chat_completions")`.
  - Other providers through "`openai-agents[litellm]`" or "`openai-agents[any-llm]`", both "best-effort, beta integrations". In JS, a Vercel AI SDK adapter is also available.
  - **Caveats:**
    - Responses support at other providers: "many other LLM providers still do not support it. You may see 404s".
    - Structured outputs: "Some model providers don't have support for structured outputs".
    - Tracing uploads to OpenAI by default, so turn it off (`set_tracing_disabled(True)`) when there is no OpenAI key.
    - Mixing models: "we recommend using a single model shape for each workflow". [agents-models], [agents-js-models]
- **Unattended runs and caps:**
  - `max_turns` raises `MaxTurnsExceeded`. `DEFAULT_MAX_TURNS = 10` in the source.
  - Usage via `result.context_wrapper.usage` (requests, input, output and reasoning tokens). Chat Completions streaming may need `include_usage=True`. No cost or token budget is documented.
  - Sessions (`SQLiteSession`) carry history between runs. [agents-running], [agents-usage], [agents-run-config-src]
- **Approvals:** `needs_approval` on tools, `require_approval` on local MCP servers, `RunState.to_json()` "to store pending work in a database or queue". Approval is "opt-in" for `ShellTool` and `ApplyPatchTool`. [agents-hitl] _Interpretation:_ since an Approval is a gate between runs, the Assistant needs this only if it ever pauses inside a run.
- **Tools:** function tools, local MCP over stdio, Streamable HTTP or SSE, and tool allow/block filters. Hosted tools such as web search, file search and hosted MCP need OpenAI Responses models. "Hosted tools currently work with OpenAI models that support the Responses API's hosted MCP integration." [agents-mcp], [agents-tools]
- **Rules from git:** nothing loads automatically. `SandboxAgent` can load skills lazily and keep "Agent memory" across sandbox runs. [agents-sandbox]
- **Fit:** Python `>=3.10` works on the VM's 3.10. MIT licence. The SDK is still 0.x.

## 6. Vercel AI SDK (`ai` 7.0.138)

- **Wire APIs:**
  - "The default OpenAI model factory (`openai('model-id')`) uses the Responses API". "Since AI SDK 5, the OpenAI responses API is called by default (unless you specify e.g. 'openai.chat')."
  - `createOpenAI({ baseURL })` targets a gateway.
  - `@ai-sdk/openai-compatible` calls `/chat/completions` and supports "models that return reasoning/thinking tokens (e.g., DeepSeek R1)".
  - `@ai-sdk/anthropic` takes a `baseURL` as well. [aisdk-openai], [aisdk-openai-compatible]
- **Loop and caps:** "By default, `ToolLoopAgent` stops after 20 steps using `isStepCount(20)`." `stopWhen` accepts custom conditions; the docs' example stops on an estimated cost ("Stop if cost exceeds $0.50"). [aisdk-loop-control]
- **Structured output with tools:** "you can combine it with tool calling in the same request", and the output "counts as a step". [aisdk-structured]
- **Approvals:** the result carries `tool-approval-request` parts. You answer with a `tool-approval-response` and call again. "The older `needsApproval` property on `tool()` definitions is deprecated." [aisdk-tools]
- **MCP:** `createMCPClient` from `@ai-sdk/mcp`. Stdio is "For local development only", and "The stdio transport should only be used for connecting to local servers as it cannot be deployed to production environments." [aisdk-mcp] _Interpretation:_ a Playwright MCP server on the same VM is exactly that local case. The warning is about serverless hosting.
- **Fit:** `engines.node >=22` (VM: 24); Apache-2.0. Major lines 5, 6 and 7 all got patches on 12 Oct 2026. Nothing loads Rules automatically, and there is no shell tool or sandbox.

## 7. Pydantic AI (2.55.0)

- **Wire APIs:**
  - "The bare 'openai:' prefix resolves to OpenAIResponsesModel"; `openai-chat:` pins Chat Completions.
  - For an endpoint without its own provider, "use OpenAIProvider with its base_url and api_key". The docs warn: "Compatibility with one API does not imply support for the other or for every OpenAI feature."
  - Non-OpenAI models behind an OpenAI-compatible URL need a model profile, or "features such as `thinking` or structured output may be ignored or rejected".
  - Anthropic-compatible gateways go through `AnthropicProvider(anthropic_client=AsyncAnthropic(base_url=...))`; the docs name "MiniMax, OpenRouter, or LiteLLM".
  - DeepSeek and OpenRouter have their own providers. [pyd-openai], [pyd-compatible], [pyd-anthropic], [pyd-models]
- **A ChatGPT plan without a gateway:** the `openai-codex:` prefix lets you "Use your ChatGPT/Codex subscription with Pydantic AI instead of a pay-per-token API key". It "reads the CLI's credentials from `~/.codex/auth.json`" and the file "is never written to; refreshed tokens live in memory". "The provider refreshes expired tokens automatically, and refresh tokens are single-use." "There is no device flow." "The Codex backend is streaming-only". [pyd-openai-codex]
  - _Interpretation:_ single-use refresh tokens mean two clients refreshing the same login can lock each other out. The same holds for Codex CLI, Pydantic AI, and a gateway credential pasted from that login.
- **Fallback across providers:** "you can use FallbackModel to attempt multiple models in sequence until one succeeds". "Validation errors… do **not** trigger fallback". "Response-based fallback currently only works with non-streaming requests". [pyd-models]
- **Caps and usage:** `UsageLimits` caps requests, `tool_calls_limit`, output tokens, `per_request_input_tokens_limit` and `cost_limit` ("caps `RunUsage.cost` in USD"). Going over raises `UsageLimitExceeded`. [pyd-agent]
- **Approvals:** `requires_approval=True` or `ApprovalRequired` ends the run with `DeferredToolRequests`. You "Store the paused conversation", and "the conversation you store is everything you need to resume". [pyd-deferred]
- **Harness:** `pydantic-ai-harness[coder]` adds file-system, shell, repo-context and sub-agent tools. Its shell runs "without an allowlist, and the file tools' path limits don't apply to them". Isolation means swapping "`LocalWorkspace` for a sandbox capability (Modal, E2B, or Sprites)". "While Pydantic AI Harness is on 0.x releases, the API may change between minor releases." [pyd-harness-coder]
- **Fit:** the 2.55.0 release (9 Oct 2026) says "Require Python 3.11 or newer in every package; Python 3.10 installs resolve to 2.54.0 and earlier". The VM has Python 3.10.12. MIT. A 1.x line is still maintained (1.107.7, 30 Sep 2026). [pyd-2.55.0], [pypi]

## 8. Hand-rolled loop

No primary source covers a loop the Assistant would write itself. What follows is _Interpretation_.

- **What you write:** a loop that calls the gateway's Chat Completions endpoint (the format DeepSeek, OpenRouter and most relays share), runs tools in-process, and calls MCP through an official MCP SDK. This gives the tightest control:
  - Rules load exactly as the code says.
  - Each Hard limit is an `if` in the tool layer.
  - No machine-local memory competes with the Personal database.
- **What you own:** streaming parsing, tool-call assembly, retries, context compaction, transcript storage, and each provider's quirks, such as passing DeepSeek's `reasoning_content` back on tool turns.
- **What it saves:** none of the CLIs' upgrade churn affects it.
- **No other harnesses added:** nothing else found clearly beats the listed candidates on these criteria.

## 9. Gateways: new-api and CLIProxyAPI

### 9.1 What runs on the VM now

- **new-api:** image `calciumion/new-api:latest`, labelled `org.opencontainers.image.version: v1.0.0-rc.22` and built 2026-07-26. Upstream is at `v1.0.0-rc.44` (12 Oct 2026), 384 commits later. [newapi-releases]
- **Ports:** `docker ps` shows `3000/tcp` with no host mapping. Only `caddy` publishes ports (80/443).
  - _Interpretation:_ a harness running on the host reaches new-api through Caddy or a newly published port, not `localhost:3000`.
- **gpt-load** (`ghcr.io/tbphp/gpt-load`) also runs, on `3001/tcp`. It was not researched here.

### 9.2 "CPA" is CLIProxyAPI

CLIProxyAPI's own README lists companion projects named "CPA Usage Keeper", "CPA-Manager-Plus" and "Oh-My-CPA". It describes itself as "a proxy server that provides OpenAI/Gemini/Claude/Codex/Grok compatible API interfaces for CLI." [cpa-readme]

### 9.3 What each can serve from a subscription login

| | new-api | CLIProxyAPI |
| :-- | :-- | :-- |
| ChatGPT / Codex plan | Channel type 57, "ChatGPT Subscription (Codex)", described as "Access Codex using ChatGPT subscription credentials". Its key field asks you to "Paste Codex OAuth JSON credential (access_token / refresh_token / account_id)". new-api refreshes it itself: every 10 minutes it checks, and refreshes when expiry is less than 24 hours away. It reaches `chatgpt.com` at `/backend-api/codex/responses`. Present in rc.22. [newapi-src-ui], [newapi-codex-src] | `--codex-login` runs CLIProxyAPI's own OAuth ("add `--no-browser` to print the login URL"; "The local OAuth callback uses port `1455`"). It load-balances across several accounts. [cpa-codex], [cpa-readme] |
| Claude plan | No subscription channel type; the Anthropic channel uses an API key. (A "Sub2API" channel type connects to another gateway.) [newapi-src-ui] | "Claude Code support via OAuth login", with load-balancing across several accounts. [cpa-readme] |
| Others | API-key channels: OpenRouter (type 20), DeepSeek (43), custom/"Advanced Custom" relays (8, 58) and more. [newapi-constants] | OAuth for Gemini (Antigravity), Grok Build, Kimi, Muse Code, Devin. API-key upstreams through `openai-compatibility` (OpenRouter is the docs' example) and `codex-api-key` ("upstream Codex compatible providers"). [cpa-readme], [cpa-openai-compat], [cpa-codex-compat] |

- **A ChatGPT login wants one client.** _Interpretation:_ given single-use refresh tokens (§7), the ChatGPT login pasted into new-api should be a separate login from the one in `~/.codex/auth.json`. CLIProxyAPI avoids this by running its own login.
- **Headless login:** _Unverified:_ how to finish CLIProxyAPI's port-1455 callback on a VM with no browser. An SSH tunnel is the likely route.
- **Support boundary:** new-api's issue template says "Reports about Coding Plan services, reverse-engineered channels, third-party API wrappers, or compatibility issues caused by exposing a Codex endpoint through a reverse proxy as a general-purpose API are not accepted." [newapi-issue-template]

### 9.4 Wire APIs exposed

- **new-api (current source):** "OpenAI Chat / Responses | `POST /v1/chat/completions`, `POST /v1/responses`", "Anthropic Messages | `POST /v1/messages`", Gemini `generateContent`, and a Responses WebSocket. [newapi-readme]
  - The Codex channel itself answers only `/v1/responses` (plus `/compact` and `/alpha/search`). For `/v1/chat/completions` and `/v1/messages` it returns "codex channel: … endpoint not supported". [newapi-codex-src]
  - A global `ChatCompletionsToResponsesPolicy` (off by default) can route Chat Completions requests to Responses-only channels. It is in rc.22 too. [newapi-settings-src]
- **new-api rc.22 (the VM's build):** its README listed "OpenAI Compatible ⇄ Claude Messages", "OpenAI Compatible → Google Gemini", and "🚧 **OpenAI Compatible ⇄ OpenAI Responses** - In development". In rc.22 the DeepSeek channel's `ConvertOpenAIResponsesRequest` is a stub returning "not implemented". [newapi-rc22]
- **CLIProxyAPI:** clients can use "any OpenAI (including Responses), Gemini (including Interactions), or Claude-compatible client or SDK". In the source, translators are arranged as `internal/translator/<upstream>/<client format>`. Examples:
  - `openai/claude`: "transforming Anthropic API requests into OpenAI Chat Completions API format".
  - `openai/openai/responses`: `ConvertOpenAIResponsesRequestToOpenAIChatCompletions`.
  - `codex/claude`: Messages clients reach Codex upstreams. [cpa-readme], [cpa-src]

### 9.5 Which provider reaches which harness (the ≥2-providers requirement)

| Harness ↓ / provider → | ChatGPT plan (Codex login) | DeepSeek | OpenRouter | Unnamed relay |
| :-- | :-- | :-- | :-- | :-- |
| **Codex CLI** (Resp only) | Native login; or new-api Codex channel / CPA `--codex-login` | DeepSeek's own Responses API: "To meet the demand for Codex, our API now supports the Responses API format". Through new-api: rc.22 ✗ ("not implemented"); passed through since "feat: deepseek responses api" (merged 2026-07-31). Through CPA: Resp→Chat translation. [deepseek-responses], [newapi-pr-6562] | Native `/api/v1/responses` ("This API is **stateless**"); or a gateway translating to Chat. [openrouter-responses] | Works if it serves Responses; otherwise needs gateway translation |
| **OpenCode** | Its own "ChatGPT Plus/Pro" login, or a gateway Resp endpoint via `@ai-sdk/openai` | Chat via `@ai-sdk/openai-compatible`, or Msgs | Built-in provider or Chat | Whatever it serves |
| **Claude Code** (Msgs only) | CPA `codex/claude` translator. new-api's Codex channel rejects `/v1/messages`; "Advanced Custom channels can convert Claude Messages and Gemini to OpenAI Responses" (rc.42) | DeepSeek's `/anthropic` endpoint; new-api's DeepSeek channel sends Claude format to `/anthropic/v1/messages` natively | "Anthropic Skin" at `https://openrouter.ai/api` | Works if it serves Msgs; otherwise needs gateway translation |
| **Agents SDK / AI SDK / Pydantic AI / hand-rolled** | Gateway Resp endpoint; Pydantic AI also has `openai-codex:` | Chat (or Resp, Msgs) | Chat (or Resp, Msgs) | Whatever it serves |

All three provider APIs here are stateless. DeepSeek's Responses API: `previous_response_id` is "Not supported (stateless API)"; `store` is "Not supported". OpenRouter rejects `store: true` or a `previous_response_id`. [deepseek-responses], [openrouter-responses] _Unverified:_ that Codex 0.162.1 never sends `previous_response_id` to a custom provider.

### 9.6 What breaks in translation

**new-api's own quality grades.** RelayKit, new-api's converter (module split out on 27 Jul 2026, after rc.22), grades each path. Translated from Chinese:

| From \ to | Chat | Responses | Claude Messages | Gemini |
| :-- | :-: | :-: | :-: | :-: |
| Chat | | good | fair | fair |
| Responses | good | | fair | fair |
| Claude Messages | fair | fair | | discouraged |

- **What the grades mean:** "`good` means the two protocols are structurally close and fields map one-to-one; `fair` means the main content converts and protocol-specific fields are reported as diagnostics"; "Claude to Responses responses … go through OpenAI Chat". [newapi-relaykit] (translated)
- **Losses are allowed by default:** `ToolLossPolicy` "`allow` is the default: the conversion completes and all losses are returned as diagnostics". Only `safe` or `strict` turns them into errors. [newapi-relaykit] (translated)
- **The diagnostics may not reach anyone:** open issue #7456 says "RequestResult.Diagnostics is discarded on the success path, so tool policy losses are never logged or returned". [newapi-7456]

What fails, by kind:

- **Tool calls:**
  - new-api: "Keep Responses custom tools when converting to Chat Completions, so tools such as `exec` and `apply_patch` are no longer dropped" (rc.41). "Responses custom tools such as `exec` and `apply_patch` are kept on Claude and Gemini upstreams" (rc.42). Still open: "#5938 Responses→Chat conversion drops mcp tools" and "#7593 Anthropic /v1/messages tools 字段未转换为 OpenAI 格式，上游报 400". [newapi-releases], [newapi-issues]
  - DeepSeek's Responses API accepts `function` tools ("other types ignored") and, as a custom tool, only `apply_patch` "for Codex compatibility; other names return a `400` error". [deepseek-responses]
- **Reasoning:**
  - Responses→Chat drops reasoning items unless the gateway rebuilds `reasoning_content`; DeepSeek's thinking mode then rejects the follow-up turn. CLIProxyAPI fixed this in June 2026 (#3710). [cpa-3710]
  - DeepSeek Responses: "`effort` supported; `summary` accepted but no summary is generated". [deepseek-responses]
  - CLIProxyAPI: "Numeric budgets don't change reasoning effort for these protocols" (OpenAI, Codex, OpenRouter), and values out of range "are clamped". [cpa-thinking]
  - Claude Code sends adaptive `thinking` to unknown model IDs (§4). new-api rc.44 started forwarding `thinking.block_binding` "and every `anthropic-beta` header value" to fix "The block is bound to a different conversation". [newapi-releases]
- **Streaming:** new-api rc.44 fixed lost text when "Chat streams converted to Claude Messages" and kept "assistant text next to tool calls" in Messages→Chat. CLIProxyAPI has an open report: "Codex SSE: frequent incomplete streams at 22s and ~900s" (#6469). [newapi-releases], [cpa-issues]
- **Structured output:** Claude Code's `output_config.format` must be dropped or translated (`CLAUDE_CODE_DISABLE_STRUCTURED_OUTPUTS=1`). DeepSeek's Anthropic endpoint supports "Only `effort`" in `output_config`. [cc-gateway-protocol], [deepseek-anthropic] _Unverified:_ how either gateway maps a Responses `text.format` JSON Schema onto a Chat-only upstream.

### 9.7 Operations

- **Usage and caps:**
  - new-api keeps usage logs and quotas per key: "Manage quotas, subscriptions, usage logs, cache accounting, and expression-based pricing". [newapi-readme] _Interpretation:_ a per-key quota in the gateway is one deterministic spend cap that works whichever harness runs, including Codex, which has none of its own.
  - CLIProxyAPI: "Since v6.10.0, CLIProxyAPI … no longer ship built-in usage statistics". An add-on is needed. [cpa-readme]
- **Licence and pace:**
  - new-api: AGPL-3.0; rc.37 to rc.44 in one month.
  - CLIProxyAPI: MIT; v7.0.0 on 9 May 2026, v8.0.0 on 27 Sep 2026, then ten releases (v8.0.18–v8.0.27) in six days. Each release ships a `linux_aarch64` build.
  - Both document fixes in nearly every release that change translation behaviour. [newapi-releases], [cpa-releases]

## 10. Open risks and items not verified

- _Unverified:_ that the VM's new-api rc.22 can serve Codex at all through a Codex or OpenAI channel without upgrading. Nothing was sent to it in this research.
- _Unverified:_ whether `codex exec` runs Rules-bearing `AGENTS.md` identically to the TUI, and whether untrusted hooks are skipped or fatal.
- _Unverified:_ whether Codex's `forbidden` rules hold under `danger-full-access`, and whether MCP servers run inside its sandbox.
- _Unverified:_ how OpenCode's `tool.execute.before` treats MCP tools, and how OpenCode prices custom gateway models.
- _Unverified:_ how any CLI prices non-Claude or non-OpenAI models in its cost output. Treat CLI cost figures as unreliable behind a gateway, and use the gateway's logs.
- _Unverified:_ whether the person's "DeepSeek plan" is an API balance or a subscription. DeepSeek's API docs describe API keys only.
- _Unverified:_ the unnamed relay's wire APIs. It decides whether Codex or Claude Code can use it without translation.
- **Shared login:** single-use refresh tokens (Pydantic AI docs) imply that one ChatGPT login shared by Codex CLI, a gateway channel and a library will break on refresh. _Interpretation_, not tested.
- **Moving targets:**
  - OpenCode 2 is rolling out (new plugin API and permission format).
  - Pydantic AI raised its Python floor in a minor release.
  - Codex removed a whole wire API within two months of announcing it.
  - The gateways' translation layers change weekly.
  - Re-check versions before building.

## 11. Decisions this raises

- **Gateway role:** pass formats through, or translate? If the gateway only passes each provider through in its native format, Codex and Claude Code are limited to the providers that natively serve their one format. If it translates, the losses in §9.6 apply.
- **new-api upgrade:** rc.22 → rc.44, or move to CLIProxyAPI (or run both)? Codex-to-DeepSeek routing through new-api needs at least the 2026-07-31 change.
- **ChatGPT login:** one login per client, or which single client owns it?
- **Hard limits:** where do they live? In the harness (Codex sandbox and rules, OpenCode permissions, Claude Code deny rules and hooks), in the Assistant's own tool code (SDKs, hand-rolled), or in the gateway (quotas)?
- **Machine-local stores:** turn off or empty Codex Memories, `~/.codex/AGENTS.md`, `~/.config/opencode/AGENTS.md`, `~/.claude/CLAUDE.md` and Claude Code auto memory, so Rules live only in git?
- **Python:** 3.10 on the host with Pydantic AI ≤2.54, or a Python 3.11+ container?

## Sources

Docs pages carry no visible date unless noted. "Read" is the fetch date, 2026-10-13. Source-code links point at `main` on 2026-10-13 unless a tag is named.

**Observed on the VM (2026-10-13)**
- [codex `--help`], [codex `exec resume --help`], [codex `features list`]: `codex-cli 0.162.1` on the VM.
- [claude `--help`]: Claude Code 2.1.296 on the VM.
- Sandbox probe: `codex sandbox <probe.sh>` with the default policy, plus the same script outside the sandbox as a control.

**Codex CLI**
- [codex-noninteractive]: Non-interactive mode. https://learn.chatgpt.com/docs/non-interactive-mode (redirected from developers.openai.com/codex/noninteractive; read 2026-10-13)
- [codex-config-advanced]: Advanced configuration. https://learn.chatgpt.com/docs/config-file/config-advanced (read 2026-10-13)
- [codex-config-ref]: Configuration reference. https://learn.chatgpt.com/docs/config-file/config-reference (read 2026-10-13)
- [codex-agents-md]: AGENTS.md. https://learn.chatgpt.com/docs/agent-configuration/agents-md (read 2026-10-13)
- [codex-skills]: Build skills. https://learn.chatgpt.com/docs/build-skills (read 2026-10-13)
- [codex-memories]: Memories. https://learn.chatgpt.com/docs/customization/memories?surface=cli (read 2026-10-13)
- [codex-hooks]: Hooks. https://learn.chatgpt.com/docs/hooks (read 2026-10-13)
- [codex-rules]: Rules. https://learn.chatgpt.com/docs/agent-configuration/rules (read 2026-10-13)
- [codex-security]: Agent approvals & security. https://learn.chatgpt.com/docs/agent-approvals-security.md (read 2026-10-13)
- [codex-chat-deprecation]: "Deprecating `chat/completions` support in Codex", discussion #7782, 2025-12-09. https://github.com/openai/codex/discussions/7782
- [codex-pr-10157]: "chore: nuke chat/completions API", merged 2026-02-03. https://github.com/openai/codex/pull/10157
- [codex-exec-src]: `codex-rs/exec/src/lib.rs`. https://github.com/openai/codex/blob/main/codex-rs/exec/src/lib.rs (read 2026-10-13)
- [codex-model-info-src]: `codex-rs/models-manager/src/model_info.rs`. https://github.com/openai/codex/blob/main/codex-rs/models-manager/src/model_info.rs (read 2026-10-13)
- [codex-releases]: https://github.com/openai/codex/releases (rust-v0.156.0, 2026-09-22 to rust-v0.162.1, 2026-10-09)

**OpenCode**
- [opencode-cli]: CLI. https://opencode.ai/docs/cli/ (page "Last updated: Oct 13, 2026")
- [opencode-providers]: Providers. https://opencode.ai/docs/providers/ (read 2026-10-13)
- [opencode-rules]: Rules. https://opencode.ai/docs/rules/ (read 2026-10-13)
- [opencode-permissions]: Permissions. https://opencode.ai/docs/permissions/ (read 2026-10-13)
- [opencode-plugins]: Plugins. https://opencode.ai/docs/plugins/ (read 2026-10-13)
- [opencode-agents]: Agents. https://opencode.ai/docs/agents/ (read 2026-10-13)
- [opencode-skills]: Skills. https://opencode.ai/docs/skills/ (read 2026-10-13)
- [opencode-mcp]: MCP servers. https://opencode.ai/docs/mcp-servers/ (read 2026-10-13)
- [opencode-sdk]: SDK. https://opencode.ai/docs/sdk/ (read 2026-10-13)
- [opencode-v2-migrate]: Migrate from V1. https://opencode.ai/v2/docs/migrate-v1 (read 2026-10-13)
- [opencode-security]: SECURITY.md. https://github.com/anomalyco/opencode/blob/dev/SECURITY.md (read 2026-10-13)
- [opencode-run-src]: `packages/opencode/src/cli/cmd/run.ts` at tag `v1.19.0`. https://github.com/anomalyco/opencode/blob/v1.19.0/packages/opencode/src/cli/cmd/run.ts
- [opencode-schema-src]: `packages/schema/src/v1/session.ts` at tag `v1.19.0`. https://github.com/anomalyco/opencode/blob/v1.19.0/packages/schema/src/v1/session.ts
- [opencode-releases]: https://github.com/anomalyco/opencode/releases (v1.19.0, 2026-10-11); npm `opencode-ai` dist-tags (read 2026-10-13); tag `v2.0.0` (2026-09-11) to `v2.0.27` (2026-10-12)

**Claude Code** (beyond #6)
- [cc-gateway]: Other LLM gateways. https://code.claude.com/docs/en/llm-gateway (read 2026-10-13)
- [cc-gateway-connect]: Connect Claude Code to an LLM gateway. https://code.claude.com/docs/en/llm-gateway-connect (read 2026-10-13)
- [cc-gateway-protocol]: Claude Code gateway compatibility guide. https://code.claude.com/docs/en/llm-gateway-protocol (read 2026-10-13)
- [cc-sandboxing]: Configure the sandboxed Bash tool. https://code.claude.com/docs/en/sandboxing (read 2026-10-13)
- Earlier research: `docs/research/unattended-claude.md` on branch `research/unattended-claude` (ticket #6)

**OpenAI Agents SDK**
- [agents-models]: Models. https://openai.github.io/openai-agents-python/models/ (read 2026-10-13)
- [agents-running]: Running agents. https://openai.github.io/openai-agents-python/running_agents/ (read 2026-10-13)
- [agents-usage]: Usage. https://openai.github.io/openai-agents-python/usage/ (read 2026-10-13)
- [agents-hitl]: Human-in-the-loop. https://openai.github.io/openai-agents-python/human_in_the_loop/ (read 2026-10-13)
- [agents-mcp]: MCP. https://openai.github.io/openai-agents-python/mcp/ (read 2026-10-13)
- [agents-tools]: Tools. https://openai.github.io/openai-agents-python/tools/ (read 2026-10-13)
- [agents-sandbox]: Sandbox agents. https://openai.github.io/openai-agents-python/sandbox_agents/ (read 2026-10-13)
- [agents-js-models]: Models (JS). https://openai.github.io/openai-agents-js/guides/models/ (read 2026-10-13)
- [agents-run-config-src]: `src/agents/run_config.py`. https://github.com/openai/openai-agents-python/blob/main/src/agents/run_config.py (read 2026-10-13)

**Vercel AI SDK**
- [aisdk-loop-control]: Loop control. https://ai-sdk.dev/docs/agents/loop-control (read 2026-10-13)
- [aisdk-tools]: Tools and tool calling. https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling (read 2026-10-13)
- [aisdk-mcp]: MCP tools. https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools (read 2026-10-13)
- [aisdk-structured]: Generating structured data. https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data (read 2026-10-13)
- [aisdk-openai]: OpenAI provider. https://ai-sdk.dev/providers/ai-sdk-providers/openai (read 2026-10-13)
- [aisdk-openai-compatible]: OpenAI-compatible providers. https://ai-sdk.dev/providers/openai-compatible-providers (read 2026-10-13)

**Pydantic AI**
- [pyd-openai]: OpenAI. https://pydantic.dev/docs/ai/models/openai/ (read 2026-10-13)
- [pyd-openai-codex]: OpenAI Codex. https://pydantic.dev/docs/ai/models/openai-codex/ (read 2026-10-13)
- [pyd-compatible]: Other compatible APIs. https://pydantic.dev/docs/ai/models/compatible-apis/ (read 2026-10-13)
- [pyd-anthropic]: Anthropic. https://pydantic.dev/docs/ai/models/anthropic/ (read 2026-10-13)
- [pyd-models]: Models overview. https://pydantic.dev/docs/ai/models/overview/ (read 2026-10-13)
- [pyd-agent]: Agents (usage limits). https://pydantic.dev/docs/ai/core-concepts/agent/ (read 2026-10-13)
- [pyd-deferred]: Deferred tools. https://pydantic.dev/docs/ai/tools-toolsets/deferred-tools/ (read 2026-10-13)
- [pyd-harness-coder]: Harness: Coder. https://pydantic.dev/docs/ai/harness/coder/ (read 2026-10-13)
- [pyd-2.55.0]: Release v2.55.0, 2026-10-09. https://github.com/pydantic/pydantic-ai/releases/tag/v2.55.0

**Package registries (read 2026-10-13)**
- [pypi]: `openai-agents` 0.23.1 (`>=3.10`), `pydantic-ai` 2.55.0 (`>=3.11`), 2.54.0 and 1.107.7 (`>=3.10`). https://pypi.org/
- npm: `@openai/agents` 0.20.0; `ai` 7.0.138 (`node >=22`, Apache-2.0); `@ai-sdk/openai` 4.0.92; `@ai-sdk/openai-compatible` 3.0.68; `@ai-sdk/anthropic` 4.0.79; `@ai-sdk/mcp` 2.0.74. https://www.npmjs.com/

**Providers**
- [deepseek-responses]: Responses API. https://api-docs.deepseek.com/guides/responses_api (read 2026-10-13)
- [deepseek-anthropic]: Anthropic API. https://api-docs.deepseek.com/guides/anthropic_api (read 2026-10-13)
- DeepSeek, Codex integration. https://api-docs.deepseek.com/quick_start/agent_integrations/codex (read 2026-10-13)
- [openrouter-responses]: Responses API overview. https://openrouter.ai/docs/api/reference/responses/overview (read 2026-10-13)
- [openrouter-claude-code]: Claude Code integration. https://openrouter.ai/docs/guides/guides/claude-code-integration (read 2026-10-13)

**new-api**
- [newapi-readme]: README.en.md on `main`. https://github.com/QuantumNous/new-api/blob/main/README.en.md (read 2026-10-13)
- [newapi-rc22]: README.en.md and `relay/channel/deepseek/adaptor.go` at tag `v1.0.0-rc.22` (2026-07-26). https://github.com/QuantumNous/new-api/tree/v1.0.0-rc.22
- [newapi-relaykit]: RelayKit README (Chinese; quotes translated). https://github.com/QuantumNous/new-api/blob/main/relaykit/README.md (read 2026-10-13)
- [newapi-codex-src]: `relay/channel/codex/adaptor.go`, `service/codex_oauth.go`, `service/codex_credential_refresh_task.go`. https://github.com/QuantumNous/new-api/tree/main/relay/channel/codex (read 2026-10-13)
- [newapi-src-ui]: `web/src/features/channels/constants.ts`. https://github.com/QuantumNous/new-api/blob/main/web/src/features/channels/constants.ts (read 2026-10-13)
- [newapi-constants]: `constant/channel.go`. https://github.com/QuantumNous/new-api/blob/main/constant/channel.go (read 2026-10-13)
- [newapi-settings-src]: `setting/model_setting/global.go`, on `main` and at `v1.0.0-rc.22`. https://github.com/QuantumNous/new-api/blob/main/setting/model_setting/global.go
- [newapi-pr-6562]: "feat: deepseek responses api", merged 2026-07-31. https://github.com/QuantumNous/new-api/pull/6562
- [newapi-releases]: Releases v1.0.0-rc.23 to rc.44 (2026-07 to 2026-10-12). https://github.com/QuantumNous/new-api/releases
- [newapi-7456]: Issue #7456, open. https://github.com/QuantumNous/new-api/issues/7456 (read 2026-10-13)
- [newapi-issue-template]: the bug-report template text, as shown in issue #7456 (read 2026-10-13)
- [newapi-issues]: Issues #5938 and #7593, both open on 2026-10-13. https://github.com/QuantumNous/new-api/issues

**CLIProxyAPI**
- [cpa-readme]: README.md. https://github.com/router-for-me/CLIProxyAPI/blob/main/README.md (read 2026-10-13)
- [cpa-codex]: Codex provider. https://help.router-for.me/configuration/provider/codex.html (read 2026-10-13)
- [cpa-openai-compat]: OpenAI compatibility. https://help.router-for.me/configuration/provider/openai-compatibility.html (read 2026-10-13)
- [cpa-codex-compat]: Codex compatibility. https://help.router-for.me/configuration/provider/codex-compatibility.html (read 2026-10-13)
- [cpa-codex-client]: Agent client: Codex. https://help.router-for.me/agent-client/codex.html (read 2026-10-13)
- [cpa-thinking]: Thinking. https://help.router-for.me/configuration/thinking.html (read 2026-10-13)
- [cpa-src]: `internal/translator/…` on `main`, including `openai/claude/openai_claude_request.go`, `openai/openai/responses/openai_openai-responses_request.go` and `shell_tool.go`. https://github.com/router-for-me/CLIProxyAPI/tree/main/internal/translator (read 2026-10-13)
- [cpa-3710]: Issue #3710, "Fix DeepSeek reasoning_content replay in Responses-to-Chat conversion", closed 2026-06-19. https://github.com/router-for-me/CLIProxyAPI/issues/3710
- [cpa-issues]: Issue #6469, open. https://github.com/router-for-me/CLIProxyAPI/issues/6469
- [cpa-releases]: https://github.com/router-for-me/CLIProxyAPI/releases (v7.0.0 2026-05-09; v8.0.0 2026-09-27; v8.0.27 2026-10-12)
