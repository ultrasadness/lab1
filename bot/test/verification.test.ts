// Verifying a Registration (#58): while it waits for verification, plain code fills the emailed code, or opens the
// link, by reference, only when Gmail's own check shows DMARC pass for the Product's domain, the mail came within 1
// minute of the final press, and it holds exactly one code or link. Any other mail is put to the person to tap in
// Gmail, and its arrival makes the Registration *registered* all the same. Each test reads what the browser, Gmail,
// Discord, GitHub and the bot's log saw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEEDS_YOU, PERSON, PRODUCTS_FORUM, SIGNUP_MAILBOX, type World } from './harness/world.ts';
import { until } from './harness/miner-day.ts';
import { approve, walkthroughPut, WITH_PASSWORD } from './harness/walkthrough-day.ts';
import { whoReceived } from './harness/secrets.ts';
import type { FakePage } from './harness/fake-browser.ts';
import type { Mail } from './harness/fake-gmail.ts';
import { updateOf, type SeenMessage } from './harness/fake-discord.ts';

const SIGNUP = WITH_PASSWORD.signup!;
const PLUS_ADDRESS = 'you+codemind@gmail.com';
const SUBMITTED = 'submitted 01:00 PT Mon Oct 12';

/** The page the final press leads to: one field for the emailed code, and Verify. */
const VERIFY: FakePage = {
  url: 'https://app.codemindhq.dev/verify',
  title: 'Check your email',
  text: `We sent a code to ${PLUS_ADDRESS}.`,
  forms: [
    {
      formElement: true,
      action: null,
      method: 'post',
      fields: [{ type: 'text', name: 'code', label: 'Code from your email', required: true, autocomplete: 'one-time-code', links: [] }],
      submits: [{ label: 'Verify', disabled: false }],
      links: [],
    },
  ],
  next: 'https://app.codemindhq.dev/welcome',
};
const WELCOME: FakePage = { url: 'https://app.codemindhq.dev/welcome', title: 'Welcome', text: 'Your account is ready.' };

/** When the final press is done: the time `walkthroughPut` leaves the clock at, which the Approval doesn't move. */
const PRESSED_AT = '2026-10-12T08:00:00.000Z';
/** A time this many seconds after the final press. */
const after = (seconds: number) => new Date(Date.parse(PRESSED_AT) + seconds * 1000).toISOString();

const CODE = '482913';

/** Codemind's verification mail, with its code, received this many seconds after the final press. */
const codeMail = (seconds: number, change: Partial<Mail> = {}): Mail => ({
  from: 'Codemind <hello@codemindhq.dev>',
  to: PLUS_ADDRESS,
  subject: 'Your Codemind verification code',
  text: `Your verification code is ${CODE}. It expires in 10 minutes.`,
  receivedAt: after(seconds),
  ...change,
});

type Start = NonNullable<Parameters<typeof walkthroughPut>[2]>['start'];

/** Codemind's Walkthrough put to the person, its final press leading to `verifyPage`. */
function put(t: { after(fn: () => Promise<void>): void }, verifyPage: FakePage = VERIFY, start?: Start): Promise<World> {
  return walkthroughPut(t, { ...WITH_PASSWORD, signup: { ...SIGNUP, next: verifyPage.url } }, {
    start,
    before: (w) => {
      w.browser.page(verifyPage);
      w.browser.page(WELCOME);
    },
  });
}

/** Codemind's Walkthrough approved, and its Registration waiting for verification on the page its final press led to. */
async function awaiting(t: { after(fn: () => Promise<void>): void }, verifyPage: FakePage = VERIFY, start?: Start): Promise<World> {
  const world = await put(t, verifyPage, start);
  // The Walkthrough's card, which a card about the Gmail token may come before.
  const card = world.discord.cards(NEEDS_YOU).find((c) => c.buttons.some((b) => b.label === 'Approve'))!;
  await world.discord.tap({ userId: PERSON, customId: card.buttons.find((b) => b.label === 'Approve')!.customId, channelId: NEEDS_YOU, messageId: card.id });
  await world.assistant.whenIdle();
  assert.equal(world.clock.now().toISOString(), PRESSED_AT);
  return world;
}

