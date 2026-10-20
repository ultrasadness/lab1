# Registration 使用一个专用的 Gmail 作为 Signup mailbox，不设第二个邮箱

[English](0003-one-dedicated-signup-mailbox.md) | 中文

每个 Registration 使用的地址都投递到一个只为 Registration 保留的新 Gmail 账号，也就是 Signup mailbox。每个 Product 得到一个加号地址（`you+<product>@gmail.com`），在 `+` 被拒绝的地方，回退为不带加号的原地址。因为这个账号里只有注册邮件，“Assistant 只碰与注册相关的邮件”是由账号的边界保证的，而不是靠过滤代码；使用原地址也不会暴露任何个人信息。每个 Registration 都把这个地址绑定到某个 Product 的账号上，所以以后要换它，就得在每个 Product 上改邮箱。在 [除了 Gmail，我们还需要一个 Outlook 的 Signup identity 吗？](https://github.com/ultrasadness/lab1/issues/13) 中决定。

## 考虑过的方案

- **这个人现有的 Gmail**：不用新账号，但 Assistant 的读取范围会覆盖这个人的私人邮件，而原地址回退会让那个收件箱进入各个 Product 的营销名单。
- **通过 Graph 把 Outlook.com 作为第二个 Signup identity**：否决。拒绝 Gmail 地址的 Wall 大多拒绝所有免费邮箱服务商（“work email only”、HubSpot 的 “Block free email providers”），outlook.com 也在其中。Outlook 只能越过对子地址的拦截，而 Gmail 的原地址本来就能越过。它的代价是一个 Azure/Entra 目录（有用户报告会被要求填银行卡）、第二个 OAuth 令牌、第二套台账和 Reply draft 路径。
- **把 Outlook 转发进 Gmail**：只能收。回复会从 Gmail 发出，而 Gmail 将在 2027 年 1 月取消第三方地址的 “Send mail as”。
- **`+` 被拒绝时用 Gmail 的加点变体（`y.ou@gmail.com`）**：不用第二个邮箱就能每个 Product 一个地址，但有些网站会对 gmail.com 去掉点号，而且按发件人域名把邮件匹配到它的 Registration，本来就覆盖了原地址。

## 后果

- **加号地址用于分拣和追查泄露，不用于隐私。** 任何人都能去掉 `+<product>` 得到原地址。
- **Reply draft 从 Registration 的 Signup identity 发出**，发在这个 Product 的邮件线程里：用它的加号地址，或在 `+` 被拒绝时用原地址。每次发送都由普通代码根据 Registration 记录设置 `From`，从不由模型设置，Approval 里也会显示它。通过 Gmail API 发送时，加号地址的 `From` 会保留下来，在“已发送”里和对方收到的邮件里都是如此，不需要 “Send mail as” 别名。所以按加号地址认得这个账号的客服会收到从它发出的回复，回信也会回到这个 `+tag`。在 [既然 Gmail 会保留加号地址，Reply draft 应该从 Product 的加号地址发出吗？](https://github.com/ultrasadness/lab1/issues/28) 中决定，取代了本 ADR 最初记录的原地址规则。
- **Gmail iOS 总是使用原地址。** 它在任何草稿的发件人一行显示原地址，保存编辑时写入原地址，未改动的草稿也从原地址发出。在 Gmail 里编辑、在 Discord 里批准的 Reply draft 仍从 Signup identity 发出，因为 `From` 由普通代码设置。这个人直接从 Gmail 发出的 Reply draft 则从原地址发出；凡是这个人在 Gmail 里编辑过的 Reply draft，Discord 都会注明这一点。之后那个 Product 记住的就是原地址，它的邮件像原地址回退那样按发件人域名匹配，也不能再靠标签追查。
- **Walkthrough 显示两个地址**：加号地址和回退用的原地址，所以一次 Approval 覆盖两者。`+` 被拒绝不算 Wall，拒绝 gmail.com 本身的表单才算。
