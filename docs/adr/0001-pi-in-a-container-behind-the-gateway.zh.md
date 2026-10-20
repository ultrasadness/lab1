# Assistant 由这个人网关后面、容器里的 Pi 运行

[English](0001-pi-in-a-container-behind-the-gateway.md) | 中文

Assistant 的 agent 循环是开源的 Pi harness。它运行在一个长期存在的 Docker 容器里，Discord 机器人每次运行启动一个 Pi 进程（`docker exec … pi --mode rpc`）。模型来自这个人自己订阅的套餐，经由 new-api 提供；容器只能通过机器人那个负责加上密钥的 forwarder 访问 new-api（[ADR 0009](./0009-the-bot-runs-as-its-own-user-and-holds-every-token-outside-the-containers.zh.md)），new-api 后面是持有自己 ChatGPT Plus 登录的 CLIProxyAPI（CPA）。这个人想要一个能一个功能一个功能地扩展的 harness，跑在已经付费的模型上，并且至少有两个 provider，这样失去一个套餐只是改一下配置。Pi 用 TypeScript 模块扩展，可以嵌入使用或通过 RPC 运行，稳定到足以固定版本（1.x），并且支持这些套餐用到的每一种线上 API（wire API）。在 [Assistant 运行在哪个 agent harness 和模型上？](https://github.com/ultrasadness/lab1/issues/8) 中决定。

## 考虑过的方案

- **Claude Code**（无头的 `claude -p` 或 Agent SDK）：否决。这个人的 Claude Pro 登录不得转接给别的 harness。用 Claude Code 作 harness 时，不管背后是什么模型，都适用 Anthropic 的 Usage Policy。它只能通过 Anthropic 不支持的格式转换来使用 GPT 模型。
- **Codex CLI**：开源，默认带沙箱，有官方的 ChatGPT Plus 路线。否决，因为它只能通过 MCP、skill 和 hook 扩展，而且只支持 Responses API。
- **DeepSeek 的 `dsh`**：可插拔程度最深的选项。暂时否决，因为它是开发者预览版，明言会有破坏性变更，自称还不能用于生产，也没有获准的 ChatGPT Plus 路线。等它结束预览后值得再看。
- **OpenCode**，或在某个 SDK 上自己写循环：OpenCode 当时正处在 2.0 重新设计的半途中。自己写循环意味着 Rule 的加载和每一项限制都得自己写，而且多半会失去 ChatGPT Plus。
- **用 Pi 官方的 “Sign in with ChatGPT” 代替 CPA**：唯一明确获准的 Plus 路线。否决，因为它会把一个 OpenAI 令牌放进容器，并让 Plus 流量绕过网关的配额、角色映射和回退。使用 CPA 转供的 Plus 登录，是这个人为个人用途接受的风险。它的依据是 OpenAI 的 Codex 负责人在 2026 年 7 月 12 日对 CLIProxyAPI 的认可，那是在 OpenAI 的 “Sign in with ChatGPT” 条款（2026 年 9 月 29 日）写下 “Do not provide general-purpose API access for other tools”（不要为其他工具提供通用 API 访问）之前。如果那条路线关闭，Pi 的官方登录仍是回退方案。

## 后果

- **Hard limit 在模型之下强制执行**，靠的是窄的权限范围、Assistant 自己的工具、容器和网关配额。Pi 自己没有沙箱或权限系统，它的 `tool_call` 拦截只是第二层。
- **一个角色的第二个 provider 通过机器人的 forwarder 接手，而不是通过 new-api。** forwarder 按固定的顺序为每个请求挑选 provider，并按花费预算放行每次运行（[ADR 0011](./0011-the-forwarder-picks-each-requests-provider-and-holds-the-spending-budgets.zh.md)）。
- **容器里没有任何 Secret 或令牌。** 任何需要它们的事（一份 Gmail 草稿、一个按引用填入的字段、一条 Discord 帖子）都通过一个窄接口交给外面的机器人。每个令牌放在哪里，见 [ADR 0009](./0009-the-bot-runs-as-its-own-user-and-holds-every-token-outside-the-containers.zh.md)。
- **Approval 是两次运行之间的关卡，从不是一次运行中途的暂停。** 一次运行在决策点结束，再由新的运行或普通代码严格按批准的内容行事。
- **Pi、容器镜像、new-api 和每个角色背后的模型都固定版本。** 升级是有意为之的，每次都要先通过 Rule 延续检查和一次 Miner 试运行。
- **Pi 的本机文件（`~/.pi/agent/`）在镜像里按构造就是空的。** 无人值守的运行需要 `--approve` 或一个受信任的项目，才能加载放在 git 里的 skill。
