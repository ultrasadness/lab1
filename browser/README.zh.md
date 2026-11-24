# 浏览器服务

[English](README.md) | 中文

运行在自己的加固容器里的 Playwright（ADR 0006），借助 Node 的类型剥离原样运行。它唯一的客户端是机器人，通过 Unix 套接字连接：它不监听任何端口，网络也是它独有的，所以 Pi 容器访问不到它。#43 搭起了容器，以及只读的 `read(url)`：Dossier 和 Walkthrough 在任何 Approval 之前用它读取 Product 的页面。#55 加上了 Registration 的会话：填表运行经由机器人可以使用的固定动作，以及普通代码的页面检查、按下按钮和按引用填写。#101 加上了 `redirect(url)`。从 #56 起机器人驱动会话：它打开会话、切换驱动者、执行填表运行的动作，并请求页面检查、指纹和按下按钮。从 #58 起它请求 `fill-code` 和 `open-link`，用来验证一个 Registration。从 #59 起它为 Submit 点按请求截图，并在这个人批准过指纹的页面上按下按钮。

| 路径 | 是什么 |
|---|---|
| `src/api.ts` | 套接字 API 的类型：机器人发送什么、收到什么 |
| `src/client.ts` | 浏览器测试用的套接字客户端。机器人不从 `browser/` 导入任何东西，所以它自己这一侧写在 `bot/src/browser.ts` |
| `src/main.ts` | 启动 Xvfb、一个有界面的 Chrome for Testing（没有沙箱就拒绝启动）和套接字 |
| `src/reader.ts` | `read(url)`：在一个用完即弃的内存上下文里打开一个页面 |
| `src/redirect.ts` | `redirect(url)`：用一个不跟随跳转的 HEAD 得知 URL 指向哪里 |
| `src/sessions.ts` | Registration 的会话：数量上限、驱动者和关闭时机，固定动作，以及普通代码的动作 |
| `src/page-check.ts` | 页面检查的规则，只针对指定按钮提交的那个表单 |
| `src/snapshot.ts`, `src/redact.ts` | 一次读取或一个会话能看到页面的哪些内容，以及去掉填进会话的每个 Secret 和看起来随机的字符串 |
| `src/cookie-banners.ts` | 每次快照之前，以拒绝（opt-out）模式运行 autoconsent |
| `src/walls.ts` | 银行卡字段，以及加载时的机器人检测或插页 |
| `Dockerfile`, `compose.yaml`, `seccomp_profile.json` | 按 digest 固定的镜像，以及容器的加固设置 |
| `chrome-policies.json` | 托管策略：在任何上下文里都不保存密码、不自动填充、不下载、不弹权限请求 |

固定版本的地方：`Dockerfile` 里 Node 运行时和 Playwright 镜像的 digest，以及 `package.json` 里 `playwright-core`（与 Playwright 镜像一致）和 `@duckduckgo/autoconsent` 的确切版本，只通过 `ops/upgrade` 更新。修补后的 Node 二进制替换 Playwright 镜像里的 `/usr/bin/node`，`/usr/local/bin/node` 指向它，因此绝对路径和 PATH 都使用它，Chromium 不变。在 #72 实现 `ops/upgrade` 之前，按 `ops/README.md` 所述通过 `ops/install --deploy` 部署这些固定版本。

## 套接字 API

在 `$SOCKET_PATH` 的套接字上，用 JSON 请求体的 HTTP。

