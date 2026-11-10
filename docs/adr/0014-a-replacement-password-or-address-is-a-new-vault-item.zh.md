# 替换用的密码或地址是一个新的 vault 条目，结果只写进 `registration.md`

[English](0014-a-replacement-password-or-address-is-a-new-vault-item.md) | 中文

[ADR 0004](./0004-random-passwords-in-a-bitwarden-collection-the-person-owns.zh.md) 让 Assistant 在 Approval 时创建一个 vault 条目，并且从不修改或删除条目。它还让拒绝密码的表单在同一个 Approval 之内得到一个新密码，在 `+` 被拒绝时把用户名换成不带加号的地址，并把 _abandoned_ 的 Registration 的结果写进它的条目备注。不修改条目的话，这三件事都没法对 Approval 时创建的条目做。所以每次替换都是一个新条目，结果只写进 `registration.md`。在 [填写并按下一个干净的 Registration](https://github.com/ultrasadness/lab1/issues/56) 中决定。这收窄了 ADR 0004，它的其余部分保持不变；也收窄了 [ADR 0006](./0006-registration-browser-in-its-own-container-driven-through-fixed-actions.zh.md) 的每页一次填表运行。

## 考虑过的方案

- **机器人在结果出来之前修改它自己这个 Registration 的条目**：每个 Product 只有一个条目，而且总是对的，备注也能写结果。目前不采用：这会是机器人第一次修改条目，改错了会落在一个已经在用的密码上，而只创建更简单。如果同一个网站的两个条目在实际使用中让自动填充（AutoFill）混乱，这就是备选方案。
- **等表单接受密码之后才创建条目**：不会留下过时的条目，但填表期间密码只存在于机器人的内存里，而 Handoff 需要在填写任何表单之前就有这个条目。

## 后果

- **拒绝密码的表单**会得到一个新条目，里面是更窄的密码：只含字母和数字，24 个字符；如果表单连这个也拒绝，就用 16 个字符。同一页最多重新填写两次。
- **拒绝 `+` 的表单**会得到一个新条目，用户名是不带加号的地址，前提是 Walkthrough 有密码字段。它沿用页面上已有的密码，所以不管表单拒绝的是哪个字段，账号的密码都是新条目里的那个。没有密码字段时就没有条目，只换地址。
- **这一页会重新填写**，仍在同一个 Approval 之下。下一次填表运行必须先重新填写被拒绝的字段，普通代码才会接受它点名的按钮，因为页面上可能还留着被拒绝的内容；这一页总共最多 3 次填表运行。
- **每个新条目的备注**写明它替换的是哪个条目，以及原因，比如 “Replaces item … : the form refused its password.”。它的名字和网站与第一个条目相同。
- **第一个条目会留下。** 密码被拒绝之后，它里面的密码没有任何账号在用；`+` 被拒绝之后，它里面是账号的密码，旁边却是表单拒绝了的地址。这个人想删时在 Bitwarden 里删掉它，在那之前自动填充会为这个网站给出两个条目。
- **`registration.md`** 在每一行 approved 里写明当时存放密码的条目，并为每次替换写一行，写明两个条目。
- **结果从不写进条目的备注。** `registration.md` 记着它，_abandoned_ 的 Registration 的条目保持创建时的样子。
- **替换条目只创建一次。** 机器人在请求 `bw` 之前，先把它的备注存进实时存储，创建之前先在 Password vault 里找带这些备注的条目，就像 [ADR 0007](./0007-live-state-in-sqlite-and-an-uncertain-step-counts-as-done.zh.md) 对第一个条目的做法。
- **机器人怎样得知被拒绝：** 只从填表运行得知。它读页面自己的文字，以 `finish(stuck)` 和原因 `password-refused` 或 `plus-refused` 结束。只在最后一次按下之后才出现的拒绝不会被发现，因为那时没有模型再读页面。备选方案是：如果看到一个表单只通过浏览器自己的校验拒绝、没有任何文字，停在没通过的检查上，就把页面检查在那个字段上的 `invalid` 也当作一次拒绝。
