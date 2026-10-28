# Hook 和 CI

[English](hooks-and-ci.md) | 中文

每次提交和 push 要过哪些检查，两个 package 都在内：根目录的（机器人、我们的 Pi 扩展、VM 上的运维脚本和脚本）和 `browser/` 的（浏览器服务）。在新的克隆里，用 `git config core.hooksPath .githooks` 打开一次 `.githooks/` 里的 hook。

## Hook

- **pre-commit**：在主 checkout 里，它拒绝 `main` 以外任何分支上的提交；它也拒绝修改、删除或重命名 `main` 里已有的实时存储 schema fixture（`bot/test/fixtures/store-schemas/`，#98）的提交。然后它检查暂存内容的一份副本：每个 package 的类型检查（用这个 package 自己的依赖运行），然后是文档配对检查（`docs/agents/doc-pairs.md`）。任何一项没通过，它就拒绝提交。某个 package 没装依赖时，它拒绝每一次提交，并说明怎么安装。它不运行任何测试：根目录的测试在 #98 里跑了 8 分钟，浏览器服务的测试要构建镜像。
- **post-checkout**：`git worktree add` 刚建好一个 worktree 时，它在里面为每个 package 运行 `npm ci`，能从 npm 的缓存装就从缓存装，让类型检查有它们的依赖。它是安装依赖，而不是用符号链接接上主 checkout 的 `node_modules`：通过这样的链接运行 `npm ci` 或 `npm uninstall`，会改动主 checkout 自己的依赖。安装失败时，它会说明，worktree 照样建好。
- **commit-msg**：提交消息里在 GitHub 关闭关键字后面跟着 issue 引用时，比如 `Closes #88`，即使两者之间隔着一个换行或一个空行，它也拒绝这条消息：提交一到 `main`，GitHub 就会关闭这个 issue，而 ticket 要在落地之后手动关闭（`docs/agents/issue-tracker.md` 里的 **Close**）。改为把引用写成 `(#88)`。
- **pre-push**：它拒绝把 `main` 移到某个提交的 push，除非 GitHub Actions 已经在这个提交上运行过，并且每次运行都通过：GitHub Free 不给私有仓库提供分支保护，所以服务器那边没有什么会拒绝它。这个 hook 通过 `gh` 向 GitHub 查询，所以 `gh` 必须已经登录。

## Claude Code hook

`.claude/settings.json` 给这个仓库里的每个 Claude Code 会话三个它自己的 hook，都是 `.claude/hooks/` 里用 Node 运行的脚本：

- **reply-language**（在 Stop 时）：一轮的最后一条回复是英文时，它把回复退回去重写，这是 `CLAUDE.md` 的 Language 一节的要求。它不计代码、行内代码、链接和加粗片段（加粗里放的是标题）；一条回复至少有 40 个拉丁字母、且汉字在字母和汉字合计中占不到 15% 时，它就把这条回复当作英文。已经退回过一次的回复，这一轮就到此结束。
- **note-language**（在每次工具调用之后）：按同一条规则判断这一轮里 Claude 在工具调用之前写给这个人的说明，每条英文说明向 Claude 指出一次，让下一条说明用中文写。交互会话写入会话记录可能落后一条或几条消息，所以一条说明可能要在它之后一次或几次工具调用时才被指出；被会话记录记成 thinking 的说明则看不到。
- **review-committed**（在 Skill 工具上）：checkout 里还有没提交的改动，或者分支缺少 `main` 上的提交时，它拒绝启动 code-review skill，并说明要先提交还是先 rebase，这是 `CLAUDE.md` 的 Code review 一节的要求。

会话从它启动时所在的 checkout 读取这些 hook，所以对它们的改动，要等到进了 `main` 才生效。在 #48 的 retro 里，正在运行的会话在下一次工具调用时就用上了 `.claude/` 里新加的设置文件，之后启动的会话也从 `main` 运行了新的 hook。

## CI

GitHub Actions 在每次 push 和 pull request 时运行两个 workflow，所以浏览器那边的运行慢了或失败了，也不会遮住机器人的结果：

- **Bot**（`.github/workflows/bot.yml`）：根目录的类型检查、文档配对检查和根目录的测试。测试分成三个分片，各是一个独立的 job（`TEST_SHARD`，`npm test` 把它作为 `--test-shard` 传给 `node --test`），第一个 job 还运行类型检查和文档配对检查。在 #53 里，原来那一个 job 用掉了 15 分钟里的 11.5 分钟。每个 job 的摘要会列出它最慢的测试和它的总耗时（`scripts/slowest-tests.ts`），这样某个测试快到 60 秒、或者某个分片快到 15 分钟时，在失败之前就能看出来。
- **Browser**（`.github/workflows/browser.yml`）：在 `browser/` 里运行 `npm ci`、类型检查和测试。测试会构建镜像，并通过 Docker Compose 启动它。runner 是 amd64 的，所以测试的是固定 digest 里的 amd64 镜像，而 VM 上运行的是其中的 arm64 镜像。

## 测试

根目录的 `npm test` 运行这些 hook 和检查的测试：

- `scripts/pre-commit.test.ts`、`scripts/post-checkout.test.ts` 和 `scripts/commit-msg.test.ts` 在一个用完即弃的仓库里提交，或者添加一个 worktree。`scripts/pre-push.test.ts` 从这样一个仓库 push，用的是一个需要 `jq` 的假 `gh`。
- `scripts/reply-language.test.ts`、`scripts/note-language.test.ts` 和 `scripts/review-committed.test.ts` 像会话那样运行每个 Claude Code hook，用的是一份用完即弃的会话记录或一个用完即弃的仓库。`scripts/slowest-tests.test.ts` 在一次运行的输出上运行 CI 摘要。
- `scripts/doc-pairs.test.ts` 在用完即弃的文档对上运行文档配对检查。
- `scripts/bounded-waits.test.ts`：某个 `spawnSync`、`execSync` 或 `execFileSync` 调用自己的参数里没有 `timeout` 时，它就失败：同步的子进程会阻塞事件循环，所以别的定时器都结束不了它（`CODING_STANDARDS.md` 里的 **Every wait has a bound**）。
- `scripts/bot-imports.test.ts`：`bot/src` 导入的某个模块既不是 Node 自己的（`node:`），也不是机器人自己的文件时，它就失败：机器人自己没有任何 npm 依赖（`bot/README.md`），`graphql` 只给测试和 schema 抓取用。
- `scripts/bot-test-imports.test.ts`：`bot/test/` 下、`bot/test/harness/` 以外的某个文件导入 `bot/src` 下的文件时，它就失败：测试只经由 harness 接触机器人（`bot/README.md`），而从 `bot/src` 导入的测试断言的是机器人怎样构造某样东西。
