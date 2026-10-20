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

在新的克隆里，用 `git config core.hooksPath .githooks` 打开一次 `.githooks/` 里的 hook。暂存的文件没通过类型检查、或让某对文档不同步（`docs/agents/doc-pairs.md`）时，pre-commit hook 拒绝提交；在主 checkout 里，它还拒绝 `main` 以外任何分支上的提交。提交消息里在 GitHub 关闭关键字后面跟着 issue 引用时，比如 `Closes #88`，commit-msg hook 拒绝这条消息：提交一到 `main`，GitHub 就会关闭这个 issue，而 ticket 要在落地之后手动关闭（`docs/agents/issue-tracker.md` 里的 **Close**）。改为把引用写成 `(#88)`。GitHub Actions 在每次 push 和 pull request 时运行类型检查、文档配对检查和测试（`.github/workflows/bot.yml`）。pre-push hook 拒绝把 `main` 移到某个提交的 push，除非 GitHub Actions 已经在这个提交上运行过，并且每次运行都通过：GitHub Free 不给私有仓库提供分支保护，所以服务器那边没有什么会拒绝它。这个 hook 通过 `gh` 向 GitHub 查询，所以 `gh` 必须已经登录。

机器人的测试只走 seam 1（`bot/test/harness/`）：真实的机器人在进程内运行，真实的 Pi 和我们的扩展作为本地进程运行，对接假的 Discord、Product Hunt 和模型 provider 服务器，以及一个由测试拨动的时钟。文档配对检查的测试（`scripts/doc-pairs.test.ts`）在用完即弃的文档对上运行检查本身。pre-push hook 的测试（`scripts/pre-push.test.ts`）从一个用完即弃的仓库 push，用的是一个需要 `jq` 的假 `gh`；commit-msg hook 的测试（`scripts/commit-msg.test.ts`）则在这样一个仓库里提交。

时钟的一次跳跃（`advanceTo`）只在新的时间点把过期的定时器触发一次，和真实时钟一样。要测试重复的定时器，用 `stepThrough` 逐一走过它的每次触发。

## 运行

机器人读取 `config/assistant.json`（或 `$ASSISTANT_CONFIG`），并按 systemd 的 `LoadCredential=` 交付的方式，从 `$CREDENTIALS_DIRECTORY` 读取它的令牌：`discord-bot-token`、`producthunt-token`，以及每个角色一个 `newapi-key-<role>`。Interest scope 是它检出的 Personal database 里的 `profile/interest-scope.md`。

```sh
docker build -f pi/Dockerfile -t assistant-pi .
npm start
```

在 VM 上的安装（它自己的用户、Docker 辅助程序、systemd 单元）是 #71。它还会设置 `config/assistant.json` 留空的部分：各个 Discord id、如何在回环地址上访问 new-api，以及代替 `docker exec` 的辅助程序。在那之前，配置里的 `pi.command` 直接运行 `docker exec`，而 ADR 0009 不允许装好的机器人这样做：`assistant` 用户不在 `docker` 组里，只能通过辅助程序访问 Docker。它传进容器的唯一值是每次运行自己的令牌，这个令牌只让 Pi 为这一次运行访问 forwarder，而且从来不是密钥。

`config/assistant.json` 里的运行上限是初始值。墙钟时间上限在 #26 中确定；轮数和 token 上限是初步估计，要根据 `run.finished` 日志行再调。

机器人每个事件向 stdout 输出一行 JSON。`run.finished` 行带有这次运行的角色、provider、模型和精确的 token 数；运行触到上限时，还写明触到的是哪个上限。`miner.judged` 行写明哪个模型请求的回复里有这次评判，以及该请求的精确 token 数；通常一个回复就评判了它那次运行里的每个 Launch。