/** Delivers a mail to the Signup mailbox, then moves the clock 5 s past its receipt, for the bot's next read. */
async function deliver(world: World, mail: Mail): Promise<string> {
  const id = world.gmail.deliver(mail);
  await world.advanceTo(new Date(Date.parse(mail.receivedAt!) + 5000).toISOString());
  return id;
}

/** The Registration's status message in the Product's post, as the person now sees it. */
function statusOf(world: World): SeenMessage {
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  return post!.messages.find((m) => m.text.startsWith('**Registration**'))!;
}

/** What the status message says the Registration is doing: what follows `**Registration** · `, up to the Approval. */
const standing = (world: World) => statusOf(world).text.split(' · Walkthrough v')[0]!.replace('**Registration** · ', '');

const registrationFile = (world: World) => world.git.file('products/codemindhq.dev/registration.md')!;
const logged = (world: World, event: string) => world.logs.filter((l) => l.event === event);
const tags = (world: World) => world.discord.forumPosts(PRODUCTS_FORUM)[0]!.tags;
/** The presses the pages received after the final one, Create account. */
const verifyPresses = (world: World) => world.browser.presses.slice(1).map(({ url, button, values }) => ({ url, button, values }));

test('a code 40 s after the final press, from the Product with DMARC pass, is filled by reference and Verify pressed: the Registration is registered', async (t) => {
  const world = await awaiting(t);
  const cards = world.discord.cards(NEEDS_YOU).length;

  const id = await deliver(world, codeMail(40));

  assert.deepEqual(verifyPresses(world), [{ url: VERIFY.url, button: 'Verify', values: { code: CODE } }]);
  assert.equal(standing(world), `${SUBMITTED} · verified · **registered**`);
  assert.deepEqual(tags(world), ['registered']);
  assert.match(registrationFile(world), /^- 2026-10-12 01:00 PT · verified: plain code filled the emailed code and pressed "Verify"$/m);
  assert.match(registrationFile(world), /^- 2026-10-12 01:00 PT · \*\*registered\*\*$/m);
  assert.equal(world.browser.openSessions.length, 0, 'its session is closed');
  assert.equal(world.discord.cards(NEEDS_YOU).length, cards, 'nothing is put to the person');
  assert.deepEqual(
    logged(world, 'registration.verification-mail').map(({ productId, messageId, delaySeconds, way }) => ({ productId: typeof productId, messageId, delaySeconds, way })),
    [{ productId: 'number', messageId: id, delaySeconds: 40, way: 'code' }],
  );
  // The code reached the browser by reference alone.
  assert.deepEqual(whoReceived(world, CODE), []);
  assert.ok(!JSON.stringify(world.logs).includes(CODE), 'no log line holds the code');
  assert.deepEqual(world.gmail.changes, [], 'nothing in the mailbox changed');
});

/** The page a final press leads to when the Product sends a link: nothing to fill. */
const CHECK_EMAIL: FakePage = { url: 'https://app.codemindhq.dev/check-email', title: 'Check your email', text: `We sent a link to ${PLUS_ADDRESS}.` };
const LINK = 'https://app.codemindhq.dev/verify-email?token=Qm3xZ8pL2vR9tN4kW7yBc5';

/** Codemind's verification mail, with its link, received this many seconds after the final press. */
const linkMail = (seconds: number, change: Partial<Mail> = {}): Mail => ({
  from: 'Codemind <hello@codemindhq.dev>',
  to: PLUS_ADDRESS,
  subject: 'Confirm your Codemind address',
  text: `Confirm your address: ${LINK}\nThe link expires in 10 minutes.`,
  receivedAt: after(seconds),
  ...change,
});

