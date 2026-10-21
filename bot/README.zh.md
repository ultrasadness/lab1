# 机器人

[English](README.md) | 中文

Assistant 唯一长期运行的进程：运行在 Node 24 上的 TypeScript，借助 Node 的类型剥离（type stripping）原样运行，自己没有任何 npm 依赖。它持有所有令牌，独自写入实时存储（live store），并发出所有对外调用。规格是 #41。它的第一个切片（#42）打通了 Miner 从 Product Hunt 到 Miner days 论坛的路径，#47 为每个达到或高于 Day's line 的 Launch 加上一份 Dossier。

| 路径 | 是什么 |
|---|---|
| `bot/src/assistant.ts` | 启动每个部分和日程（太平洋时间 01:00 的补跑、它每 30 分钟的重试、太平洋时间 06:00 的迟到检查）；后台通道（background lane）；谁可以点按 |
| `bot/src/miner/` | 评判运行、Day's line、每日帖子（day post）和 `days/` 文件、3 个日期的补跑和 Retry |
| `bot/src/dossier/` | Dossier：每份读取的页面、它那次运行的提示词和记录、控制在 Discord 4,000 字符以内的卡片、它的 Product 帖子，以及 Personal database 里这个 Product 的文件夹 |
| `bot/src/browser.ts`, `bot/src/root-domain.ts` | 经由 Unix 套接字调用浏览器服务的 `read(url)`，以及用作 Product 键的根域名 |
| `bot/src/personal-database.ts` | Personal database 的写入者：一把锁管住快进、写入、提交和推送，以及历史分叉时的卡片（ADR 0012） |
| `bot/src/status.ts` | `#status` 文字频道里的静默消息 |
| `bot/src/needs-you.ts` | `#needs-you` 文字频道里的卡片，每张都提及这个人 |
| `bot/src/forwarder.ts` | Pi 容器唯一的端点：带角色密钥的模型请求（每个都按名义美元计价），以及运行记录 |
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

机器人的测试只走 seam 1（`bot/test/harness/`）：真实的机器人在进程内运行，真实的 Pi 和我们的扩展作为本地进程运行，对接假的 Discord、Product Hunt、浏览器服务和模型 provider 服务器、一个存放 Personal database 的假 GitHub，以及一个由测试拨动的时钟。假的 GitHub 是一个本地的裸仓库，git 通过代替 ssh 的 `bot/test/harness/fake-ssh.ts` 访问它。它只放行 deploy key，可以拒绝推送，也接受这个人自己的提交和合并。只有 harness 从 `bot/src` 导入：`bot/test/` 下其他任何文件的导入只要写出那里的某个文件，`npm test` 都会失败（`scripts/bot-test-imports.test.ts`）。

时钟的一次跳跃（`advanceTo`）只在新的时间点把过期的定时器触发一次，和真实时钟一样。要测试重复的定时器，用 `stepThrough` 逐一走过它的每次触发。

假的浏览器服务在一个 Unix 套接字上回答 `read(url)`。每个 Launch 的网站跳转都通向 `.example` 上一个属于它自己的普通站点，带一个价格页和一个注册页，除非测试从 `bot/test/harness/dossier-fixtures.ts` 提供某个真实 Product 的页面。

假的 Product Hunt 只回答真实 API 的实时 schema 接受、变量也符合这份 schema 的查询，其他查询一律拒绝：回复里有 GraphQL 错误，没有数据。这样，写错的字段、参数或 enum 值会让测试失败，而不是等到上线时才让机器人的读取失败。`npm run capture:producthunt-schema` 通过内省（introspection）抓取这份 schema，以 SDL 形式写到 `bot/test/fixtures/producthunt/schema.graphql`，假的 Product Hunt 就从那里读取它。遇到 HTTP 错误、GraphQL 错误，或者回复建不出 schema 时，脚本什么都不写，并说明原因。这个脚本由这个人来运行，因为 agent 从不读取令牌：它像机器人一样，自己读取 `$CREDENTIALS_DIRECTORY` 里的 `producthunt-token`，并向机器人配置里写的 API 发请求。在 Claude Code 会话里，在命令前输入 `!`，令牌就不会进入 agent 的上下文。每当 `bot/src/product-hunt.ts` 里的某个查询改变，或者实时 API 可能已经改变时，就再运行一次，并提交它写出的文件。

```sh
CREDENTIALS_DIRECTORY=/path/to/credentials npm run capture:producthunt-schema
```

## 运行

