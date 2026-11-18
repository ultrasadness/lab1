// Sorting matched mail (#61): each mail matched to a Registration and within the cap goes to a mail run of the mail
// role, which sees it with its Secrets as placeholders and sorts it into *asks for a reply*, *needs the person* or *for
// the record*. Each kind then gets its own treatment on Discord. Each test reads what the model provider, Discord,
// Gmail and GitHub saw, and the bot's log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NEEDS_YOU, PERSON, PRODUCTS_FORUM, TOKENS, type World } from './harness/world.ts';
import { delivered, PLUS_ADDRESS, registered } from './harness/signup-mail.ts';
import { whoReceived } from './harness/secrets.ts';
import type { Mail } from './harness/fake-gmail.ts';
import { mailSorted, sorted } from './harness/fake-model.ts';
import { popupOf, updateOf, type SeenMessage } from './harness/fake-discord.ts';

/** Codemind's mail to its Signup identity. */
const mail = (change: Partial<Mail> = {}): Mail => ({
  from: 'Codemind <hello@codemindhq.dev>',
  to: PLUS_ADDRESS,
  subject: 'Your first week with Codemind',
  text: 'Here are three tips for your first week. Your sign-in code, should you need it, is 482913.',
  ...change,
});

/** What the bot logged of each mail run's sort. */
const sorts = (world: World) => world.logs.filter((l) => l.event === 'mail.sorted').map(({ messageId, kind }) => ({ messageId, kind }));

/** Codemind's post in the Products forum, the only one, and its messages. */
const thread = (world: World) => world.discord.forumPosts(PRODUCTS_FORUM)[0]!.id;
const postMessages = (world: World) => world.discord.forumPosts(PRODUCTS_FORUM)[0]!.messages;

test('mail for the record goes to a mail run of the mail role, which sees it with its Secrets as placeholders and its Registration, and gets no message of its own', async (t) => {
  const world = await registered(t, 'logged-in');
  const cards = world.discord.cards(NEEDS_YOU).length;
  const messages = postMessages(world).length;
  const [id] = await delivered(world, mail());
  await world.assistant.whenIdle();

  const [run, ...more] = world.model.mailRuns;
  assert.equal(more.length, 0, 'one mail run');
  assert.match(run!.prompt, /Here are three tips for your first week\. Your sign-in code, should you need it, is \[code 1\]\./);
  assert.match(run!.prompt, /Your first week with Codemind/);
  assert.match(run!.prompt, /hello@codemindhq\.dev/);
  assert.match(run!.prompt, /Root domain: codemindhq\.dev/);
  assert.match(run!.prompt, /Its Registration is registered/);
  const requests = world.model.requests.filter((r) => r.tools.includes('record_mail'));
  assert.ok(requests.length > 0);
  for (const r of requests) {
    assert.equal(r.model, 'mail@openrouter', 'only through the mail role’s names');
    assert.equal(r.authorization, `Bearer ${TOKENS.mailKey}`, 'with the mail role’s own key');
  }
  assert.deepEqual(whoReceived(world, '482913'), [], 'the code reaches no model and no Discord message');
  assert.deepEqual(sorts(world), [{ messageId: id, kind: 'for-the-record' }]);
  assert.equal(world.discord.cards(NEEDS_YOU).length, cards, 'no card');
  assert.equal(postMessages(world).length, messages, 'and no message in its Product post');
});

/** The buttons on a message, in a row or beside a line, by label. */
const labels = (message: SeenMessage) => [...message.lines.flatMap((l) => (l.button ? [l.button] : [])), ...message.buttons];

/** The person taps a button on a message. */
function tap(world: World, channelId: string, message: SeenMessage, label: string) {
  const b = labels(message).find((x) => x.label === label);
  assert.ok(b, `${label} is on the message`);
  return world.discord.tap({ userId: PERSON, customId: b.customId, channelId, messageId: message.id });
}

