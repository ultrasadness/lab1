# forwarder 为每个请求挑选 provider，并掌管花费预算

[English](0011-the-forwarder-picks-each-requests-provider-and-holds-the-spending-budgets.md) | 中文

机器人的 forwarder（[ADR 0009](./0009-the-bot-runs-as-its-own-user-and-holds-every-token-outside-the-containers.zh.md)）选择由哪个 provider 服务每个模型请求，并按花费预算放行每次运行。new-api 仍然掌管渠道、密钥和模型名，但 provider 出故障时，它不再做任何决定。在 new-api 默认的 `RetryTimes` 为 0 时，一个 Plus 的 429 就直接让运行失败，所以在有人改映射之前，[ADR 0001](./0001-pi-in-a-container-behind-the-gateway.zh.md) 中每个角色的两个 provider 根本不起作用。CPA 的 ChatGPT 登录是这个人自己的账号，所以 Assistant 和这个人共用 Plus 额度。它的用量响应头从不到达机器人（CPA 的 `passthrough-headers` 默认关闭，而 new-api 的流式路径只转发 `X-Reasoning-Included` 和 `X-Codex-Turn-State`），所以没人能看到这份额度还剩多少。forwarder 已经知道每次运行的角色，并精确统计它的 token，所以它是唯一一个能有意识地做故障转移、并约束 Assistant 花费的地方。预算是防止失控的护栏，比如邮件洪水、运行死循环，或回退到更贵的模型；其大小设定为普通的一天永远碰不到。在 [每种运行可以花多少，预算用完时会怎样？](https://github.com/ultrasadness/lab1/issues/39) 中决定。

## 考虑过的方案

- **由 new-api 做故障转移（`RetryTimes` 大于 0）**：否决。冷却期间它在每个请求上都先试 Plus，它不重试 402 或 403，而且机器人只能事后从 token 日志得知是哪个 provider 提供的服务。
- **配给而不是护栏**，即 Assistant 通过少做事来达成的花费目标：Day's line 需要每一个 Fit，而且 Assistant 会悄悄地少做事。
- **以原始 token 为单位的预算**：Luna 和 Sol 的价格相差约 20 倍，所以 token 预算要么卡住便宜的模型，要么放任昂贵的模型失控。
- **把 new-api 密钥配额当作预算**：密钥的配额是一个永不重置的终身额度池，机器人没有管理员令牌给它充值，而且用完额度的密钥和错误的密钥一样回答 401 “Invalid token”。
- **所有东西共用一个预算**：一场邮件洪水就会让 Miner 停下。
- **为 Assistant 单独再订一份 Plus**：每月再多 20 美元，去保护一份 Plus share 本来就在保护的额度。
- **new-api 里不限额的角色密钥**：那样的话，forwarder 里的计数 bug 只能靠预付余额来拦住，在 Plus 上则只能靠 OpenAI 的时间窗口，而那也是这个人的窗口。
- **预算用完时中断运行**：已经花掉的钱白费了，条目也会半途而废。

## 后果

- **路由**：
  - forwarder 按 `ops/pins` 的顺序，把每个请求发到一个 `role@provider` 模型名。每个名字恰好由一个渠道服务，所以不管这个人为其他用途把 `RetryTimes` 设成多少，new-api 都无法切换 provider。不带 provider 的角色名被取消。
  - 它跳过正在冷却（错误给出重置时间时冷却到那个时间，否则每 30 分钟再试一次）、余额不足（402）、持续出错，或超出 Plus share 的 provider。provider 掉线的运行会换下一个继续。
  - mail 角色只为 `mail` 分组里的路线设 `@provider` 名（[ADR 0010](./0010-mail-text-reaches-only-mail-cleared-roles-on-routes-that-dont-train.zh.md)），所以故障转移永远不会离开这个分组。
  - forwarder 记录每个请求由哪个 provider 服务，所以 Miner 评判的 provider 不再需要 [怎样发现给出的 Fit 比其他 provider 偏高或偏低的 Miner provider？](https://github.com/ultrasadness/lab1/issues/35) 里的 token 日志查找。
  - provider 掉线时，`#status` 里会有一条静默消息，写明是哪个 provider、原因、持续到何时，以及由哪个 provider 接手；恢复时再有一条。一个角色没有任何 provider 可用时就是停机，按 [机器人、容器和网关如何保持运行和升级，其中一个停掉时会怎样？](https://github.com/ultrasadness/lab1/issues/26) 所说的处理。余额耗尽只有在让某个角色没有 provider 可用时，才会产生一张 `#needs-you` 卡片。
- **单位**是按标价计算的名义美元：每个请求的精确 token 数 × `ops/pins` 为该 provider 的模型记录的每 1M 输入、缓存和输出 token 的价格。Plus 按 OpenAI 同一模型的 API 标价计价，所以即使它不额外花钱，用量也是有上限的。
- **预算**：
  - registration、mail 和 question，各自按太平洋时间日计；
  - Miner，按 Miner 日期计，所以 3 天的补跑能得到三个日期的预算；
  - checks，按周计：每周检查、每日探测，以及 Rule 被保留或编辑时的检查；
  - **Plus share**：Assistant 在滚动 7 天内、跨所有角色和检查在 Plus 上花掉的名义美元。达到它会把工作转到下一个 provider，不会停下任何东西。

  这些值放在 git 里机器人的配置中，只通过 `ops/upgrade` 修改。初始值约为 [按 Assistant 的用量，模型路线、Product Hunt 和 Gmail 适用哪些限制和价格？](https://github.com/ultrasadness/lab1/issues/36) 中估算的两倍。实测 14 天之后，每周简报会提议：每个角色取最贵一天的 3 倍，checks 取最贵一周的 2 倍。这个人对照 ChatGPT 自己的用量页面比较一周之后，再设定 Plus share。
- **放行**：预算在运行开始时检查。已开始的运行会在它自己的上限内完成，所以预算最多超出一次运行的 token 上限。Plus share 在每个请求上都检查。
- **从不拦下，但计入**：为已批准的 Registration 做的工作（填表运行、修订后的 Walkthrough）、等待验证的 Registration 的邮件、这个人启动的检查、Correction 的运行，以及 `ops/upgrade` 的门禁，后者会打印它们累计的花费。Correction 以它所纠正条目的角色运行，计入那个角色的预算；针对 Skip 的 Correction 计入它的 Miner 日期（在 [写规格之前还有什么要决定？](https://github.com/ultrasadness/lab1/issues/40) 中决定）。
- **预算用完时，工作等待，不会因此多丢掉任何东西**：
  - Miner 日期等待，只会因现有的 3 天窗口而被丢弃；
  - Walkthrough 准备和 Retry 点按在太平洋时间 00:00 之后运行，最早的 Dossier 优先；
  - 邮件在台账里等待，并在摘要中显示为 not handled；
  - Question 立即被拒绝，不排队；
  - 每周检查先运行 Miner 的 Fit 检查，再在每个角色的主 provider 上运行 Rule 用例，然后是回退 provider；没轮到的列为 *not run*，从不算作失败。
- **每个用完的预算只通知这个人一次**，通过一张 `#needs-you` 卡片：开头列出最贵的 3 次运行，说明什么在等待、何时重置，并提供 **Allow one more day**。question 预算用完时，改为在 Question 帖子里放同样的按钮。
- **forwarder 之下的金额上限**：
  - 按 token 付费路线上的**预付余额**，关闭自动充值。
  - **new-api 密钥配额。** `ops/upgrade role` 用根据同一份 `ops/pins` 价格算出的倍率为它们计价，每个角色密钥初始有 4 周的预算。

  两者都由这个人手动充值。每周简报显示每个余额和配额，剩余不足 2 周时加一行提示。收到 new-api 的 401 时，forwarder 用那个密钥读取 `GET /api/usage/token/`，配额用完后它仍会应答。于是用完的配额会被报告为已用完，而不是令牌失效。
- **Product Hunt 和 Gmail 没有预算。** 普通代码遵守它们的限流回复。
- **“Budget” 不是术语表里的术语。** 在 Discord 上和文档里，花费预算总是以它的角色命名（*mail budget*、*checks budget*），而 [ADR 0002](./0002-rules-are-files-proven-by-their-own-case.zh.md) 的 4k token 预算始终是 **the Rule budget**。
