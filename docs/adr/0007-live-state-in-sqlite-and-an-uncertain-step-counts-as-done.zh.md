# 实时状态是一个只由机器人写入的 SQLite 存储，不确定的步骤算作已完成

[English](0007-live-state-in-sqlite-and-an-uncertain-step-counts-as-done.md) | 中文

随着工作推进而变化的一切，都保存在 VM 上的一个 SQLite 文件里，就在 git 跟踪的 Personal database 旁边：邮件台账和 Gmail 的 `historyId`、每个 Launch 的评判结论、每个 Registration 和 Reply draft 的当前状态、Approval，以及保证某个步骤只发生一次的标记。机器人是它唯一的写入者，它也是这些状态唯一的事实来源。git 里的 Personal database 以可读的文字行记录每个 Registration 的历史，由机器人在里程碑（已批准、已提交、结果）处写入。课程要求用 Markdown 做 Personal database，所以读者会以为台账在那里。但 Registration 等待验证时每隔几秒就变一次的状态，意味着每次都要提交一次。而且按 [ADR 0002](./0002-rules-are-files-proven-by-their-own-case.zh.md) 的提交锁，历史分叉时机器人会停止提交，所以一次误入的 git 编辑就会冻结台账，让 Assistant 停摆。在 [Registration 和 Reply draft 的状态如何流转，如何防止重复处理？](https://github.com/ultrasadness/lab1/issues/11) 中决定。

## 考虑过的方案

- **一切都放在 git 跟踪的 Personal database 里，每次变化一个提交**：这个人可以就地读到每个状态。否决，因为提交量太大，而且历史一旦分叉就会停下所有工作，而不只是 Rule 的编辑。
- **状态作为 YAML front matter，这个人可在 git 里编辑，由机器人读回**：每次编辑都得对照状态机检查，而手工编辑的状态可能跳过一个只能发生一次的步骤。改为由这个人在 Discord 上更改 Registration 的状态。

## 后果

- **Markdown 记录是一个视图。** 机器人根据存储写出它，从不从 git 读回状态编辑。Personal database 里每个 Product 的文件夹把它存为 `registration.md`，放在 Dossier 的 `dossier.md` 旁边。这个人的自由文本备注放在第三个文件 `notes.md` 里，机器人只创建它一次、此后不再写入，所以机器人写的任何东西都碰不到这些备注。在 [Dossier 在它的 Product 帖子里怎么呈现，又如何保存在 git 里？](https://github.com/ultrasadness/lab1/issues/33) 中决定，取代了本 ADR 最初记录的备注小节。每个 Miner 日也有同样的视图 `days/<YYYY-MM-DD>.md`：Day's line，以及每个 Featured Launch 一行，Correction 改变这一天时重写。机器人写进 Personal database 的每个日期都带年份（`2026-10-14 08:12 PT`），这样 Question 就能按日期筛选。这两点都在 [这个人如何从 Discord 向 Personal database 提问？](https://github.com/ultrasadness/lab1/issues/37) 中决定。
- **只能发生一次的步骤先记后做。** 普通代码在按下按钮、打开验证链接或发送 Reply draft 之前，先写一个 _intended_ 标记（条目、步骤、页面或已批准字节的指纹），然后执行，再写 _done_。
- **不确定的步骤算作已完成，并且从不自动重试。** 重启或超时之后，有 _intended_ 而没有 _done_，就意味着账号可能已经存在。按下就算已按下，Registration 进入等待验证。会告诉这个人哪里不确定。发送能读回结果：如果邮件线程里没有新的 `SENT` 消息，而且草稿仍是已批准的那封，那它就没有发出，可以再发。创建 vault item 也能读回：条目里有密码唯一的一份，机器人也需要它的 id；Password vault 能看出条目在不在，不在时才新建（[#54](https://github.com/ultrasadness/lab1/issues/54)）。结束时这个人没有说明什么都没提交的 Takeover，也算作已提交。[ADR 0006](./0006-registration-browser-in-its-own-container-driven-through-fixed-actions.zh.md) 的规则（浏览器服务重启后，最后一个按钮已被按下的 Registration 等待这个人在 Gmail 里点按）也出于同样的理解。
- **不确定的按下由这个人的话来定，普通代码从不定。** 在 Takeover 中，**Continue** 表示没有创建账号，即使之前有一次被 Product 明显拒绝了的按下。这时 Registration 回到页面检查，下一次按下得到一个新的 _intended_ 标记。如果最后一次按下 10 秒后，同一个 URL 上仍显示同一个表单，普通代码只是告诉这个人，并附上 **Take over** 和 **Hand off**。状态不会自行改变。在 [Registration 遇到 Wall 时会怎样，处于边界的页内操作又归哪边？](https://github.com/ultrasadness/lab1/issues/10) 中决定。
- **Approval 以条目和版本哈希为键**，在存储中唯一，并带有 Discord 用户 id、交互 id 和时间。对已批准版本的第二次点按什么也不做，对旧版本的点按会被拒绝。
- **邮件和 Launch 按各自的键只处理一次**：台账按 Gmail 消息 ID，在存储的 `historyId` 前进之前写入；Launch 按 Product Hunt 的 Post id；Product 按根域名。
- **一封邮件的处置最多变动一次，而且只能从等待中的处置变动。** _Unmatched_、_held_（超出上限、quiet，或不在 Following 中）和 _not handled_（已停止或在等待）各自只能变动一次，变为最终处置，途径是 **From a Product…**、**Read it**，或者 **Retry** 或某条路线恢复。每次变动都新增一行，记下时间和原因，不覆盖任何东西。普通代码在邮件到达时设定扣留原因，之后从不复查，所以重新 Following 某个 Product 不会放出任何已扣留的邮件。在 [写规格之前还有什么要决定？](https://github.com/ultrasadness/lab1/issues/40) 中决定。
- **如果存储丢失**，Assistant 从当前的 Gmail `historyId` 开始，把所有更早的邮件都当作已经看过。漏掉一封邮件比处理两次更安全。备份这个文件属于让 Assistant 持续运行的工作。
- **为 Rule 用例保留 90 天的原始输入**以普通文件的形式放在存储旁边，由存储建立索引，不进 git。
