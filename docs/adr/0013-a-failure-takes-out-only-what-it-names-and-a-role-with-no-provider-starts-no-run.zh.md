# 一次失败只让它涉及的部分停用，没有 provider 的角色不开始运行

[English](0013-a-failure-takes-out-only-what-it-names-and-a-role-with-no-provider-starts-no-run.md) | 中文

[ADR 0011](./0011-the-forwarder-picks-each-requests-provider-and-holds-the-spending-budgets.zh.md) 让 forwarder 跳过正在冷却、余额不足或持续出错的 provider，并按角色的顺序发送每个请求。它没有说一次失败让多大范围停用，排在后面的 provider 怎样才能再被试到，也没有说一个没有 provider 可用的角色对等着它的工作意味着什么。2026-11-06 和 2026-11-07 这三点都出了问题：`registration@openrouter` 在 new-api 上没有渠道，152 个聊天请求答了 503，它旁边 Miner 的名字却正常，38 个 Dossier 运行失败，每个都用掉一次尝试。七份 Dossier 停在次数上限，这个人通过一次性修改实时存储，让它们再试一次。所以，一次失败只让它涉及的部分停用，到了再试时间的 provider 排在顺序之前，没有 provider 可用的角色不开始运行。在[在一个角色的 provider 之间做故障转移](https://github.com/ultrasadness/lab1/issues/46)中决定。这收窄了 ADR 0011，并改变了[给写不成的 Dossier 的运行设上限](https://github.com/ultrasadness/lab1/issues/100)上的第三个回答。

## 考虑过的方案

- **任何失败都让整个 provider 停用**：像 ADR 0011 那样每个 provider 只有一行 `#status` 消息，但一个没有渠道的名字会让这个 provider 上的每个角色都停下，每次 30 分钟。
- **严格按角色的顺序**：没有请求乱序，但排在后面的 provider 只有在它前面的都不可用时才被问到，所以一次充值不会被注意到，它的卡片也一直挂着。
- **给到期的 provider 单独发探测**：要多发一个请求，而下一个真实请求不额外花钱。每日探测是[在宕机和令牌失效时继续运行](https://github.com/ultrasadness/lab1/issues/70)的工作。
- **连续失败三次，名字才掉线**：对偶发的一次 5xx 更宽容，在只有一个 provider 的角色上，这样一次 5xx 会毁掉一次运行。到 2026-11-09 的 10 天里没有出现过上游 5xx，所以这仍是备选方案。
- **没有 provider 时运行照常开始并失败，也计次数**：这是 #100 确定的，因为机器人当时分不清这样的运行和 Dossier 自身的失败。现在 forwarder 分得清了，而计次数的代价就是那次手工修改。
- **把失效的角色密钥留给 #70**：在它做好之前，运行会一直失败并用掉尝试。

## 后果

- **一次失败让什么停用：**
  - 429 或 402：整个 provider，对列出它的每个角色都是如此。
  - 其他任何失败：只有那个 `role@provider` 名字，所以一个真的挂掉的 provider 每个角色各有一行 `#status` 消息，而 ADR 0011 是每个 provider 一行。其中包括 `GET /api/usage/token/` 显示还有配额的 401，那是 provider 拒绝了它自己的密钥。
  - `GET /api/usage/token/` 显示配额已尽的 401、403 `pre_consume_token_quota_failed`，或者 new-api 在那里也拒绝的密钥：这个角色的所有 provider，因为它们共用它的密钥。
  - 403 `insufficient_user_quota`：每个角色，因为同一个 new-api 用户持有每把密钥。
  - 一次这样的回答就够了。
- **顺序**：到了再试时间的 provider 最先被问到，排在角色的顺序之前。这样每 30 分钟最多有一个请求不按顺序。拒绝不花钱，它一旦服务了，顺序就恢复成配置的样子。当那个请求评判了 Launch 时，当天的摘要会写明这些 provider。
- **重置时间**：经过 new-api 后只有 429 的 `error.metadata` 能保留下来，其中带有 OpenRouter 的 `X-RateLimit-Reset`。它丢掉 CPA 的 `Retry-After` 和 `reset_seconds`（#46 上的试验），所以 ChatGPT Plus 每 30 分钟再试一次，它那行消息写的是下次何时再试，而不是掉线到何时。
- **没有 provider 可用的角色不开始运行**，没有任何 provider 服务过的运行也一样对待，因为两者都没花钱：
  - Miner 日期等待，它的迟到消息写明原因；
  - Dossier 不用掉尝试：它的列表照常发出，写明它和原因，每 30 分钟的一轮都会再试；
  - Correction 或 Walkthrough 准备等下一次 30 分钟的尝试。
- **provider 服务过、之后角色才没有 provider 可用的运行**算失败的运行，要计次数，这样重试就不会无止境地花钱。
- **这个人会听到**：花完的 gateway quota 会收到 ADR 0011 给让角色没有 provider 可用的余额不足的那张 `#needs-you` 卡片。失效的密钥会有一行 `#status` 消息，写明它的 `ops/token` 命令，#70 再加上它的通知。