test('mail that needs the person gets a card in #needs-you that mentions them and says what it wants done; Done shrinks it to a line, and an untouched one lapses after 14 days', async (t) => {
  const world = await registered(t, 'logged-in');
  const cards = world.discord.cards(NEEDS_YOU).length;
  world.model.mail = (run) =>
    /New sign-in/.test(run.prompt)
      ? mailSorted('needs-the-person', { gist: 'A new sign-in', wants: 'Confirm the new sign-in from Mac' })
      : mailSorted('needs-the-person', { gist: 'Trial ends', wants: 'Pick a plan before the trial ends on Nov 30' });
  await delivered(world, mail({ subject: 'New sign-in to Codemind', text: 'Was this you? A new sign-in from Mac.' }));
  await world.assistant.whenIdle();

  const [card] = world.discord.cards(NEEDS_YOU).slice(cards);
  assert.equal(
    card!.text,
    `<@${PERSON}> **Mail from Codemind needs you**\nConfirm the new sign-in from Mac\n-# From Codemind (\`hello@codemindhq.dev\`) · “New sign-in to Codemind” · <#${thread(world)}>`,
  );
  assert.deepEqual(card!.mentions, [PERSON], 'it mentions the person');
  assert.deepEqual(card!.buttons.map((b) => b.label), ['Done', 'Correct', 'Draft reply']);

  const done = await tap(world, NEEDS_YOU, card!, 'Done');
  assert.equal(updateOf(done)!.text, 'Mail from Codemind · done');
  await world.assistant.whenIdle();
  assert.equal(world.discord.cards(NEEDS_YOU)[cards]!.text, 'Mail from Codemind · done');
  assert.deepEqual(world.discord.cards(NEEDS_YOU)[cards]!.buttons, []);

  // A second card, left alone, lapses 14 days after it went out.
  await delivered(world, mail({ subject: 'Your trial ends soon', text: 'Pick a plan before Nov 30.' }));
  await world.assistant.whenIdle();
  const second = world.discord.cards(NEEDS_YOU)[cards + 1]!;
  assert.match(second.text, /Pick a plan before the trial ends on Nov 30/);
  const sentAt = world.clock.now().getTime();
  await world.advanceTo(new Date(sentAt + 14 * 24 * 60 * 60_000 - 60_000).toISOString());
  assert.match(world.discord.cards(NEEDS_YOU)[cards + 1]!.text, /needs you/, 'still open a minute before its 14 days');
  await world.advanceTo(new Date(sentAt + 14 * 24 * 60 * 60_000 + 1000).toISOString());
  assert.equal(world.discord.cards(NEEDS_YOU)[cards + 1]!.text, 'Mail from Codemind · lapsed after 14 days; it’s still in Gmail');
  assert.ok(world.logs.some((l) => l.event === 'mail.card-lapsed'));
});

/** What the bot logged of the mail queued for a Reply draft, which #62's run writes. */
const draftsQueued = (world: World) => world.logs.filter((l) => l.event === 'mail.reply-draft-queued').map(({ messageId, cause }) => ({ messageId, cause }));

/** A mail with a `List-Unsubscribe` header, as a mailing tool sends it. */
const BULK = { listUnsubscribe: '<https://codemindhq.dev/unsubscribe>' };

test('mail that asks for a reply is queued for a Reply draft when it isn’t bulk, and gets no message of its own', async (t) => {
  const world = await registered(t, 'logged-in');
  const cards = world.discord.cards(NEEDS_YOU).length;
  const messages = postMessages(world).length;
  world.model.mail = () => mailSorted('asks-for-reply', { gist: 'Why did you sign up?' });
  const [id] = await delivered(world, mail({ from: 'Ana from Codemind <ana@codemindhq.dev>', subject: 'Quick question', text: 'Why did you sign up for Codemind?' }));
  await world.assistant.whenIdle();

  assert.deepEqual(sorts(world), [{ messageId: id, kind: 'asks-for-reply' }]);
  assert.deepEqual(draftsQueued(world), [{ messageId: id, cause: 'arrival' }]);
  assert.equal(world.discord.cards(NEEDS_YOU).length, cards);
  assert.equal(postMessages(world).length, messages);
});

