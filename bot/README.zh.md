# 机器人

[English](README.md) | 中文

Assistant 唯一长期运行的进程：运行在 Node 24 上的 TypeScript，借助 Node 的类型剥离（type stripping）原样运行，自己没有任何 npm 依赖。它持有所有令牌，独自写入实时存储（live store），并发出所有对外调用。规格是 #41。它的第一个切片（#42）打通了 Miner 从 Product Hunt 到 Miner days 论坛的路径，#47 为每个达到或高于 Day's line 的 Launch 加上一份 Dossier，#48 让这个人可以对 Miner 的评判做 Correction，#49 把每个 Correction 分为只修正本项、Interest scope 的改动或 Rule，并把每条保留下来的 Rule 载入之后的运行，#53 为每个 open 或 waitlisted 的 Product 把一份 Walkthrough 交给这个人，它的 Approval 开启这个 Product 的 Registration。#99 让配置可以关掉 Walkthrough，发布时它们就是关着的。#100 给写不成的 Dossier 的尝试次数设了上限。#98 给实时存储加上 schema 版本号，以及机器人启动时运行的迁移（migration）。#71 把它安装到 VM 上，以它自己的用户运行（`ops/README.md`），#85 给它加上 healthchecks.io 的 ping。#54 在 Approval 时把 Registration 的密码存进 Password vault，并拒绝任何含有 Secret 的模型请求、Discord 消息或提交。

| 路径 | 是什么 |
|---|---|
| `bot/src/assistant.ts` | 启动每个部分和日程（太平洋时间 01:00 的补跑、它每 30 分钟的重试、太平洋时间 06:00 的迟到检查）；后台通道（background lane），它先运行 Correction，再运行 Walkthrough 准备，最后运行 Miner，以及从不在其中排队的普通代码工作，比如 Keep 或 Approve；谁可以点按 |
| `bot/src/miner/` | 评判运行、Day's line、每日帖子（day post）和 `days/` 文件、3 个日期的补跑和 Retry，以及对一天的评判所做的 Correction 和它们的分类运行 |
| `bot/src/rules/` | Rule：每次运行的 Rule 文件、它提示词里的 Rule 一节和 Rule budget；Correction 的分类运行；以及提议的 Rule 和 Interest scope 改动的卡片，带 Keep、Edit 和 Discard |
| `bot/src/dossier/` | Dossier：每份读取的页面、它那次运行的提示词和记录、控制在 Discord 4,000 字符以内的卡片、它的 Product 帖子、Personal database 里这个 Product 的文件夹，以及对写不成的 Dossier 的尝试 |
| `bot/src/walkthrough/` | Walkthrough：对注册页的读取、它那次运行的提示词和记录、`#needs-you` 里的卡片和它在 Product 帖子里的副本、Edit、Correct、Dismiss、14 天过期和 Prepare again、开启 Registration 的 Approval、Product 所处的位置，以及 `registration.md` |
| `bot/src/browser.ts`, `bot/src/root-domain.ts` | 经由 Unix 套接字调用浏览器服务的 `read(url)` 和 `redirect(url)`，以及用作 Product 键的根域名 |
| `bot/src/personal-database.ts` | Personal database 的写入者：一把锁管住快进、写入、提交和推送，以及历史分叉时的卡片（ADR 0012） |
| `bot/src/status.ts` | `#status` 文字频道里的静默消息 |
| `bot/src/needs-you.ts` | `#needs-you` 文字频道里的卡片，每张都提及这个人 |
| `bot/src/health-ping.ts` | healthchecks.io 的 ping：机器人登录着 Discord、实时存储也写得进时，每 5 分钟一次 |
| `bot/src/password-vault.ts` | Password vault：每次操作运行一次 `bw`，机器人生成的密码，以及存放它的条目 |
| `bot/src/secret-guard.ts` | 最后一道门：机器人持有的每个 Secret，按确切值在每个模型请求和 Discord 消息里查找，以及要求更换它的通知 |
| `bot/src/forwarder.ts` | Pi 容器唯一的端点：带角色密钥的模型请求（每个都按名义美元计价），以及运行记录 |
| `bot/src/pi-runs.ts` | 每次运行一个 `pi --mode rpc` 进程，按墙钟时间、轮数和 token 数设上限 |
| `bot/src/store.ts` | 实时存储（SQLite），以及它的 schema 和迁移 |
| `bot/src/product-hunt.ts`, `bot/src/discord/` | Product Hunt API v2 和 Discord |
| `pi/extension/` | 我们的 Pi 扩展：把 forwarder 作为 provider、这次运行的 Rule，以及每种运行的记录工具和提示词。它被单独复制进 Pi 容器，所以它和 `bot/src` 互不导入 |
| `pi/pi-run`, `pi/Dockerfile` | 一次运行如何启动，以及 Pi 容器镜像 |
| `config/assistant.json` | 设置，只通过 `ops/upgrade` 修改；在 #72 带来它之前，通过一次提交和 `ops/install --deploy` 修改 |
| `ops/`, `compose.yaml` | VM 上的安装、令牌、夜间备份和浏览器防火墙，Docker 辅助程序，以及 Pi 和浏览器服务的 compose 项目（`ops/README.md`） |

