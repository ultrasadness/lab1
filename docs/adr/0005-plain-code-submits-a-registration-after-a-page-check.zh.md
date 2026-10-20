# 普通代码在页面检查之后提交 Registration，任何 Claude 模型都不参与准备

[English](0005-plain-code-submits-a-registration-after-a-page-check.md) | 中文

这个人批准 Walkthrough 之后，Assistant 自己填写表单并提交。但提交从来不是模型的动作。填表运行以写明要按哪个按钮结束。随后普通代码检查填好的页面，只有页面与批准的内容一致时，才按下那个按钮。如果不一致，这个人会在 Discord 上收到一张填好的表单的截图，点按一次 Submit 即可提交。以前，每个 Registration 都以这个人在 Takeover 中按下提交结束。那是基于 Anthropic 的 Usage Policy（“Utilize automation in account creation”，即在创建账号时使用自动化），其他 provider 的政策都没有对应的条款。Pi 作为 harness、且没有 Claude 模型准备 Registration 之后，这一条款不再适用，而这个人希望在设计能安全做到的范围内尽量少些麻烦。在 [Claude 的 Usage Policy 允许 Assistant 提交 Registration 吗？](https://github.com/ultrasadness/lab1/issues/15) 中决定。

## 考虑过的方案

- **总是由这个人在 Takeover 中提交**（这次复核之前的做法）：在任何 provider 下都安全。否决，因为每个顺利的 Registration 都要花一次手机会话，而它唯一的政策理由已经不在了。
- **每次都由这个人在 Discord 上点按一次提交**：一张填好的表单的截图加一个 Submit 按钮。作为检查失败时的回退方案保留，而不是默认做法。
- **在填表运行中由模型按下提交**：最简单。否决，因为那样的话，注入的页面文本、或改写工具调用的中转站（relay），就能创建账号。由普通代码按按钮时，模型的浏览器工具根本没有提交动作。
- **允许 Claude 模型，并逐次运行检查**：让 Claude 模型准备 Registration，再根据网关日志，把任何由 Claude 模型填写的 Registration 转为 Takeover。否决：它增加了第二条路线，却什么也省不下，因为这个人在别处也不用任何 Claude 模型。

## 后果

- **检查**：普通代码按下任何东西之前，以下各项都必须成立。它只看指定的按钮所提交的那个表单，包括通过 `form=` 关联到它的字段。页面上别处的字段和隐藏输入一律忽略。
  - 顶层页面在 Walkthrough 写明的注册主机上。这个主机来自 Approval 之前对注册页面的读取，它可能是某个认证服务商托管的页面，而不是 Product 自己的域名。
  - 每个可见字段都处于四种状态之一：由某个 Walkthrough 键填入，并保持该键批准的值（Signup identity 的两个地址都算）；按引用填入；由这个人在 Takeover 中填入；或者为空。其他任何值都会让检查失败，包括页面预设的值，或被页面脚本改过的值。
  - 浏览器自身的有效性检查通过，所以没有必填字段为空。
  - 唯一一个未经这个人同意就勾选的框，是必填的条款框，而且它的链接指向 Walkthrough 所链接的条款。

  Continue/Next 和 Join waitlist 也在同样的检查下按下。检查起初要求每个字段都在 Walkthrough 里写明。现在 Walkthrough 从未写明的字段可以保持为空：Approval 之前的读取只能看到表单的第一页，所以要求写明每个字段，会让后面每一页都失败。在 [Registration 遇到 Wall 时会怎样，处于边界的页内操作又归哪边？](https://github.com/ultrasadness/lab1/issues/10) 中细化。
- **检查失败**时，如果这个人能在截图上看出差别（一个未经批准的值或选项），就转到 Submit 点按。另有三种失败改为退回一份修订后的 Walkthrough：一个没有批准值的必填字段、不同的条款或一个新的要求同意的勾选框，以及位于另一个主机上的页面。修订后的 Walkthrough 是一个新版本，在同一个浏览器会话之内批准。
- **验证**：邮件里的验证码按引用填入，然后按下 Verify。验证链接由普通代码按引用打开。两者都只在以下各项全部成立时才会发生；否则由这个人在 Gmail 里点按。
  - Gmail 自己对这封邮件的认证结论显示，Product 的域名或它的某个子域名 DMARC 通过。光看 From 头永远不算数。
  - Gmail 在表单提交后 1 分钟之内收到它。
  - 它恰好包含一个验证码或一个链接。

  在 [Assistant 持有哪些 Gmail 权限，可以用它们做什么？](https://github.com/ultrasadness/lab1/issues/16) 中明确。
- **仍归这个人的事**：
  - OAuth 授权同意（“Sign in with Google”），实际上就是一次 Handoff。
  - 条款禁止机器人创建账号的 Product，直接转为 Handoff。条款只禁止自动化访问的 Product 走正常路线，并在它的 Dossier 里引用该条款。
  - 通过 Product 自己的注册 API 注册仍被排除，因为检查是围绕网页构建的。
- **网关**：任何准备 Registration 的模型角色都不映射到 Claude 模型。在 OpenRouter 上，写明模型名，并把 Anthropic 排除在托管方之外。中转站按它所宣称的模型来判断。
- **Takeover 现在只用于 Wall。**
