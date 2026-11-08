# VM 上的运维

[English](README.md) | 中文

在 Oracle VM 上运行 Assistant 的脚本，按 ADR 0008 和 ADR 0009 的决定：机器人作为它自己的 `assistant` 用户运行，每个令牌都是容器之外一个归 root 所有的文件，运行中的 Assistant 用它自己的一份 checkout。#71 带来安装、令牌、夜间备份、浏览器的防火墙和 Docker 辅助程序。脚本由 agent 编写和测试，试运行也由 agent 来跑；凡是碰到真实令牌的，都由这个人来运行。这个人在 VM 上执行的验收清单在 #85 和 #73 里。

| 路径 | 是什么 |
|---|---|
| `ops/install` | 唯一的安装脚本：可以重复运行，第二次运行什么都不改 |
| `ops/token`, `ops/token.ts` | 获取、更换或检查令牌的唯一途径 |
| `ops/backup` | 实时存储和 new-api 的夜间备份 |
| `ops/firewall` | 浏览器容器的主机防火墙：只能访问公共互联网；以及 Pi 通往 forwarder 的路 |
| `ops/docker-helper.ts`, `ops/run-pi.ts` | 归 root 所有的 Docker 辅助程序，以及它在机器人这一侧的部分 |
| `ops/alert.ts` | 机器人或备份放弃时发出的告警 |
| `ops/systemd/` | `ops/install` 放进 `/etc/systemd/system` 的单元 |
| `ops/coding-sessions/` | Claude Code 和 Codex 的设置，让编码会话碰不到凭据 |
| `ops/github-known-hosts` | GitHub 公布的 ssh 主机密钥，供机器人的 ssh 使用 |
| `ops/bitwarden/` | 机器人运行的 Bitwarden CLI `bw` 的版本固定：它的确切版本，以及它带来的每个包的哈希 |
| `compose.yaml` | Pi 和浏览器服务的 compose 项目 |

## 安装

所有命令都在 lab1 的主 checkout 里、`main` 分支上运行：

1. 把 new-api 发布在回环地址上，也就是 `config/assistant.json` 里 `gateway.baseUrl` 访问它的地方：在 new-api 的 compose 项目里，给 `new-api` 服务加上 `ports: ["127.0.0.1:3000:3000"]`。机器人在那里访问 new-api，从不经过 Caddy。
2. `sudo ops/install --personal-database git@github.com:<owner>/<repo>.git`。它最后会列出机器人和它的告警还在等什么。
3. 对它列出的每个令牌运行 `sudo ops/token <name>`（见下文）。
4. 再运行一次 `sudo ops/install`。deploy key 就位后，它会检出 Personal database 的 `main`；配置和每个令牌都就位后，它会启动机器人。
5. 配置里标着 `set at go-live` 的值和任何代码一样修改：一次落到 `main` 上的提交，然后 `sudo ops/install --deploy`。

`ops/install` 会放好下面这些，每一样都先检查再修改：

- 供机器人和运维脚本使用的 Node 24.22.2，对照 nodejs.org 公布的 SHA-256 校验，放在 `/opt/assistant/node`，这个链接改指向时，正在运行的机器人会重启到它上面；
- `sqlite3`，供备份使用；
- `bw`，版本由 `ops/bitwarden/` 固定，放在 `/opt/assistant/bw`，`config/assistant.json` 里的 `bitwarden.command` 从那里运行它，安装时不运行任何包的安装脚本；
- `assistant` 系统用户，除了它自己的组以外不在任何组里：没有 `sudo`，没有 `docker`，`/home/ubuntu` 也不向它开放；
- `/etc/assistant/credentials` 和 `/var/backups/assistant`，只归 root 所有（权限 700）；
- 机器人在 `/opt/assistant/lab1` 的 lab1 checkout，归 root 所有，机器人只能读，和编码会话工作的地方分开；
- `assistant` 用户的 `known_hosts` 里的 GitHub 主机密钥；
- 机器人在 `personalDatabase.dir` 的 Personal database checkout，`origin` 指向仓库的 ssh URL，deploy key 能用之后再检出 `main`；
- `ops/systemd/` 里的单元，以及浏览器服务的套接字目录 `/run/lab1-browser`，每次开机都会重新建好；
- 编码会话的设置；
- 防火墙，然后是 compose 项目，最后是机器人。

