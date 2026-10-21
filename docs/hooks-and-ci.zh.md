# Hook 和 CI

[English](hooks-and-ci.md) | 中文

每次提交和 push 要过哪些检查，两个 package 都在内：根目录的（机器人、我们的 Pi 扩展和脚本）和 `browser/` 的（浏览器服务）。在新的克隆里，用 `git config core.hooksPath .githooks` 打开一次 `.githooks/` 里的 hook。

## Hook

- **pre-commit**：在主 checkout 里，它拒绝 `main` 以外任何分支上的提交。然后它检查暂存内容的一份副本：每个 package 的类型检查（用这个 package 自己的依赖运行），然后是文档配对检查（`docs/agents/doc-pairs.md`）。任何一项没通过，它就拒绝提交。某个 package 没装依赖时，它拒绝每一次提交，并说明怎么安装。它不运行任何测试：根目录的测试要跑一分钟左右，浏览器服务的测试要构建镜像。
- **post-checkout**：`git worktree add` 刚建好一个 worktree 时，它在里面为每个 package 运行 `npm ci`，能从 npm 的缓存装就从缓存装，让类型检查有它们的依赖。它是安装依赖，而不是用符号链接接上主 checkout 的 `node_modules`：通过这样的链接运行 `npm ci` 或 `npm uninstall`，会改动主 checkout 自己的依赖。安装失败时，它会说明，worktree 照样建好。
- **commit-msg**：提交消息里在 GitHub 关闭关键字后面跟着 issue 引用时，比如 `Closes #88`，它拒绝这条消息：提交一到 `main`，GitHub 就会关闭这个 issue，而 ticket 要在落地之后手动关闭（`docs/agents/issue-tracker.md` 里的 **Close**）。改为把引用写成 `(#88)`。
- **pre-push**：它拒绝把 `main` 移到某个提交的 push，除非 GitHub Actions 已经在这个提交上运行过，并且每次运行都通过：GitHub Free 不给私有仓库提供分支保护，所以服务器那边没有什么会拒绝它。这个 hook 通过 `gh` 向 GitHub 查询，所以 `gh` 必须已经登录。

## CI

GitHub Actions 在每次 push 和 pull request 时运行两个 workflow，所以浏览器那边的运行慢了或失败了，也不会遮住机器人的结果：

- **Bot**（`.github/workflows/bot.yml`）：根目录的类型检查、文档配对检查和根目录的测试。
- **Browser**（`.github/workflows/browser.yml`）：在 `browser/` 里运行 `npm ci`、类型检查和测试。测试会构建镜像，并通过 Docker Compose 启动它。runner 是 amd64 的，所以测试的是固定 digest 里的 amd64 镜像，而 VM 上运行的是其中的 arm64 镜像。

## 测试

根目录的 `npm test` 运行这些 hook 和检查的测试：

- `scripts/pre-commit.test.ts`、`scripts/post-checkout.test.ts` 和 `scripts/commit-msg.test.ts` 在一个用完即弃的仓库里提交，或者添加一个 worktree。`scripts/pre-push.test.ts` 从这样一个仓库 push，用的是一个需要 `jq` 的假 `gh`。
- `scripts/doc-pairs.test.ts` 在用完即弃的文档对上运行文档配对检查。
- `scripts/bounded-waits.test.ts`：某个 `spawnSync`、`execSync` 或 `execFileSync` 调用自己的参数里没有 `timeout` 时，它就失败：同步的子进程会阻塞事件循环，所以别的定时器都结束不了它（`CODING_STANDARDS.md` 里的 **Every wait has a bound**）。
