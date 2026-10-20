# Personal database 是一个独立的仓库，代码只通过 `ops/upgrade` 进入运行中的 Assistant

[English](0008-the-personal-database-is-its-own-repo-and-code-ships-only-through-ops-upgrade.md) | 中文

Personal database（Profile、Dossier 和 Registration 历史、Miner 日，以及 Rule 和它们的用例）存放在一个独立的私有 git 仓库里。`lab1` 存放代码、`ops/` 和文档。运行中的 Assistant 从它自己的 `lab1` checkout 运行，停在 `ops/upgrade` 上次部署的提交上，从不从编码会话工作的 checkout 运行。按照 [Correction 如何变成 Rule，我们又如何证明它能延续？](https://github.com/ultrasadness/lab1/issues/14) 的结论，机器人在每次运行前快进 Personal database，在每次提交后推送。如果那个仓库也存放代码，每次快进都会绕过升级门禁部署未经测试的代码。开发时的推送也会不断与机器人的推送分叉，而历史分叉会让机器人停止提交。课程要求用 git 管理实现和 Rule，两个仓库仍然满足这一点。在 [机器人、容器和网关如何保持运行和升级，其中一个停掉时会怎样？](https://github.com/ultrasadness/lab1/issues/26) 中决定。

## 考虑过的方案

- **一个仓库，一个 checkout**（即现在的 `~/lab1`）：否决。快进也会部署代码，而且编码会话和机器人会写同一个工作树。
- **一个仓库，两个 checkout**（代码停在固定的提交上，机器人的数据 checkout 跟踪 `main`）：否决。机器人和这个人会推送到同一个分支，所以这个人开发期间历史会经常分叉，每次分叉机器人都会停止提交。

## 后果

- **只有 `ops/upgrade <part> <version>` 能改变运行中的 Assistant。** 这个人在 VM 上运行它，从不从 Discord 运行。它按以下顺序工作：
  - 在运行中的版本旁边构建或拉取候选版本；
  - 对候选版本运行该部分的门禁；
  - 只有门禁通过时，才写入 pin、把它提交到 `lab1`、切换过去，并把结果发到 Discord。

  门禁失败时什么都不改变，除非这个人在 Discord 上推翻一个失败的 Rule 用例或一个漂移的 Miner provider，这是 [ADR 0002](./0002-rules-are-files-proven-by-their-own-case.zh.md) 和 Miner 试运行所允许的。
- **门禁**，细化了 [ADR 0001](./0001-pi-in-a-container-behind-the-gateway.zh.md) 的规则：
  - **任何会改变模型看到什么、或由哪个模型来看的东西**（Pi、它的镜像、我们的扩展、提示词和 schema、new-api、CPA、某个角色的模型）：Rule 延续检查和一次 Miner 试运行。在 Miner 试运行中，Miner 角色的每个 provider 评判一组冻结的、由 24 个过去的 Featured Launch 组成的集合，这些 Launch 的 Fit 已经由这个人确认。某个 provider 的 Fit 平均比这个人的高或低一分或以上时，试运行失败。在这个人确认这组集合之前，它只检查一天能否以有效的记录完成。在 [怎样发现给出的 Fit 比其他 provider 偏高或偏低的 Miner provider？](https://github.com/ultrasadness/lab1/issues/35) 中决定；
  - **浏览器镜像**：[ADR 0006](./0006-registration-browser-in-its-own-container-driven-through-fixed-actions.zh.md) 中的填表冒烟测试；
  - **只涉及机器人的代码**：它自己的测试。
- **`ops/rollback <part>`** 回退该部分最近一次的 pin 提交，并切回上一个镜像，上一个镜像一直留在 VM 上。
- **`lab1` 里的 `ops/pins` 记录每一个 pin**：
  - Pi、浏览器、new-api 和 CPA 的镜像 digest；
  - Pi 的 npm 版本；
  - 每个角色的 provider 和模型，按优先级排序，并附上每个模型每 1M 输入、缓存和输出 token 的价格。

  机器人在启动时和每周检查中，对照它检查运行中的镜像和 Pi 的版本，并发布任何漂移。角色的映射只通过 `ops/upgrade role <role>` 改变，所以机器人不持有 new-api 的管理员令牌。这个命令还会根据记录的价格设置 new-api 的倍率，让 new-api 的配额和 forwarder 的花费预算按同样的美元计数（[ADR 0011](./0011-the-forwarder-picks-each-requests-provider-and-holds-the-spending-budgets.zh.md)）。每周检查写明每个用例实际运行在哪个 provider 和模型上。
- **new-api 不再用 `:latest`**，改为固定的 digest。它仍留在自己的 compose 项目里，这个项目也服务这个人的其他用途。
- **离开 VM 之后，只有 git 留存**：`lab1` 和 Personal database 仓库，后者由机器人在每次提交后推送。SQLite 存储和 new-api 的数据库每晚备份，但只备份在 VM 上。如果 VM 丢失，就从两个仓库重建，并重新获取每一个令牌。