不带 `--dry-run` 时，`ops/install` 只运行 `main` 里有的东西，因为编码会话就在它运行的那个 checkout 里工作：只要那里的 `ops/` 和 `main` 不同，它就拒绝运行，并说明哪里不同（在 #71 上确定）。`sudo ops/install --dry-run` 说明会改什么，但什么都不改，还会运行尚未提交的改动；它不需要 root。如果给出的 Personal database 的 checkout 里还什么都没检出，它还会通过 deploy key 去问 GitHub 它会拉取到什么。没有 root 时它看不到凭据目录里面，所以会把每个令牌都列为缺失。

在 #72 带来 `ops/upgrade` 之前，`--deploy` 是一次提交进入运行中的 Assistant 的途径，这是这个人在 #71 上选的临时办法。它把机器人的 checkout 移到主 checkout 的 `main`，前提是它就是 `origin/main`：pre-push hook 只让 CI 已经通过的提交进入 `main`。然后它再安装一遍，构建 compose 项目，并重启机器人。没有推送过的 `main`，或者不是从正在运行的提交延续下来的，它都会拒绝。机器人的 checkout 里不是 git 做出的改动，是 `ops/install` 会点名的问题，在这个改动消失之前它都会失败。

## 令牌

`sudo ops/token <name>` 不回显地读取值，用一次无害的调用检查它，只有检查通过后才写入 `/etc/assistant/credentials/<name>`（归 root 所有，权限 600），并重启读取它的服务。检查不通过的值什么也不会改变。只有当机器人读取的每个令牌都已就位、Personal database 也已检出时，机器人才会重启；在那之前，`ops/token` 会说明它还在等什么。`ops/token --list` 列出每个令牌，`ops/token --check [<name>…]` 检查已就位的令牌，`ops/token --dry-run <name>` 读取并检查一个值，但不写入。

| 令牌 | 怎么获得 | 它的检查 |
|---|---|---|
| `discord-bot-token` | Developer Portal 的 Bot 页面 | Discord 的 `/users/@me` |
| `producthunt-token` | Product Hunt API v2 的开发者令牌 | 查询一个 Launch |
| `newapi-key-<role>`，用于 `miner`、`registration`、`mail`、`question` 和 `checks` | new-api 为这个角色生成的密钥（见下文） | new-api 的 `/models`，其中必须列出这个角色请求的每个 `<role>@<provider>` |
| `newapi-key-probe` | new-api 为每日探测生成的密钥 | new-api 的 `/models` |
| `gmail-client-secret` | Google Cloud 的 Credentials 页面为桌面应用客户端下载的 JSON | Google 接受这个客户端，只拒绝一个编造的授权码 |
| `gmail-refresh-token` | 在 Safari 里授权一次：登录 Signup mailbox 的账号，打开 `ops/token` 显示的链接，再把 Safari 打不开的那个地址粘贴回来 | 刷新一次，权限恰好是 `gmail.readonly` 和 `gmail.compose`，以及这个邮箱的地址 |
| `bitwarden-api-key` | 机器人的 Bitwarden 账号的个人 API 密钥：先是它的 `client_id`，再是它的 `client_secret` | 在一个一次性的数据目录里，`bw` 用它登录 |
| `bitwarden-master-password` | 机器人的 Bitwarden 账号 | 在一个一次性的数据目录里，`bw` 登录、用它解锁并同步，账号必须只能看到 *Registrations* 集合 |
| `healthchecks-ping-bot`, `-miner`, `-backup`, `-weekly` | healthchecks.io 上每个检查的 ping URL；机器人那个检查的周期是 5 分钟，宽限 10 分钟 | 在这个检查上记一条日志事件，其他什么都不改 |
| `personal-database-deploy-key` | 在 VM 上生成：`ops/token` 显示公钥，把它加到仓库的 Deploy keys 里，勾上 "Allow write access"，然后它等你按回车 | 在机器人的 checkout 里通过这把密钥运行 `git ls-remote origin main`，再做一次什么都不推的推送，没有写权限的密钥会被 GitHub 拒绝 |