- `GET /health`：浏览器的版本和 autoconsent 的版本。服务只以有界面模式运行，并启用 Chromium 的沙箱：没有沙箱时，它在启动时就退出。
- `POST /read`，请求体为 `{ "url": "https://…" }`：返回一个 `PageRead`（`src/api.ts`），或者返回 `{ "error": { "kind", "message" } }`：URL 不是普通的 http 或 https 时状态码为 400；页面加载不了、是一个下载、或耗时超过 60 秒时为 502。`snapshot` 是模型可以看到的部分：其中每个字符串里看起来随机的字符串都换成了 `[random]`。其余部分（确切的最终 URL 和主机、状态码、支付字段、机器人检测和 cookie 横幅）只给普通代码用。
- `POST /redirect`，请求体为 `{ "url": "https://…" }`：从服务的网络对这个 URL 发一个 HEAD，不用浏览器，也不跟随任何跳转，回答 `{ "status", "location" }`。`location` 是 3xx 回答指向的绝对 URL，其他情况下为 null。错误和 `/read` 相同，最多耗时 30 秒。机器人只对 Product Hunt 的跳转发送它，而且是在读取这个跳转停在机器人检测上之后（#101）。
- `POST /session/open`，请求体为 `{ "registration", "url", "domains" }`：一个 Registration 的会话，即一个属于它自己的内存上下文，在 Walkthrough 的起始 URL 打开，返回 `{ "session" }`。同时最多打开 5 个（429，`full`），每个 Registration 一个（409，`already-open`），起始页面加载不了时不会打开（502）。会话在以下时候关闭：收到 `POST /session/close`、一个动作耗时超过 60 秒、打开验证链接之后，或者 24 小时内没有任何针对它的请求（`SESSION_IDLE_LIMIT_MS`）：机器人自己的 24 小时规则会先关掉它，所以这一条兜住的是机器人丢掉的会话。
- `POST /session/drive`，请求体为 `{ "session", "driver" }`：现在由谁驱动这个会话，`none`、`fill-run`、`plain-code` 或 `person`。每个动作的路径写明它需要的驱动者；这个人在 Takeover 中驱动时，其他任何一方都不能动作。把这个人填的字段显示为 `[person]`、并让页面检查接受它们，随 #60 的 Takeover 一起实现。
- `POST /fill-run/…`：填表运行经由机器人可以使用的固定动作，除非顶层页面位于会话的某个域名上，否则每一个都会被拒绝（`off-domain`）。`snapshot` 先拒绝 cookie 横幅。它只按填入字段的东西显示字段（字段的 Walkthrough 键、`[password]` 或 `[code]`），从不显示字段的值，并按确切值删去填进会话的每个 Secret，再删去看起来随机的字符串。它给出的 ref（`f1`、`b1`、`l1`）指明其他动作所用的字段、提交控件和链接，只显示一个按钮的表单也包括在内。`fill` 接受一个 Walkthrough 键和机器人提供的批准值；`fill-secret` 接受机器人按引用提供的 `password` 或 `code`；`choose` 接受一个选项的标签，或 `ticked`、`left unticked`，并且只点击角色为 combobox、option、checkbox、radio 或 switch 的元素；`open` 加载链接的 URL 而不是点击它，而且只限会话的域名。
- `POST /plain-code/…`：普通代码自己的动作。`snapshot` 与填表运行的相同。`check` 就是页面检查：给出指定按钮、批准的注册主机、批准的条款 URL 和 Signup identity 的两个地址，它回答哪条规则在哪个字段上失败。它等页面保持不变 1.5 秒之后才判断，最多等到请求之后 5 秒，因为页面的脚本可能还在对最后一次填写作出反应。`fingerprint` 对 URL、表单结构和各字段的值取哈希，并在旁边回答页面的 `shape`：URL，以及每个表单字段的类型和名字、按钮的文字，用来判断按下之后是否仍显示同一个表单（#59）。`screenshot` 遮住每个按引用填入的字段，还可以标出一个按钮的轮廓并标记字段。它也遮住任何含有本会话填入的 Secret 的字段，比如页面把密码移进它自己做的字段时。这样的字段或按引用填写的字段上的失败带有 `secret`。`check` 和 `press` 可以带 `approvedPage`，也就是 Submit 点按批准的页面的指纹：这时它们放行这个人在那个页面上看到的值，即 `unapproved-value` 和 `unapproved-box`，但从不放行标有 `secret` 的，并且除非页面仍有那个指纹，否则以 `changed` 拒绝；这在页面保持不变之后判断（#59）。`press` 只在检查通过、且按钮可见、可用、位于会话的域名上、是那个包含每个仍显示着的已填字段的表单唯一的提交控件时才动作，所以页面已经隐藏的前一步不算。点击开始之后才失败的，回答里带 `uncertain`，并算作已经按下（ADR 0007）。`fill-code` 按引用填入邮件里的验证码，`open-link` 打开验证链接，然后关闭会话。
- 银行卡字段（`cc-*` autocomplete 值）无论要求什么都会被拒绝（`payment-field`），支付服务商的 frame 从不出现在快照里。拒绝的格式是 `{ "error": { "kind", "message" } }`，种类见 `src/api.ts`；被检查拒绝的按下请求在 `check` 里带上检查结果。

## 测试

```sh
npm ci
npm run typecheck
npm test                         # every test; builds the image first
KEEP_BROWSER=1 npm test          # leaves the containers up afterwards
npm run test:file -- test/page-check.test.ts   # one file, or several; builds the image first
npm run smoke                    # the fill smoke test alone
```

这些测试就是浏览器 seam（seam 2）：它们通过套接字驱动真实镜像里的真实 Chromium，容器由 `compose.yaml` 启动，带着它全部的加固设置。`test/compose.test.yaml` 把它放进一个没有互联网的网络，旁边是一个本地测试页面服务器（`test/pages/`），测试里出现的每个主机都由它应答。这个服务器把会话提交的每个表单、打开的每个验证链接都记进日志，测试把它读作 Product 收到的东西。测试用的 compose 文件还把会话“24 小时没有请求”的时限缩短为 15 秒，把 60 秒的动作上限缩短为 20 秒（`SESSION_ACTION_LIMIT_MS`），这样测试能看到两者各自关闭会话。整套测试约需 4 分钟。

在 CI 的 runner 上，页面的定时器可能晚大约一秒才运行，本地运行从来没出现过这种情况：测试要对页面脚本的反应作断言之前，先看 `CODING_STANDARDS.md` 里的“Plain code judges a page that has held still”。

填表冒烟测试（`test/smoke.test.ts`）通过固定动作填写本地测试表单，由普通代码按下提交，再检查测试服务器收到的恰好是批准的值。它是浏览器镜像的升级门禁（ADR 0006），等 #72 建好 `ops/upgrade` 后由它运行。

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

要在线上服务上手动试一次读取，由这个人在 VM 上运行下面这行，在 agent 的 session 里用 `!`。套接字只接受机器人的组，所以 agent 自己的 shell 连不上它。`/redirect` 接受同样的请求体。

```sh
sudo curl -s --max-time 90 --unix-socket /run/lab1-browser/browser.sock -H 'content-type: application/json' -d '{"url":"https://example.com/"}' http://localhost/read | jq '{finalHost, status, botCheck, error}'
```
