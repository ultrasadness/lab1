# 分叉的 Personal database 通过一个由这个人合并的分支重新接上

[English](0012-a-diverged-personal-database-rejoins-through-a-branch-the-person-merges.md) | 中文

机器人在每次提交后推送 Personal database（[ADR 0008](./0008-the-personal-database-is-its-own-repo-and-code-ships-only-through-ops-upgrade.zh.md)），一旦它的 checkout 和 GitHub 的 `main` 分叉就停止提交（[Correction 如何变成 Rule，我们又如何证明它能延续？](https://github.com/ultrasadness/lab1/issues/14)）。分叉是这样发生的：GitHub 拒绝了一次推送，机器人的提交留在 checkout 里等待；而在下一次推送成功之前，这个人在 GitHub 上提交了，比如在 GitHub 的网页编辑器里改了一个 Rule。之前没有任何决定说明两边怎样重新接上，而这个人只有一部 iPhone。所以机器人把它自己的提交推送到一个专属的分支 `assistant/unmerged-<commit>`，并发一张 `#needs-you` 卡片，链接到 GitHub 上把这个分支合并进 `main` 的页面。这个人用合并提交（merge commit）合并它。机器人在下一次快进时发现 `main` 里有了自己的提交，于是快进并重新开始提交，卡片也缩成一行。在 [Write Miner days to the Personal database](https://github.com/ultrasadness/lab1/issues/44) 中决定。

## 考虑过的方案

- **卡片上放一个从 GitHub 重新开始的按钮**：点一下就丢掉机器人没推送的提交，把 checkout 重置到 `main`，再从实时存储重写每个视图。这对这个人最省事，但这样一来，机器人提交的所有东西都得能从存储里重建，包括保留的 Rule 和 Interest scope 的变更。
- **卡片只告知，由这个人通过 SSH 在 VM 上合并**：代码最少，但需要终端和机器人自己的用户，而其他每种修复都能在手机上完成。
- **机器人自己合并或变基**：违背 #14。#14 在分叉时停止提交，就是为了让这个人的编辑和机器人的写入永远不会在没有这个人参与时被合在一起。

## 后果

- **这个分支只推送一次，从不强推**，因为这个人可能在 GitHub 的 pull request 里在这个分支上解决冲突。卡片要等这个分支到了 GitHub 上才发，所以它的链接总能打开这个分支。
- **只有合并提交才能让两边重新接上。** squash 或 rebase 合并之后，`main` 里没有机器人自己的那些提交，所以机器人仍然停着。卡片会说明要创建合并提交。
- **两边分叉期间，机器人照样抓取（fetch）**：每次运行前一次，另外每隔 `personalDatabase.retryMinutes`（初始为 30 分钟）一次。运行读取 checkout 当时的样子。机器人要写的每个文件都以最新版本在实时存储里等待，两边重新接上后再提交。
- **退路是上面那个按钮**：如果在手机上合并让这个人陷入困境，比如遇到 GitHub 的编辑器解决不了的冲突，就改用它。