deploy key 的私钥从不离开 VM（在 #71 上确定）：在询问 GitHub 期间，它待在凭据目录里面的一个目录里，即使 SSH 会话断开，这个目录也会被删除。试了五次 GitHub 仍然拒绝的密钥，什么也不会改变：从仓库里删掉它，再运行一次 `ops/token`。CPA 的 ChatGPT 登录，也就是粘贴那个打不开的 `localhost:1455` 地址，随 CPA 本身在 #72 里到来。

运行 `ops/token bitwarden-api-key` 之前，这个人要先设置一次 Password vault（ADR 0004）：这个人自己的 Bitwarden 账号拥有一个免费组织，里面有 *Registrations* 集合；机器人自己的账号 vault 里没有别的东西，作为组织的第二个成员，对那个集合有 *Can edit* 权限，别的什么都碰不到。两个账号都在 bitwarden.com 上，`bw` 没有另行设置时用的就是这个服务器。被邀请的成员要先接受邮件里的链接，再由所有者确认，之后才能看到内容。账号能看到别的集合时检查就会失败，因为机器人会因此扣住每个 Approval。

`bw list collections` 不会说明账号能对集合做什么，所以检查分辨不出两种错误的授权：

- 只读授权：第一个 Approval 会被扣住，日志行会写明原因；
- *Can edit, except passwords*：创建能成功，但 `bw` 把每个密码都答成 null，所以按引用填写（#56）会没有东西可填。#54 的试验在 2026-11-08 遇到了这种情况。

机器人的单元只交付机器人现在读取的令牌：`discord-bot-token`、`producthunt-token`、`newapi-key-miner`、`newapi-key-registration`、`personal-database-deploy-key`、`healthchecks-ping-bot`、`bitwarden-api-key` 和 `bitwarden-master-password`。之后读取别的令牌的 ticket，会在 `ops/systemd/assistant.service` 里加上它的 `LoadCredential=` 一行：只要这个单元和机器人读取的名字不一致，`ops/test/token.test.ts` 就会失败。

### new-api 的渠道和角色密钥

forwarder 向 new-api 请求一个角色的模型时，用的名字是 `<role>@<provider>`，比如 `miner@openrouter`，从不用模型自己的名字（ADR 0011）。在 #72 的 `ops/upgrade role` 能创建它们之前，由这个人在 new-api 的管理页面里逐个设置：

- 一个该 provider 类型的渠道，它的模型只有这一个名字，并带一条从这个名字到 provider 所服务模型的模型重定向，比如 `{"miner@openrouter": "nvidia/nemotron-3-ultra-550b-a55b:free"}`：这个模型就是 `config/assistant.json` 里 `roles.<role>.providers` 写明的那个，它的价格在 `prices` 里；
- 在 new-api 的倍率设置里给这个名字一个价格，处于自用模式的 new-api 不要求这一项：这个价格就是 `prices` 给这个模型的价格，所以免费模型的输入和输出都是 $0；
- 一个只属于这个角色的令牌，它的模型限制写明这个角色的每个 `<role>@<provider>` 名字，额度是这个角色 4 周的预算（ADR 0011）；mail 角色的令牌放在 `mail` 分组里（ADR 0010）。这个角色的名字必须对它的令牌所用的分组可用，否则 new-api 会返回 503 和 `model_not_found`。

持有这些令牌的 new-api 用户自己也需要额度。new-api 会按每次请求的费用从中预扣，不够时就以 403 拒绝，比如 `insufficient_user_quota`。

在 new-api 的 Playground 里对每个名字发一句 "hi"，就能看出渠道、重定向和价格都可用。之后，如果 new-api 的 `/models` 显示一个 key 访问不到它所属角色的每个名字，`ops/token newapi-key-<role>` 就会拒绝它。上线时（#85），两个令牌都被限制在上游模型的名字上，registration 角色的位置上放的还是 miner 的 key：当时的检查只数模型个数，所以两个都通过了，结果每次运行都因 new-api 的 403 而失败。这两步都不会把 new-api 的价格和 `prices` 作比较。2026-11-05（#85），new-api 一直在对这个免费模型收费，而机器人按 $0 计算，所以用户额度耗尽时日志里还是 `"spent":0`，从 09:26 UTC 起 Dossier 的运行都因这个 403 而失败。2026-11-06 和 2026-11-07（#85），`registration@openrouter` 对 `vip` 分组不可用，所以每次 Dossier 的运行都因这个 503 而失败。

