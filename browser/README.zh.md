# 浏览器服务

[English](README.md) | 中文

运行在自己的加固容器里的 Playwright（ADR 0006），借助 Node 的类型剥离原样运行。它唯一的客户端是机器人，通过 Unix 套接字连接：它不监听任何端口，网络也是它独有的，所以 Pi 容器访问不到它。这个切片（#43）搭起了容器，以及只读的 `read(url)`：Dossier 和 Walkthrough 在任何 Approval 之前用它读取 Product 的页面。

| 路径 | 是什么 |
|---|---|
| `src/api.ts` | 套接字 API 的类型：机器人发送什么、收到什么 |
| `src/client.ts` | 机器人这一侧的套接字 |
| `src/main.ts` | 启动 Xvfb、一个有界面的 Chrome for Testing（没有沙箱就拒绝启动）和套接字 |
| `src/reader.ts` | `read(url)`：在一个用完即弃的内存上下文里打开一个页面 |
| `src/snapshot.ts`, `src/redact.ts` | 一次读取能看到页面的哪些内容，以及去掉看起来随机的字符串 |
| `src/cookie-banners.ts` | 每次快照之前，以拒绝（opt-out）模式运行 autoconsent |
| `src/walls.ts` | 银行卡字段，以及加载时的机器人检测或插页 |
| `Dockerfile`, `compose.yaml`, `seccomp_profile.json` | 按 digest 固定的镜像，以及容器的加固设置 |
| `chrome-policies.json` | 托管策略：在任何上下文里都不保存密码、不自动填充、不下载、不弹权限请求 |

固定版本的地方：`Dockerfile` 里 Node 运行时和 Playwright 镜像的 digest，以及 `package.json` 里 `playwright-core`（与 Playwright 镜像一致）和 `@duckduckgo/autoconsent` 的确切版本，只通过 `ops/upgrade` 更新。修补后的 Node 二进制替换 Playwright 镜像里的 `/usr/bin/node`，`/usr/local/bin/node` 指向它，因此绝对路径和 PATH 都使用它，Chromium 不变。在 #72 实现 `ops/upgrade` 之前，按 `ops/README.md` 所述通过 `ops/install --deploy` 部署这些固定版本。

## 套接字 API

在 `$SOCKET_PATH` 的套接字上，用 JSON 请求体的 HTTP。

- `GET /health`：浏览器的版本和 autoconsent 的版本。服务只以有界面模式运行，并启用 Chromium 的沙箱：没有沙箱时，它在启动时就退出。
- `POST /read`，请求体为 `{ "url": "https://…" }`：返回一个 `PageRead`（`src/api.ts`），或者返回 `{ "error": { "kind", "message" } }`：URL 不是普通的 http 或 https 时状态码为 400；页面加载不了、是一个下载、或耗时超过 60 秒时为 502。`snapshot` 是模型可以看到的部分：其中每个字符串里看起来随机的字符串都换成了 `[random]`。其余部分（确切的最终 URL 和主机、状态码、支付字段、机器人检测和 cookie 横幅）只给普通代码用。

## 测试

```sh
npm ci
npm run typecheck
npm test                         # every test; builds the image first
KEEP_BROWSER=1 npm test          # leaves the containers up afterwards
```

这些测试就是浏览器 seam（seam 2）：它们通过套接字驱动真实镜像里的真实 Chromium，容器由 `compose.yaml` 启动，带着它全部的加固设置。`test/compose.test.yaml` 把它放进一个没有互联网的网络，旁边是一个本地测试页面服务器（`test/pages/`），测试里出现的每个主机都由它应答。

pre-commit hook 用这里安装的依赖，对暂存的文件运行这里的类型检查；CI 在一个单独的 workflow 里运行 `npm ci`、类型检查和测试（`docs/hooks-and-ci.md`）。

## 运行

在 VM 上，这个服务运行在根目录 `compose.yaml` 的项目里，和 Pi 在一起，挂在一个名字固定的网桥 `br-lab1-browser` 上，由 `ops/install` 在那里启动它（`ops/README.md`）。这里的 `compose.yaml` 需要两个设置，由 `ops/install` 提供：

- `BROWSER_SOCKET_DIR`：一个属于机器人的用户和组、权限为 `2770` 的目录，这样其中的套接字会归属机器人的组；
- `BROWSER_SOCKET_GID`：机器人的组 id，容器加入这个组，才能在那里创建套接字。

Compose 从项目所在的目录读取 seccomp 配置文件，所以放在别处的项目，比如根目录 `compose.yaml` 的项目，还要把 `BROWSER_SECCOMP_PROFILE` 设为 `seccomp_profile.json` 的绝对路径。

```sh
BROWSER_SOCKET_DIR=/run/lab1-browser BROWSER_SOCKET_GID=$(getent group assistant | cut -d: -f3) docker compose up -d --build
```

`ops/firewall` 让它的出站流量只能去往公共互联网：从它的网桥出发，任何私有地址、链路本地地址或主机上的东西都访问不到（`ops/README.md`）。