Pi 自己的文档随它的包一起发布，`npm ci` 运行之后位于 `node_modules/@earendil-works/pi-coding-agent/docs/`：`rpc.md` 讲每次运行使用的 RPC 模式，`json.md` 讲事件流，`message-types.md` 讲事件流里的消息，`settings.md` 讲 Pi 的 `settings.json`，包括它的重试退避。

## 测试

```sh
npm ci
npm run typecheck
npm run check:docs                     # the doc pairs
npm run check:shell                    # shellcheck over the shell scripts
npm run check:source                   # the tests that read the source as text
npm test                               # every test
node --test bot/test/miner-day.test.ts # one file
```

`npm test` 给每个测试 60 秒。超时的测试会失败；即使它留下了没关闭的服务器或定时器，整个运行也照样结束（`--test-force-exit`）。设了 `TEST_SHARD` 时，比如 `TEST_SHARD=2/3`，它只运行测试文件里的这一个分片，和 CI 一样。

每次提交和 push 要过的 hook 和 CI，以及在新的克隆里怎么打开 hook，见 `docs/hooks-and-ci.md`。`npm test` 也运行 `ops/test/` 里运维脚本的测试（`ops/README.md`）。

机器人的测试只走 seam 1（`bot/test/harness/`）：真实的机器人在它独占的 worker 线程里运行，真实的 Pi 和我们的扩展作为本地进程运行，对接假的 Discord、Product Hunt、浏览器服务、模型 provider 和 healthchecks.io 服务器、一个假的 `bw`、一个存放 Personal database 的假 GitHub，以及一个由测试拨动的时钟。假的 GitHub 是一个本地的裸仓库，git 通过代替 ssh 的 `bot/test/harness/fake-ssh.ts` 访问它。它只放行 deploy key，可以拒绝或扣住推送，也接受这个人自己的提交和合并。只有 harness 从 `bot/src` 导入：`bot/test/` 下其他任何文件的导入只要写出那里的某个文件，`npm test` 都会失败（`scripts/bot-test-imports.test.ts`）。`bot/test/store-schema.test.ts` 还会用 `node:sqlite` 直接读取实时存储的文件，这是 #98 对它的要求；`bot/test/health-ping.test.ts` 也通过它占住实时存储的写锁，以此模拟一个写不进的实时存储。`bot/test/` 下其他任何文件只要写出 `node:sqlite`，`npm test` 都会失败（`scripts/bot-test-store.test.ts`）。测试还可以断言什么，见 `CODING_STANDARDS.md` 的 **What a test asserts on**。