test('a link 40 s after the final press, from the Product with DMARC pass, is opened by reference, and the session closes: the Registration is registered', async (t) => {
  const world = await awaiting(t, CHECK_EMAIL);
  world.browser.page({ url: LINK, title: 'Address confirmed', text: 'Your address is confirmed.' });
  const [session] = world.browser.sessions;

  await deliver(world, linkMail(40));

  assert.deepEqual(world.browser.linksOpened, [{ registration: session!.registration, url: LINK }]);
  assert.deepEqual(verifyPresses(world), [], 'nothing is pressed');
  assert.equal(standing(world), `${SUBMITTED} · verified · **registered**`);
  assert.deepEqual(tags(world), ['registered']);
  assert.match(registrationFile(world), /^- 2026-10-12 01:00 PT · verified: plain code opened the verification link$/m);
  assert.equal(world.browser.openSessions.length, 0, 'the session closed once the link was opened');
  assert.deepEqual(logged(world, 'registration.verification-mail').map((l) => [l.delaySeconds, l.way]), [[40, 'link']]);
  assert.deepEqual(whoReceived(world, LINK), []);
  assert.ok(!JSON.stringify(world.logs).includes('Qm3xZ8pL2vR9tN4kW7yBc5'), 'no log line holds the link');
});

/** The latest card in #needs-you. */
const lastCard = (world: World) => world.discord.cards(NEEDS_YOU).at(-1)!;

/** The person taps Done on the latest card in #needs-you. */
function tapDone(world: World) {
  const card = lastCard(world);
  const done = card.buttons.find((b) => b.label === 'Done')!;
  return world.discord.tap({ userId: PERSON, customId: done.customId, channelId: NEEDS_YOU, messageId: card.id });
}

/** The card that puts the verification mail to the person, as they see it, said why. */
const verifyCard = (why: string, spam = '') =>
  `<@${PERSON}> **Verify Codemind in Gmail**\n` +
  `Codemind's verification mail came 01:01 PT Mon Oct 12${spam}. The Assistant didn't use it: ${why}. ` +
  'Open it in Gmail and tap its link or enter its code. If that has expired, log in to Codemind as you+codemind@gmail.com, with the password AutoFill gives you, and have it send a new one. ' +
  'The Registration counts as registered. See <#';