## 机器人的用户和 Docker 辅助程序

`assistant` 用户不在 `docker` 组里，所以机器人只能通过辅助程序访问 Docker（ADR 0009）。`assistant-docker.socket` 监听 `/run/assistant-docker.sock`，只有 `assistant` 组可以打开它，每个连接都以 root 身份启动一次 `ops/docker-helper.ts`。连接的第一行请求恰好两个命令之一：在 `assistant-pi` 容器里为一个角色启动一个 `pi --mode rpc` 进程，或者报告每个运行中容器的镜像和 digest。其他任何请求都会被拒绝，也不会运行任何 Docker 命令。运行的令牌通过环境变量进入容器，从不出现在命令行上。

`ops/run-pi.ts` 是机器人的 `pi.command`：它向辅助程序请求这次运行，转发 stdin 和 stdout，以 Pi 的退出码退出，并把 Pi 的 stderr 的末尾写到它自己的 stderr。机器人这一侧关闭后，辅助程序结束 Pi 的 stdin，Pi 随之结束；10 秒后还在运行的，它的 `docker exec` 会被杀掉。杀掉 `docker exec` 并不会停止容器里的进程，但这样的 Pi 访问不到任何模型：机器人的这次运行一结束，forwarder 就忘掉这次运行的令牌。

机器人的单元不让它看到 `/home`，除了 `/var/lib/assistant` 也不让它写任何地方。机器人运行时每 5 分钟向它在 healthchecks.io 上的检查发一次 ping（`bot/README.md`），所以它一停下，邮件会在 15 分钟内发出。它停止 120 秒后重启，所以即使陷入崩溃循环，每天也只登录 Discord 720 次；一小时内 10 次启动失败后，它就停下，并由 `assistant-alert@bot.service` 把机器人的检查标为失败，邮件于是立刻发出。

| 单元 | 做什么 |
|---|---|
| `assistant.service` | 机器人 |
| `assistant-docker.socket`, `assistant-docker@.service` | Docker 辅助程序，每个连接一个服务 |
| `assistant-firewall.service` | 在 Docker 启动之前运行 `ops/firewall apply` |
| `assistant-backup.timer`, `assistant-backup.service` | 备份，在太平洋时间 00:30 运行；某晚错过时，在开机时补上 |
| `assistant-alert@.service` | 告警，用于 `bot` 或 `backup` |

Miner 没有 timer：机器人自己在太平洋时间 01:00 安排它，机器人每次启动都会补上 VM 关机期间错过的日期（在 #71 上确定）。每周检查的 timer 随 #52 一起来，Miner、备份和每周检查的 healthchecks.io ping 随 #70 一起来。

## 备份

`assistant-backup.timer` 每晚运行 `ops/backup`：对实时存储做一次 `sqlite3 .backup`，对 new-api 的数据库做一次 `pg_dump`，放进 `/var/backups/assistant/<Pacific date>/`，保留最近 7 晚。这份 dump 里有各个套餐的 provider 密钥，所以这个目录只归 root 所有。令牌从不备份：如果 VM 丢了，每个令牌都用 `ops/token` 重新获取。`ops/backup --dry-run` 说明它会备份什么，以及每一部分是否存在。

恢复某一晚的备份：

```sh
sudo systemctl stop assistant.service
# A crash leaves the old store's write-ahead log behind, which SQLite would replay onto the restored store.
sudo rm -f /var/lib/assistant/assistant.sqlite-wal /var/lib/assistant/assistant.sqlite-shm
sudo install -o assistant -g assistant -m 600 /var/backups/assistant/<night>/assistant.sqlite /var/lib/assistant/assistant.sqlite
sudo systemctl start assistant.service
sudo docker stop new-api
# Only root can read the backups, so root's shell opens the dump.
sudo sh -c 'docker exec -i postgres pg_restore --username root --dbname new-api --clean --if-exists < /var/backups/assistant/<night>/new-api.dump'
sudo docker start new-api
```