时钟的一次跳跃（`advanceTo`）只在新的时间点把过期的定时器触发一次，和真实时钟一样。要测试重复的定时器，用 `stepThrough` 逐一走过它的每次触发。

`world.restart()` 和 `world.outage()` 走机器人自己的停止流程，它会等每个任务和每项普通代码工作做完，所以用它们，测试没法让机器人停在同一项工作的两步之间。`world.kill()` 可以。它终止机器人的线程，并杀掉机器人启动的每个运行、git 命令和 `bw` 命令，机器人的停止流程不会运行。旧的机器人再也不会有任何动作，不管假服务怎么回答、时钟怎么走；之后 `restart` 或 `outage` 在同一个实时存储、数据目录和 Personal database checkout 上启动一个新的机器人。测试通过外部世界选择停在哪里，绝不伸进 `bot/src`：它让一个假服务收下请求且永不回答，用 `world.model.hold`、`world.git.holdPushes` 或 `world.bitwarden.holdCreate`，等到假服务收到请求，再杀掉机器人。被扣住的请求在关掉扣留之后仍然被扣住，所以新机器人的请求会得到回答。旁边没有对外调用的位置，用这种办法到不了。杀掉和 VM 上的崩溃有两点不同。实时存储的句柄会干净地关闭，所以没有测试走到 SQLite 对预写日志（write-ahead log）的恢复，而下一个机器人读到的提交都一样。另外，机器人启动的东西会立刻结束，而在 VM 上，git 命令先收到 systemd 发的 SIGTERM，容器里的 Pi 则通过 stdin 被告知结束，并且再也连不上模型（`ops/README.md`）。机器人为什么运行在线程里，见 #96。

假的浏览器服务在一个 Unix 套接字上回答 `read(url)` 和 `redirect(url)`。每个 Launch 的网站跳转都通向 `.example` 上一个属于它自己的普通站点，带一个价格页和一个注册页，除非测试从 `bot/test/harness/dossier-fixtures.ts` 提供某个真实 Product 的页面。HEAD 回答 403，除非测试设定了它的回答。

假的 `bw`（`bot/test/harness/fake-bw.ts`）和真的一样，每条命令一个进程，`world.bitwarden` 读取它保存的东西：Password vault 里的条目，以及每条命令的参数和它拿到了哪些 `BW_` 变量。它的注释写明它依据真实 CLI 的哪些表现，以及哪些还没有真实账号试过。

每次 Pi 运行大约要半秒 CPU，一个 Miner 日除了评判运行，还要为它的每份 Dossier 各跑一次，再为每个 open 或 waitlisted 的 Product 的 Walkthrough 各跑一次（harness 启动机器人时 Walkthrough 是打开的），所以 fixture 日的 Dossier 会让每个发出一天的测试都付出代价。不是测 Dossier 的测试，用 `world.model.onlyDossiers(postIds)` 把它那一天的 Dossier 限制在需要的几份：其他每个 Launch 都会被评判在 Day's line 以下。

假的 Product Hunt 只回答真实 API 的实时 schema 接受、变量也符合这份 schema 的查询，其他查询一律拒绝：回复里有 GraphQL 错误，没有数据。这样，写错的字段、参数或 enum 值会让测试失败，而不是等到上线时才让机器人的读取失败。`npm run capture:producthunt-schema` 通过内省（introspection）抓取这份 schema，以 SDL 形式写到 `bot/test/fixtures/producthunt/schema.graphql`，假的 Product Hunt 就从那里读取它。遇到 HTTP 错误、GraphQL 错误，或者回复建不出 schema 时，脚本什么都不写，并说明原因。这个脚本由这个人来运行，因为 agent 从不读取令牌：它像机器人一样，自己读取 `$CREDENTIALS_DIRECTORY` 里的 `producthunt-token`，并向机器人配置里写的 API 发请求。在 Claude Code 会话里，在命令前输入 `!`，令牌就不会进入 agent 的上下文。每当 `bot/src/product-hunt.ts` 里的某个查询改变，或者实时 API 可能已经改变时，就再运行一次，并提交它写出的文件。

