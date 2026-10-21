# 机器人

[English](README.md) | 中文

Assistant 唯一长期运行的进程：运行在 Node 24 上的 TypeScript，借助 Node 的类型剥离（type stripping）原样运行，自己没有任何 npm 依赖。它持有所有令牌，独自写入实时存储（live store），并发出所有对外调用。规格是 #41；这第一个切片（#42）打通 Miner 从 Product Hunt 到 Miner days 论坛的路径。

| 路径 | 是什么 |
|---|---|
| `bot/src/assistant.ts` | 启动每个部分和日程（太平洋时间 01:00 的补跑、它每 30 分钟的重试、太平洋时间 06:00 的迟到检查）；后台通道（background lane）；谁可以点按 |
| `bot/src/miner/` | 评判运行、Day's line、每日帖子（day post）、3 个日期的补跑和 Retry |
| `bot/src/status.ts` | `#status` 文字频道里的静默消息 |
| `bot/src/forwarder.ts` | Pi 容器唯一的端点：带角色密钥的模型请求，以及运行记录 |
| `bot/src/pi-runs.ts` | 每次运行一个 `pi --mode rpc` 进程，按墙钟时间、轮数和 token 数设上限 |
| `bot/src/store.ts` | 实时存储（SQLite） |
| `bot/src/product-hunt.ts`, `bot/src/discord/` | Product Hunt API v2 和 Discord |
| `pi/extension/` | 我们的 Pi 扩展：把 forwarder 作为 provider，以及每种运行的记录工具和提示词 |
| `pi/pi-run`, `pi/Dockerfile` | 一次运行如何启动，以及 Pi 容器镜像 |
| `config/assistant.json` | 设置，只通过 `ops/upgrade` 修改 |

Pi 自己的文档随它的包一起发布，`npm ci` 运行之后位于 `node_modules/@earendil-works/pi-coding-agent/docs/`：`rpc.md` 讲每次运行使用的 RPC 模式，`json.md` 讲事件流，`message-types.md` 讲事件流里的消息，`settings.md` 讲 Pi 的 `settings.json`，包括它的重试退避。

## 测试

```sh
npm ci
npm run typecheck
npm run check:docs                     # the doc pairs
npm test                               # every test
node --test bot/test/miner-day.test.ts # one file
```

`npm test` 给每个测试 60 秒。超时的测试会失败；即使它留下了没关闭的服务器或定时器，整个运行也照样结束（`--test-force-exit`）。

每次提交和 push 要过的 hook 和 CI，以及在新的克隆里怎么打开 hook，见 `docs/hooks-and-ci.md`。

机器人的测试只走 seam 1（`bot/test/harness/`）：真实的机器人在进程内运行，真实的 Pi 和我们的扩展作为本地进程运行，对接假的 Discord、Product Hunt 和模型 provider 服务器，以及一个由测试拨动的时钟。只有 harness 从 `bot/src` 导入：`bot/test/` 下其他任何文件的导入只要写出那里的某个文件，`npm test` 都会失败（`scripts/bot-test-imports.test.ts`）。

时钟的一次跳跃（`advanceTo`）只在新的时间点把过期的定时器触发一次，和真实时钟一样。要测试重复的定时器，用 `stepThrough` 逐一走过它的每次触发。

假的 Product Hunt 只回答真实 API 的实时 schema 接受、变量也符合这份 schema 的查询，其他查询一律拒绝：回复里有 GraphQL 错误，没有数据。这样，写错的字段、参数或 enum 值会让测试失败，而不是等到上线时才让机器人的读取失败。`npm run capture:producthunt-schema` 通过内省（introspection）抓取这份 schema，以 SDL 形式写到 `bot/test/fixtures/producthunt/schema.graphql`，假的 Product Hunt 就从那里读取它。遇到 HTTP 错误、GraphQL 错误，或者回复建不出 schema 时，脚本什么都不写，并说明原因。这个脚本由这个人来运行，因为 agent 从不读取令牌：它像机器人一样，自己读取 `$CREDENTIALS_DIRECTORY` 里的 `producthunt-token`，并向机器人配置里写的 API 发请求。在 Claude Code 会话里，在命令前输入 `!`，令牌就不会进入 agent 的上下文。每当 `bot/src/product-hunt.ts` 里的某个查询改变，或者实时 API 可能已经改变时，就再运行一次，并提交它写出的文件。

```sh
CREDENTIALS_DIRECTORY=/path/to/credentials npm run capture:producthunt-schema
```

## 运行

机器人读取 `config/assistant.json`（或 `$ASSISTANT_CONFIG`），并按 systemd 的 `LoadCredential=` 交付的方式，从 `$CREDENTIALS_DIRECTORY` 读取它的令牌：`discord-bot-token`、`producthunt-token`，以及每个角色一个 `newapi-key-<role>`。Interest scope 是它检出的 Personal database 里的 `profile/interest-scope.md`。

```sh
docker build -f pi/Dockerfile -t assistant-pi .
npm start
```

在 VM 上的安装（它自己的用户、Docker 辅助程序、systemd 单元）是 #71。它还会设置 `config/assistant.json` 留空的部分：各个 Discord id、如何在回环地址上访问 new-api，以及代替 `docker exec` 的辅助程序。在那之前，配置里的 `pi.command` 直接运行 `docker exec`，而 ADR 0009 不允许装好的机器人这样做：`assistant` 用户不在 `docker` 组里，只能通过辅助程序访问 Docker。它传进容器的唯一值是每次运行自己的令牌，这个令牌只让 Pi 为这一次运行访问 forwarder，而且从来不是密钥。

`config/assistant.json` 里的运行上限是初始值。墙钟时间上限在 #26 中确定；轮数和 token 上限是初步估计，要根据 `run.finished` 日志行再调。

机器人每个事件向 stdout 输出一行 JSON。`run.finished` 行带有这次运行的角色、provider、模型和精确的 token 数；运行触到上限时，还写明触到的是哪个上限。`miner.judged` 行写明哪个模型请求的回复里有这次评判，以及该请求的精确 token 数；通常一个回复就评判了它那次运行里的每个 Launch。