## 浏览器的防火墙

`ops/firewall apply` 丢弃浏览器容器发往公共互联网以外任何地方的每个包：私有地址段、Tailscale 的地址段、链路本地地址（其中包括 Oracle 的实例元数据）、主机自己的地址，以及 IPv6 的本地地址段。它在 raw 表里工作，排在 Docker 和 Tailscale 加的链之前。容器的 DNS 仍然可用：Docker 的解析器从主机转发查询，而不是从浏览器的网桥转发。

`ops/firewall check` 需要 Docker，但不需要 root：它从浏览器网络上的一个临时容器去试每一类被封的地址和两个公共地址，任何一个结果不对它就失败。在 #71 里，它在一个临时网络上试过：没有防火墙时，这样的容器能访问实例元数据、sshd、new-api 的网络和 Tailscale 的解析器；有了防火墙，只能访问公共互联网。`ops/firewall --dry-run` 打印这些规则。

它还让 Pi 的容器能访问机器人的 forwarder。Pi 运行在 Docker 的默认网桥 `docker0` 上，通过这个网桥的网关访问 forwarder，但 Oracle 的 Ubuntu 镜像在 filter 表的 `INPUT` 末尾用一条 `REJECT` 拒绝了 ssh、http 和 https 以外的一切，上线时（#85）每次 Miner 运行都因此被拒。所以 `apply` 在 `INPUT` 最前面放一条 `ACCEPT`，只放行从 `docker0` 到 forwarder 端口的流量；`check` 还会从这个网桥上的一个临时容器去试 forwarder，它必须能访问到。在那里，和每个目标一样，被拒绝的连接也算访问到了，因为它已经到达主机。`ops/firewall` 里 forwarder 的地址就是 `config/assistant.json` 里的那个：只要两者不一致，`ops/test/firewall.test.ts` 就会失败。

## 编码会话

编码会话以 `ubuntu` 身份运行，它保留着 sudo。`ops/install` 写入 `/etc/claude-code/managed-settings.d/assistant.json` 和 `/etc/codex/requirements.toml`，禁止每个 Claude Code 和 Codex 会话读取凭据目录、systemd 在 `/run/credentials` 里交给各个服务的凭据，以及备份。不是 `ops/install` 写的 `requirements.toml` 会原样保留，并被点名，由这个人手动合并。Claude Code 的 Bash 规则会拒绝任何提到这些目录的命令，在代码里 `grep` 它们也算在内（在 #71 上确定）。一旦这妨碍了做运维的会话，就把它们收窄到同时提到 `sudo` 和这些目录的命令。

## 测试

`npm test` 会和其他测试一起运行 `ops/test/`。这些测试把 VM 放在一个临时目录里（`OPS_ROOT`），用假的系统命令和假的外部服务，只用假的令牌：

- `install.test.ts` 安装两次，检查第二次什么都不改；它还覆盖试运行、经过一个只放行已添加的 deploy key 的假 GitHub 的 Personal database、`--deploy`、`systemd-analyze verify` 读到的单元文件，以及 `ops/install` 不在 bash 忽略 `set -e` 的地方做任何改动；
- `token.test.ts` 输入每一种令牌，包括在一个会回显输入的终端下输入，并检查写入了什么、重启了什么；
- `docker-helper.test.ts` 像 systemd 那样，在 `systemd-socket-activate` 后面运行辅助程序，配一个假的 `docker`；
- `alert.test.ts` 让告警对着一个假的 healthchecks.io 运行，它按测试说的次数失败；
- `backup.test.ts` 和 `firewall.test.ts`，后者在测试自己的一个网络命名空间里运行。

在 VM 上，agent 运行这些试运行：`ops/install --dry-run`、用假值运行 `ops/token --dry-run <name>`、`ops/backup --dry-run`、`ops/firewall --dry-run`，以及在防火墙就位后运行 `ops/firewall check`。
