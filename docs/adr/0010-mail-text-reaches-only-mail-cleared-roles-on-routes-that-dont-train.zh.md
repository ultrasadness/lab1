# 邮件文本只到达 mail-cleared 角色，且只走条款禁止训练的路线

[English](0010-mail-text-reaches-only-mail-cleared-roles-on-routes-that-dont-train.md) | 中文

即使 Gmail OAuth 应用从未经过验证，Google 的 Limited Use 规则仍然约束它。Gmail 数据 “may not be used to train or improve foundational or frontier models”（不得用于训练或改进基础模型或前沿模型），而且应用的公开隐私页面必须如实说明数据如何被使用。所以 Signup mailbox 邮件里的文本，以及模型根据它写出的任何东西，只到达 **mail-cleared**（获准读取邮件）的 mail 角色的运行。这个角色只使用合格的路线：针对那条确切路线的书面条款写明，输入默认不会、或在设置了退出选项后不会被用于训练或改进模型。允许为滥用监控而保留数据。这收窄了 [Assistant 运行在哪个 agent harness 和模型上？](https://github.com/ultrasadness/lab1/issues/8) 中“除 Secret 外，任何数据都可以发给任何 provider”的规则。在 [按照 Google 的 Limited Use 规则，哪些模型路线可以读取 Signup mailbox 的邮件？](https://github.com/ultrasadness/lab1/issues/30) 中决定。conversation 角色原先也是 mail-cleared 的，直到 [这个人如何从 Discord 向 Personal database 提问？](https://github.com/ultrasadness/lab1/issues/37) 把它限定在 Personal database 上，并改名为 question 角色。

## 哪些运行读取邮件

- **mail-cleared 的运行**：邮件运行（把邮件匹配到 Registration、给它分类、选择填入哪个验证码占位符）、Reply draft 运行、重放存储邮件的 Rule 用例，以及根据邀请邮件构建的 Walkthrough。
- **机器人的 Gmail 接口是邮件文本进入 Pi 容器的唯一途径**，它只把这些文本交给 mail-cleared 角色的运行。
- **Personal database 只保留来自邮件的状态、日期和 Gmail 消息 ID**，从不保留引用或概括的邮件文本。所以 Miner、首次 Walkthrough 准备和 question 运行仍可以使用任何 provider。
- **question 运行从不搜索 Signup mailbox。** 它们只读 Personal database。如果它们哪天获得了邮件搜索能力，question 角色就回到 `mail` 分组。
- **由针对邮件条目的 Correction 保留下来的 Rule，是这个人自己的陈述，不是 Gmail 数据**，可以在任何作用范围加载。它的提议不引用任何邮件文本，也不写出任何发件人或地址，这一点由这个人在保留它时检查。

## 哪些路线合格

- **目前有两条合格**：
  - 经 CPA 的 ChatGPT Plus，关闭了 “Improve the model for everyone”，并在 Privacy Portal 提交了 “Do not train on my content” 请求。OpenAI 说两者任一都覆盖 “Codex tasks”，而 CPA 的请求以 Codex CLI 的身份出现。这种覆盖是推断出来的，未经验证。
  - OpenRouter，每个请求都带 `data_collection: "deny"`。
- **不合格**：
  - DeepSeek 的直连 API：没有书面的 API 退出选项。
  - Shanghai AI Lab 的端点：没有书面条款。
  - 自身条款不过关的任何中转站。
  - [ADR 0001](./0001-pi-in-a-container-behind-the-gateway.zh.md) 的回退方案，即 Pi 官方的 ChatGPT 登录，只有在有人确认 OpenAI 的退出选项覆盖它的请求之后才合格。
- **有两个 provider 时用两个；一个就足以继续运行。** 失去一个会发一条 Discord 通知。没有合格的 provider 应答时，mail-cleared 的运行等待，从不回退到不合格的 provider。以这种方式错过的验证邮件，会让它的 Registration 变为 _handed off_。

## 强制执行

- **new-api 的分组 `mail`** 只包含合格的渠道，mail 角色的密钥绑定到它。令牌的分组决定哪些渠道可以为它服务。跨分组重试只存在于 `auto` 分组，所以在这里永远不适用。
- **OpenRouter 的 deny** 由 new-api 在 OpenRouter 渠道上的参数覆盖设置，而不是由 forwarder 设置。forwarder 无法知道 new-api 选了哪个上游，而 ChatGPT 后端可能拒绝它不认识的字段。
- **`ops/upgrade role` 拒绝把渠道放进 `mail`**，除非 `ops/pins` 记录了它合格的依据：条款、条款的 URL、阅读日期，以及设置了的退出选项。pins 检查会把 OpenRouter 的覆盖设置与运行中的设置进行比较。

## 退出选项，以及发现某个被重新打开

- **设置**：
  - 在 CPA 登录的 ChatGPT 账号上：上面两项设置。
  - 在 OpenRouter 上：关闭两个 “may train” 开关（付费模型和免费模型），关闭 Input & Output Logging，关闭 “OpenRouter Use of Inputs/Outputs”。逐请求的 deny 让这些成为第二层。
  - 在这个人的 Discord 账号上：关闭 “Use data to improve Discord”。
- **发现**：
  - 每个退出选项都记录在 `ops/pins` 里，附上最近一次确认的日期。
  - `ops/token <provider>` 和 `ops/upgrade role` 会请这个人确认它。
  - 每 90 天一条 Discord 提醒列出它们，附带 “Still off” 按钮。不会暂停任何东西。
  - 每 6 个月，一条提醒要求对照记录的条款，重新阅读每条合格路线的训练条款。

## 存储

- **VM 上邮件文本的每一份副本都在 90 天后过期。** 包括原始输入存储、运行记录和备份。
- **例外是邮件 Rule 的用例夹具。** 它放在 VM 上 git 之外的本地夹具存储里，保留到它的 Rule 退役为止。Rule 按 ID 指向它。这修订了 [ADR 0002](./0002-rules-are-files-proven-by-their-own-case.zh.md)。如果 VM 丢失，这些夹具随之丢失，它们的 Rule 会被标记出来，等着用以后的邮件建立新用例。
- **new-api 自己的日志文件不含请求或回复文本**（2026 年 10 月 15 日检查过：访问行、用量记录、错误）。例外是渠道测试，它的回复会被完整记录。内容日志保持关闭，也从不对邮件运行渠道测试。

## 隐私页面

它的文本在 [按照 Google 的 Limited Use 规则，哪些模型路线可以读取 Signup mailbox 的邮件？](https://github.com/ultrasadness/lab1/issues/30) 的结论里。它的源文件和代码放在一起，通过 `ops/upgrade` 发布。它按上面的标准描述模型 provider，而不是点名，并写明了 Discord 和 GitHub。本 ADR 划的线有任何改变，都要先改这个页面。

## 考虑过的方案

- **每个角色都是 mail-cleared**：无需跟踪什么，但 Miner 和 Registration 准备会失去所有不合格的路线。
- **标记每个收到邮件衍生文本的运行**：最灵活，但每段存储的文本都需要一个标记，说明它从哪里来。
- **要求零数据保留**：会去掉 ChatGPT Plus（它在服务器端的保留情况未知），只剩 OpenRouter 的 ZDR 端点这一个 provider。
- **任何未知会拿数据训练的路线**：无法在公开页面上如实陈述。
- **邮件 Rule 夹具放在 git 里**：GitHub 会永久保存 Gmail 文本，页面也就得说明这一点。Google 的 API 条款也禁止永久复制 API 内容。
- **在页面上点名 provider**：今天属实，但每次 `ops/upgrade role` 之后都会过时。