test('bulk mail that asks for a reply gets a silent message in its Product post: the sender, the subject and its own text, with Draft reply and Correct', async (t) => {
  const world = await registered(t, 'logged-in');
  const cards = world.discord.cards(NEEDS_YOU).length;
  const messages = postMessages(world).length;
  world.model.mail = () => mailSorted('asks-for-reply', { gist: 'Welcome, just hit reply' });
  const text = [
    'Welcome to Codemind! Just hit reply and tell me what you’re building.',
    'Your sign-in code is 482913.',
    '',
    '— Ana',
    '',
    'On Mon, Oct 12, 2026 at 9:00 AM Codemind <hello@codemindhq.dev> wrote:',
    '> Thanks for signing up.',
    '> An older line of the thread.',
  ].join('\n');
  const [id] = await delivered(world, mail({ ...BULK, from: 'Ana at Codemind <ana@codemindhq.dev>', subject: 'Welcome aboard *for real*', text }));
  await world.assistant.whenIdle();

  assert.deepEqual(draftsQueued(world), [], 'bulk mail gets a draft only when the person asks');
  assert.equal(world.discord.cards(NEEDS_YOU).length, cards, 'nothing in #needs-you');
  const [message, ...more] = postMessages(world).slice(messages);
  assert.equal(more.length, 0);
  assert.equal(
    message!.text,
    [
      '**Mail that asks for a reply** · from Ana at Codemind (`ana@codemindhq.dev`)',
      '**Welcome aboard \\*for real\\***',
      'Welcome to Codemind! Just hit reply and tell me what you’re building.',
      'Your sign-in code is \\[code 1\\].',
      '',
      '— Ana',
    ].join('\n'),
  );
  assert.ok(message!.silent, 'it is silent');
  assert.ok(message!.mentionsNobody, 'and pings no one');
  assert.deepEqual(message!.buttons.map((b) => b.label), ['Draft reply', 'Correct']);
  assert.deepEqual(whoReceived(world, 'An older line of the thread.'), ['the model provider'], 'the quoted history reaches the mail run, never Discord');

  // Draft reply queues the mail for its Reply draft, once.
  const tapped = await tap(world, thread(world), message!, 'Draft reply');
  assert.equal(tapped.type, 6, 'the tap is taken');
  await world.assistant.whenIdle();
  assert.deepEqual(draftsQueued(world), [{ messageId: id, cause: 'draft-reply' }]);
  assert.match(postMessages(world)[messages]!.text, /-# Reply draft queued$/);
  assert.deepEqual(postMessages(world)[messages]!.buttons.map((b) => b.label), ['Correct']);
});

test('a no-reply sender gets no Reply draft and no Draft reply, whatever the model concluded: Reply-To decides, otherwise From', async (t) => {
  const world = await registered(t, 'logged-in');
  const cards = world.discord.cards(NEEDS_YOU).length;
  const messages = postMessages(world).length;
  world.model.mail = (run) =>
    /needs-you/.test(run.prompt) ? mailSorted('needs-the-person', { wants: 'Confirm the new sign-in' }) : mailSorted('asks-for-reply', { gist: 'Tell us your use' });
  const [, , , replyToAna] = await delivered(
    world,
    mail({ from: 'Codemind <no-reply@codemindhq.dev>', subject: 'What will you use it for?', text: 'Tell us what you will use Codemind for.' }),
    mail({ ...BULK, from: 'Codemind <noreply+news@codemindhq.dev>', subject: 'What do you build?', text: 'Tell us what you build.' }),
    mail({ from: 'Ana <ana@codemindhq.dev>', replyTo: 'Codemind <donotreply@codemindhq.dev>', subject: 'Your goals?', text: 'What are your goals?' }),
    mail({ from: 'Codemind <no_reply@codemindhq.dev>', replyTo: 'Ana <ana@codemindhq.dev>', subject: 'Your team?', text: 'How big is your team?' }),
    mail({ from: 'Codemind <do-not-reply@codemindhq.dev>', subject: 'needs-you: new sign-in', text: 'A new sign-in from Mac.' }),
  );
  await world.assistant.whenIdle();

  assert.deepEqual(draftsQueued(world), [{ messageId: replyToAna, cause: 'arrival' }], 'only the mail whose Reply-To takes replies');
  const posted = postMessages(world).slice(messages);
  assert.equal(posted.length, 3, 'the other three that ask for a reply get a silent message each, bulk or not');
  for (const message of posted) {
    assert.deepEqual(message.buttons.map((b) => b.label), ['Correct']);
    assert.match(message.text, /-# Its reply address is a no-reply one, so it gets no Reply draft$/);
  }
  assert.match(posted[0]!.text, /What will you use it for\?/);
  assert.match(posted[1]!.text, /What do you build\?/);
  assert.match(posted[2]!.text, /Your goals\?/);
  const [needsYou] = world.discord.cards(NEEDS_YOU).slice(cards);
  assert.deepEqual(needsYou!.buttons.map((b) => b.label), ['Done', 'Correct'], 'its card has no Draft reply');
});

test('with no mail route answering, mail waits as not handled · waiting and never goes to another role’s route; it is sorted once a mail route answers again', async (t) => {
  const world = await registered(t, 'logged-in', {
    configure: (config) => {
      config.providers.deepseek = { label: 'DeepSeek', mailGroup: false };
      config.providers.plus = { label: 'ChatGPT Plus', mailGroup: true };
      config.roles.registration.providers = [{ name: 'deepseek', model: 'judge-model-1' }, ...config.roles.registration.providers];
      config.roles.mail.providers = [...config.roles.mail.providers, { name: 'plus', model: 'judge-model-1' }];
    },
  });
  // Both mail routes have no channel on new-api; the registration role's routes answer.
  world.model.fault = (r) => (r.model.startsWith('mail@') ? { answer: 'no-channel' } : undefined);
  const [first, second] = await delivered(world, mail({ subject: 'Tips, part one' }), mail({ subject: 'Tips, part two' }));
  await world.assistant.whenIdle();

  assert.deepEqual(
    world.logs.filter((l) => l.event === 'mail.waiting').map((l) => l.messageId),
    [first, second],
  );
  assert.deepEqual(sorts(world), []);
  const carried = world.model.requests.filter((r) => r.raw.includes('Tips, part'));
  assert.deepEqual([...new Set(carried.map((r) => r.model))].sort(), ['mail@openrouter', 'mail@plus'], 'only the mail role’s routes, both tried');

  // Half an hour on, a mail route answers again.
  world.model.fault = (r) => (r.model === 'mail@openrouter' ? { answer: 'no-channel' } : undefined);
  await world.advanceTo(new Date(world.clock.now().getTime() + 31 * 60_000).toISOString());
  assert.deepEqual(sorts(world), [
    { messageId: first, kind: 'for-the-record' },
    { messageId: second, kind: 'for-the-record' },
  ]);
  assert.deepEqual(
    [...new Set(world.model.requests.filter((r) => r.raw.includes('Tips, part')).map((r) => r.model))].sort(),
    ['mail@openrouter', 'mail@plus'],
    'and still never another role’s',
  );
});

test('a mail run stopped at its cap leaves the mail not handled · stopped, with a notice in its Product post carrying the only Retry; one that records nothing does too', async (t) => {
  const world = await registered(t, 'logged-in', { configure: (config) => void (config.runCaps.mail.tokens = 1000) });
  const messages = postMessages(world).length;
  const [capped] = await delivered(world, mail({ subject: 'Capped', receivedAt: '2026-10-12T16:05:00Z' }));
  await world.assistant.whenIdle();

  assert.deepEqual(world.logs.filter((l) => l.event === 'mail.stopped').map(({ messageId, why }) => ({ messageId, why })), [
    { messageId: capped, why: 'its run hit its token cap (1,000 tokens)' },
  ]);
  const [notice, ...more] = postMessages(world).slice(messages);
  assert.equal(more.length, 0, 'one notice');
  assert.equal(notice!.text, '**Mail not handled** · From Codemind (`hello@codemindhq.dev`) · “Capped” · received 09:05 PT Mon Oct 12: its run hit its token cap (1,000 tokens).\n-# Retry runs it again under the same limits.');
  assert.ok(notice!.silent);
  assert.deepEqual(labels(notice!).map((b) => [b.label, b.disabled]), [['Retry', false]]);
  assert.equal(world.model.mailRuns.length, 1, 'and no run tries it again by itself');
  await world.advanceTo(new Date(world.clock.now().getTime() + 2 * 60 * 60_000).toISOString());
  assert.equal(world.model.mailRuns.length, 1, 'not even hours later');

  // Retry runs it again under the same limits, which it fits now.
  world.model.usage = { prompt_tokens: 600, completion_tokens: 50, cached_tokens: 0 };
  const retried = await tap(world, thread(world), notice!, 'Retry');
  assert.equal(retried.type, 6, 'the tap is taken');
  await world.assistant.whenIdle();
  assert.deepEqual(sorts(world), [{ messageId: capped, kind: 'for-the-record' }]);
  const handled = postMessages(world)[messages]!;
  assert.equal(handled.text, '**Mail handled** · From Codemind (`hello@codemindhq.dev`) · “Capped” · received 09:05 PT Mon Oct 12, sorted after Retry.');
  assert.deepEqual(labels(handled).map((b) => [b.label, b.disabled]), [['Retry', true]]);
  assert.ok((await tap(world, thread(world), notice!, 'Retry')).type === 4, 'a second tap is refused');

  // A run that records no sort is stopped the same way, with why.
  world.model.mail = () => 'none';
  const [unrecorded] = await delivered(world, mail({ subject: 'Unrecorded' }));
  await world.assistant.whenIdle();
  assert.deepEqual(world.logs.filter((l) => l.event === 'mail.stopped').at(-1)!.messageId, unrecorded);
  assert.match(postMessages(world).at(-1)!.text, /^\*\*Mail not handled\*\* · From .* · “Unrecorded” · received .*: its run recorded no sort\.\n/);
});

/** A Rule a Correction of mail may propose: general, quoting no mail and naming no sender. */
const ONBOARDING = {
  name: 'Onboarding questions want a reply',
  statement: 'A Product’s question about how the person will use it, or a request for an analysis of their needs, asks for a reply, even from a mailing tool.',
};

test('Correct on a mail’s card sorts it again under the mail role: needing a reply, a draft is queued and the card closes; a proposed mail Rule quoting the mail is refused, and its general rewording goes to the person', async (t) => {
  const world = await registered(t, 'logged-in');
  const cards = world.discord.cards(NEEDS_YOU).length;
  world.model.mail = (run) =>
    /The person corrected that/.test(run.prompt) ? mailSorted('asks-for-reply', { gist: 'What are you building?' }) : mailSorted('needs-the-person', { wants: 'Say what you are building' });
  const rule = (name: string, statement: string) => sorted('rule', { rule: { name, statement, scope: 'mail', amends: false } });
  world.model.sort = () => rule('Reply to questions', 'When ana@codemindhq.dev asks what you are building, reply.');
  // Each refused proposal is followed by one that carries less of the mail, until a general one.
  const rewordings = [
    rule('Reply to questions', 'When Ana asks a question, reply.'),
    rule('Reply to questions', 'Questions from codemindhq.dev want a reply.'),
    rule('Reply to questions', 'When a mail says tell me what you are building, reply.'),
    rule(ONBOARDING.name, ONBOARDING.statement),
  ];
  world.model.sortAgain = () => rewordings.shift() ?? 'none';
  const [id] = await delivered(world, mail({ from: 'Ana <ana@codemindhq.dev>', subject: 'What are you building?', text: 'Tell me what you are building with Codemind, and I will set you up.' }));
  await world.assistant.whenIdle();
  const card = world.discord.cards(NEEDS_YOU)[cards]!;
  assert.match(card.text, /Say what you are building/);

  const opened = await tap(world, NEEDS_YOU, card, 'Correct');
  const popup = popupOf(opened)!;
  assert.equal(popup.title, 'Correct · Mail from Codemind');
  const sent = await world.discord.submitPopup({ userId: PERSON, customId: popup.customId, channelId: NEEDS_YOU, messageId: card.id, fields: { what: 'This needed a reply, not a task: she asked a question.' } });
  assert.equal(sent.type, 6);
  await world.assistant.whenIdle();

  // The mail is sorted again, under the mail role, with what the person wrote.
  const [, again] = world.model.mailRuns;
  assert.match(again!.prompt, /kind: needs-the-person/);
  assert.match(again!.prompt, /This needed a reply, not a task: she asked a question\./);
  assert.deepEqual(sorts(world), [
    { messageId: id, kind: 'needs-the-person' },
    { messageId: id, kind: 'asks-for-reply' },
  ]);
  assert.deepEqual(draftsQueued(world), [{ messageId: id, cause: 'correction' }]);
  assert.equal(world.discord.cards(NEEDS_YOU)[cards]!.text, 'Mail from Codemind · corrected: it asks for a reply; a Reply draft is queued');
  assert.deepEqual(world.discord.cards(NEEDS_YOU)[cards]!.buttons, []);

  // Its sorting run is the mail role's too, and loads the mail Rules.
  const [sorting] = world.model.sortingRuns;
  const sortRequests = world.model.requests.filter((r) => r.tools.includes('record_sort'));
  assert.ok(sortRequests.length > 0 && sortRequests.every((r) => r.model === 'mail@openrouter'));
  assert.match(sorting!.prompt, /The Correction's scope is mail/);
  assert.match(sorting!.prompt, /quotes no mail text and names no sender or address/);
  assert.deepEqual(
    sorting!.sortReplies.slice(0, 4).map((r) => r.match(/, and (it .*?)\. Say it in general words/)?.[1]),
    ['it names an email address', 'it names the sender, Ana', "it names the sender's domain, codemindhq.dev", 'it quotes the mail ("tell me what you are")'],
    'each proposal carrying the mail is refused, saying how',
  );
  assert.match(sorting!.sortReplies[4]!, /^Recorded/, 'and “analysis” is no naming of Ana');

  const [proposal] = world.discord.cards(NEEDS_YOU).slice(cards + 1);
  assert.equal(
    proposal!.text,
    [
      `<@${PERSON}> **Proposed Rule · not an Approval**`,
      `**${ONBOARDING.name}** · mail\n> ${ONBOARDING.statement}`,
      '-# From your Correction on **Mail from Codemind** (Mon Oct 12): “This needed a reply, not a task: she asked a question.”',
      '-# Keep adds it to every later mail run. Keeping it approves nothing: nothing is registered or sent.',
    ].join('\n'),
  );
  for (const quoted of ['ana@codemindhq.dev', 'Tell me what you are building', 'When Ana asks']) {
    assert.ok(!proposal!.text.includes(quoted), `${quoted} isn't proposed`);
  }

  // Kept, it loads into every later mail run.
  await tap(world, NEEDS_YOU, proposal!, 'Keep');
  await world.assistant.whenIdle();
  const path = 'rules/mail/onboarding-questions-want-a-reply.md';
  assert.ok(world.git.file(path)!.includes(`taught-on:\n  - Gmail message ${id} (mail from Codemind) of 2026-10-12\n`), world.git.file(path));
  await delivered(world, mail({ subject: 'Another week', text: 'Weekly news.' }));
  await world.assistant.whenIdle();
  const latest = world.model.requests.filter((r) => r.tools.includes('record_mail')).at(-1)!;
  assert.ok(latest.raw.includes(`Rule: ${ONBOARDING.name}`), 'the kept mail Rule is in the next mail run’s prompt');
  for (const value of ['Tell me what you are building with Codemind', 'What are you building?', 'Say what you are building', 'ana@codemindhq.dev']) {
    assert.ok(!world.git.history().includes(value), `the Personal database keeps no mail text: ${value}`);
  }
});

test('for a waitlisted Product, the mail run’s record says whether the mail is an invite', async (t) => {
  const world = await registered(t, 'waitlist');
  world.model.mail = (run) => (/Its Registration is waitlisted/.test(run.prompt) ? mailSorted('needs-the-person', { wants: 'Accept the invite', invite: /invite/i.test(run.prompt) }) : 'none');
  world.model.mailAgain = () => 'none';
  const [invite, news] = await delivered(
    world,
    mail({ subject: 'Your invite to Codemind is here', text: 'You are off the waitlist: accept your invite.' }),
    mail({ subject: 'Waitlist update', text: 'You are number 40 on the waitlist.' }),
  );
  await world.assistant.whenIdle();
  assert.deepEqual(
    world.logs.filter((l) => l.event === 'mail.sorted').map(({ messageId, invite }) => ({ messageId, invite })),
    [
      { messageId: invite, invite: true },
      { messageId: news, invite: false },
    ],
  );

  // A record that leaves it open is refused, and the run told why.
  world.model.mail = () => mailSorted('for-the-record', { invite: null });
  await delivered(world, mail({ subject: 'Waitlist news' }));
  await world.assistant.whenIdle();
  assert.match(world.model.mailRuns.at(-1)!.mailReplies[0]!, /on this Product’s waitlist, so invite must be true or false/);
});

test('a mail its Registration takes as its verification mail reaches no mail run; a welcome beside it is sorted as any mail', async (t) => {
  const world = await registered(t);
  const [welcome, code] = await delivered(
    world,
    mail({ subject: 'Welcome to Codemind', text: 'Glad to have you. Start with the docs.' }),
    mail({ subject: 'Your Codemind verification code', text: 'Your verification code is 482913.' }),
  );
  await world.assistant.whenIdle();
  assert.equal(world.logs.find((l) => l.event === 'registration.verification-mail')?.messageId, code);
  assert.deepEqual(sorts(world), [{ messageId: welcome, kind: 'for-the-record' }]);
  assert.deepEqual(whoReceived(world, 'Your Codemind verification code'), [], 'no model sees the verification mail, nor Discord its subject');
  // Nor later: the next pass leaves it to plain code.
  await world.advanceTo(new Date(world.clock.now().getTime() + 31 * 60_000).toISOString());
  assert.deepEqual(sorts(world), [{ messageId: welcome, kind: 'for-the-record' }]);
  assert.equal(world.model.mailRuns.length, 1);
});

test('mail recorded before mail runs came is sorted at the next start, its Reply-To read again from Gmail where its kept copy lacks it', async (t) => {
  const world = await registered(t, 'logged-in');
  world.model.fault = (r) => (r.model.startsWith('mail@') ? { answer: 'no-channel' } : undefined);
  world.model.mail = () => mailSorted('asks-for-reply', { gist: 'What will you use it for?' });
  const [id] = await delivered(world, mail({ from: 'Ana <ana@codemindhq.dev>', replyTo: 'Codemind <noreply@codemindhq.dev>', subject: 'What will you use it for?', text: 'Tell us.' }));
  await world.assistant.whenIdle();
  assert.equal(world.logs.filter((l) => l.event === 'mail.waiting').length, 1);

  // As #57 kept it, before this ticket: no sender as written and no Reply-To.
  const folder = join(world.dataDir, 'raw', 'gmail', id!);
  for (const file of readdirSync(folder)) {
    const { sender, replyTo, ...kept } = JSON.parse(readFileSync(join(folder, file), 'utf8')) as Record<string, unknown>;
    assert.ok(sender && replyTo);
    writeFileSync(join(folder, file), `${JSON.stringify(kept, null, 2)}\n`);
  }
  const reads = world.gmail.readsOf(id!).length;
  world.model.fault = () => undefined;
  await world.restart();
  // Its route is tried again once its 30 minutes are up.
  await world.advanceTo(new Date(world.clock.now().getTime() + 31 * 60_000).toISOString());

  assert.deepEqual(sorts(world), [{ messageId: id, kind: 'asks-for-reply' }]);
  assert.equal(world.gmail.readsOf(id!).length, reads + 1, 'read again from Gmail, once');
  assert.deepEqual(draftsQueued(world), [], 'its Reply-To is a no-reply one, so no Reply draft');
  assert.match(postMessages(world).at(-1)!.text, /no-reply one/);
});

test('Correct on a bulk mail’s message in the Product post: one its run can’t apply says so, and one that finds it for the record closes the message', async (t) => {
  const world = await registered(t, 'logged-in');
  const messages = postMessages(world).length;
  let corrected: 'none' | 'for-the-record' = 'none';
  world.model.mail = (run) => (!/The person corrected that/.test(run.prompt) ? mailSorted('asks-for-reply', { gist: 'Tell us about you' }) : corrected === 'none' ? 'none' : mailSorted('for-the-record', { gist: 'A survey' }));
  await delivered(world, mail({ ...BULK, subject: 'Tell us about you', text: 'Take our two-minute survey.' }));
  await world.assistant.whenIdle();
  const correct = async (what: string) => {
    const message = postMessages(world)[messages]!;
    const popup = popupOf(await tap(world, thread(world), message, 'Correct'))!;
    await world.discord.submitPopup({ userId: PERSON, customId: popup.customId, channelId: thread(world), messageId: message.id, fields: { what } });
    await world.assistant.whenIdle();
  };

  await tap(world, thread(world), postMessages(world)[messages]!, 'Draft reply');
  await world.assistant.whenIdle();
  assert.equal(draftsQueued(world).length, 1);

  await correct('This is a survey, it didn’t need me.');
  const unapplied = postMessages(world)[messages]!;
  assert.match(unapplied.text, /-# Reply draft queued · Your Correction couldn't be applied: its run recorded no sort\. Correct again$/);
  assert.deepEqual(unapplied.buttons.map((b) => b.label), ['Correct']);
  assert.equal(world.model.sortingRuns.length, 0, 'nothing was sorted again, so nothing to sort');

  corrected = 'for-the-record';
  await correct('This is a survey, it didn’t need me.');
  assert.equal(postMessages(world)[messages]!.text, 'Mail from Codemind · “Tell us about you” · corrected: for the record');
  assert.deepEqual(postMessages(world)[messages]!.buttons, []);
  assert.equal(world.model.sortingRuns.length, 1);
  assert.deepEqual(
    world.logs.filter((l) => l.event === 'mail.reply-draft-withdrawn').map((l) => l.messageId),
    [draftsQueued(world)[0]!.messageId],
    'the Correction withdraws the draft still queued: the mail needs no reply',
  );
});

test('a bulk mail too long for one Discord message has its own text cut to fit, and keeps its subject and buttons', async (t) => {
  const world = await registered(t, 'logged-in');
  const messages = postMessages(world).length;
  world.model.mail = () => mailSorted('asks-for-reply', { gist: 'A long letter' });
  const paragraph = 'We would love to hear what you are building, so please reply and tell us everything. ';
  const text = `${paragraph.repeat(60)}\nThe last line, which won't fit.`;
  assert.ok(text.length > 5000);
  await delivered(world, mail({ ...BULK, subject: 'A long letter', text }));
  await world.assistant.whenIdle();

  const message = postMessages(world)[messages]!;
  assert.ok(message.textLength <= 4000, `${message.textLength} characters`);
  assert.ok(message.textLength > 3500, 'it uses the room it has');
  assert.match(message.text, /^\*\*Mail that asks for a reply\*\*.*\n\*\*A long letter\*\*\nWe would love to hear/);
  assert.match(message.text, /…$/, 'cut where it ran out of room');
  assert.ok(!message.text.includes('The last line'));
  assert.deepEqual(message.buttons.map((b) => b.label), ['Draft reply', 'Correct']);
  assert.deepEqual(world.discord.refused, []);
});

test('a code in the name of a mail’s From is a placeholder too: no model and no Discord message holds it', async (t) => {
  const world = await registered(t, 'logged-in');
  const cards = world.discord.cards(NEEDS_YOU).length;
  world.model.mail = () => mailSorted('needs-the-person', { wants: 'Check the new sign-in' });
  await delivered(world, mail({ from: 'Your code 482913 <hello@codemindhq.dev>', subject: 'New sign-in', text: 'A new sign-in from Mac.' }));
  await world.assistant.whenIdle();

  assert.match(world.model.mailRuns[0]!.prompt, /Your code \[code 1\] <hello@codemindhq\.dev>/);
  assert.match(world.discord.cards(NEEDS_YOU)[cards]!.text, /-# From Your code \\\[code 1\\\] \(`hello@codemindhq\.dev`\)/);
  assert.deepEqual(whoReceived(world, '482913'), []);
});

test('a card a Correction sorts otherwise stays the line it shrank to: it never lapses, and the Product post’s message keeps its buttons', async (t) => {
  const world = await registered(t, 'logged-in');
  const cards = world.discord.cards(NEEDS_YOU).length;
  const messages = postMessages(world).length;
  world.model.mail = (run) => (/The person corrected that/.test(run.prompt) ? mailSorted('asks-for-reply') : mailSorted('needs-the-person', { wants: 'Answer the survey' }));
  await delivered(world, mail({ ...BULK, subject: 'Quick survey', text: 'Tell us how you found us.' }));
  await world.assistant.whenIdle();
  const card = world.discord.cards(NEEDS_YOU)[cards]!;
  const popup = popupOf(await tap(world, NEEDS_YOU, card, 'Correct'))!;
  await world.discord.submitPopup({ userId: PERSON, customId: popup.customId, channelId: NEEDS_YOU, messageId: card.id, fields: { what: 'It asks me to reply.' } });
  await world.assistant.whenIdle();
  const corrected = 'Mail from Codemind · corrected: it asks for a reply; a Reply draft is queued';
  assert.equal(world.discord.cards(NEEDS_YOU)[cards]!.text, corrected);
  assert.deepEqual(postMessages(world)[messages]!.buttons.map((b) => b.label), ['Correct'], 'the bulk mail’s message, its draft queued');

  await world.advanceTo(new Date(world.clock.now().getTime() + 15 * 24 * 60 * 60_000).toISOString());
  assert.equal(world.discord.cards(NEEDS_YOU)[cards]!.text, corrected, 'no lapse');
  assert.ok(!world.logs.some((l) => l.event === 'mail.card-lapsed'));
  assert.ok(popupOf(await tap(world, thread(world), postMessages(world)[messages]!, 'Correct')), 'its Correct still opens');
});

test('a message Discord doesn’t take is sent again 5 minutes on, once', async (t) => {
  const world = await registered(t, 'logged-in');
  const cards = world.discord.cards(NEEDS_YOU).length;
  world.model.mail = () => mailSorted('needs-the-person', { wants: 'Confirm the new sign-in' });
  world.discord.refuseNextMessage(NEEDS_YOU);
  await delivered(world, mail({ subject: 'New sign-in' }));
  await world.assistant.whenIdle();
  assert.equal(world.discord.cards(NEEDS_YOU).length, cards, 'Discord refused the card');
  assert.equal(world.logs.filter((l) => l.event === 'mail.show-failed').length, 1);

  await world.advanceTo(new Date(world.clock.now().getTime() + 4 * 60_000).toISOString());
  assert.equal(world.discord.cards(NEEDS_YOU).length, cards, 'not before the 5 minutes');
  await world.advanceTo(new Date(world.clock.now().getTime() + 61_000).toISOString());
  assert.equal(world.discord.cards(NEEDS_YOU).length, cards + 1);
  assert.match(world.discord.cards(NEEDS_YOU)[cards]!.text, /Confirm the new sign-in/);
  await world.advanceTo(new Date(world.clock.now().getTime() + 10 * 60_000).toISOString());
  assert.equal(world.discord.cards(NEEDS_YOU).length, cards + 1, 'and once');
});

test('what a mail run wrote from a mail is forgotten after 90 days, with the mail’s kept text', async (t) => {
  const world = await registered(t, 'logged-in');
  await delivered(world, mail({ subject: 'Tips' }));
  await world.assistant.whenIdle();
  assert.equal(sorts(world).length, 1);
  await world.advanceTo('2027-01-09T09:30:00Z'); // 01:30 PST, 89 days on
  assert.ok(!world.logs.some((l) => l.event === 'mail.text-forgotten'), 'kept until its 90 days are up');
  await world.advanceTo('2027-01-11T09:30:00Z'); // 01:30 PST, after the daily expiry, 90 days on
  assert.deepEqual(world.logs.filter((l) => l.event === 'mail.text-forgotten').map((l) => l.sorts), [1]);
});

test('a card whose lapse Discord wouldn’t take is shrunk 5 minutes on', async (t) => {
  const world = await registered(t, 'logged-in');
  const cards = world.discord.cards(NEEDS_YOU).length;
  world.model.mail = () => mailSorted('needs-the-person', { wants: 'Confirm the new sign-in' });
  await delivered(world, mail({ subject: 'New sign-in' }));
  await world.assistant.whenIdle();
  const sentAt = world.clock.now().getTime();

  world.discord.uneditable.add(NEEDS_YOU);
  await world.advanceTo(new Date(sentAt + 14 * 24 * 60 * 60_000 + 1000).toISOString());
  assert.ok(world.logs.some((l) => l.event === 'mail.card-lapsed'));
  assert.match(world.discord.cards(NEEDS_YOU)[cards]!.text, /needs you/, 'Discord took no edit');

  world.discord.uneditable.delete(NEEDS_YOU);
  await world.advanceTo(new Date(world.clock.now().getTime() + 5 * 60_000 + 1000).toISOString());
  assert.equal(world.discord.cards(NEEDS_YOU)[cards]!.text, 'Mail from Codemind · lapsed after 14 days; it’s still in Gmail');
});

test('a card whose send went unanswered is known by the Correct tapped on it, and closes once the Correction sorts the mail otherwise', async (t) => {
  const world = await registered(t, 'logged-in');
  const cards = world.discord.cards(NEEDS_YOU).length;
  world.model.mail = (run) => (/The person corrected that/.test(run.prompt) ? mailSorted('for-the-record') : mailSorted('needs-the-person', { wants: 'Read the news' }));
  world.discord.loseReply('message', 1, NEEDS_YOU);
  await delivered(world, mail({ subject: 'News' }));
  await world.assistant.whenIdle();
  const card = world.discord.cards(NEEDS_YOU)[cards]!;
  assert.match(card.text, /Read the news/, 'Discord took the card, and its answer never came');

  const popup = popupOf(await tap(world, NEEDS_YOU, card, 'Correct'))!;
  await world.discord.submitPopup({ userId: PERSON, customId: popup.customId, channelId: NEEDS_YOU, messageId: card.id, fields: { what: 'Just news.' } });
  await world.assistant.whenIdle();
  assert.equal(world.discord.cards(NEEDS_YOU)[cards]!.text, 'Mail from Codemind · corrected: for the record');
  assert.equal(world.discord.cards(NEEDS_YOU).length, cards + 1, 'and it was never sent again');
});