机器人读取 `config/assistant.json`（或 `$ASSISTANT_CONFIG`），并按 systemd 的 `LoadCredential=` 交付的方式，从 `$CREDENTIALS_DIRECTORY` 读取它的令牌：`discord-bot-token`、`producthunt-token`、每个角色一个 `newapi-key-<role>`，以及 Personal database 仓库的 deploy key `personal-database-deploy-key`。

机器人的 Personal database checkout 位于 `personalDatabase.dir`：这个人的仓库的一个克隆，检出 `main`，`origin` 指向仓库的 ssh URL。机器人在里面运行 git 时，除了这个 checkout 自己的 git 配置之外不读任何配置，并带着 deploy key 通过 `personalDatabase.ssh` 访问 GitHub，所以机器人用户的 `known_hosts` 里必须有 GitHub 的主机密钥。每次运行前它都快进这个 checkout，运行从其中的 `profile/interest-scope.md` 读取 Interest scope。机器人写的每个文件，比如 `days/<YYYY-MM-DD>.md`，都先在实时存储里排队，再单独提交，每次提交都会推送。被 GitHub 拒绝的推送，或者已经分叉的历史，每隔 `personalDatabase.retryMinutes` 重试一次。

Dossier 发到 Products 论坛 `discord.productsForumId`，论坛标签由这个人创建：*Walkthrough*、*Registering*、*Needs you*、*registered*、*waitlisted*、*handed off*、*abandoned*、*no account* 和 *Skipped*。机器人按名字找标签，所以只有名字要紧；目前它只打 *no account* 这一个。Dossier 通过位于 `browser.socketPath` 的浏览器服务套接字（`browser/README.md`）读取它的 Product 的页面，每次读取都在 `pages/` 下和其他原始输入放在一起，保留 90 天。

```sh
docker build -f pi/Dockerfile -t assistant-pi .
npm start
```

在 VM 上的安装（它自己的用户、Docker 辅助程序、systemd 单元）是 #71。它还会设置 `config/assistant.json` 留空的部分：各个 Discord id、浏览器服务的套接字、如何在回环地址上访问 new-api，以及代替 `docker exec` 的辅助程序。在那之前，配置里的 `pi.command` 直接运行 `docker exec`，而 ADR 0009 不允许装好的机器人这样做：`assistant` 用户不在 `docker` 组里，只能通过辅助程序访问 Docker。它传进容器的唯一值是每次运行自己的令牌，这个令牌只让 Pi 为这一次运行访问 forwarder，而且从来不是密钥。

`config/assistant.json` 里的运行上限是初始值。墙钟时间上限在 #26 中确定，Dossier 运行的除外；它和轮数、token 上限都是初步估计，要根据 `run.finished` 日志行再调。

`roles` 里的每个 provider 都写明它在 new-api 上的 `role@provider` 渠道服务哪个模型，`prices` 记录每个这样的模型的标价，以每 1M 未缓存输入、缓存输入和输出 token 的美元计。只要某个 provider 的模型没有价格，机器人就不会启动。ADR 0011 把价格放在 `ops/pins` 里；在它出现之前，价格放在这里。每个模型请求都按它的 provider 的价格计为名义美元。`budgets.miner` 是一个 Miner 日期的运行可以花的钱，Retry 也算在内，初始为 6 美元。只有在这个日期的花费低于 Miner 预算时，运行才会开始；已开始的运行即使超出预算也会完成。Miner 预算一旦用完，这个日期剩下的运行就等待，它在太平洋时间 06:00 的迟到消息会点出 Miner 预算；调高 `budgets.miner` 并重启机器人，这些运行就会继续。Miner provider 的模型连同它的价格在上线时设置（#85）；`prices` 里已经有 GPT-6.1 Sol 的价格，各项预算就是按这个价格定的（#39）。`budgets.registration` 初始为 20 美元，是 registration 角色的运行在一个太平洋时间日可以花的钱，Dossier 运行也在其中；它们的花费会被计算，但在 #69 之前，没有什么会让运行受它约束。

机器人每个事件向 stdout 输出一行 JSON。`run.finished` 行带有这次运行的角色、provider、模型、精确的 token 数和名义美元；运行触到上限时，还写明触到的是哪个上限。`miner.run-held` 行写明一次在等 Miner 预算的运行，以及这个日期的花费；`miner.posted` 行带有这个日期总共花了多少。`miner.judged` 行写明哪个模型请求的回复里有这次评判，以及该请求的精确 token 数；通常一个回复就评判了它那次运行里的每个 Launch。`dossier.written` 行用根域名写明一份 Dossier 的 Product，以及写它的那次运行、provider 和模型。
