# 会成长的个人助理

[English](CONTEXT.md) | 中文

一个持续为一个人工作的个人助理：它在 Product Hunt 上留意符合这个人兴趣的新产品，为每个值得的产品准备账号注册，处理注册带来的邮件，并在做任何有后果的事之前先问这个人。它把这个人的纠正变成下次就会应用的规则，以此成长。

## 术语

### 发现

**Product**：
有人做出来、你可以拿来用的软件或在线服务，不论是否需要账号：每个网站或每家公司算一个。硬件，以及没有可用之物的公告，都不是 Product。
_避免使用_：App、tool、startup

**Launch**：
一个 Product 在某一天于 Product Hunt 上的一次亮相。一个 Product 可以有多个 Launch，但最多只有一个 Registration。
_避免使用_：Post、listing

**Featured Launch**：
Product Hunt 放进当天主榜单的 Launch。某一天的大多数 Launch 都上不了主榜单，而 Miner 只评判 Featured Launch。
_避免使用_：Top post、homepage launch

**Maker comment**：
Product 自己的制作者在它的 Launch 下发的评论；Offer 常常出现在这里。
_避免使用_：First comment、founder comment

**Offer**：
Product 为注册或付费给出的优于平常的条件，比如折扣、额度（credits）或更长的免费套餐；有优惠码、截止日期或名额上限时，也包括在内。
_避免使用_：Coupon、deal、promo

**Interest scope**：
这个人明确说出的偏好，每个 Launch 都对照它来评判。
_避免使用_：Preferences、filters、tags

**Fit**：
一个 Launch 与 Interest scope 的契合程度，用 0 到 10 的整数表示，只根据这个 Launch 本身评判。
_避免使用_：Score、relevance、rating

**Day's line**：
在某个太平洋时间日里能得到 Dossier 的最低 Fit：当天排第 N 的 Launch 的 Fit，N 随当天 Featured Launch 的数量增加，但这条线从不低于一个固定的下限。它在一整天都评判完之后才划定，Correction 从不移动它。
_避免使用_：Threshold、cutoff、quota

**Miner**：
Assistant 中把一天的 Launch 变成 Dossier 或 Skip 的那一部分。
_避免使用_：Scraper、crawler

**Skip**：
Miner 给出的一句话理由，说明为什么不为某个 Launch 准备 Dossier，通常会写出它的 Fit 和 Day's line。Skip 的存在，就是为了让人能纠正它。

**Dossier**：
Assistant 为一个 Product 写的档案：它是开放注册还是要排队等候（waitlist）、怎么注册、有哪些 Offer、它的范围，以及对这个人可能的用处。每一条说法都注明来源。
_避免使用_：Report、summary、notes

### 行动

**Walkthrough**：
交给这个人做 Approval 的具体注册方案：填哪些字段、填什么值、用哪个 Signup identity、接受哪些条款，以及提交时会发生什么。
_避免使用_：Plan、proposal、guide

**Approval**：
这个人明确说“是”，对象是以下三者之一：一份确切的 Walkthrough，允许 Assistant 准备这个 Registration，并在填好的表单与展示过的内容一致时提交；一份确切的已填表单，允许 Assistant 提交它；或一份确切的 Reply draft。它只覆盖展示过的内容。
_避免使用_：Confirmation、consent、OK

**Registration**：
为一个 Product 创建账号这件事（从它的 Approval 算起）及其结果：_registered_（已注册）、_waitlisted_（排队中）、_handed off_（已转为 Handoff）或 _abandoned_（已放弃）。一个 Product 最多有一个。排队中的 Registration 后来收到邀请、已转为 Handoff 的 Registration 收到验证邮件、或这个人重新开始一个已放弃的 Registration，都是同一个 Registration 在往前推进。
_避免使用_：Signup、account creation、onboarding

**Wall**：
Registration 中光靠填入已批准的值过不去的东西，比如机器人检测、只能通过另一个账号登录、手机验证或银行卡字段。遇到 Wall 的 Registration 会转为 Takeover 或 Handoff，或者被放弃。
_避免使用_：Blocker、obstacle、CAPTCHA（单独使用时）

**Takeover**：
这个人用手机实时接管 Assistant 的浏览器会话，以越过一个 Wall。
_避免使用_：Remote control、screen share

**Handoff**：
把 Registration 剩下的部分交给这个人在自己的设备上完成，并附上完成它所需的东西。
_避免使用_：Escalation、fallback

**Following**：
Registration 有了结果之后，Assistant 对这个 Product 的持续关注：处理这个 Product 的邮件，并把它之后的 Launch 加进 Dossier。过一段时间，处于 Following 中的 Product 会变得 **quiet**，此后只有它的非推广邮件还会到达 Assistant。排队中的 Product 永远不会变 quiet。这个人可以让一个 Product 保持完整的 Following，也可以停止 Following 它。
_避免使用_：Tracking、monitoring、subscription

**Signup identity**：
一个 Registration 使用的名字和邮箱地址。这个地址总是投递到 Signup mailbox。
_避免使用_：Account、alias、persona

**Signup mailbox**：
专门留给 Registration 用的邮箱。每个 Signup identity 的地址都投递到这里，它也是 Assistant 唯一读取的邮箱。
_避免使用_：Inbox、signup Gmail、registration account

**Reply draft**：
Assistant 为某个 Product 发来的邮件准备的回复，依据邮件往来和 Personal database 写成；只有这个人批准的最终版本才会发出。
_避免使用_：Response、message

**Hard limit**：
Assistant 绝不会做的事，即使当下得到了 Approval 也不做。
_避免使用_：Guardrail、policy

**Secret**：
谁持有它，谁就能以这个人或 Assistant 的身份行事的值：密码、验证码、魔法链接或重置链接、访问令牌，或 Assistant 自己的某个密钥。Assistant 从不把 Secret 放进模型的输入或发给这个人的消息里，哪怕是很快过期的验证码也不行；Secret 必须进入表单时，按引用填入。它和 Profile 排除在外的敏感数据不是一回事。
_避免使用_：Credential、sensitive data

**Password vault**：
这个人的密码管理器里存放每个 Registration 密码的那个集合。Assistant 往里添加密码，并按引用从中填入；这个人在自己的设备上查看它，Registration 完成后也只有这个人会改密码。Personal database 从不保存 Secret，只指向 Password vault 里的条目。
_避免使用_：Keychain、password store、vault（单独使用时）

### 记忆

**Personal database**：
这个人的事实，以及 Assistant 关于这个人的记录，存放在这个人能直接查看和编辑的地方。
_避免使用_：Knowledge base、memory、vault

**Question**：
这个人就 Personal database 提出的问题，只根据它来回答，每一条说法都指向它出自的那几行。
_避免使用_：Query、chat、conversation

**Profile**：
关于这个人的日常事实：这个人用的名字，以及要用的邮箱地址。这个人的日常邮箱地址在这里是一条事实，绝不是 Signup identity。刻意不包含敏感数据。
_避免使用_：User info、bio

**Correction**：
这个人告诉 Assistant 它哪里做错了。Correction 总会修正它所针对的那一项，也可能改变 Interest scope，或成为一条 Rule。
_避免使用_：Feedback、complaint

**Rule**：
关于 Assistant 应该如何工作的一般性陈述，从 Correction 中得出，只有在这个人同意后才保留，之后的每次会话都会应用。关于这个人的事实永远不是 Rule；它们属于 Profile。
_避免使用_：Memory、preference、instruction
