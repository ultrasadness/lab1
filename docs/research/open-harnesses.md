# Open, extensible harnesses: Pi and DeepSeek Harness

Research for ticket #24 on the map (#1). It answers: the person wants an open-source harness they can extend feature by feature as the Assistant grows, and named "Pi" and "the DeepSeek harness". How well does each fit, measured against the facts already gathered for Codex CLI and OpenCode?

- **Researched:** 2026-10-13, from primary sources: each project's own docs and source code at a named tag, release notes, package registries, OpenAI's Sign in with ChatGPT developer docs, and DeepSeek's own product page. Each source is listed at the end with the date it showed or the date it was read.
- **Observed on the VM** (2026-10-13): Linux 6.8.0-1060-oracle `aarch64`; active LSMs `lockdown,capability,landlock,yama,apparmor`; glibc 2.35; bubblewrap 0.6.1; Node v24.20.0; Python 3.10.12. Neither `pi` nor `dsh` is installed, and there is no `~/.pi` or `~/.dsh`. Nothing was installed or run for this research. Both projects were read from source tarballs unpacked under `/tmp`.
- **Builds on:**
  - [`docs/research/agent-harnesses.md`](https://github.com/ultrasadness/lab1/blob/research/agent-harnesses/docs/research/agent-harnesses.md) (#22): Codex CLI, OpenCode, the gateways. Codex and OpenCode facts are cited from there, not re-researched. They appear here as reference columns, plus a few extensibility facts that file did not cover.
  - [`docs/research/provider-terms.md`](https://github.com/ultrasadness/lab1/blob/research/provider-terms/docs/research/provider-terms.md) (#23): what each plan permits.
- **Scope:** fit as the Assistant's harness, with weight on extensibility: how a new capability is added, how stable that API is, and whether the harness can be embedded in our own Node or Python process. This file does not pick a harness.
- **Quotes vs inference:** passages in quotation marks are verbatim. A few are translated from Chinese, and marked so. Anything marked _Interpretation_ or _Unverified_ is mine, not the source's.

## Answer in brief

1. **Identity: both names resolve to one clear project each.**
   - **"Pi" is the pi coding agent**, now `earendil-works/pi`, published as `@earendil-works/pi-coding-agent` 1.2.0. It began as Mario Zechner's `badlogic/pi-mono` (`@mariozechner/pi-coding-agent`). The GitHub repo redirects, and the npm scope moved at 0.74.0 (7 May 2026). The packages the ticket names are now `pi-ai` and `pi-agent-core`.
   - **"The DeepSeek harness" is DeepSeek's own DeepSeek Harness (`dsh`)**, at `deepseek-ai/deepseek-harness`, published as `@deepseek-ai/dsh` 0.2.0-rc.2. It has been open since 13 Aug 2026, and deepseek.com/harness presents it as DeepSeek's.
   - The other candidates are a small unaffiliated Python repo with the same name, and Codewhale (formerly `deepseek-tui`), which says it is "not affiliated with any model provider" (§1).
2. **Both are built to be extended in code, more deeply than Codex CLI.**
   - **Pi:** one TypeScript module per extension, loaded without a build step. It can register tools, `/` commands, providers, MCP servers and event handlers. A `tool_call` handler can rewrite or block any call, MCP calls included.
   - **dsh:** "everything is a plugin" on the Cordis framework. Tools, the model adapter, the session log and the agent loop itself are plugins, composed from YAML patch layers.
   - **Codex, for comparison:** extends through MCP servers, skills, hooks and plugin bundles of those. The pages read describe no in-process tool API.
3. **API stability differs sharply.**
   - **Pi** reached 1.0 on 1 Oct 2026. Its release rule is "`patch` = fixes + additions, `minor` = breaking changes. No major releases." 1.2.0 (12 Oct) changed the extension API, and one patch release (1.0.3) also carried a breaking change.
   - **dsh** is a "_developer preview_": "**THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**" All 26 of its GitHub releases are pre-releases (17 Aug to 9 Oct 2026). Its own safety notice says it "must not be treated as secure or production-ready".
4. **Embedding and unattended runs:**
   - **Pi** embeds in-process in Node (`createAgentSession()`), or runs as a child process over JSONL RPC (typed `RpcClient`). A Python host uses RPC; the docs include a Python reader. The lower-level `pi-agent-core` and `pi-ai` libraries can also be used alone.
   - **dsh** embeds only as a child process over stdio JSON-RPC. It ships a TypeScript client and a Python SDK; the Python SDK bundles the runtime, so it "needs no system Node.js". It also speaks ACP.
   - **Unattended runs:**
     - **Pi:** `pi -p`, `--mode json` and `--session-id` (open or create).
     - **dsh:** `dsh --profile headless` (exit 0 or 1, `--json`, `--session-id`).
     - **Neither has** a built-in turn cap, spend cap, or schema-constrained final answer like Codex's `--output-schema`.
5. **ChatGPT Plus: Pi has both kinds of login, and dsh has no official one.**
   - **Pi's official login:** since 0.99.0 (29 Sep 2026), Pi's `openai` provider offers "Sign in with ChatGPT". It follows OpenAI's documented open-source flow (`client_id=dynamic_agent_client`, `agent_name_hint` "Pi", scope `chatgpt.tokens.use.direct`, requests to `api.openai.com/v1`). OpenAI lists Pi as an open-source integration.
   - **Pi's legacy login:** the older "OpenAI Codex (legacy)" provider is still there. It reuses the Codex CLI's OAuth client ID `app_EMoamEEZ73f0CkXaXp7hrann` against `chatgpt.com/backend-api`.
   - **dsh** is not a listed SIWC integration. Its only ChatGPT path is pi-ai 0.87's Codex-client login, and its own guide says OAuth providers "such as Codex, are not supported here yet".
6. **Providers through the gateway:** both speak Chat Completions, Responses and Anthropic Messages to a custom endpoint, so DeepSeek and OpenRouter pass through the gateway without translation.
   - **Pi's built-in `deepseek` provider** uses Chat Completions.
   - **dsh's native DeepSeek adapter** speaks only Anthropic Messages (`https://api.deepseek.com/anthropic`). Its other providers go through Pi's `pi-ai` library, pinned at `^0.87.1`, which predates Pi's SIWC login.
7. **Rules from git and the second layer for Hard limits.**
   - **Rules:** both load `AGENTS.md`/`CLAUDE.md` chains and Agent Skills from the repo. Neither has auto-memory. Each has machine-local stores that compete with Rules in git: Pi's `~/.pi/agent/` (`AGENTS.md`, `SYSTEM.md`, `APPEND_SYSTEM.md`, skills); dsh's `~/.dsh/` (`AGENTS.md`, skills, profile patches).
   - **Pi** has no permission system and no sandbox: "Pi does not include a built-in permission system". Its second layer is an extension's `tool_call` block, which fails safe. Isolation is a container or micro-VM.
   - **dsh** ships Codex-style `read-only`/`workspace-write`/`danger-full-access` modes on bubblewrap/Landlock. The modes cover file effects only, not network. Approvals fail closed when no one answers. Its Claude Code/Codex hook bridge fails open when a hook crashes.

## 1. Which "Pi" and which "DeepSeek harness"

**Pi.** The person's "PI" in the context of an open, customizable agent harness matches the pi coding agent. _Interpretation:_ Inflection's "Pi" is a consumer chatbot, not a harness, so it is not a candidate.

- `github.com/badlogic/pi-mono` now resolves to `earendil-works/pi` (created 9 Aug 2025; MIT; 114,734 stars on 2026-10-13). Earendil Works lists Austria as its location. [pi-repo]
- npm: `@mariozechner/pi-coding-agent` stops at 0.73.1 (last modified 7 May 2026). `@earendil-works/pi-coding-agent` starts at 0.74.0 (7 May 2026) and is at 1.2.0 (12 Oct 2026). A `legacy-node20` dist-tag points at 0.74.2. [npm]
- README: "Pi is a minimal, extensible agent harness that you can make your own." and "Pi ships with powerful defaults but skips features like sub-agents and plan mode. Ask Pi to build what you want, or install a package that does it your way." [pi-readme]
- The monorepo's packages include `pi-ai` ("Unified multi-provider LLM API"), `pi-agent-core` ("Agent runtime with tool calling and state management"), `pi-coding-agent` (the CLI), `pi-tui`, `pi-durable` and `pi-mcp`. [pi-readme]

**"The DeepSeek harness".** Candidates found on 2026-10-13:

| Candidate | What it is | Evidence | Likelihood |
| :-- | :-- | :-- | :-- |
| **DeepSeek Harness (`dsh`)**, `deepseek-ai/deepseek-harness` | DeepSeek's own open-source agent harness, CLI `dsh`, npm `@deepseek-ai/dsh` | In DeepSeek's GitHub org (with DeepSeek-V3, R1 and others). Repo created 13 Aug 2026; 248,500 stars. The README says it was "developed by DeepSeek AI". deepseek.com/harness links the repo and carries "© 2026 杭州深度求索人工智能基础技术研究有限公司" (Hangzhou DeepSeek's legal name). [dsh-readme], [dsh-site], [dsh-repo] | **Most likely.** It is DeepSeek's harness, and it has an ecosystem of its own: GitHub repos tagged `dsh-plugin`, desktop shells, a plugin market. |
| `HenryZ838978/deepseek-harness` | "Protocol-layer harness for DeepSeek: Python witness stack" | Created 9 May 2026, 48 stars, MIT. A secondary write-up says it disclaims any link to the official framework. [henry-repo] | Unlikely: small, and not an agent harness in the same sense. |
| Codewhale (formerly `deepseek-tui`, `Hmbown/DeepSeek-TUI`) | A community Rust coding agent | "Codewhale began as `deepseek-tui` … It is now provider-neutral and independently maintained, and is not affiliated with any model provider." 41,072 stars. [codewhale] | Possible only if the person meant the earlier community "DeepSeek TUI". It has since been renamed. |
| "A harness run on DeepSeek models" | DeepSeek's docs walk through Claude Code, Codex, OpenCode, OpenClaw and Hermes (#23) | [provider-terms] §3 | A different meaning; it is already covered by #22. |

The rest of this file covers DeepSeek Harness (`dsh`). Its version is npm `latest` **0.2.0-rc.2** (tag `dsh-v0.2.0-rc.2`, 29 Sep 2026). An alpha, 0.2.1-alpha.2 (9 Oct), sits under the `alpha` tag.

## 2. Comparison

Abbreviations: **Resp** = OpenAI Responses API, **Chat** = OpenAI Chat Completions, **Msgs** = Anthropic Messages, **SIWC** = Sign in with ChatGPT. The Codex CLI and OpenCode columns come from #22 unless a source is named.

| Criterion | **Pi 1.2.0** | **DeepSeek Harness (`dsh`) 0.2.0-rc.2** | Codex CLI 0.162.1 (reference) | OpenCode 1.19.0 (reference) |
| :-- | :-- | :-- | :-- | :-- |
| Maintainer / licence | Earendil Works (began as Mario Zechner's `pi-mono`); MIT | DeepSeek; MIT | OpenAI; Apache-2.0 | `anomalyco` (GitHub org); MIT |
| Status / pace | 1.x since 1 Oct 2026; 14 releases 13 Sep – 12 Oct; ~4.2M npm downloads a week | Developer preview; 26 pre-releases 17 Aug – 9 Oct, no stable release; ~358K npm downloads a week | Stable releases every 1–2 days | ~30 releases Jul–Oct; OpenCode 2 rolling out |
| **How a new tool is added** | Extension (TS/JS module): `pi.registerTool()` with TypeBox schema, loaded by jiti, no build | Cordis plugin: `ctx.tools.register(defineTool(...))`, inserted into the profile with a YAML patch | MCP server (or skill / plugin bundle); no in-process tool API in the pages read | `.opencode/tools/*.ts` with `tool()` from `@opencode-ai/plugin`; MCP |
| Other extension points | Event handlers (`pi.on`), `/` commands, flags, shortcuts, providers, MCP servers, virtual models, TUI renderers; skills; prompt templates | Everything is a plugin: tools, model adapters, session log, agent loop; `tools/pre-execute` and `tools/post-execute` waterfalls, guards; services | Hooks, rules, skills, MCP, plugins (skills + MCP + hooks + browser extensions) | Plugins (hooks such as `tool.execute.before`), skills, MCP |
| Distribution | Pi packages from npm or git, pinned by version or ref | `dsh plugin --profile <p> add …` (pnpm); declared DSH peer ranges enforced | Plugins, skills, MCP config | npm plugins, local files |
| **Extension API stability** | Lockstep versions; breaking changes only in minors by policy (once in a patch); 1.2.0 changed `before_agent_start` | "THERE WILL BE COMPATIBILITY-BREAKING CHANGES" | "Rules are experimental and may change"; releases every 1–2 days | "V1 plugin implementations do not run in V2" |
| **Embed in Node** | In-process SDK (`createAgentSession`), or `RpcClient` subprocess | Subprocess only: `@deepseek-ai/dsh-sdk-client` over stdio JSON-RPC (npm `latest` tag is a stale 0.0.1-rc.1; 0.2.0-rc.2 is under `next`) | `@openai/codex-sdk`; Codex app-server [codex-sdk] | `opencode serve` plus SDK |
| **Embed in Python** | RPC subprocess (JSONL; docs include a Python reader) | `deepseek-harness-sdk` (bundled runtime, Python ≥3.10, no system Node); PyPI is at 0.1.5rc1 | `openai-codex` (Python ≥3.10; drives app-server over JSON-RPC) [codex-sdk] | SDK over HTTP (not checked for Python) |
| One-shot run | `pi -p "<prompt>"`; `--mode json` | `dsh --profile headless "<task>"` | `codex exec` | `opencode run` |
| Failure signal | `-p`: non-zero on `error`/`aborted`/`length`. JSON mode: a failed response "does not by itself produce a nonzero exit status" | Exit 0 = completed, 1 = aborted or errored | Exit 1 on error | `exitCode = 1` on session error |
| Structured final answer | None built in; pattern: a terminating tool (`terminate: true`) with a TypeBox schema | None for the root agent; subagent and workflow structured outputs are object-rooted | `--output-schema` | SDK `format` (StructuredOutput tool) |
| Resume a session | `--session-id <id>` opens or creates; `--continue`; `--fork`; `--no-session` | `--session-id` adopts an existing session only ("an unknown id fails"); default fresh `session-<uuid>` | `exec resume <id>` | `--session`, `--continue` |
| Usage reporting | Tokens and cost on every assistant message | Per-step token `usage` on `--json` `step_end`; no cost | Tokens, no cost | Tokens and cost |
| Turn / spend caps | None built in; an extension can `ctx.abort()`; retry settings | "No built-in turn budget"; per-request `maxTokens`; tool timeouts | None | Per-agent `steps` |
| Wire APIs to a custom endpoint | Chat, Resp, Msgs, Google (`models.json`); Bedrock, Mistral and others through built-in providers | Chat, Resp, Msgs (via `pi-ai`); native DeepSeek adapter is Msgs only | **Resp only** | Chat, Resp, Msgs |
| **ChatGPT Plus login** | **SIWC** (official dynamic registration) on `openai`; plus "OpenAI Codex (legacy)" reusing the Codex CLI client ID | **No SIWC.** Only pi-ai 0.87's Codex-client OAuth through an authorization seam; Web UI: "not supported here yet" | Codex's own login | Listed SIWC integration; `dev` branch has both SIWC and "Codex browser (legacy)" (_Unverified_ for 1.19.0) |
| DeepSeek | Built-in `deepseek` provider (Chat to `api.deepseek.com`), or custom | Native `deepseek-official` (Msgs to `api.deepseek.com/anthropic`), DeepSeek account sign-in, or a pi-ai custom route | Resp only (DeepSeek has native Resp) | Chat or Msgs |
| Rules from git | `AGENTS.md`/`CLAUDE.md` from cwd and parents (no trust needed); `.agents/skills`, `.pi/skills` (trust-gated) | `AGENTS.md`/`CLAUDE.md` chain from git root to cwd (64 KiB cap in base); `.dsh/skills`, `.agents/skills` | `AGENTS.md` chain (32 KiB); `.agents/skills` | `AGENTS.md`, `instructions` globs, skills |
| Competing machine-local stores | `~/.pi/agent/` `AGENTS.md`, `SYSTEM.md` (replaces the system prompt), `APPEND_SYSTEM.md`, skills, extensions, `settings.json`, `models.json`, `mcp.json`; `~/.agents/skills` | `~/.dsh/AGENTS.md`, `~/.dsh/skills`, `~/.agents/skills`, `$DSH_HOME/profiles/<p>/cordis.patch.yml`, `$DSH_HOME/cordis.patch.yml` | Memories (off), `~/.codex/AGENTS.md`, `default.rules` | `~/.config/opencode/AGENTS.md`, `~/.claude/CLAUDE.md` |
| Second layer for Hard limits | No permission system; `tool_call` handler can block (handler failure blocks); `--tools` allowlist, `--exclude-tools` | Approval `ask`/`never`, fails closed; guards; pre-execute waterfall; hook bridges (fail open on hook crash) | `forbidden` rules, `PreToolUse` hooks, MCP allow/deny | `deny` rules, `tool.execute.before` |
| Sandbox | **None**; patterns: Docker, Gondolin micro-VM, OpenShell, an example bwrap extension | bwrap/Landlock file sandbox, `workspace-write` by default; network not covered | bwrap + seccomp; network off by default | None |
| MCP (Playwright) | Built in since 0.99.0: stdio and streamable HTTP (no SSE); default exposure `codemode` | Opt-in `dsh-mcp-client` per server; experimental browser-use provider for Playwright MCP | stdio + HTTP; `required = true` | Local and remote |
| Telemetry default | `enableInstallTelemetry: true` (install/update reporting, provider attribution headers) | `FEEDBACK_ONLY`: a session-log prefix goes to DeepSeek's collector only after explicit `/feedback` | (see #22) | (see #22) |
| Fit on this VM | Node ≥22.19 ✓; `pi-linux-arm64` binary ✓ | Node `^22.19 \|\| >=24` ✓; linux-arm64 native Landlock launcher ✓; `manylinux_2_28_aarch64` wheel ✓ (glibc 2.35) | Installed | arm64 binary |

_Interpretation:_ judged only on "add features incrementally", Pi and dsh both let new capabilities be code that runs inside the harness and sees every tool call, while Codex keeps new capabilities outside it (MCP, hooks). Pi has the smaller surface and a 1.x API. dsh has the larger built-in feature set (sandbox, approvals, scheduler, browser-use, subagents, Web UI) on an API that is explicitly unstable.

## 3. Pi

### 3.1 Extending it

- **Extension module.** "Extensions are TypeScript modules that add executable behavior to Pi." An extension exports a default factory that receives `ExtensionAPI`. "Pi uses `jiti`, so local TypeScript extensions do not need a separate compilation step." Extensions load from `~/.pi/agent/extensions/`, project `.pi/extensions/`, `-e <path>`, or Pi packages. [pi-extensions]
- **Integration points** (the doc's own table): `pi.on()`, `pi.registerTool()`, `pi.registerCommand()`, `pi.registerShortcut()`/`registerFlag()`, `pi.sendUserMessage()`/`sendMessage()`, `pi.appendEntry()`, session control (active tools, model, thinking level), `pi.registerProvider()`, `pi.registerMcpServer()`, `pi.registerVirtualModel()`, renderers and `ctx.ui`, and `pi.events` between extensions. [pi-extensions]
- **Tools.** "A custom tool defines a name, model-facing description, TypeBox parameter schema, and `execute()` function." Tools can declare `outputSchema` and return `structuredContent`. They can call other tools with `ctx.executeTool()`; nested calls "go through argument validation and the `tool_call` and `tool_result` handlers like model-issued calls". Return `terminate: true` to skip the follow-up model turn. [pi-extensions]
- **Events that matter for the Assistant:**
  - "`tool_call` can mutate input or block execution."
  - "`tool_result` handlers compose".
  - "`before_agent_start` exposes both the current prompt and its structured `systemPromptOptions`".
  - "`agent_settled` is final and notification-only; use it when an integration needs to know Pi will not continue automatically." [pi-extensions]
- **Trust:** "An extension runs inside the Pi process with the same operating-system permissions. It can inspect prompts, tool calls, files, credentials, and session history, so load extensions only from sources you trust." [pi-extensions]
- **Packages:** "Versioned npm specifications are pinned. Git tags and commits are also pinned". Pi supplies `pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-tui` and `typebox` to extensions. [pi-packages]
- **Examples in the repo** (all for v1.2.0): `permission-gate.ts`, `protected-paths.ts`, `confirm-destructive.ts`, `structured-output.ts`, `sandbox/`, `gondolin/`, `git-checkpoint.ts`, `auto-commit-on-exit.ts`, `plan-mode/`, `subagent/` and others. [pi-examples]
- **API stability:**
  - The release skill: "**Lockstep versioning**: all packages share one version; every release updates all together. `patch` = fixes + additions, `minor` = breaking changes. No major releases." [pi-release]
  - The changelog's "Breaking Changes" sections cover "API changes requiring migration". [pi-agents]
  - **1.2.0 (12 Oct 2026)** changed the extension API: "`BeforeAgentStartEvent` is now a union on `messageType`", "`pi.sendUserMessage()` requires `deliverAs`".
  - **1.0.3 (5 Oct 2026, a patch)** carried "Renamed the Azure provider from `azure-openai-responses` to `azure`" under Breaking Changes. [pi-changelog]
  - _Interpretation:_ pin to a minor (`~1.2.x`) and read the Breaking Changes section before each minor.
- **Earlier stance, changed:** the 0.73.1 README said "**No MCP.** Build CLI tools with READMEs (see Skills), or build an extension that adds MCP support." [pi-readme-0.73] 0.99.0 (29 Sep 2026) "Added codemode, tool search, and MCP support as built-in extensions." [pi-changelog] The sub-agent stance remains (the README still "skips features like sub-agents and plan mode"), and there is still no built-in permission system (§3.6).

### 3.2 Embedding in our own process

- **Modes:** "All four modes use the same agent, sessions, resources, and tools." Interactive, Print ("Final text on stdout"), JSON ("JSONL events on stdout") and RPC ("JSONL commands, responses, and events"; long-lived). "The SDK is not a CLI mode. It embeds the agent directly in a Node.js or Bun process." [pi-cli-integration]
- **SDK:** `createAgentSession()` returns an `AgentSession`.
  - **Swappable pieces:** "Each boundary can be supplied explicitly": `modelRuntime`, `settingsManager` (in-memory possible), `sessionManager` (`SessionManager.inMemory()`), `resourceLoader` (inline extension factories, or a custom loader that owns discovery completely), and `tools`/`customTools`.
  - **No built-in extensions:** "The CLI loads `codemode`, `tool_search`, and MCP as built-in extensions. SDK sessions do not". You add `createMcpExtension()` and the others yourself. [pi-sdk]
  - _Interpretation:_ the SDK lets the Assistant's own Node bot decide every resource, with no machine-local discovery at all. That is the strongest answer to "Rules only from git".
- **RPC:** "For Node.js or TypeScript integrations, prefer `RpcClient` … It starts a Pi RPC child process, correlates requests, exposes typed command methods, and delivers session events". The RPC doc includes "This Python example uses a binary pipe reader". [pi-cli-integration], [pi-rpc]
- **Lower layers:** `@earendil-works/pi-agent-core` (`new Agent({ initialState, streamFn })`) and `@earendil-works/pi-ai` can be used without the coding agent. [pi-agent-core]
- **Rebranding:** a source fork can set `piConfig.name`/`configDir` in `package.json` ("These settings affect the CLI banner, configuration paths, and derived environment variable names"). [pi-cli-integration]

### 3.3 Unattended runs

- **Print:** "A final assistant response with an `error` or `aborted` stop reason produces a nonzero exit status." A `length` stop also exits non-zero. [pi-cli-integration]
- **JSON:** "A failed or aborted assistant response appears in the event stream but does not by itself produce a nonzero exit status. Inspect the events when success or failure matters." The stream starts with a session header and ends at `agent_settled`. [pi-cli-integration], [pi-json]
- **Sessions:**
  - `--session-id <id>` "Opens the exact project session ID or creates it if absent."
  - `--no-session` "Uses an in-memory session that is not persisted."
  - `--continue`, `--fork` and `--session-dir` are also available. [pi-cli]
  - _Interpretation:_ a Discord thread ID can be the session ID for conversation threads, and work runs can use `--no-session`, which matches #8.
- **Usage:** `message_update` carries cumulative `usage` with `cost` (input, output, cacheRead, cacheWrite, total). The cost comes from the model's catalog price. [pi-json], [pi-models]
- **Caps:** no turn, step or spend limit appears in the CLI or settings docs. Retries are configurable (`retry.maxRetries`, default 3). An extension can call `ctx.abort()` or `ctx.shutdown()`. [pi-settings], [pi-ext-types] _Interpretation:_ a turn cap is a few lines in a `turn_end` handler. Spend caps belong in the gateway (#22 §9.7).
- **Structured output (the Miner):** no `--output-schema`. The repo's `structured-output.ts` example "Demonstrates `terminate: true` so the agent can end on a tool call without paying for an extra follow-up LLM turn". It defines a TypeBox schema and returns the data in `details`. [pi-examples] _Interpretation:_ a `dossier_or_skip` tool with a validated schema gives the Miner structured output. Pi validates the arguments, and the host reads them from the tool result.
- **Approvals as gates between runs:** in print and JSON modes `ctx.hasUI` is false. The permission-gate example returns `{ block: true, reason: "Dangerous command blocked (no UI for confirmation)" }`. [pi-examples]
- **Network activity:** `PI_OFFLINE` "Disable[s] automatic network activity, including model catalog refreshes". `PI_SKIP_VERSION_CHECK` disables the version check. `PI_TELEMETRY` overrides install telemetry. `enableInstallTelemetry` defaults to `true` ("anonymous install/update reporting and selected provider attribution headers"). [pi-env], [pi-settings]

### 3.4 Providers and the ChatGPT login

- **Custom endpoints:** "Use `models.json` when an endpoint speaks an API Pi already supports. This includes most Ollama, LM Studio, vLLM, SGLang, and proxy deployments."
  - **APIs:** `pi-ai` knows `openai-completions`, `openai-responses`, `azure-openai-responses`, `openai-codex-responses`, `anthropic-messages`, `mistral-conversations`, `bedrock-converse-stream`, `google-generative-ai`, `google-vertex` and `pi-messages`.
  - **Keys and headers:** `apiKey` and header values accept `$NAME`, `${NAME}` or `!command`.
  - **Compat flags:** the compatibility settings "should describe verified differences in the endpoint's request or response behavior". [pi-models], [pi-ai-types]
  - _Interpretation:_ each gateway route can use its provider's native format, as OpenCode does in #22. No translation is needed for DeepSeek or OpenRouter.
- **Gateway config lives on the machine.** The project `.pi/` table has `settings.json` and `mcp.json` but no `models.json`. `models.json` is listed only under the agent directory. [pi-config] _Interpretation:_ like Codex (#22 §2.2), the gateway route lives outside git. The alternatives are a provider registered by a trusted project extension (`pi.registerProvider()`), or the SDK.
- **DeepSeek:** the built-in `deepseek` provider is `openAICompletionsApi()` at `https://api.deepseek.com` with `DEEPSEEK_API_KEY`. Pi reads reasoning from `reasoning_content`, `reasoning` or `reasoning_text`. [pi-ai-src]
- **OpenRouter:** with a key, "Pi lists only the OpenRouter chat models that key may use". [pi-providers]

**ChatGPT Plus: is it SIWC or the Codex client?** Pi has **both**, as separate providers.

1. **`openai` provider, "Sign in with ChatGPT": the official SIWC flow.**
   - Changelog 0.99.0: "Added Sign in with ChatGPT to the OpenAI provider in `/login`, which uses a ChatGPT subscription with the OpenAI API. Pi stores a stable `deviceId` in the global settings for this login". [pi-changelog]
   - Source (`packages/ai/src/auth/oauth/openai-chatgpt.ts`, v1.2.0): "OpenAI Responses API token sharing through Sign in with ChatGPT. This public-client flow uses no client secret and sends the resulting user access token directly to api.openai.com." It sets `const DYNAMIC_CLIENT_ID = "dynamic_agent_client";` and `const AGENT_NAME_HINT = "Pi";`. It sends `ext_agent_host_id: urn:uuid:<deviceId>`, `resource: https://api.openai.com/v1` and scope `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`. It also rejects a grant that lacks `chatgpt.tokens.use.direct`. [pi-ai-src]
   - OpenAI's SIWC docs prescribe exactly this: "Start first-time registration with `client_id=dynamic_agent_client`, include the host's `ext_agent_host_id`, and set `agent_name_hint` to your app's actual name". Its scope table says "ChatGPT plan usage scopes: `offline_access resource.invoke chatgpt.tokens.use.direct`." [siwc-docs]
   - OpenAI's partner page lists "Open-source integrations: … Pi (github.com/earendil-works/pi)". [siwc-partners]
   - **Headless VM:** Pi's docs say "On a remote or headless machine, an OAuth callback may not reach the local process. When prompted, paste the final redirect URL or authorization code back into Pi." The source races the loopback callback against a pasted redirect URL. [pi-providers], [pi-ai-src] _Interpretation:_ the login can finish on the VM itself, with the VM's own host ID. OpenAI's alternative, its "Self-hosted VMs" guide, transfers a credential file instead.
2. **`openai-codex` provider, "OpenAI Codex (legacy)": a reuse of the Codex CLI's OAuth client.**
   - Source (`openai-codex.ts`): `const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";`, authorize URL `https://auth.openai.com/oauth/authorize`, redirect `http://localhost:1455/auth/callback`, and a device-code flow at `/codex/device`. The provider's `baseUrl` is `https://chatgpt.com/backend-api`. [pi-ai-src]
   - OpenAI's Codex source declares the same value: `pub const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";` ("client id used for oauth token refresh flow"). [codex-client-id]
   - Changelog 0.99.0: "Renamed the inherited OpenAI Codex provider to "OpenAI Codex (legacy)"; Sign in with ChatGPT on the OpenAI provider supersedes it." [pi-changelog]
- **Terms (from #23, applied here):**
  - The SIWC route in a listed open-source harness on the person's own VM is **permitted, with conditions**: "a remote runtime only that user controls", "express consent before background use", and "Connected application only".
  - The legacy Codex-client route presents Pi to OpenAI as the Codex CLI. _Interpretation:_ that is the pattern the SIWC Terms address with "Do not impersonate OpenAI, another application". #23 rated the comparable gateway route "unclear, leaning not permitted".
- **SIWC limits that bind Pi's `openai` route** [siwc-docs]:
  - "Set `store: false` and `stream: true`".
  - "Omit `previous_response_id` over HTTP".
  - Hosted tools are unsupported: "Image generation, file search, Code Interpreter, native computer use, hosted MCP/connectors".
  - "For ChatGPT Plus users, the five-hour usage limit is shared across all apps".
  - Pi's own models doc adds: "Sign in with ChatGPT credentials do not work with" OpenAI's Decisions API. [pi-models]
- **Other subscription logins Pi offers:**
  - Claude Pro/Max (Claude Code's OAuth client ID, base64-encoded in `anthropic.ts`), GitHub Copilot, Kimi Code, xAI (SuperGrok / X Premium), Meta (Muse), plus OpenRouter OAuth and Radius (Earendil's own gateway). [pi-ai-src]
  - Pi warns when Anthropic subscription auth is active that "Anthropic third-party usage draws from extra usage and is billed per token". [pi-changelog]
  - _Interpretation:_ #23 found a Claude Pro login in a non-Anthropic harness **not permitted**. The login exists in Pi, so keeping it unused is up to configuration.

### 3.5 Rules from git

- **Context files:** "Pi loads them from the agent directory, the working directory, and its parent directories." An `AGENTS.override.md` "replaces `AGENTS.md` or `CLAUDE.md` only in the same directory." "Context-file discovery does not require project trust." [pi-config]
  - _Not found:_ any size cap on context files in the docs read. Codex has a 32 KiB cap (#22).
- **Skills:** Pi "implements the Agent Skills specification". It "adds each skill's name, description, and path to the system prompt" and loads the body on demand. Project `.agents/skills/` directories are "discovered from the working directory through its ancestors, stopping at the repository root". `disable-model-invocation: true` hides a skill from automatic use. [pi-skills]
- **Project trust gates the rest.** `.pi/settings.json`, `.pi/mcp.json`, `.pi/extensions`, `.pi/skills`, `.pi/SYSTEM.md` and project `.agents/skills` need a trust decision. "Print, JSON, and RPC modes cannot show the built-in trust prompt." Without an override, `defaultProjectTrust: "ask"` (the default) "skips them". "Use `--approve` or `--no-approve` when an automated run needs an explicit one-time decision." [pi-security]
  - _Interpretation:_ an unattended `pi -p` run without `--approve` loads `AGENTS.md` but silently skips Rules kept as project skills. This is the same kind of trap #6 and #22 found in Claude Code and Codex.
- **Machine-local competitors:**
  - `~/.pi/agent/AGENTS.md` (or `CLAUDE.md`).
  - `~/.pi/agent/SYSTEM.md` "Replaces Pi's default system prompt", and `APPEND_SYSTEM.md` adds to it.
  - `~/.pi/agent/skills/`, `~/.agents/skills/`, `~/.pi/agent/extensions/`, `settings.json`, `models.json`, `mcp.json`, `auth.json` and `trust.json`. [pi-config], [pi-security]
- **No auto-memory:** none of the docs describe one. Codemode's `store()` keeps "small JSON values across `codemode` calls" in the session log only. [pi-codemode]

### 3.6 Second layer for Hard limits

- **No built-in permission system:** "Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it." [pi-readme]
  - "Safety comes from limiting the files, credentials, processes, and network services Pi can access … Watching the transcript, using project trust, and reviewing changes do not create a security boundary." [pi-security]
- **Blocking hooks:**
  - "`tool_call` can mutate input or block execution."
  - "A `tool_call` handler failure blocks the tool as a fail-safe".
  - "Every MCP call passes through Pi's tool pipeline. Extension `tool_call` and `tool_result` handlers, including permission gates, therefore apply to MCP tools."
  - Nested codemode calls also pass the handlers. [pi-extensions], [pi-mcp]
  - _Interpretation:_ fail-safe blocking on handler errors is stricter than Codex's hooks ("a useful guardrail, not a complete enforcement boundary") and stricter than dsh's hook bridge (§4.5).
- **Tool allowlists:** `--tools` "Replaces the default selection with a comma-separated allowlist"; `--exclude-tools` and `--no-mcp` remove tools; `--no-tools` starts with none. [pi-cli]
- **Isolation patterns** (from `containerization.md`): plain Docker (whole process), Docker Sandboxes, OpenShell, and the Gondolin extension ("Built-in tools and `!` commands" in a local micro-VM; "other extension tools still run on the host"). An example `sandbox/` extension wraps `bash` with `@anthropic-ai/sandbox-runtime` ("bubblewrap on Linux"). [pi-containerization], [pi-examples]
  - _Unverified:_ that example on this VM; it may need `socat` like Claude Code's sandbox (#22).
- **Codemode:** model-written JavaScript runs "in a QuickJS sandbox and reach[es] the other tools through `tools.<name>(args)`". Its calls still pass the `tool_call` handlers. [pi-cli], [pi-extensions]

### 3.7 Tools: MCP and the browser

- **Transports:** "Pi connects to Model Context Protocol servers over stdio or streamable HTTP". "`sse` is rejected." [pi-mcp]
- **Config files:** `~/.pi/agent/mcp.json`, or `.pi/mcp.json` once the project is trusted. `pi mcp add playwright -- <command> [args...]`. [pi-cli], [pi-mcp]
- **Exposure:** the default exposure is `codemode`: tools are "Callable from codemode scripts, but neither declared to the model nor listed". `direct` declares them like built-in tools. [pi-mcp] _Interpretation:_ for a Playwright browser driven turn by turn, set `exposure: direct` on that server.
- **Startup:** "The first prompt waits up to 10 seconds only for servers with `direct` tools". No setting like Codex's `required = true` is documented. `pi mcp list` "exit[s] with `1` when a config entry is invalid or an enabled server is not connected", so a wrapper can check before a run. [pi-mcp]
- **Built-in tools:** `read`, `bash`, `edit`, `write` by default, plus `grep`, `find` and `ls`. There is no built-in browser. [pi-cli]

### 3.8 Fit

- **Platform:** Node ≥22.19.0 (the VM has 24.20.0). Release assets include `pi-linux-arm64.tar.gz`. The npm install uses `--ignore-scripts`. [npm], [pi-release-assets]
- **Release pace:** 14 releases from 13 Sep to 12 Oct 2026; 1.0.0 on 1 Oct. [pi-releases]
- **Contributions:** "New issues and PRs from new contributors are auto-closed by default. Maintainers review auto-closed issues daily." [pi-readme]
- **Ecosystem:** OpenClaw is "a real-world integration". dsh itself depends on `pi-ai` (§4.3). [pi-readme], [dsh-pi-ai]

## 4. DeepSeek Harness (`dsh`)

### 4.1 Identity and status

- "DeepSeek Harness (`dsh`) is an open-source agent harness developed by DeepSeek AI. It is built on an **everything-is-a-plugin** architecture and powered by Cordis". [dsh-readme]
- "DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**" [dsh-readme]
- DeepSeek's page, translated: "DeepSeek Harness is open for global testing and open-sourced at the same time, extending Agent capabilities with freely composable plugins". "The core plugins and base APIs of the DeepSeek Harness preview will keep iterating." [dsh-site] (translated)
- **SAFETY.md:**
  - "It has not undergone a security audit and must not be treated as secure or production-ready."
  - "Sandboxing, approval prompts, and permission controls can reduce risk, but they do not guarantee isolation or prevent damage."
  - "Prefer a disposable virtual machine, container, or dedicated environment." [dsh-safety]
- **Releases:**
  - 26 GitHub releases from `dsh-v0.1.0-rc.7` (17 Aug 2026) to `dsh-v0.2.1-alpha.2` (9 Oct 2026), all marked pre-release.
  - npm `@deepseek-ai/dsh` was created 10 Aug 2026 and has 31 versions.
  - GitHub issues are disabled (`has_issues: false`); feedback goes through GitHub Discussions. [dsh-repo], [npm]

### 4.2 Extending it

- **Plugins:** "In Harness, a plugin is a TypeScript module that exports an `apply` function." It declares dependencies with `inject` ("The framework waits for every required service before loading the plugin"). "Anything registered through `ctx`—event listeners, tools, or timers—is cleaned up when the plugin unloads." [dsh-dev-basic]
- **Tools:** `ctx.tools.register(defineTool({ name, description, parameters, output: { schema, render }, execute }))`. "`defineTool` infers and validates `args` from `parameters`". [dsh-dev-tool]
- **Interception:**
  - The tool pipeline runs a "`tools/pre-execute` waterfall (hooks, permission, sandbox)", then "Registered monotonic guards (deny or abstain)", then `ctx.approval` ("absent or unanswerable: deny"), then "`tools/execute` waterfall (timeout, retry, metrics)" and "`tools/post-execute` waterfall (accept, block, replace, add context)".
  - "PTC mode sends both the reserved `run_code` transport and its serialized sub-calls through the pipeline". [dsh-tool-pipeline]
- **Composition:**
  - **Profiles:** "profiles are ordered stacks of plugin-bundle patch layers under the user's own overrides." The tree composes each bundle's patch, "then the profile's `cordis.patch.yml`, then the home-level `$DSH_HOME/cordis.patch.yml`, then `--patch` overlays."
  - **Install guard:** "Installation and profile startup enforce declared DSH peer ranges … Incompatible plugins require an explicitly acknowledged exact-version exemption."
  - **Hot reload:** `dsh-hmr` can reload patch edits without a restart. [dsh-cli]
  - _Interpretation:_ the Assistant's own plugin rows could live in the repo as a `--patch` file, while credentials stay in `$DSH_HOME`.
- **Hook bridges:** `dsh-hooks-claude-code` and `dsh-hooks-codex` "run command hooks from your existing Claude Code `hooks.json`". `PreToolUse` can "block the tool, or ask for approval before it runs". [dsh-hooks]
- **Scale of the code base:** the source tree has 55 package groups (`acp`, `browser-use`, `computer-use`, `guard`, `hooks`, `mcp`, `sandbox`, `schedule`, `subagent`, `webhook`, `workflow` and others), 156 MB unpacked. _Interpretation:_ there is a lot to build on, and a lot of surface that can change under a plugin during the preview.

### 4.3 Embedding in our own process

- **Launcher:** "The `dsh` command is the sole supported Node application launcher". "SDK and ACP are profiles, not separate public bins." The modes are `--profile headless "job"`, `--profile sdk` ("Serve SDK clients over JSON-RPC stdio"), `--profile sdk-minimal`, `--profile acp` ("Serve automation clients over ACP stdio") and `web`. [dsh-cli]
- **TypeScript:**
  - `@deepseek-ai/dsh-sdk-client` lets "TypeScript programs start and drive a complete DeepSeek Harness runtime over stdio JSON-RPC". `run()` returns `{ sessionId, finalResponse, events, notifications }`. [dsh-sdk-client]
  - npm's `latest` tag for this package is `0.0.1-rc.1`; 0.2.0-rc.2 is under `next`. [npm]
- **Python:**
  - `deepseek-harness-sdk` needs "Python 3.10 or newer" on "Linux x64, Linux arm64, macOS 14 or newer on arm64, or Windows x64". "The installation includes a matching native runtime wheel and the `dsh` command. Normal SDK execution needs no system Node.js."
  - `RunResult(session_id, final_response, finish_reason, events, notifications)`.
  - "The example and SDK never silently read `~/.dsh`". [dsh-python-sdk], [dsh-python-readme]
  - PyPI has `deepseek-harness-sdk` 0.1.5rc1 (10 Sep 2026), with a `manylinux_2_28_aarch64` runtime wheel. That is behind npm's 0.2.0-rc.2. [pypi]
- _Unverified:_ composing dsh in-process inside our own Node process. `@deepseek-ai/dsh/profile-boot` serves the Desktop host, and no public guide covers in-process embedding.

### 4.4 Unattended runs

- **Headless:** "`dsh-headless` runs one dsh task from the command line and prints the final answer, then exits — no GUI, no server, no browser." "Exit code 0 means the task completed; 1 means it aborted or errored." "One task per run". [dsh-headless]
- **`--json`:**
  - The stream "opens with `session` … and closes with `final`, and carries `status`, `text`, `thinking`, `tool_call`, and `tool_result` events in between".
  - Strings other than `final` are capped at 8 KiB.
  - "A turn that fails in-turn still ends with a `final` event (often empty) … treat exit code 1 and the `turn_end` reason as the failure signal."
  - The `step_end` status event includes `usage` when every attempt reported it. [dsh-headless], [dsh-json-src]
- **Sessions:**
  - The default is a fresh `session-<uuid>`.
  - "Pass `--session-id <id>` to continue that conversation … an id with no stored Session fails before the task runs".
  - Adoption also refuses a session recorded in another working directory.
  - _Interpretation:_ the bot has to store the dsh session ID for each Discord thread from the first run's `session` event. Pi, by contrast, creates the session under the ID it is given.
- **Caps:** "**No built-in turn budget** — tool calls or steering continue the current turn; a policy that bounds runaway turns must cancel from an existing lifecycle extension point". `maxTokens` caps each request's output. The base bundle sets a 60 s bash timeout. `dsh-repeat-tool-reminder` is "advisory: it never blocks". [dsh-agent-loop], [dsh-sdk-client], [dsh-base-patch], [dsh-guard]
- **Structured output:** no schema option on headless, the SDK or the root agent. Subagent and workflow outputs can be structured ("Caller-defined subagent and workflow structured outputs remain object-rooted"). [dsh-tools-readme] _Interpretation:_ the Miner would use a plugin tool whose validated arguments are the Dossier-or-Skip record, as with Pi.
- **Approvals as gates between runs:** "`'never'` — never prompt anyone: every ask resolves `'rejected'` deterministically. The strict headless stance (CI, unattended runs)". Under `ask` with no answerer, "the chain falls through to the fail-closed `'unavailable'`". [dsh-approval]

### 4.5 Providers and the ChatGPT login

- **Native DeepSeek adapter (`deepseek-official`):**
  - The official root is `https://api.deepseek.com/anthropic`, and "Configuration accepts Messages only and has no `protocol` field."
  - `$DEEPSEEK_BASE_URL` can point it at "a Messages-compatible root". The defaults advertise `deepseek-flash` and `deepseek-v4-pro`. [dsh-llm-deepseek]
- **DeepSeek account route (`deepseek-account`):** "Sign in through the system browser". It reads `normal_wallets` / `bonus_wallets` balances from DeepSeek Platform. [dsh-account] _Interpretation:_ it bills the same pay-as-you-go balance; it is not a subscription (consistent with #23 §3).
- **Third-party and custom providers (`dsh-llm-pi-ai`):**
  - "The **API protocol** must be the one your gateway speaks, and the picker offers three: OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages". "A provider speaks one protocol, so a gateway that serves two needs two providers." [dsh-providers]
  - Compat switches exist for gateways that differ from OpenAI: `supportsDeveloperRole: false`, `maxTokensField: max_tokens`, and `thinkingFormat: deepseek` "A model that thinks unless told not to — DeepSeek V4 behind an OpenAI-compatible gateway". [dsh-providers]
  - _Interpretation:_ if the research lab's DeepSeek endpoint speaks only Chat Completions, it goes through this route, not the native Messages adapter.
- **Pi's `pi-ai` underneath.** `@deepseek-ai/dsh-llm-pi-ai` depends on `"@earendil-works/pi-ai": "^0.87.1"`. Under npm's 0.x caret rule, that is `>=0.87.1 <0.88.0`. [dsh-pi-ai]
- **ChatGPT Plus:**
  - **The user guide:** "Providers that sign in with OAuth, such as Codex, are not supported here yet." [dsh-providers]
  - **The adapter's notes:** "Codex is sign-in-able through the authorization flow's OAuth grant". The authorization seam's example registers a `llm-pi-ai/openai-codex` flow labelled "ChatGPT (Codex)". [dsh-pi-ai], [dsh-authorization]
  - **pi-ai at v0.87.1 has no SIWC module.** Its only ChatGPT OAuth is `openai-codex.ts`, with `CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"`. [pi-ai-0.87.1]
  - **dsh is not on OpenAI's list** of open-source SIWC integrations (OpenClaw, OpenCode, Pi, T3). [siwc-partners]
  - _Interpretation:_ under #23, dsh has no documented permitted ChatGPT Plus route. The plan could reach dsh only through a gateway, whose status is "unclear, leaning not permitted".

### 4.6 Rules from git

- **Instruction files:** `dsh-agent-instructions` "loads the applicable chain for the first request". The chain is "the user-global `$DSH_HOME/AGENTS.md` followed by the project chain — every existing candidate file from the project root down to the session working directory". `AGENTS.local.md` and `CLAUDE.local.md` are "additive local overlays". The base bundle sets `maxBytes: 65536`, and "broader files are omitted before the most specific file is truncated". [dsh-agent-instructions], [dsh-base-patch]
- **Skills**, by discovery rank: `<projectRoot>/.dsh/skills`, `<projectRoot>/.agents/skills`, `customSkillDirs`, `<dshHome>/skills`, `<agentsHome>/skills`, then bundled. "Nested recursive `**/SKILL.md` discovery is not supported." [dsh-skills]
- **Memory:** none built in. Three "default-off reference configurations" connect third-party memory MCP servers. [dsh-mcp-memory]
- **Machine-local stores:**
  - `~/.dsh/AGENTS.md`, `~/.dsh/skills`, `~/.agents/skills`.
  - Profile patches under `$DSH_HOME/profiles/<p>/`, and `$DSH_HOME/.credentials.yaml`.
  - Session logs under `$DSH_HOME`. [dsh-providers], [dsh-agent-instructions]

### 4.7 Second layer for Hard limits

- **Sandbox modes:**
  - "`SandboxMode` governs filesystem effects only … Network and process visibility are outside this vocabulary."
  - On Linux the backend is "bwrap/Landlock". Enforcement is reported as `full` or `partial`, where "partial" covers "Older Landlock ABIs". [dsh-sandbox]
- **Defaults:**
  - "Every shipped CLI mode starts with the same file-effect boundary": `mode: process.env.DSH_PERMISSION_MODE ?? 'workspace-write'`.
  - The approval policy is `ask` unless the mode is `danger-full-access`. Presets are `read-only`, `workspace-write` and `danger-full-access`. [dsh-base-patch], [dsh-permission-presets]
- **Approvals:** "Callers … fail closed unless it is `allowed-once`." [dsh-approval]
- **Hook bridges fail open:** "If the config cannot be read or parsed, the bridge logs a warning and runs no hooks — the agent still starts." "A hook that fails to run (a bad command or a crash) is logged, and the agent continues." [dsh-hooks] _Interpretation:_ a Hard limit placed in dsh is safer as a native guard or pre-execute plugin than as a bridged shell hook.
- **On this VM:** Landlock is in the active LSM list, bubblewrap 0.6.1 is installed, and the native package ships `linux-arm64` with "the static Landlock executable". [dsh-native] _Unverified:_ whether dsh reports `full` enforcement here; nothing was run.

### 4.8 Tools: MCP and the browser

- **MCP:** "MCP servers are opt-in. Configure one `@deepseek-ai/dsh-mcp-client` entry per server". Client config owns the "startup failure policy". [dsh-mcp]
- **Browser use:** "Mount `dsh-browser-use` and one provider". The providers are Playwright MCP, Chrome DevTools MCP and Stagehand. "The providers are experimental public npm packages and require explicit activation." "Browser profiles and login state are not restored from the Session log." [dsh-browser-use]
- **Telemetry:**
  - Session telemetry runs in `FEEDBACK_ONLY` mode, sending to `https://dsh-otel-collector.deepseeksvc.com/v1/logs`.
  - "OTel releases a Session-log prefix only after explicit user feedback … A non-empty `DSH_TELEMETRY_DISABLED` … opts the process out". [dsh-base-patch]

### 4.9 Fit

- **Node:** `"engines": { "node": "^22.19.0 || >=24.0.0" }` (the VM has 24.20.0). [dsh-package-json]
- **Native and Python packages:** the native addon has `linux-arm64` and `linux-x64` packages. The Python runtime wheels include `manylinux_2_28_aarch64`, and the VM's glibc is 2.35. [dsh-native], [pypi]
- **Web UI:** `dsh web` serves on `127.0.0.1:3080`. The VM needs headless or SDK mode, not the Web UI.

## 5. Codex CLI and OpenCode: extensibility (reference)

#22 covers their runs, providers, Rules and limits. These facts add the extensibility side:

- **Codex:**
  - Its Plugins page lists the components a plugin bundles: "Skills", "MCP servers", "Browser extensions" and "Hooks". It describes no in-process tool mechanism; tools come from MCP servers. [codex-plugins]
  - **Embedding:** the TypeScript `@openai/codex-sdk` "lets your application start, continue, and resume local Codex threads" (Node 18+). "The Python SDK controls the local Codex app-server over JSON-RPC" (`pip install openai-codex`, Python 3.10+). "Published SDK builds include a pinned Codex CLI runtime dependency." [codex-sdk]
- **OpenCode:**
  - "Tools are defined as **TypeScript** or **JavaScript** files", in `.opencode/tools/` or `~/.config/opencode/tools/`, with the `tool()` helper from `@opencode-ai/plugin`. [opencode-custom-tools]
  - OpenCode 2: "V1 plugin implementations do not run in V2" (#22 §3.4).
  - Its `dev` branch has a SIWC module (`registrationClientID = "dynamic_agent_client"`, `tokenSharingScope = "chatgpt.tokens.use.direct"`) and a "Codex browser (legacy)" login using `app_EMoamEEZ73f0CkXaXp7hrann`. [opencode-src] _Unverified:_ which of the two OpenCode 1.19.0 ships.

## 6. Open risks and items not verified

- _Unverified:_ neither Pi nor dsh was installed or run on the VM. arm64 builds, Landlock enforcement (dsh), and Pi's paste-the-redirect SIWC login on the VM are inferred from docs and source.
- _Unverified:_ whether SIWC "ChatGPT plan usage" covers Pi when it is embedded through its SDK in the person's own bot, as opposed to the Pi CLI. The requests still use Pi's registration (`agent_name_hint` "Pi"), but OpenAI's docs separate "open-source partners" from "selected private clients" (#23).
- _Unverified:_ what dsh's default `workspace-write` + `ask` preset sends to approval during a headless run. Under no answerer, those calls are denied (fail closed), which could stall a Registration run.
- _Unverified:_ dsh's ChatGPT/Codex sign-in path. The user guide says it is not supported, and the adapter has a seam for it. No surface that offers it was traced.
- _Unverified:_ whether Pi's example `sandbox` extension needs `socat`, which is missing on the VM, as Claude Code's sandbox does.
- **Pi:**
  - Breaking changes ship in minor releases weekly or faster, and 1.2.0 changed the extension event shape.
  - Pi's own Claude Pro/Max login and the legacy Codex login are present and only one `/login` away.
  - Install telemetry and provider attribution headers are on by default.
- **dsh:**
  - Its version cadence is pre-release only, and its own safety notice warns against treating it as secure.
  - Its npm `dsh-sdk-client` `latest` tag and PyPI SDK lag the CLI.
  - Its pi-ai pin (`^0.87.1`) keeps it on pi-ai's pre-SIWC line.
  - Its native DeepSeek adapter reaches only Messages endpoints.
- **Moving targets:** Pi went from "No MCP" to built-in MCP within five months. dsh is eight weeks old. OpenCode 2 and Codex keep changing (#22). Re-check versions before building.

## 7. Decisions this raises

- **Which harness:** Pi, dsh, Codex CLI or OpenCode, judged on extensibility against stability. The choice also settles in-process (Pi SDK) against subprocess embedding (Pi RPC, dsh SDK, Codex SDK).
- **ChatGPT Plus route if Pi is chosen:** Pi's SIWC goes straight to `api.openai.com`, and #23 found it permitted. But it bypasses the gateway, and with it the gateway quotas and logs #8 relies on for Hard limits and spend. Use SIWC direct, or keep the plan behind the gateway, whose terms are unclear?
- **ChatGPT Plus if dsh is chosen:** dsh has no documented permitted route. Drop the plan from dsh, leaving DeepSeek + OpenRouter to meet "at least two providers", or route it through a gateway?
- **Isolation:** Pi has no sandbox, so a container, dedicated user or micro-VM becomes compulsory. dsh and Codex sandbox file effects only (dsh) or files and network (Codex). Which OS boundary does the Assistant run in?
- **Rules loading under automation:** pass `--approve` (Pi), or save trust, so that skills in git load in unattended runs? Empty or forbid `~/.pi/agent/{AGENTS,SYSTEM,APPEND_SYSTEM}.md`, `~/.dsh/AGENTS.md` and `~/.agents/skills`?
- **Version policy:** pin Pi to a minor and dsh to an exact pre-release, and decide who reads the Breaking Changes before upgrading.
- **Telemetry and network:** set `PI_TELEMETRY=0` / `enableInstallTelemetry: false` / `PI_OFFLINE`, and `DSH_TELEMETRY_DISABLED`?
- **Unused logins:** how to keep Pi's Claude Pro/Max login, and its legacy Codex login, out of use: config only, or a wrapper that refuses those providers?

## Sources

"Read" is the fetch date, 2026-10-13. Source-code links point at the named tag.

**Observed on the VM (2026-10-13)**
- `uname -srm`, `/sys/kernel/security/lsm`, `ldd --version`, `bwrap --version`, `node --version`, `python3 --version`; absence of `pi`, `dsh`, `~/.pi`, `~/.dsh`.

**Pi (earendil-works/pi, tag `v1.2.0` unless noted)**
- [pi-repo]: GitHub API `repos/earendil-works/pi` and `repos/badlogic/pi-mono` (redirect), org `earendil-works` (read 2026-10-13). https://github.com/earendil-works/pi
- [pi-readme]: `README.md`. https://github.com/earendil-works/pi/blob/v1.2.0/README.md
- [pi-readme-0.73]: README of `@mariozechner/pi-coding-agent@0.73.1` (npm, published 2026-05-07; read via `npm view … readme`)
- [pi-cli]: `packages/coding-agent/docs/cli.md`. https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/cli.md
- [pi-cli-integration]: `docs/cli-integration.md` (and `how-pi-works.md`). https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/cli-integration.md
- [pi-json]: `docs/json.md`. [pi-rpc]: `docs/rpc.md`. [pi-sdk]: `docs/sdk.md`. https://github.com/earendil-works/pi/tree/v1.2.0/packages/coding-agent/docs
- [pi-extensions]: `docs/extensions.md`. https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/docs/extensions.md
- [pi-ext-types]: `src/core/extensions/types.ts` (`abort()`, `shutdown()`, `isIdle()`)
- [pi-examples]: `examples/extensions/` (`structured-output.ts`, `permission-gate.ts`, `sandbox/index.ts`, and others). https://github.com/earendil-works/pi/tree/v1.2.0/packages/coding-agent/examples/extensions
- [pi-packages]: `docs/packages.md`. [pi-skills]: `docs/skills.md`. [pi-codemode]: `docs/codemode.md`
- [pi-config]: `docs/configuration.md`. [pi-settings]: `docs/settings.md`. [pi-env]: `docs/environment-variables.md`
- [pi-security]: `docs/security.md`. [pi-containerization]: `docs/containerization.md`
- [pi-mcp]: `docs/mcp.md`. [pi-models]: `docs/models.md`. [pi-providers]: `docs/providers.md`
- [pi-ai-src]: `packages/ai/src/auth/oauth/openai-chatgpt.ts`, `openai-codex.ts`, `anthropic.ts` and the other `auth/oauth/*.ts`; `providers/openai.ts`, `providers/openai-codex.ts`, `providers/deepseek.ts`; `api/openai-completions.ts`
- [pi-ai-types]: `packages/ai/src/types.ts` (`KnownApi`)
- [pi-ai-0.87.1]: `packages/ai/src/auth/oauth/` at tag `v0.87.1` (directory listing and `openai-codex.ts`). https://github.com/earendil-works/pi/tree/v0.87.1/packages/ai/src/auth/oauth
- [pi-agent-core]: `packages/agent/README.md`
- [pi-changelog]: `packages/coding-agent/CHANGELOG.md`, sections 0.99.0 (2026-09-29), 1.0.0 (2026-10-01), 1.0.3 (2026-10-05), 1.2.0 (2026-10-12). https://github.com/earendil-works/pi/blob/v1.2.0/packages/coding-agent/CHANGELOG.md
- [pi-agents]: root `AGENTS.md` (changelog rules). [pi-release]: `.pi/skills/release.md` (versioning rule)
- [pi-releases]: https://github.com/earendil-works/pi/releases (v0.86.0 2026-09-19 … v1.2.0 2026-10-12). [pi-release-assets]: v1.2.0 assets incl. `pi-linux-arm64.tar.gz`

**DeepSeek Harness (deepseek-ai/deepseek-harness, tag `dsh-v0.2.0-rc.2`, 2026-09-29)**
- [dsh-repo]: GitHub API `repos/deepseek-ai/deepseek-harness` and its release list (read 2026-10-13). https://github.com/deepseek-ai/deepseek-harness
- [dsh-site]: DeepSeek Harness product page. https://deepseek.com/harness (read 2026-10-13; Chinese, quotes translated)
- [dsh-readme]: `README.md`. [dsh-safety]: `SAFETY.md`. https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.0-rc.2
- [dsh-cli]: `apps/cli/README.md`. [dsh-package-json]: root `package.json` (`engines`)
- [dsh-headless]: `packages/bundle/headless/README.md`. [dsh-json-src]: `packages/bundle/headless/src/json-stream.ts`
- [dsh-base-patch]: `packages/bundle/base/cordis.patch.yml` (sandbox, approval, telemetry, `agent-instructions` rows)
- [dsh-dev-basic]: `docs/user/develop/basic/index.md`. [dsh-dev-tool]: `docs/user/develop/basic/tool.md`
- [dsh-tool-pipeline]: `docs/tool-execution-pipeline.md`. [dsh-tools-readme]: `packages/core/tools/README.md`
- [dsh-agent-loop]: `packages/core/agent-loop/README.md`. [dsh-guard]: `packages/guard/*/README.md`
- [dsh-sdk-client]: `packages/sdk/client/README.md`. [dsh-python-sdk]: `docs/user/guide/python-sdk.md`. [dsh-python-readme]: `python/sdk/README.md`
- [dsh-providers]: `docs/user/guide/providers.md`. [dsh-pi-ai]: `packages/llm/llm-pi-ai/README.md` and `package.json`. [dsh-llm-deepseek]: `packages/llm/llm-deepseek/README.md`
- [dsh-account]: `packages/llm/llm-deepseek-account/README.md`, `packages/credentials/deepseek-account-platform/README.md`. [dsh-authorization]: `packages/credentials/authorization/README.md`
- [dsh-sandbox]: `docs/subsystems/sandbox.md`. [dsh-approval]: `docs/subsystems/approval.md`. [dsh-permission-presets]: `docs/subsystems/permission-presets.md`
- [dsh-hooks]: `packages/hooks/README.md`, `packages/hooks/hooks-claude-code/README.md`
- [dsh-agent-instructions]: `packages/context/agent-instructions/README.md`. [dsh-skills]: `docs/subsystems/skills.md`. [dsh-mcp-memory]: `docs/user/guide/mcp-memory.md`
- [dsh-mcp]: `docs/subsystems/mcp.md`. [dsh-browser-use]: `docs/subsystems/browser-use.md`
- [dsh-native]: `native/README.md`, `native/system/README.md` and its `packages/` listing

**Other candidates**
- [henry-repo]: GitHub API `repos/HenryZ838978/deepseek-harness` (read 2026-10-13). https://github.com/HenryZ838978/deepseek-harness
- [codewhale]: `README.md` of `codewhale-hq/Codewhale` (redirected from `Hmbown/DeepSeek-TUI`; read 2026-10-13). https://github.com/codewhale-hq/Codewhale
- Secondary write-ups found by search, not relied on: KDnuggets, "What I've Learned About DeepSeek Harness"; eesel.ai, "DeepSeek Harness (dsh) explained"; developersdigest.tech, "We Read DeepSeek Harness"; deepseekharness.io; deepseek-code.com; deepseek.day (all found 2026-10-13).

**OpenAI**
- [siwc-docs]: Sign in with ChatGPT developer docs (Quickstart, Overview, Registration and sign-in, Preview limitations, Self-hosted VMs, Accounts and sessions). https://developers.openai.com/siwc/llms-full.txt (read 2026-10-13)
- [siwc-partners]: Sign in with ChatGPT partners page. https://learn.chatgpt.com/docs/sign-in-with-chatgpt (read 2026-10-13; no date on page)
- [codex-client-id]: `codex-rs/login/src/auth/manager.rs` on `main`. https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs (read 2026-10-13)
- [codex-sdk]: Codex SDK. https://learn.chatgpt.com/docs/codex-sdk (redirected from developers.openai.com/codex/sdk; read 2026-10-13)
- [codex-plugins]: Plugins. https://learn.chatgpt.com/docs/plugins (read 2026-10-13)

**OpenCode**
- [opencode-custom-tools]: Custom tools. https://opencode.ai/docs/custom-tools/ (page "Last updated: Oct 13, 2026")
- [opencode-src]: `packages/core/src/plugin/provider/chatgpt.ts` and `openai.ts` on branch `dev`. https://github.com/anomalyco/opencode/tree/dev/packages/core/src/plugin/provider (read 2026-10-13)

**Package registries (read 2026-10-13)**
- [npm]: `@earendil-works/pi-coding-agent` 1.2.0 (`node >=22.19.0`; first version 0.74.0, 2026-05-07; dist-tag `legacy-node20` 0.74.2); `@mariozechner/pi-coding-agent` 0.73.1; `@deepseek-ai/dsh` 0.2.0-rc.2 (created 2026-08-10, 31 versions); `@deepseek-ai/dsh-sdk-client` (`latest` 0.0.1-rc.1, `next` 0.2.0-rc.2); weekly downloads 2026-10-05 to 2026-10-11 from api.npmjs.org (pi-coding-agent 4,156,854; pi-agent-core 5,347,861; dsh 358,343). https://www.npmjs.com/
- [pypi]: `deepseek-harness-sdk` 0.1.5rc1 (2026-09-10, `>=3.10`); `deepseek-harness-runtime-bin` 0.1.5rc1 wheels incl. `manylinux_2_28_aarch64`. https://pypi.org/

**Earlier research in this repo**
- [agent-harnesses]: `docs/research/agent-harnesses.md` on `research/agent-harnesses` (#22). https://github.com/ultrasadness/lab1/blob/research/agent-harnesses/docs/research/agent-harnesses.md
- [provider-terms]: `docs/research/provider-terms.md` on `research/provider-terms` (#23). https://github.com/ultrasadness/lab1/blob/research/provider-terms/docs/research/provider-terms.md
