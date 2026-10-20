# 机器人以自己的用户运行，并在容器之外持有每一个令牌

[English](0009-the-bot-runs-as-its-own-user-and-holds-every-token-outside-the-containers.md) | 中文

Assistant 使用的每个密钥和令牌都是 Secret，没有一个放在容器里。每个固定的令牌都是 `/etc/assistant/credentials/` 里一个归 root 所有的文件（权限 600），由 systemd 通过 `LoadCredential=` 交给需要它的服务。机器人以一个专用的 `assistant` 系统用户运行，没有 sudo，不在 `docker` 组里，也看不到 `/home/ubuntu`。现在一切都以 `ubuntu` 运行，它有免密码的 sudo 并在 `docker` 组里，编码会话也以 `ubuntu` 运行：一个读了令牌文件的编码 agent，会把 Secret 放进模型的输入。Pi 容器只能通过机器人里的一个 forwarder 访问 new-api，由 forwarder 加上这次运行的密钥。在 [Assistant 的 Secret 和令牌放在哪里，每一个又如何获取和更换？](https://github.com/ultrasadness/lab1/issues/25) 中决定。

## 考虑过的方案

- **机器人以 `ubuntu` 运行**：否决。每个编码会话都能读机器人的令牌，而机器人也能读 `gh` 那个管着整个 GitHub 账号的令牌。
- **为机器人的用户使用 rootless Docker**：否决。容器的流量会以这个用户自己的进程的身份出去，这会破坏 [ADR 0006](./0006-registration-browser-in-its-own-container-driven-through-fixed-actions.zh.md) 的宿主机防火墙。
- **令牌存放在 Bitwarden**：机器人仍需要把它的 Bitwarden 登录放在磁盘上才能取回令牌，而 Bitwarden 一出故障，一切都会停下。
- **用 sops 或 age 加密令牌**：无人值守的启动需要密钥放在同一块磁盘上，所以加密保护的是副本，而不是运行中的 VM。Ubuntu 22.04 的 systemd（249）也没有 `systemd-creds`。
- **compose 文件里的环境变量**，就像 new-api 现在这样：任何能用 Docker 的人都能通过 `docker inspect` 读到它们。
- **把 new-api 密钥放进 Pi 容器的环境变量**：Pi 的 `bash` 能读到它，违反 [ADR 0001](./0001-pi-in-a-container-behind-the-gateway.zh.md)。持有一个密钥的代理 sidecar 既不能做到每个角色一个密钥，也不能精确统计每次运行的 token。
- **`bw serve`**：一个没有认证、一直保持解锁的 API。改为机器人每次操作都运行一次 `bw`，会话密钥只在内存里，所以没有任何东西在监听。
- **为 Personal database 的仓库使用细粒度的 GitHub 令牌**：它会过期，所以又多一个会失效的令牌。deploy key 不会。

## 后果

- **只能通过一个固定的辅助程序使用 Docker。** 一个归 root 所有的辅助程序给机器人提供两个命令：
  - 为某个角色启动一个 `pi --mode rpc` 进程；
  - 为 `ops/pins` 检查报告运行中镜像的 digest。

  [ADR 0001](./0001-pi-in-a-container-behind-the-gateway.zh.md) 的 `docker exec` 仍会发生，但机器人不能运行任何其他 Docker 命令。这个人保留 sudo，而 Claude Code 和 Codex 的设置禁止编码会话访问凭据目录。
- **每个令牌放在哪里**：
  - **凭据目录**：
    - Discord 机器人令牌；
    - Gmail 的 client secret 和 refresh token；
    - Product Hunt 令牌；
    - 每个角色一个 new-api 密钥，外加一个探测密钥；
    - 机器人的 Bitwarden API 密钥和主密码；
    - healthchecks.io 的 ping URL；
    - 一个只对 Personal database 的仓库有写权限的 deploy key。
  - **和负责续期它的东西放在一起**：CPA 的 ChatGPT 登录在 CPA 的卷里，`bw` 的数据目录跟着机器人。
  - **在 new-api 的数据库里**：各套餐的 provider 密钥，以及 CPA 渠道使用的 CPA API 密钥。CPA 的配置文件归 root 所有、权限 600，它的管理 API 是关闭的。CPA 只能从 new-api 经内部 Docker 网络访问。
  - **绝不**放在 git、命令行、容器的环境变量或日志里。令牌不备份：如果 VM 丢失，每一个都重新获取。每晚的 new-api 转储里有 provider 密钥，只有 root 能读。
- **forwarder** 细化了 [ADR 0001](./0001-pi-in-a-container-behind-the-gateway.zh.md)：Pi 容器唯一的端点是机器人，而不是 new-api。
  - **密钥**：机器人知道每次运行的角色，所以使用那个角色的 new-api 密钥。每个密钥在 new-api 里都被限定为它角色的模型、一个配额和机器人的地址。mail 角色的密钥还绑定到 new-api 的 `mail` 分组，那个分组里只有不拿输入做训练的路线（[ADR 0010](./0010-mail-text-reaches-only-mail-cleared-roles-on-routes-that-dont-train.zh.md)）。
  - **计数**：机器人精确统计每次运行的 token，用于 [ADR 0008](./0008-the-personal-database-is-its-own-repo-and-code-ships-only-through-ops-upgrade.zh.md) 的单次运行上限。
  - **路由和预算**：forwarder 还为每个请求挑选 provider，并按花费预算放行每次运行（[ADR 0011](./0011-the-forwarder-picks-each-requests-provider-and-holds-the-spending-budgets.zh.md)）。收到 new-api 的 401 时，要先对照密钥的剩余配额核实，才能把密钥报告为失效。
  - **公共网关**：Assistant 的流量从不经过 Caddy。`na.pot.dpdns.org` 仍然公开，供这个人的其他用途使用，而泄露的 Assistant 密钥在外部毫无用处。new-api 保留它的用量日志，内容日志关闭。
- **`ops/token <name>` 是获取或更换令牌的唯一途径。** 这个人在 VM 上运行它，从 iPhone 上经 Tailscale 用 SSH 应用连接。它会：
  1. 不回显地读取值，或者读取 Gmail 或 CPA 登录之后粘贴进来的那个打不开的 `127.0.0.1` 或 `localhost:1455` 地址；
  2. 写入凭据文件；
  3. 用一次无害的调用检查令牌；
  4. 重启使用它的服务。

  这些命令合在一起，就是重建 VM 的操作手册。
- **机器人拒绝任何包含它所持有的某个 Secret 确切值的模型请求或 Discord 消息**，并发布一条通知，要求更换那个令牌。这把 [ADR 0006](./0006-registration-browser-in-its-own-container-driven-through-fixed-actions.zh.md) 对快照的确切值脱敏，扩展到 Assistant 自己的密钥和每一条出去的路。
