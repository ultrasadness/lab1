# Registration 浏览器运行在自己的容器里，模型只能通过固定动作驱动它

[English](0006-registration-browser-in-its-own-container-driven-through-fixed-actions.md) | 中文

填写 Registration 的浏览器运行在它自己的长期容器里，由我们的一个小型浏览器服务（TypeScript 和 Playwright）掌管。机器人是这个服务唯一的客户端，通过 Unix 套接字连接，所以 Pi 只能通过机器人的窄接口接触浏览器。模型从不自由地点击或输入。它只有一组固定动作：拍快照、用一个以 Walkthrough 键指定的已批准值填写字段、按引用填入 Secret、选择一个已批准的选项、打开 Walkthrough 域名上的链接，以及结束。注册页面和 Product 网站都是不可信的文本，而任何一次点击都可能运行页面的 JavaScript，所以“不做会发送数据的点击”无法逐个元素地强制执行。防御在于：读取页面的运行几乎什么都做不了，而每一次按下都由普通代码完成。在 [Registration 浏览器在哪里运行，如何防止页面文本操纵 Assistant？](https://github.com/ultrasadness/lab1/issues/18) 中决定。

## 考虑过的方案

- **Pi 容器里的 Playwright MCP**，这是 [headless-signup 研究](https://github.com/ultrasadness/lab1/blob/research/headless-signup/docs/research/headless-signup.md) 里最显而易见的路径：因两个理由否决。
  - **快照会泄露已填的值。** Playwright 的快照把每个字段的当前值都放进文本，包括密码（`ariaSnapshot.ts` 只略去复选框、单选按钮和文件输入），所以 `browser_snapshot` 会把已填入的密码交给模型。
  - **Pi 能读取浏览器 profile。** Pi 的 `bash` 能读取 profile 里的 cookie，违反 [ADR 0001](./0001-pi-in-a-container-behind-the-gateway.zh.md) 中容器不持有任何 Secret 的规则。
- **机器人直接通过 CDP 驱动 Playwright**：少一个程序。否决，因为 CDP 是对浏览器不需认证的完全控制，而且机器人一重启，就会丢掉正在等 Takeover 的会话。
- **宿主机上单独的操作系统用户**：隔离更弱，而且网络限制需要按用户设防火墙规则。
- **允许模型点击，但拒绝点击类似提交的元素**：页面脚本可以在任何一次点击时发送数据；在字段一变化就捕获其内容的页面上，光是输入就足够了。
- **把提示注入分类器当作防御**：不算一种防御。挡住注入文本的，是运行做不到的事，而不是检测。
- **一个持久的浏览器 profile**（Playwright MCP 的默认做法）：它把每个 Product 的登录 cookie 都集中在一处，还让第三方追踪器能把这个人的各个 Registration 互相关联起来。
- **用 Playwright 的 Dashboard 做 Takeover**（`playwright cli show`）：这个人在 [哪种 Takeover 形式能在 iPhone 上用：noVNC 还是 Playwright 的 Dashboard？](https://github.com/ultrasadness/lab1/issues/21) 中在 iPhone 上试过之后否决。
  - 它的实时视图在一个可聚焦的 `<div>` 上接收按键，而不是在文本框上，所以 iOS 从不弹出键盘。它也没有触摸处理，所以点按只能通过 iOS 模拟出的鼠标事件到达页面。这个人无法可靠地输入或选择任何东西。
  - 它列出每个已绑定的浏览器，所以同时进行两个 Takeover 时，两个会话都会显示出来。它那种只显示一个上下文的视图，只以桌面应用窗口的形式存在，不在任何端口上提供。
  - 它没有认证。
- **用反检测浏览器 Camoufox 取代 Chrome for Testing**：在 [当浏览器读取停在机器人检测上时，用 HEAD 读取 Product Hunt 的跳转](https://github.com/ultrasadness/lab1/issues/101) 中用默认配置试过一次，它和 Chrome for Testing 一样停在 Product Hunt 的 challenge 上。规格排除了这类浏览器，而且补丁节奏会跟着 Camoufox 的发布走。如果那条路被关掉，由 [如果 Product Hunt 关掉对其跳转的 HEAD，再评估让浏览器服务使用 Camoufox](https://github.com/ultrasadness/lab1/issues/102) 重新考虑。

## 后果

- **模型的动作**，顶层页面不在 Walkthrough 的域名上时一律拒绝：
  - `snapshot`；
  - `fill(field, key)`，只填已批准的值，从不填模型自己的文本；
  - `fillSecret(field, password|code)`；
  - `choose(field, key)`，只点击 role 为 combobox、option、checkbox、radio 或 switch 的元素；
  - `open(link)`，加载 `<a href>` 的 URL，而不是点击它；
  - `finish(button | wall | stuck)`，其中 Wall 的种类来自一个固定列表：`bot-check`、`oauth-only`、`phone`、`blocked`、`card`、`free-email`、`invite-only`。

  模型没有输入 URL、按键、脚本、cookie、网络读取、上传、下载或截图的能力。处于边界的动作只能作为一个独立的动作加入。Cookie 横幅不算这种动作：每次快照之前，普通代码用一套针对已知同意管理工具（consent manager）的规则，拒绝非必要的 cookie。没有规则匹配的横幅会留在那里；如果它挡住了一次按下，这个 Registration 就交给这个人（在 [Registration 遇到 Wall 时会怎样，处于边界的页内操作又归哪边？](https://github.com/ultrasadness/lab1/issues/10) 中决定）。这套规则是 DuckDuckGo 的 `autoconsent`，以拒绝（opt-out）模式运行，在 `ops/pins` 中固定版本，只通过 `ops/upgrade` 更新。它也在只读的 `read(url)` 读取中运行，因为在那里横幅可能遮住表单（在 [写规格之前还有什么要决定？](https://github.com/ultrasadness/lab1/issues/40) 中决定）。
- **填表运行**是一个启动时不带内置工具、不带 MCP、不带 codemode、也没有会话的 Pi 进程。它只看得到已批准的 Walkthrough、Registration 范围内的 Rule 和快照。它唯一的输出是结构化的 `finish` 结果，其原因来自一个固定列表；任何简短备注都以代码块的形式到达 Discord。
- **普通代码只在以下两条都成立时才按下按钮**：
  - 页面通过 [ADR 0005](./0005-plain-code-submits-a-registration-after-a-page-check.zh.md) 中的页面检查；
  - 指定的元素可见、可用、位于 Walkthrough 的域名上，并且是包含该页所有已填字段的那个表单唯一的原生提交控件。在同一个 document 里、页面后来已经隐藏的前一步上填的字段不算（在 [在浏览器服务中驱动一个 Registration 会话](https://github.com/ultrasadness/lab1/issues/55) 中决定）。

  否则由这个人在一张标出了指定按钮轮廓的截图上点按 Submit。每页一次填表运行，超过 5 页后，这个 Registration 交给这个人。
- **任何原始字段值都不会到达模型。**
  - **快照**显示填入某字段的 Walkthrough 键；按引用填入的字段显示 `[password]` 或 `[code]`。每个填进会话的 Secret 都按确切值从整个快照中删除，看起来随机的字符串则按模式删除。
  - 发到 Discord 的**截图**会遮住每个按引用填入的字段。
  - **一旦账号可能已经存在**，就再没有模型读取那个 Registration 的页面。
  - 因此，**存下来的快照**（也就是 Rule 用例重放的输入）不含任何 Secret。
- **会话**：每个 Registration 一个隔离的浏览器上下文，只在内存里，从不落盘，也不进 git。一个会话同一时间只有一个驱动者：填表运行、普通代码，或在 Takeover 中的这个人。它在以下时候关闭：
  - 有了任何结果时；
  - 普通代码打开验证链接之后立即关闭；
  - 24 小时没有进展之后，也就是 24 小时内没有任何针对这个会话的请求：机器人自己的 24 小时规则会先关掉它，所以这一条兜住的是机器人丢掉的会话；
  - 其中某个动作耗时超过 60 秒时，因为它的页面卡死了。

  同时最多开着 5 个。最后两种关闭在 [在浏览器服务中驱动一个 Registration 会话](https://github.com/ultrasadness/lab1/issues/55) 中决定。
- **Product 网站**（为 Dossier 而读）通过一个用完即弃的上下文里的只读 `read(url)` 读取，快照脱敏方式相同。每个注册页面在准备它的 Walkthrough 时（在任何 Approval 之前）也是这样读取的。这次读取给 Walkthrough 提供字段、注册 URL 和主机，以及页面加载时就能看到的 Wall。注入的文本仍可能让 Dossier 或 Skip 产生偏差，而它们的引用让这个人能够核查。有一个请求不是读取：当对 Product Hunt 跳转的读取停在机器人检测上时，普通代码从服务的网络对这个 URL 发一个 HEAD，不跟随任何跳转，再像读取其他页面一样读取得到的地址（在 [当浏览器读取停在机器人检测上时，用 HEAD 读取 Product Hunt 的跳转](https://github.com/ultrasadness/lab1/issues/101) 中决定）。
- **容器**：
  - 按 digest 固定的 Playwright arm64 镜像，以非 root 的 `pwuser` 身份在 Xvfb 下有界面地运行 Chrome for Testing，并使用 Playwright 的 seccomp 配置，让 Chromium 的沙箱开启。没有沙箱时，服务拒绝启动。
  - 除 `SYS_CHROOT` 外去掉所有 capability；Chromium 的命名空间沙箱需要它：没有它，沙箱的 zygote 进程在启动时就会退出。另外还有 `no-new-privileges`。
  - 只读的根文件系统，`/tmp` 用 tmpfs，home 目录归 `pwuser` 所有；home 目录归 root 所有时，Chrome 的崩溃处理程序会在启动时中止浏览器。用 `--shm-size` 代替 `--ipc=host`。
  - 在每个上下文里：关闭下载、权限请求、密码保存和自动填充。
  - 不管 Walkthrough 怎么说，支付字段（`autocomplete` 值为 `cc-*` 的字段，或支付服务商 frame 里的字段）一律拒绝。
  - 它不持有 Gmail、Discord、Bitwarden 或 new-api 的任何令牌。它里面唯一的令牌是 Takeover 链接的令牌。
- **网络**：只能访问公共互联网。宿主机防火墙封锁私有地址段、Tailscale 的地址段、链路本地地址（包括 Oracle 的实例元数据）、宿主机自己的服务以及 IPv6 本地地址段。Takeover 视图只能通过 `tailscale serve` 访问，用一个独立的 HTTPS 端口，因为 tailnet 的根路径已经在服务另一个应用。
- **Takeover**（在 [哪种 Takeover 形式能在 iPhone 上用：noVNC 还是 Playwright 的 Dashboard？](https://github.com/ultrasadness/lab1/issues/21) 中找到）：用上游的 noVNC（1.7.0），而不是 Ubuntu 的 1.0.0。
  - 每个 Registration 的浏览器运行在它自己的 Xvfb display 上，配有自己在 localhost 上的 VNC 服务器，所以一个视图只显示那一个会话。一个 websockify 提供 noVNC，并按令牌把每个连接路由到一个 display。
  - 令牌在这个人点按 Take over 时生成，在 **Continue**、**I submitted** 和 24 小时关闭时删除，同时那个 display 的 VNC 服务器会重启，让已打开的视图断开。被撤销的链接无法重新连接。
  - 链接总是带 `https://`，因为这个端口只讲 HTTPS。
  - 浏览器服务通过它自己的 Playwright 连接看到这个人的提交，和 Product 的服务器收到它在同一秒，所以 [ADR 0007](./0007-live-state-in-sqlite-and-an-uncertain-step-counts-as-done.zh.md) 的验证窗口可以以它为起点。
  - 窗口是常见的桌面尺寸（1280x800）。手机形状的窗口也能用（Chrome 最窄为 500 DIP），但对桌面 Chrome 来说，以这种形状去面对机器人检测显得古怪。
  - 输入需要用 noVNC 的键盘按钮：在视图里点按字段不会弹出 iOS 键盘。
- **打补丁**：Chrome for Testing 只随 Playwright 更新。每次 Playwright 发布后一周内重建浏览器镜像，门禁是针对一个本地测试表单的填表冒烟测试，而不是 Rule 延续检查。这为这一个镜像细化了 [ADR 0001](./0001-pi-in-a-container-behind-the-gateway.zh.md) 的升级规则。
