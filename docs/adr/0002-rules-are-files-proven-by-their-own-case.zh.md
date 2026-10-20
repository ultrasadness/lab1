# Rule 是由我们自己的扩展加载的文件，每条都由它自己的延续用例证明

[English](0002-rules-are-files-proven-by-their-own-case.md) | 中文

每条 Rule 是 Personal database 里 `rules/<scope>/` 下的一个 Markdown 文件，我们自己的 Pi 扩展在每次运行开始时，把作用范围内的每条 Rule 放进提示词。只有这个人决定保留之后，Rule 才会被提交。每条 Rule 都带一个延续用例（carry-over case）：教出它的那个条目、另一个它应当改变结果的真实条目，以及用脚本能检查的方式写出的那个结果。课程要求让 Correction 在新的会话里作用到另一个条目上，而 Pi 在两次运行之间什么都不记得，所以让 Rule 延续下去，必须是我们构建出来、并且能证明的东西。在 [Correction 如何变成 Rule，我们又如何证明它能延续？](https://github.com/ultrasadness/lab1/issues/14) 中决定。

## 考虑过的方案

- **所有 Rule 都放在 `AGENTS.md`**：不需要项目信任就能在每次运行中加载，但它是一个不断变长、没有作用范围的文件，所以每次运行都会带上每一条 Rule。
- **每条 Rule 作为一个 Agent Skill**：由模型决定是否打开它，而无人值守的 Pi 运行在没有 `--approve` 时会跳过项目 skill。这两点都不能保证每次都加载 Rule。
- **按相似度检索原始的 Correction**，而不是一般性的 Rule：避免把 Rule 写得太窄或太宽。否决，因为这个人无法把它们当作一份“Assistant 现在会怎么做”的清单来阅读或编辑，而由检索器决定哪些 Correction 算数，这一点没法测试。
- **一套固定的黄金测试集**，而不是每条 Rule 一个用例：更便宜也更稳定，但大多数真实的 Rule 永远不会被证明能延续。

## 后果

- **作用范围有 Miner**（评判和 Skip）、**Dossier**、**Walkthrough/Registration**、**mail** 和 **all**。mail 范围同样加载到邮件运行和 Reply draft 运行中，因为邮件运行决定哪封邮件得到 Reply draft，而 Correction 可能会说它选错了。在 [哪些匹配上的邮件会得到 Reply draft，Assistant 写它时依据什么？](https://github.com/ultrasadness/lab1/issues/32) 之前，它叫 *Reply draft*。
- **输出写明它应用了哪些 Rule**，通过每条经过 schema 校验的记录里的一个字段。只有在 3 次全新运行中至少有 2 次既写明了这条 Rule、又得到预期结果，用例才通过。用例创建时，它还必须在没有这条 Rule 时失败。
- **用例重放存下来的输入**，这些输入放在 Rule 旁边：API 原样返回的 Launch 数据、Secret 已替换成占位符的邮件，以及 Walkthrough 看到的页面文本。没有用例会打开真实的浏览器，也没有夹具（fixture）含有 Secret。原始输入在 git 之外保留 90 天，以便用过去的条目构建用例。邮件夹具是“放在 Rule 旁边”的例外：它放在 VM 上 git 之外的本地夹具存储里，直到它的 Rule 退役，Rule 按 ID 指向它（[ADR 0010](./0010-mail-text-reaches-only-mail-cleared-roles-on-routes-that-dont-train.zh.md)）。
- **检查针对映射到这条 Rule 所属角色的每个 provider 运行**：在 Rule 被保留时、Rule 被编辑后、每次升级前（失败会阻止升级，除非这个人推翻它），以及每周一次，以发现某个 provider 悄悄换掉了固定名称背后的模型。它通过只有该 provider 提供的模型名（例如 `miner@openrouter`）访问每个 provider，这些名字由 `ops/upgrade role` 随角色的映射一起创建和删除，因为普通的 new-api 密钥无法选择渠道（[怎样发现给出的 Fit 比其他 provider 偏高或偏低的 Miner provider？](https://github.com/ultrasadness/lab1/issues/35)）。
- **一次运行加载的 Rule 有一个预算**，始终称为 **the Rule budget**（约 4k token），以免和 [ADR 0011](./0011-the-forwarder-picks-each-requests-provider-and-holds-the-spending-budgets.zh.md) 的花费预算混淆。接近 Rule budget 时，Assistant 会提议合并有重叠的 Rule，合并后的 Rule 继承它们的用例。60 天内没人引用过的 Rule 会被提议退役。
