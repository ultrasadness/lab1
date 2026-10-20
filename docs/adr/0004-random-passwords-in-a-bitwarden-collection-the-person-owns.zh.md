# Registration 的密码是随机的，存放在这个人拥有的 Bitwarden 集合里

[English](0004-random-passwords-in-a-bitwarden-collection-the-person-owns.md) | 中文

每个 Registration 都有自己的随机密码。它在这个人批准 Walkthrough 时由机器人生成，从不由模型生成，并作为一个条目存进 Password vault。Password vault 是一个免费的两人 Bitwarden 组织里的 *Registrations* 集合，这个组织归这个人自己的账号所有。机器人有自己的免费 Bitwarden 账号，用的是 Signup mailbox 的一个加号地址，作为组织的第二个成员，只能访问那个集合。这个人本来就在用 Bitwarden，所以密码通过 Bitwarden 的 iOS 自动填充（AutoFill）到达这个人的 iPhone，无论是在 Handoff 中注册时，还是之后每次登录时；这个人的个人密码库也从不接触 VM。在 [Registration 的密码如何生成、保存，又如何在 iPhone 上取用？](https://github.com/ultrasadness/lab1/issues/7) 中决定。

## 考虑过的方案

- **从一个基础密钥派生密码**（`HMAC(secret, root domain)`），这是这个人最初的想法。HMAC 消除了模式被看出来的风险，但派生仍有三项代价：
  - **每个网站的状态**：网站对长度和字符的规则，以及每次重置的计数器，仍然得存下来。
  - **一把钥匙开所有门**：机器人要持有基础密钥才能按引用填入，所以一次泄露就会暴露过去和将来的所有密码，而轮换这个密钥会改变每个网站的密码。
  - **iPhone 上没有自动填充**：仍在维护的选项 LessPass 看起来只能复制粘贴，这在 Handoff 中最麻烦。
- **机器人登录这个人自己的 Bitwarden 账号**：最简单的共享方式，但会把这个人的主密码和整个个人密码库放到 VM 上。
- **由机器人的账号拥有组织**：同样的共享方式，但机器人就能删掉组织和里面的一切。只有当这个人已经拥有一个免费组织时，它才是回退方案，因为每个账号只能拥有一个。
- **在 VM 上自托管 Vaultwarden，经 Tailscale 访问**：没有第三方，但多了一个要运行、备份、并保持与 Bitwarden 客户端兼容的服务器（2026 年 7 月就有一个客户端版本与它不兼容）。没有任何来源证实 iOS 自动填充能通过它工作。
- **Apple 密码（Apple Passwords）**：服务器上的任何东西都写不进去；每次导入都得从这个人的设备上开始。
- **VM 上的加密文件，密码通过 Discord 发送**：发给这个人的消息里不能有 Secret。Discord 不是端到端加密的，而且会在备份里保留已删除的消息。

## 后果

- **没有任何模型会看到密码。** 机器人的接口只给模型两件事可做：为这个 Registration 创建密码，以及把它按引用填进某个字段。Walkthrough 写明 Password vault 里的条目，但从不显示密码的值。Registration 记录和机器人的日志只保存条目 ID。
- **每个条目**以 Product 命名。它的网站是 Product 的根域名（自动填充需要这个），用户名是 Signup identity 的地址。默认密码为 24 个字符，包含所有字符类别。如果表单拒绝它，机器人会在同一个 Approval 之内生成一个新的。Walkthrough 里没有密码字段时，不创建条目。
- **Assistant 只创建条目。** 它从不修改或删除条目。_abandoned_ 的 Registration 的条目会留下，备注里写着结果。Registration 之后修改密码，是这个人自己的事。
- **VM 保存机器人账号的 API 密钥和解锁密码**，放在机器人的凭据目录里。机器人每次操作都运行一次 `bw`，会话密钥只在内存里，所以没有本地 Bitwarden API（`bw serve`）在监听。在 [Assistant 的 Secret 和令牌放在哪里，每一个又如何获取和更换？](https://github.com/ultrasadness/lab1/issues/25) 中决定；见 [ADR 0009](./0009-the-bot-runs-as-its-own-user-and-holds-every-token-outside-the-containers.zh.md)。
