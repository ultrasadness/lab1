# Pi in a container behind the person's gateway runs the Assistant

The Assistant's agent loop is the open-source Pi harness. It runs inside one long-lived Docker container, and the Discord bot starts one Pi process per run (`docker exec … pi --mode rpc`). Models come from the person's own plans, served through new-api, which the container reaches only through the bot's key-adding forwarder ([ADR 0009](./0009-the-bot-runs-as-its-own-user-and-holds-every-token-outside-the-containers.md)), with CLIProxyAPI (CPA) behind it holding its own ChatGPT Plus login. The person wanted a harness they can extend feature by feature, on models they already pay for, with at least two providers so that losing one plan is a configuration change. Pi is extended with TypeScript modules, embeds or runs over RPC, is stable enough to pin (1.x), and speaks every wire API the plans use. Decided in [Which agent harness and model does the Assistant run on?](https://github.com/ultrasadness/lab1/issues/8).

## Considered Options

- **Claude Code** (headless `claude -p` or the Agent SDK): rejected. The person's Claude Pro login may not be routed to another harness. With Claude Code as the harness, Anthropic's Usage Policy applies whatever model sits behind it. It reaches GPT models only through translation Anthropic doesn't support.
- **Codex CLI:** open source, sandboxed by default, with a first-party ChatGPT Plus route. Rejected because it extends only through MCP, skills and hooks, and speaks only the Responses API.
- **DeepSeek's `dsh`:** the most deeply pluggable option. Rejected for now because it is a developer preview that promises breaking changes, calls itself not production-ready, and has no permitted ChatGPT Plus route. Worth revisiting once it leaves preview.
- **OpenCode**, or our own loop on an SDK: OpenCode was mid-way through a 2.0 redesign. Our own loop would have meant writing Rule loading and every limit ourselves, and probably losing ChatGPT Plus.
- **Pi's official "Sign in with ChatGPT" instead of CPA:** the one clearly permitted Plus route. Rejected because it would put an OpenAI token inside the container and send Plus traffic around the gateway's quota, role mapping and fallback. Using CPA's re-served Plus login is a risk the person accepted for personal use. It rests on OpenAI's Codex lead endorsing CLIProxyAPI on 12 Jul 2026, before OpenAI's "Sign in with ChatGPT" terms (29 Sep 2026) said "Do not provide general-purpose API access for other tools". Pi's official login stays the fallback if that route closes.

## Consequences

- **Hard limits are enforced below the model**, by narrow scopes, the Assistant's own tools, the container and the gateway quota. Pi has no sandbox or permission system of its own, and its `tool_call` block is only a second layer.
- **A role's second provider takes over through the bot's forwarder, not through new-api.** The forwarder picks each request's provider in pinned order and admits each run against a spending budget ([ADR 0011](./0011-the-forwarder-picks-each-requests-provider-and-holds-the-spending-budgets.md)).
- **The container holds no Secret or token.** Anything that needs one (a Gmail draft, a field filled by reference, a Discord post) goes through one narrow interface to the bot outside. Where each token lives is [ADR 0009](./0009-the-bot-runs-as-its-own-user-and-holds-every-token-outside-the-containers.md).
- **An Approval is a gate between runs, never a pause inside one.** A run ends at a decision point, and a new run, or plain code, acts on exactly what was approved.
- **Pi, the container image, new-api and the model behind each role are pinned.** Upgrades are deliberate, each gated by the Rule carry-over check and a Miner dry run.
- **Pi's machine-local files (`~/.pi/agent/`) are empty by construction in the image.** Unattended runs need `--approve`, or a trusted project, for skills kept in git to load.