```sh
CREDENTIALS_DIRECTORY=/path/to/credentials npm run capture:producthunt-schema
```

## 修改实时存储的 schema

实时存储即 `dataDir` 里的 `assistant.sqlite`，它把自己的 schema 版本号记在 `PRAGMA user_version` 里。版本 1 是 #98 之前的 schema。机器人启动时，在任何东西读写这个存储之前，会把 `bot/src/store.ts` 里的 `SCHEMA` 整个交给一个新的存储，并记为最新版本。对一个较旧的存储，它按顺序运行这个存储的版本之后的每个迁移，每个迁移和它的版本号放在同一个事务里。有表但没有记录版本号的存储算作版本 1。失败的迁移，或者留下指向不存在的行的键的迁移，会被撤销：存储保持原来的版本号，机器人不启动，并说明是哪个迁移失败了。比代码还新的存储会被原封不动地拒绝，机器人同样不启动（由这个人在 #98 上确定）。错误信息写明两个版本号，以及两条出路：再升级到认识这个存储的版本的代码，或者从每晚的备份恢复这个存储，备份之后的实时状态会丢掉。所以，把机器人回滚到某个迁移之前，会让它停着。

要修改 schema，在一次提交里：

1. 把 `SCHEMA` 改成新的 schema。
2. 在它旁边的 `MIGRATIONS` 末尾加一个迁移，把处于上一个版本的存储改成和它一致：`name` 写明它改了什么，`sql` 写明怎么改。它在自己的事务里运行，所以它自己不开事务；它运行时外键是关着的，所以它可以重建一张被键指向的表，就像 SQLite 的[其他改动的步骤](https://www.sqlite.org/lang_altertable.html#otheralter)那样。
3. 加上新版本的 fixture `bot/test/fixtures/store-schemas/<version>.sql`，内容是新的 `SCHEMA`。

`bot/test/store-schema.test.ts` 用每个 fixture 建一个存储，在它上面启动机器人，再把这个存储的表、列、索引和键与一个新存储的相比较。所以，`SCHEMA` 改了却没有迁移、迁移漏了改动的一部分，或者某个版本没有 fixture，`npm test` 都会失败。一个迁移或 fixture 一旦进入 `main` 就不再修改，因为可能已经有存储处于它的版本；修改、删除或重命名 `main` 里已有的 fixture 的提交，会被 `.githooks/pre-commit` 拒绝（由这个人在 #98 上确定）。这个测试看到的是 SQLite 的 pragma 报告的内容，其中不包括 `CHECK` 约束、列的排序规则（collation）、partial index 的条件、trigger 的内容，以及行：一个搬动行的迁移，要另写一个测试，证明这些行都到了，比如 #53 给 `sorts` 换的新键，在一个实时存储上本来就会搬动行。

## 运行

机器人读取 `config/assistant.json`（或 `$ASSISTANT_CONFIG`），并按 systemd 的 `LoadCredential=` 交付的方式，从 `$CREDENTIALS_DIRECTORY` 读取它的令牌：`discord-bot-token`、`producthunt-token`、每个角色一个 `newapi-key-<role>`、Personal database 仓库的 deploy key `personal-database-deploy-key`、机器人在 healthchecks.io 上那个检查的 ping URL `healthchecks-ping-bot`，以及它的 Bitwarden 账号的 `bitwarden-api-key` 和 `bitwarden-master-password`。

机器人的 Personal database checkout 位于 `personalDatabase.dir`：这个人的仓库的一个克隆，检出 `main`，`origin` 指向仓库的 ssh URL。机器人在里面运行 git 时，除了这个 checkout 自己的 git 配置之外不读任何配置，并带着 deploy key 通过 `personalDatabase.ssh` 访问 GitHub，所以机器人用户的 `known_hosts` 里必须有 GitHub 的主机密钥。每次运行前它都快进这个 checkout，运行从其中的 `profile/interest-scope.md` 读取 Interest scope。机器人写的每个文件，比如 `days/<YYYY-MM-DD>.md`，都先在实时存储里排队，再单独提交，每次提交都会推送。被 GitHub 拒绝的推送，或者已经分叉的历史，每隔 `personalDatabase.retryMinutes` 重试一次。

这个人的 Profile 是其中的 `profile/profile.md`，用这个人自己写的任意 Markdown。Walkthrough 的运行从它读取要填的名字；在没有这个文件时，Walkthrough 让名字留空，并写明去哪里补上。每个 Product 的 Signup identity 是 `signupMailbox`（Signup mailbox 自己的地址）的一个加号地址，表单拒绝 `+` 时退回到这个地址本身（ADR 0003）。Walkthrough 打开时，或者还有 Walkthrough 在 `#needs-you` 里时，机器人需要它。

每次运行从这个 checkout 的最后一次提交载入它的 Rule（ADR 0002）：`rules/all/` 里的每个文件，以及它自己作用范围的文件夹 `miner`、`dossier`、`registration` 或 `mail` 里的每个文件，即 `rules/<scope>/<slug>.md`。我们的扩展在这次运行开始前向 forwarder 要来这些 Rule，把每一条完整地放进这次运行的系统提示词，所以拿不到 Rule 的运行不会开始。一条记录写明它用了哪些 Rule，写了这次运行没有载入的 Rule 的记录会被机器人退回。一个 Correction 的 Launch 重新评判之后，一次 Miner 角色的运行为这个 Correction 分类。当天的文件写明分类的结果，因 Hard limit 被拒（declined）的 Correction 还会在每日帖子里它那个 Launch 的那一行上写明。Walkthrough 的 Correction 也这样分类，由一次载入 Walkthrough/Registration Rule 的 registration 角色运行来做，它的 Product 的 `registration.md` 写明分类的结果。提议的 Rule、对一条已保留 Rule 的修订，或 Interest scope 的改动，会作为紫色卡片发到 `#needs-you`。Keep 会在写入锁下提交这个 Rule 文件或 `profile/interest-scope.md`，除非自提议以来 git 里它要替换的内容变了，或者这条 Rule 会让它那些运行的 Rule 超出 Rule budget，即 `rules.budgetTokens`（约 4,000 个 token，按四个字符一个 token 计）。这时卡片写明原因，并保持打开。

Dossier 发到 Products 论坛 `discord.productsForumId`，论坛标签由这个人创建：*Walkthrough*、*Registering*、*Needs you*、*registered*、*waitlisted*、*handed off*、*abandoned*、*no account* 和 *Skipped*。机器人按名字找标签，所以只有名字要紧；目前它打 *no account*；Walkthrough 等着这个人时打 *Walkthrough*；Walkthrough 被批准后打 *Registering* 或 *handed off*；并给被一次 Correction 撤回的 Dossier 的帖子打 *Skipped*。Dossier 通过位于 `browser.socketPath` 的浏览器服务套接字（`browser/README.md`）读取它的 Product 的页面，每次读取都在 `pages/` 下和其他原始输入放在一起，保留 90 天。当对 Launch 网站跳转的读取停在 Product Hunt 的机器人检测上时，对这个跳转发一个 HEAD 可能得到落地页的地址，这时记录 `dossier.redirect-head`。得不到时，记录 `dossier.redirect-unread` 和它的回答，这次尝试以机器人检测为原因结束：如果每个 Launch 都出现这行日志，就说明 Product Hunt 关掉了这条路，#102 等的就是这个。

写不成的 Dossier 不会拖住它那天的列表（由这个人在 #100 上确定）。这一轮里，列表的每份 Dossier 都已发出或已失败后，列表就发出，它的摘要写明每份没写成的 Dossier，以及原因。一次尝试失败，是指 Product 的落地页打不开，或者它的 Dossier 运行失败、触到上限或没有记录 Dossier。每份没写成的 Dossier 每天再试一次，时间是太平洋时间 01:00 Miner 开始时，或者那之后机器人第一次启动时，Fit 高的先试，Fit 相同时 Launch 早的先试。一次 Correction 要的 Dossier 在尝试失败后也加入它们，那个 Correction 不等它就完成。一个 Launch 最多有 `dossiers.tries` 次以没写成 Dossier 告终的尝试，初始值为 3，记在实时存储里，跨轮次、跨重启、跨两条路径累计。Assistant 自己停掉的运行（比如关机时）或被崩溃打断的运行不算，运行开始前它自己出的错也不算，比如连不上浏览器服务：这种错仍会拖住列表，Miner 每 30 分钟再试一次。因为 Pi 容器宕了或所有 provider 都失败而失败的运行，和其他失败的运行一样算一次。到了次数上限就不再开始新的尝试，`#status` 里会有一行静默消息，写明是哪份 Dossier，以及它最后一次尝试为什么失败。之后某次尝试写成的 Dossier 像其他 Dossier 一样发出，它那天的列表随后也会链接它。通过 `ops/upgrade` 调高 `dossiers.tries`，机器人就会再试这样的 Dossier，不管它有多旧，比如在一次宕机让一些 Dossier 停下之后。

只有 `walkthroughs.on` 为 `true` 时才有 Walkthrough，它和其他设置一样通过 `ops/upgrade` 修改。`config/assistant.json` 发布时把它们关着，上线（#85）也让它们一直关着，直到 #56 让 Approval 能填写表单。关着时，机器人不准备新的 Walkthrough：不会为它读取注册页，也没有运行准备它，所以没有卡片发到 `#needs-you`，没有帖子被打上 *Walkthrough*，Dossier 的 Register 一行也不提 Walkthrough；机器人没有 `signupMailbox` 也能启动。把它们打开的那次启动，会为关着期间发出 Dossier 的每个 open 或 waitlisted 的 Product 准备一份 Walkthrough，不管那份 Dossier 有多旧，从最旧的开始，在后台通道里进行。再把它们关掉，只会停止这种准备，Prepare again 的也算在内，并扣下卡片没发出去的版本（由这个人在 #99 中决定）：已经在 `#needs-you` 里的 Walkthrough 仍然可以 Approve、Edit、Correct 或 Dismiss，而 Correction 的运行仍然需要 `signupMailbox`。

Walkthrough 打开时，一个 open 或 waitlisted 的 Product 的帖子发出后，机器人再实时读一次它的注册页：它的落地页链接到的那一页，落地页没有链接到注册页时就读落地页本身。一次 registration 角色的运行根据这次读取、Dossier 和 Profile 准备 Walkthrough。它的卡片发到 `#needs-you`，每个版本的副本发到 Product 的帖子里，Dossier 的 Register 一行写明 Walkthrough 处在哪里。注册页上有银行卡字段，或者运行指出了一道什么都过不去的 Wall，就没有 Walkthrough，Register 写明原因。Edit 在同一张卡片上产生新版本，Correct 由另一次运行产生一张新卡片，Dismiss 结束它。没人回应的 Walkthrough 在 14 天后过期，带 **Prepare again**。Approve 记下 Approval 并开启 Registration：通常以 *queued* 开启，Product 的条款禁止机器人创建账号时以 *handed off* 开启；两种情况都在帖子里发一条静默的状态消息，并在 `registration.md` 里写一行。填写表单是 #56 的事，状态消息上的 **Stop** 也随它接通。

对有密码字段的 Walkthrough，Approve 先把一个新密码存进 Password vault，也就是这个人的 Bitwarden 组织里的 *Registrations* 集合（ADR 0004），每个 Registration 一个条目。密码由机器人生成，24 个字符，包含所有字符类别，任何模型都不会生成或看到它。条目以 Product 命名，网站是 Product 的根域名，用户名是 Signup identity 的加号地址。密码只通过 stdin 交给 `bw`，实时存储、`registration.md` 和日志只保存条目的 id。机器人每次操作运行一次 `bitwarden.command`，`bw` 的数据目录在 `dataDir` 下的 `bitwarden/`，会话密钥只在内存里，所以没有任何东西在监听，它也没有任何办法修改或删除条目。

Bitwarden 不可用时，Approval 被扣住：它会保留下来，但 Registration 不开始。不可用是指 `bw` 失败、超过 `bitwarden.timeoutSeconds`（一开始是 60 秒）或不存在，或者机器人的账号看到了 *Registrations* 集合以外的东西。卡片上写明正在等待，机器人每 5 分钟和每次启动时再试一次。一次可能已经到达 Password vault 的创建，比如机器人在创建中途死掉，或者一直没等到回答，会先读回来再决定是否新建，所以一个 Registration 只有一个条目。按引用填入、表单拒绝密码时的替换密码，以及 Bitwarden 不可用时扣住填入，都是 #56 的事（由这个人在 #54 上确定）。

机器人拒绝任何含有它所持有的某个 Secret 确切值的模型请求（在 forwarder 处）、Discord 消息和对 Personal database 的提交：它读取的每个令牌、它的 Bitwarden 会话密钥，以及它启动以来生成的每个密码（ADR 0009）。它查找这个值的原样、JSON 字符串里的形式，以及 URL 携带时的形式。被拒绝的模型请求让它那次运行失败，返回的 403 不会让 Pi 重试；被拒绝的 Discord 消息算作一次 Discord 的拒绝，所以它所属的工作按任何一次拒绝之后那样继续；被拒绝的文件不提交，Personal database 里的这个文件保持原样，直到下一次写入不再含有这个值（由这个人在 #54 上确定）。机器人启动以来，每个 Secret 第一次被拒绝时，在 `#needs-you` 发一条通知，写明它的名字以及如何更换。验证码要等 #57 读取 Signup mailbox 之后才加入其中。

```sh
sudo ops/install   # on the VM, from the main checkout: ops/README.md
```

在 VM 上，`ops/install` 把机器人作为 `assistant.service` 运行：以 `assistant` 用户的身份，从它自己位于 `/opt/assistant/lab1` 的 lab1 checkout 运行，令牌来自 `/etc/assistant/credentials`。`config/assistant.json` 为这样的运行做了设置。它的 `pi.command` 是 `ops/run-pi.ts`，即 Docker 辅助程序在机器人这一侧的部分，因为 `assistant` 用户不在 `docker` 组里（ADR 0009）。一次运行传进容器的唯一值是这次运行自己的令牌，这个令牌只让 Pi 为这一次运行访问 forwarder，而且从来不是密钥。`browser.socketPath` 是 compose 项目里的浏览器服务共享出来的套接字，`gateway.baseUrl` 在回环地址上访问 new-api，new-api 的 compose 项目把它发布在那里。各个 Discord id 和各个 provider 的模型已在上线时设置（#85）；要改它们，就做一次提交，再由 `ops/install --deploy` 带到 VM 上。在别处运行时，用 `$ASSISTANT_CONFIG` 指定一个配置，让它的 `pi.command` 用别的方式启动 Pi，比如带着那四个 `ASSISTANT_` 变量 `docker exec -i` 进 `assistant-pi` 容器。

`config/assistant.json` 里的运行上限是初始值。墙钟时间上限在 #26 中确定，Dossier 运行和 Correction 分类运行的除外；它们和轮数、token 上限都是初步估计，要根据 `run.finished` 日志行再调。

`roles` 里的每个 provider 都写明它在 new-api 上的 `role@provider` 渠道服务哪个模型，`prices` 记录每个这样的模型的标价，以每 1M 未缓存输入、缓存输入和输出 token 的美元计。只要某个 provider 的模型没有价格，机器人就不会启动。ADR 0011 把价格放在 `ops/pins` 里；在它出现之前，价格放在这里。每个模型请求都按它的 provider 的价格计为名义美元。`budgets.miner` 是一个 Miner 日期的运行可以花的钱，Retry 也算在内，初始为 6 美元。只有在这个日期的花费低于 Miner 预算时，运行才会开始；已开始的运行即使超出预算也会完成。Miner 预算一旦用完，这个日期剩下的运行就等待，它在太平洋时间 06:00 的迟到消息会点出 Miner 预算；调高 `budgets.miner` 并重启机器人，这些运行就会继续。上线时（#85），两个角色的 provider 都使用 OpenRouter 的免费模型 `nvidia/nemotron-3-ultra-550b-a55b:free`，价格按 0 美元计，所以没有哪项预算会拦住运行，能限制失控的是 OpenRouter 对免费请求的每日上限（由这个人在 #85 上确定）。`prices` 里也保留着 GPT-6.1 Sol 的价格，各项预算就是按这个价格定的（#39）。`budgets.registration` 初始为 20 美元，是 registration 角色的运行在一个太平洋时间日可以花的钱，Dossier 运行和 Walkthrough 运行也在其中；它们的花费会被计算，但在 #69 之前，没有什么会让运行受它约束。

机器人每个事件向 stdout 输出一行 JSON。`run.finished` 行带有这次运行的角色、provider、模型、精确的 token 数和名义美元；运行触到上限时，还写明触到的是哪个上限。`miner.run-held` 行写明一次在等 Miner 预算的运行，以及这个日期的花费；`miner.posted` 行带有这个日期总共花了多少。`miner.judged` 行写明哪个模型请求的回复里有这次评判，以及该请求的精确 token 数；通常一个回复就评判了它那次运行里的每个 Launch。`dossier.written` 行用根域名写明一份 Dossier 的 Product，以及写它的那次运行、provider 和模型。`dossier.unwritten` 行写明一次尝试没写成 Dossier 的 Launch、原因，以及它有几次尝试计入次数上限；`dossier.stopped` 行写明到达次数上限的那个 Launch。`run.rules-loaded` 行写明一次运行的 Rule 是在哪次提交读取的、这些 Rule 的名字，以及它们大约占多少 token。`walkthrough.prepared` 行写明一份 Walkthrough 的版本和准备它的那次运行，`walkthrough.none` 行写明一个 Product 为什么没有 Walkthrough，`walkthrough.approved` 行写明一次 Approval 来自哪个 Discord interaction。`vault-item.created` 行用 id 写明一个 Registration 的条目，`vault-item.found` 行写明一次没等到回答的创建之后读回来的条目，`password-vault.unavailable` 行写明一次 Approval 为什么被扣住。`secret.refused` 行写明 Secret 在哪道门被拦下，以及它的名字。

机器人每 5 分钟向它在 healthchecks.io 上的检查发一次 ping，地址是 `healthchecks-ping-bot` 里的 URL，但只在它登录着 Discord、实时存储也写得进时才发：它先把当前时间写进实时存储。没发出的 ping 记一行 `health.ping-withheld`，写明原因；healthchecks.io 没接受的 ping 记一行 `health.ping-failed`。两种情况都要等到下一个 5 分钟才再试。这个检查的周期是 5 分钟，宽限 10 分钟，所以 15 分钟没收到 ping，这个人就会收到一封邮件，邮件只说 Assistant 在 Discord 上联系不到他们（#26）。Miner、备份和每周检查的 ping 随 #70 一起来。