test('a mail 70 s after the final press is put to the person to tap in Gmail, its arrival makes the Registration registered, and Done shrinks the card', async (t) => {
  const world = await awaiting(t);

  await deliver(world, codeMail(70));

  assert.deepEqual(verifyPresses(world), [], 'plain code fills and presses nothing');
  const card = lastCard(world);
  assert.ok(card.text.startsWith(verifyCard('it came 70 s after the form was submitted, more than 1 minute')), card.text);
  assert.deepEqual(card.mentions, [PERSON]);
  assert.deepEqual(card.buttons.map((b) => b.label), ['Done']);
  assert.ok(!card.text.includes(CODE), 'the card holds no code');
  assert.equal(standing(world), `${SUBMITTED} · **registered** · verify it in Gmail`);
  assert.match(statusOf(world).text, /The Assistant didn't use it: it came 70 s after the form was submitted, more than 1 minute\. A card in <#\d+> asks you to tap it in Gmail\./);
  assert.deepEqual(tags(world), ['registered']);
  assert.match(registrationFile(world), /^- 2026-10-12 01:01 PT · verification mail came, and you verify it in Gmail$/m);
  assert.doesNotMatch(registrationFile(world), /70 s/, 'the Personal database keeps only states and dates from mail (ADR 0010)');
  assert.match(registrationFile(world), /^- 2026-10-12 01:01 PT · \*\*registered\*\*$/m);
  assert.equal(world.browser.openSessions.length, 0, 'its session is closed');
  assert.deepEqual(logged(world, 'registration.verification-mail').map((l) => [l.delaySeconds, l.way]), [[70, 'person']]);

  const reply = await tapDone(world);
  assert.equal(updateOf(reply)?.text, 'Verify Codemind in Gmail · done');
  await world.restart();
  assert.equal(world.discord.cards(NEEDS_YOU).filter((c) => c.text.includes('Verify Codemind in Gmail')).length, 1, 'a restart sends no second card');
});

test("a code with no DMARC pass in Gmail's own check is put to the person, whatever the From header and the sender's own headers say", async (t) => {
  const world = await awaiting(t);

  await deliver(world, codeMail(40, { dmarc: 'fail', senderAuthResults: ['mx.google.com; dmarc=pass (p=REJECT) header.from=codemindhq.dev'] }));

  assert.deepEqual(verifyPresses(world), []);
  assert.ok(lastCard(world).text.startsWith(verifyCard("Gmail's check doesn't show that it came from codemindhq.dev").replace('01:01', '01:00')), lastCard(world).text);
  assert.equal(standing(world), `${SUBMITTED} · **registered** · verify it in Gmail`);
});

test("a code sent through an auth vendor's domain, with DMARC pass for that domain alone, is put to the person", async (t) => {
  const world = await awaiting(t);

  await deliver(world, codeMail(40, { from: 'Codemind <noreply@mail.authvendor.dev>' }));

  assert.deepEqual(verifyPresses(world), []);
  assert.ok(lastCard(world).text.startsWith(verifyCard("Gmail's check shows that it came from mail.authvendor.dev, not codemindhq.dev").replace('01:01', '01:00')), lastCard(world).text);
  assert.deepEqual(logged(world, 'registration.verification-mail').map((l) => l.way), ['person']);
});

test('a mail holding two codes is put to the person, and neither is filled', async (t) => {
  const world = await awaiting(t);

  await deliver(world, codeMail(40, { text: `Your verification code is ${CODE}. Lost it? Your backup code is 771045.` }));

  assert.deepEqual(verifyPresses(world), []);
  assert.ok(lastCard(world).text.startsWith(verifyCard('it holds 2 codes and links, not exactly one').replace('01:01', '01:00')), lastCard(world).text);
  assert.deepEqual(whoReceived(world, '771045'), []);
});

test('a code Gmail filed in Spam is used all the same when it passes the four conditions (settled by the person on #58)', async (t) => {
  const world = await awaiting(t);

  await deliver(world, codeMail(40, { spam: true }));

  assert.deepEqual(verifyPresses(world), [{ url: VERIFY.url, button: 'Verify', values: { code: CODE } }]);
  assert.equal(standing(world), `${SUBMITTED} · verified · **registered**`);
  assert.deepEqual(logged(world, 'registration.verification-mail').map((l) => [l.spam, l.way]), [[true, 'code']]);
});

test('a mail in Spam that plain code doesn\'t use is put to the person, saying it is in Spam', async (t) => {
  const world = await awaiting(t);

  await deliver(world, codeMail(70, { spam: true }));

  assert.deepEqual(verifyPresses(world), []);
  assert.ok(lastCard(world).text.startsWith(verifyCard('it came 70 s after the form was submitted, more than 1 minute', ", and it's in Spam")), lastCard(world).text);
  assert.match(statusOf(world).text, /Its verification mail came 01:01 PT Mon Oct 12, in Spam\./);
  assert.match(registrationFile(world), /· verification mail came, in Spam, and you verify it in Gmail/);
});

test('with no mail 24 hours after the final press the Registration is handed off, never abandoned, and a mail at 25 hours moves it on to registered', async (t) => {
  const world = await awaiting(t);
  const DAY = 24 * 3600;

  await world.advanceTo(after(DAY - 60));
  assert.equal(standing(world), `${SUBMITTED} · awaiting verification`);
  await world.advanceTo(after(DAY));

  assert.equal(standing(world), `${SUBMITTED} · **handed off** · no verification mail yet`);
  assert.match(statusOf(world).text, /No verification mail came within 24 hours of the final press\. The account may exist, so it isn't abandoned/);
  assert.deepEqual(statusOf(world).buttons, []);
  assert.deepEqual(tags(world), ['handed off']);
  assert.match(registrationFile(world), /^- 2026-10-13 01:00 PT · \*\*handed off\*\*: submitted; no verification mail yet$/m);
  assert.doesNotMatch(registrationFile(world), /abandoned/);
  assert.equal(world.browser.openSessions.length, 0, 'its session is closed');
  assert.deepEqual(logged(world, 'registration.handed-off').length, 1);
  // A Handoff card tells the person, with what to do on their own device (settled by the person on #59).
  const handoff = lastCard(world);
  assert.equal(
    handoff.text,
    [
      `<@${PERSON}> **Hand off · Codemind**`,
      'The form was submitted as you+codemind@gmail.com 01:00 PT Mon Oct 12, and no verification mail came within 24 hours. The account may exist.',
      `1. Open https://app.codemindhq.dev/ and log in as \`you+codemind@gmail.com\`, with the password AutoFill gives you from Bitwarden › Registrations › Codemind (item ${world.bitwarden.items[0]!.id}).`,
      "2. If it says your address isn't verified, have it send the verification mail again, and open it in the Signup mailbox's Gmail.",
      '3. If no account was made, sign up there with the values you approved:',
      '- Email: `you+codemind@gmail.com`',
      `- Password: let AutoFill fill it from Bitwarden › Registrations › Codemind (item ${world.bitwarden.items[0]!.id})`,
      '4. Tap **Done** here once the account exists.',
      `-# See <#${world.discord.forumPosts(PRODUCTS_FORUM)[0]!.id}>.`,
    ].join('\n'),
  );
  assert.deepEqual(handoff.buttons.map((b) => b.label), ['Done']);

  await deliver(world, codeMail(DAY + 3600));

  assert.deepEqual(verifyPresses(world), []);
  assert.match(lastCard(world).text, /The Assistant didn't use it: it came 25 hours after the form was submitted, more than 1 minute\./);
  assert.equal(standing(world), `${SUBMITTED} · **registered** · verify it in Gmail`);
  assert.deepEqual(tags(world), ['registered']);
  assert.match(registrationFile(world), /^- 2026-10-13 01:00 PT · \*\*handed off\*\*: submitted; no verification mail yet$/m);
  assert.match(registrationFile(world), /^- 2026-10-13 02:00 PT · \*\*registered\*\*$/m);
  assert.match(world.discord.cards(NEEDS_YOU).find((c) => c.id === handoff.id)!.text, /^✓ Codemind · registered · <#\d+>$/, 'the mail settled what the Handoff card asked');
});

test("a verification mail that came before the bot could read the Signup mailbox is found by the next start's look-back, and too old to use, is put to the person", async (t) => {
  // Until a good token is in place, the bot reads no mail, so the mailbox's history starts after this mail.
  const world = await awaiting(t, VERIFY, { gmail: { emailAddress: 'someone.else@gmail.com' } });
  world.gmail.deliver(codeMail(30));

  world.gmail.emailAddress = SIGNUP_MAILBOX;
  await world.outage(after(2 * 3600));
  await world.assistant.whenIdle();

  assert.deepEqual(logged(world, 'mail.looked-back').map((l) => [l.since, l.found]), [[PRESSED_AT, 1]]);
  assert.deepEqual(verifyPresses(world), [], 'its code has likely expired, so nothing is filled');
  assert.match(lastCard(world).text, /The Assistant didn't use it: it was 2 hours old when plain code came to use it, more than 2 minutes\./);
  assert.equal(standing(world), `${SUBMITTED} · **registered** · verify it in Gmail`);
  assert.deepEqual(logged(world, 'registration.verification-mail').map((l) => [l.delaySeconds, l.way]), [[30, 'person']]);
});

test('a mail the ledger recorded while the final press was under way is taken once a restart settles the press, and its code is used', async (t) => {
  const world = await put(t);
  world.browser.holdPresses = true;
  await approve(world);
  await until(() => world.browser.presses.length === 1);
  world.gmail.deliver(codeMail(20));
  // The bot reads the mailbox while the press goes unanswered, so the mail is in the ledger before the Registration waits for it.
  world.clock.advanceTo(after(25));
  await until(() => logged(world, 'mail.recorded').length === 1);

  await world.kill();
  world.browser.holdPresses = false;
  await world.restart();
  await world.advanceTo(after(30));

  assert.deepEqual(verifyPresses(world), [{ url: VERIFY.url, button: 'Verify', values: { code: CODE } }]);
  assert.equal(standing(world), `submitted 01:00 PT Mon Oct 12 · verified · **registered**`);
  assert.match(statusOf(world).text, /It isn't known whether the last press went through/);
  assert.equal(logged(world, 'mail.recorded').length, 1, 'the mail is recorded once');
  assert.deepEqual(logged(world, 'registration.verification-mail').map((l) => [l.delaySeconds, l.way]), [[20, 'code']]);
});

test('a press of Verify the bot was killed during counts as done after a restart: never pressed again, and the person is told', async (t) => {
  const world = await awaiting(t);
  world.browser.holdPresses = true;
  world.gmail.deliver(codeMail(40));
  world.clock.advanceTo(after(45));
  await until(() => world.browser.presses.length === 2);

  await world.kill();
  world.browser.holdPresses = false;
  await world.restart();
  await world.advanceTo(after(50));

  assert.deepEqual(verifyPresses(world), [{ url: VERIFY.url, button: 'Verify', values: { code: CODE } }], 'Verify was pressed once, before and after');
  assert.equal(standing(world), `${SUBMITTED} · verified · **registered**`);
  assert.match(statusOf(world).text, /It isn't known whether the verification went through: the bot stopped after marking the step and before hearing that it was done\./);
  const notice = lastCard(world);
  assert.match(notice.text, /An uncertain verification · Codemind/);
  assert.match(notice.text, /The Assistant was filling the emailed code and pressing \*\*Verify\*\*, and doesn't know whether it went through/);
  assert.deepEqual(notice.mentions, [PERSON]);
  assert.match(registrationFile(world), /verified: plain code filled the emailed code and pressed "Verify" · it isn't known whether that went through/);

  await world.restart();
  assert.equal(world.discord.cards(NEEDS_YOU).filter((c) => /An uncertain verification/.test(c.text)).length, 1, 'a restart tells nobody twice');
  assert.equal(world.browser.presses.length, 2);
});

test('a link the bot was killed while opening counts as opened after a restart: never opened again, and the person is told', async (t) => {
  const world = await awaiting(t, CHECK_EMAIL);
  world.browser.page({ url: LINK, title: 'Address confirmed', text: 'Your address is confirmed.' });
  const release = world.browser.pause('/plain-code/open-link');
  world.gmail.deliver(linkMail(40));
  world.clock.advanceTo(after(45));
  await until(() => world.browser.requestsTo('/plain-code/open-link') === 1);

  await world.kill();
  release();
  await until(() => world.browser.linksOpened.length === 1);
  await world.restart();
  await world.advanceTo(after(50));

  assert.equal(world.browser.linksOpened.length, 1, 'the link was opened once, before and after');
  assert.equal(standing(world), `${SUBMITTED} · verified · **registered**`);
  assert.match(lastCard(world).text, /The Assistant was opening the verification link, and doesn't know whether it went through/);
  assert.equal(world.browser.openSessions.length, 0);
});

test('a page that splits the code across one box a digit has no one field for it, so the mail is put to the person and nothing is filled', async (t) => {
  const boxes = Array.from({ length: 6 }, (_, i) => ({ type: 'text', name: `digit${i + 1}`, label: `Digit ${i + 1} of the code`, required: true, autocomplete: null, links: [] }));
  const world = await awaiting(t, { ...VERIFY, forms: [{ ...VERIFY.forms![0]!, fields: boxes }] });

  await deliver(world, codeMail(40));

  assert.deepEqual(verifyPresses(world), []);
  assert.equal(world.browser.requestsTo('/plain-code/fill-code'), 0);
  assert.match(lastCard(world).text, /The Assistant didn't use it: its page shows no one field for the code with one button\./);
  assert.equal(standing(world), `${SUBMITTED} · **registered** · verify it in Gmail`);
});

test('a press of Verify the browser service refuses before it begins takes its mark back, and the mail is put to the person', async (t) => {
  const world = await awaiting(t, { ...VERIFY, forms: [{ ...VERIFY.forms![0]!, submits: [{ label: 'Verify', disabled: true }] }] });

  await deliver(world, codeMail(40));

  assert.deepEqual(verifyPresses(world), []);
  assert.deepEqual(logged(world, 'registration.verify-refused').map((l) => l.kind), ['not-pressable']);
  assert.match(lastCard(world).text, /The Assistant didn't use it: its button was refused \(not-pressable\)\./);
  assert.equal(standing(world), `${SUBMITTED} · **registered** · verify it in Gmail`);
  assert.doesNotMatch(registrationFile(world), /verified: plain code/);
});

test('a mail with no code or link before the code mail is no verification mail: the code mail after it is used (settled by the person on #58)', async (t) => {
  const world = await awaiting(t);
  const welcome = world.gmail.deliver({ from: 'Codemind <hello@codemindhq.dev>', to: PLUS_ADDRESS, subject: 'Welcome to Codemind', text: 'Thanks for joining Codemind.', receivedAt: after(38) });

  await deliver(world, codeMail(40));

  assert.deepEqual(verifyPresses(world), [{ url: VERIFY.url, button: 'Verify', values: { code: CODE } }]);
  assert.equal(standing(world), `${SUBMITTED} · verified · **registered**`);
  assert.deepEqual(logged(world, 'registration.mail-not-verification').map((l) => [l.messageId, l.why]), [[welcome, 'no code or link']]);
});

/** The page a refused code leads to: the code field again, with Resend beside Verify. */
const VERIFY_AGAIN: FakePage = {
  ...VERIFY,
  url: 'https://app.codemindhq.dev/verify?error=expired',
  text: 'That code has expired.',
  forms: [{ ...VERIFY.forms![0]!, submits: [{ label: 'Verify', disabled: false }, { label: 'Resend code', disabled: false }] }],
};

test('a code the Product refuses, its page still asking for it once Verify is pressed, is put to the person', async (t) => {
  // The page refuses whatever code it is given, and shows the field again with a Resend button beside Verify.
  const world = await awaiting(t, { ...VERIFY, next: VERIFY_AGAIN.url });
  world.browser.page(VERIFY_AGAIN);

  await deliver(world, codeMail(40));

  assert.deepEqual(verifyPresses(world), [{ url: VERIFY.url, button: 'Verify', values: { code: CODE } }], 'Verify was pressed once');
  assert.match(lastCard(world).text, /The Assistant didn't use it: the page still asked for the code once "Verify" was pressed, so the Product may have refused it\./);
  assert.equal(standing(world), `${SUBMITTED} · **registered** · verify it in Gmail`);
  assert.doesNotMatch(registrationFile(world), /verified: plain code/);
});

test('a link that doesn\'t load counts as opened, since the Product may have had the request, and the person is told', async (t) => {
  const world = await awaiting(t, CHECK_EMAIL);

  // No page answers at the link.
  await deliver(world, linkMail(40));

  assert.equal(world.browser.linksOpened.length, 1);
  assert.equal(standing(world), `${SUBMITTED} · verified · **registered**`);
  assert.match(lastCard(world).text, /The Assistant was opening the verification link, and doesn't know whether it went through: the link didn't load \(load-failed\), though the Product may have had the request\./);
});

test('a link the browser service refuses before opening it takes its mark back, and the mail is put to the person', async (t) => {
  const world = await awaiting(t, CHECK_EMAIL);

  // A link with a user name and password in it, which the browser service never opens.
  await deliver(world, linkMail(40, { text: `Confirm your address: https://user:pw@app.codemindhq.dev/verify-email?token=Qm3xZ8pL2vR9tN4kW7yBc5` }));

  assert.deepEqual(world.browser.linksOpened, []);
  assert.deepEqual(logged(world, 'registration.verify-refused').map((l) => [l.step, l.kind]), [['link', 'bad-request']]);
  assert.match(lastCard(world).text, /The Assistant didn't use it: the link wasn't opened \(bad-request\)\./);
});

test('a code whose browser session the browser service has lost is put to the person', async (t) => {
  const world = await awaiting(t);
  world.browser.loseSessions();

  await deliver(world, codeMail(40));

  assert.deepEqual(verifyPresses(world), []);
  assert.match(lastCard(world).text, /The Assistant didn't use it: its browser session is closed\./);
  assert.equal(standing(world), `${SUBMITTED} · **registered** · verify it in Gmail`);
});

test('a card Discord refuses is sent again 5 minutes on, once', async (t) => {
  const world = await awaiting(t);
  world.discord.refuseNextMessage(NEEDS_YOU);

  await deliver(world, codeMail(70));
  assert.equal(world.discord.cards(NEEDS_YOU).filter((c) => c.text.includes('Verify Codemind in Gmail')).length, 0, 'Discord refused it');
  await world.advanceTo(after(75 + 5 * 60));

  assert.equal(world.discord.cards(NEEDS_YOU).filter((c) => c.text.includes('Verify Codemind in Gmail')).length, 1);
});

test('a mail deleted from Gmail before plain code reads it again is no verification mail, and the next one is used', async (t) => {
  const world = await awaiting(t);
  const deleted = world.gmail.deliver(codeMail(30, { text: 'Your verification code is 551234.' }));
  // The reader reads it once to record it, and it is gone by the time plain code reads it.
  world.gmail.removeAfterReads(deleted, 1);

  await deliver(world, codeMail(40));

  assert.deepEqual(verifyPresses(world), [{ url: VERIFY.url, button: 'Verify', values: { code: CODE } }]);
  assert.deepEqual(logged(world, 'registration.mail-not-verification').map((l) => [l.messageId, l.why]), [[deleted, 'gone']]);
});

test('a code that grows older than 2 minutes while the browser service is slow to answer is never filled, and is put to the person', async (t) => {
  const world = await awaiting(t);
  const release = world.browser.pause('/session/drive');
  const drives = world.browser.requestsTo('/session/drive');
  world.gmail.deliver(codeMail(40));
  world.clock.advanceTo(after(45));
  await until(() => world.browser.requestsTo('/session/drive') > drives);

  // The browser service answers only once the mail is 125 s old.
  world.clock.advanceTo(after(165));
  release();
  await world.assistant.whenIdle();

  assert.equal(world.browser.requestsTo('/plain-code/fill-code'), 0, 'no code reached the page');
  assert.match(lastCard(world).text, /The Assistant didn't use it: it was 125 s old when plain code came to use it, more than 2 minutes\./);
});

test("a rate-limit reply to plain code's read of a mail holds every Gmail request for as long as it asks", async (t) => {
  const world = await awaiting(t);
  const id = world.gmail.deliver(codeMail(40));
  // The reader's read of it is answered; plain code's read of it is refused, with Retry-After: 60.
  world.gmail.limitAfterReads(id, 1, 60);
  await world.advanceTo(after(45));
  const limitedAt = world.gmail.requests.findLast((r) => r.path === `/messages/${id}`)!.at;

  await world.stepThrough(after(100), 5 / 60);
  assert.deepEqual(world.gmail.requests.filter((r) => r.at > limitedAt).map((r) => r.path), [], 'nothing is asked of Gmail for 60 s');
  await world.stepThrough(after(120), 5 / 60);

  assert.ok(world.gmail.requests.some((r) => r.at > limitedAt), 'Gmail is read again once the 60 s are over');
  assert.deepEqual(verifyPresses(world), [{ url: VERIFY.url, button: 'Verify', values: { code: CODE } }], 'and the code, 65 s old, is used then');
});

test("a page Verify led to that plain code can't read leaves it unknown whether the Product took the code, and the person is told", async (t) => {
  // Verify leads off the Walkthrough's domains, where plain code reads nothing.
  const world = await awaiting(t, { ...VERIFY, next: 'https://elsewhere.example/thanks' });
  world.browser.page({ url: 'https://elsewhere.example/thanks', title: 'Thanks', text: 'Thanks.' });

  await deliver(world, codeMail(40));

  assert.equal(verifyPresses(world).length, 1);
  assert.equal(standing(world), `${SUBMITTED} · verified · **registered**`);
  assert.match(lastCard(world).text, /doesn't know whether it went through: the page "Verify" led to couldn't be read, so it isn't known whether the Product took the code\./);
});

test('a bot killed after pressing Verify and before reading the page it led to reads that page after a restart', async (t) => {
  const world = await awaiting(t, { ...VERIFY, next: VERIFY_AGAIN.url });
  world.browser.page(VERIFY_AGAIN);
  world.gmail.deliver(codeMail(40));
  world.clock.advanceTo(after(45));
  await until(() => world.browser.presses.length === 2);
  // Plain code's read of the page Verify led to is taken and never answered.
  const release = world.browser.pause('/plain-code/snapshot');
  const reads = world.browser.requestsTo('/plain-code/snapshot');
  await until(() => world.browser.requestsTo('/plain-code/snapshot') > reads);

  await world.kill();
  release();
  await world.restart();

  assert.equal(verifyPresses(world).length, 1, 'Verify is never pressed again');
  assert.match(lastCard(world).text, /The Assistant didn't use it: the page still asked for the code once "Verify" was pressed/);
  assert.equal(standing(world), `${SUBMITTED} · **registered** · verify it in Gmail`);
});
