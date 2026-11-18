// Reading the Signup mailbox (#57): the bot reads new mail from Gmail's history every few seconds and records each one
// in the ledger once, by its Gmail message id, across restarts and a history Gmail no longer serves. It matches mail to
// Registrations, holds bulk mail over the weekly cap, and raises a card for a security alert from Google. Each test
// reads what Gmail, Discord and the model provider saw, the bot's log, and where a value shows on the VM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { NEEDS_YOU, PERSON, SIGNUP_MAILBOX, startWorld, type World } from './harness/world.ts';
import { GRANTED_SCOPES, type Mail } from './harness/fake-gmail.ts';
import { delivered, PLUS_ADDRESS, registered } from './harness/signup-mail.ts';
import { whereItShows } from './harness/secrets.ts';
import { until } from './harness/miner-day.ts';
import { updateOf } from './harness/fake-discord.ts';

/** What the ledger recorded of each mail, as the bot logs it. */
const recorded = (world: World) =>
  world.logs
    .filter((l) => l.event === 'mail.recorded')
    .map(({ messageId, product, matchedBy, disposition, reason }) => ({ messageId, product, matchedBy, disposition, ...(reason ? { reason } : {}) }));

/**
 * Where a value shows on the VM: everywhere `whereItShows` looks but the model provider, off the VM, which a matched
 * mail's mail run sends its text to, with its Secrets as placeholders (#61).
 */
const onTheVm = (world: World, value: string) => whereItShows(world, value).filter((where) => where !== 'the model provider');

/** A security alert from Google, as its sign-in alerts come. */
const GOOGLE_ALERT: Mail = {
  from: 'Google <no-reply@accounts.google.com>',
  subject: 'Security alert',
  text: 'A new sign-in on Mac. If this was you, you don’t need to do anything.',
};

/** The card a security alert from Google raises, as the person sees it. */
const alertCard = (spam: boolean) =>
  `<@${PERSON}> **Mail from Google (\`no-reply@accounts.google.com\`) in the Signup mailbox**\nThe Assistant doesn’t read it: open it in Gmail${spam ? ', where it’s in Spam' : ''}.`;

/** The person taps Done on a card in #needs-you. */
function tapDone(world: World, index: number) {
  const card = world.discord.cards(NEEDS_YOU)[index]!;
  const done = card.buttons.find((b) => b.label === 'Done')!;
  return world.discord.tap({ userId: PERSON, customId: done.customId, channelId: NEEDS_YOU, messageId: card.id });
}


test('a Gmail token for another mailbox is refused: the bot reads none of its mail, and the person is told to replace it', async (t) => {
  const world = await startWorld({ now: '2026-11-14T15:00:00Z', gmail: { emailAddress: 'someone.else@gmail.com' } });
  t.after(() => world.stop());
  world.gmail.deliver({ from: 'Codemind <hello@codemindhq.dev>', subject: 'Welcome to Codemind', text: 'Hello there.' });
  await world.stepThrough('2026-11-14T15:01:00Z', 0.5);

  assert.deepEqual(
    world.gmail.requests.map((r) => r.path),
    ['/profile'],
    'it asks whose mailbox the token reads, once, and nothing else',
  );
  assert.deepEqual(
    world.discord.cards(NEEDS_YOU).map((c) => c.text),
    [
      `<@${PERSON}> **Replace the Gmail token**\nIt reads someone.else@gmail.com, not the Signup mailbox, ${SIGNUP_MAILBOX}, so the bot reads no mail. Replace it on the VM: \`sudo ops/token gmail-refresh-token\`.`,
    ],
  );
  assert.deepEqual(
    world.logs.filter((l) => l.event === 'gmail.token-refused').map((l) => l.why),
    [`it reads someone.else@gmail.com, not the Signup mailbox, ${SIGNUP_MAILBOX}`],
  );
});

test('a Gmail token holding more than gmail.readonly and gmail.compose is refused before any read', async (t) => {
  const world = await startWorld({ now: '2026-11-14T15:00:00Z', gmail: { scopes: [...GRANTED_SCOPES, 'https://www.googleapis.com/auth/gmail.modify'] } });
  t.after(() => world.stop());
  await world.stepThrough('2026-11-14T15:01:00Z', 0.5);

  assert.deepEqual(world.gmail.requests, [], 'no request of the Gmail API');
  assert.deepEqual(
    world.discord.cards(NEEDS_YOU).map((c) => c.text),
    [
      `<@${PERSON}> **Replace the Gmail token**\nIt holds gmail.compose, gmail.modify and gmail.readonly, not exactly gmail.readonly and gmail.compose, so the bot reads no mail. Replace it on the VM: \`sudo ops/token gmail-refresh-token\`.`,
    ],
  );
});

test('a gmail-client-secret that holds no client id and secret is refused, and the person is told to replace it', async (t) => {
  const world = await startWorld({ now: '2026-11-14T15:00:00Z', gmail: { clientFile: 'the client id, pasted alone' } });
  t.after(() => world.stop());
  await world.stepThrough('2026-11-14T15:01:00Z', 0.5);

  assert.deepEqual(world.gmail.refreshes, [], 'Google is never asked');
  assert.deepEqual(
    world.discord.cards(NEEDS_YOU).map((c) => c.text),
    [`<@${PERSON}> **Replace the Gmail token**\nIt holds no client id and secret, so the bot reads no mail. Replace it on the VM: \`sudo ops/token gmail-client-secret\`.`],
  );
});

test('mail is matched to a Registration by its plus-address tag, then by its sender domain; mail that matches neither is unmatched and kept nowhere', async (t) => {
  const world = await registered(t);
  const ids = await delivered(
    world,
    { from: 'Codemind Team <team@mail.esp-sender.com>', to: PLUS_ADDRESS, subject: 'Welcome aboard', text: 'Thanks for joining Codemind.' },
    { from: 'Codemind <hello@news.codemindhq.dev>', subject: 'Your workspace is ready', text: 'Your Codemind workspace is ready.' },
    { from: 'Deals <deals@shop.example>', subject: 'Flash sale', text: 'An unmatched flash sale nobody signed up for.' },
    { from: 'Someone <someone@elsewhere.example>', to: 'you+nosuchproduct@gmail.com', text: 'A tag no Registration has.' },
    // From Google, without Gmail's own DMARC pass, to Codemind's plus-address: a spoof, so just unmatched.
    { ...GOOGLE_ALERT, to: PLUS_ADDRESS, dmarc: 'fail', text: 'A spoofed alert to a plus-address.' },
  );
  const [byTag, byDomain, unmatched, otherTag, spoofed] = ids;

  assert.deepEqual(recorded(world), [
    { messageId: byTag, product: 'codemindhq.dev', matchedBy: 'tag', disposition: 'queued' },
    { messageId: byDomain, product: 'codemindhq.dev', matchedBy: 'domain', disposition: 'queued' },
    { messageId: unmatched, product: null, matchedBy: null, disposition: 'unmatched' },
    { messageId: otherTag, product: null, matchedBy: null, disposition: 'unmatched' },
    { messageId: spoofed, product: null, matchedBy: null, disposition: 'unmatched' },
  ]);
  // Unmatched mail reaches no model, no Discord message and no commit, and the bot keeps no copy of it.
  assert.deepEqual(whereItShows(world, 'An unmatched flash sale nobody signed up for.'), []);
  assert.deepEqual(whereItShows(world, 'A tag no Registration has.'), []);
  assert.deepEqual(whereItShows(world, 'A spoofed alert to a plus-address.'), []);
  assert.deepEqual(world.discord.cards(NEEDS_YOU).filter((c) => c.text.includes('Mail from Google')), [], 'and it raises no card');
  assert.deepEqual(world.gmail.changes, [], 'nothing in the mailbox is changed: no draft, no label, no move');

  // The next read starts after them, so the reader reads each once. Each mail matched to the Registration awaiting
  // verification is read once more, for a code or link that would make it its verification mail (#58).
  await world.advanceTo(new Date(world.clock.now().getTime() + 5000).toISOString());
  for (const id of ids) assert.equal(world.gmail.readsOf(id).length, id === byTag || id === byDomain ? 2 : 1, id);
  assert.equal(recorded(world).length, 5);
});

test('a history Gmail no longer serves starts a read of the mail since the last check, an hour before it, which skips mail the ledger holds', async (t) => {
  const world = await startWorld({ now: '2026-11-14T15:00:00Z' });
  t.after(() => world.stop());
  const [first] = await delivered(world, { from: 'Shop <news@shop.example>', subject: 'One', text: 'The first mail.', receivedAt: '2026-11-14T14:59:00Z' });
  const checkedAt = world.clock.now().getTime(); // 15:00:05, the read that recorded it

  // The bot is down a week, and Gmail no longer serves the history it read up to.
  const later = world.gmail.deliver({ from: 'Shop <news@shop.example>', subject: 'Two', text: 'The second mail.', receivedAt: '2026-11-18T09:00:00Z' });
  world.gmail.forgetHistory();
  await world.outage('2026-11-21T15:00:00Z');

  const listed = world.gmail.requests.filter((r) => r.path === '/messages');
  assert.deepEqual(
    listed.map((r) => [r.query.q, r.query.includeSpamTrash]),
    [[`after:${(checkedAt - 3_600_000) / 1000}`, 'true']],
    'one search, from an hour before the last check, Spam included',
  );
  assert.deepEqual(recorded(world).map((r) => r.messageId), [first, later], 'each recorded once');
  assert.equal(world.gmail.readsOf(first!).length, 1, 'the mail the ledger held is not read again');
  assert.deepEqual(
    world.logs.filter((l) => l.event === 'mail.history-expired').map(({ since, found }) => ({ since, found })),
    [{ since: new Date(checkedAt - 3_600_000).toISOString(), found: 2 }],
  );

  // From then on, the history serves again, from the history id the search began at.
  const third = await delivered(world, { from: 'Shop <news@shop.example>', subject: 'Three', text: 'The third mail.' });
  assert.deepEqual(recorded(world).map((r) => r.messageId), [first, later, ...third]);
  assert.equal(world.gmail.requests.filter((r) => r.path === '/messages').length, 1, 'no second search');
});

test('a mail is recorded and handled once across a bot killed in the middle of a batch: what it recorded stays, and the rest is read after the restart', async (t) => {
  const world = await startWorld({ now: '2026-11-14T15:00:00Z' });
  t.after(() => world.stop());
  await world.assistant.whenIdle();
  const ids = [GOOGLE_ALERT, ...['Second', 'Third'].map((subject) => ({ from: 'Shop <news@shop.example>', subject, text: `The ${subject.toLowerCase()} mail.` }))].map((mail) =>
    world.gmail.deliver(mail),
  );
  // Gmail takes the read of the second mail and never answers it.
  world.gmail.holdMessage(ids[1]!);
  world.clock.advanceTo('2026-11-14T15:00:05Z');
  await until(() => world.gmail.held === 1);
  assert.deepEqual(recorded(world).map((r) => r.messageId), [ids[0]], 'the first is recorded before the batch is through');
  await until(() => world.discord.cards(NEEDS_YOU).length === 1); // and its card is out, sent beside the read

  await world.kill();
  world.gmail.releaseHolds();
  await world.restart();

  assert.deepEqual(recorded(world).map((r) => r.messageId), ids, 'each mail of the batch is recorded once');
  assert.deepEqual(
    ids.map((id) => world.gmail.readsOf(id).length),
    [1, 2, 1],
    'the fresh bot starts from the history id before the batch, and skips the mail the ledger holds',
  );
  assert.deepEqual(world.discord.cards(NEEDS_YOU).map((c) => c.text), [alertCard(false)], 'the first mail’s card went out once');
});

test('mail from Google with DMARC pass raises a card at once naming only its sender, with Done; without Gmail’s own pass, it is just unmatched', async (t) => {
  const world = await startWorld({ now: '2026-11-14T15:00:00Z' });
  t.after(() => world.stop());
  await delivered(
    world,
    GOOGLE_ALERT,
    { ...GOOGLE_ALERT, spam: true },
    // Spoofed: Gmail's DMARC check failed, though the sender wrote a passing header of its own below Gmail's.
    { ...GOOGLE_ALERT, dmarc: 'fail', senderAuthResults: ['mx.google.com; dmarc=pass header.from=accounts.google.com'] },
    { ...GOOGLE_ALERT, dmarc: 'none' },
    // Passing DMARC, for a domain that only starts like Google's.
    { ...GOOGLE_ALERT, from: 'Google <no-reply@accounts.google.com.evil.example>' },
  );

  assert.deepEqual(
    recorded(world).map((r) => [r.disposition, r.reason]),
    [['put-to-person', 'alert'], ['put-to-person', 'alert'], ['unmatched', undefined], ['unmatched', undefined], ['unmatched', undefined]],
  );
  const cards = world.discord.cards(NEEDS_YOU);
  assert.deepEqual(cards.map((c) => c.text), [alertCard(false), alertCard(true)]);
  assert.deepEqual(cards.map((c) => c.buttons.map((b) => b.label)), [['Done'], ['Done']]);
  assert.deepEqual(cards[0]!.mentions, [PERSON]);
  // The card names the sender, and nothing the mail says.
  assert.deepEqual(whereItShows(world, 'A new sign-in on Mac'), []);
  assert.deepEqual(whereItShows(world, 'Security alert'), []);

  const done = updateOf(await tapDone(world, 0))!;
  assert.equal(done.text, 'Mail from Google (`no-reply@accounts.google.com`) in the Signup mailbox · done');
  assert.deepEqual(done.buttons, []);
  const again = await world.discord.tap({ userId: PERSON, customId: cards[0]!.buttons[0]!.customId, channelId: NEEDS_YOU, messageId: cards[0]!.id });
  assert.equal(again.data?.content, 'Done already.');
});

test('a card for a security alert lapses after 14 days, across a restart, and Done on it then changes nothing', async (t) => {
  const world = await startWorld({ now: '2026-11-14T15:00:00Z' });
  t.after(() => world.stop());
  await delivered(world, GOOGLE_ALERT);
  const [card] = world.discord.cards(NEEDS_YOU);
  await world.outage('2026-11-20T15:00:00Z');
  await world.advanceTo('2026-11-28T15:00:00Z');
  assert.equal(world.discord.cards(NEEDS_YOU)[0]!.text, alertCard(false), 'not yet: 14 days from 15:00:05');

  // Discord doesn't take the edit at first; it is tried again 5 minutes on.
  world.discord.uneditable.add(NEEDS_YOU);
  await world.advanceTo('2026-11-28T15:00:05Z');
  assert.equal(world.discord.cards(NEEDS_YOU)[0]!.text, alertCard(false));
  world.discord.uneditable.delete(NEEDS_YOU);
  await world.advanceTo('2026-11-28T15:05:05Z');
  const [lapsed] = world.discord.cards(NEEDS_YOU);
  assert.equal(lapsed!.id, card!.id);
  assert.equal(lapsed!.text, 'Mail from Google (`no-reply@accounts.google.com`) in the Signup mailbox · lapsed after 14 days; it’s still in Gmail');
  assert.deepEqual(lapsed!.buttons, []);
  const tapped = await world.discord.tap({ userId: PERSON, customId: card!.buttons[0]!.customId, channelId: NEEDS_YOU, messageId: card!.id });
  assert.equal(tapped.data?.content, 'It lapsed already; the mail is still in Gmail.');
});

/** Bulk mail from Codemind, as its newsletter comes. */
const newsletter = (subject: string, spam = false): Mail => ({
  from: 'Codemind <news@codemindhq.dev>',
  subject,
  text: `${subject}: what's new at Codemind.`,
  listUnsubscribe: '<https://codemindhq.dev/unsubscribe>',
  spam,
});

test('at most 3 bulk mails a Product in a rolling 7 days go on, counted by Gmail’s receive time across Inbox and Spam; the 4th is held over the cap', async (t) => {
  const world = await registered(t, 'logged-in');
  const at = async (when: string, ...mail: Mail[]) => {
    await world.advanceTo(when);
    return delivered(world, ...mail);
  };
  const [one] = await at('2026-10-12T09:00:00Z', newsletter('One'));
  const [two] = await at('2026-10-13T09:00:00Z', newsletter('Two', true));
  const [three] = await at('2026-10-14T09:00:00Z', newsletter('Three'));
  const [four, plain] = await at('2026-10-15T09:00:00Z', newsletter('Four'), { from: 'Codemind <hello@codemindhq.dev>', subject: 'Your invoice', text: 'Not bulk: no List-Unsubscribe.' });
  // Seven days after the first, it has left the window; the held fourth never counted.
  const [five] = await at('2026-10-19T09:00:00Z', newsletter('Five'));
  const [six] = await at('2026-10-19T10:00:00Z', newsletter('Six'));

  // History may give a mail later than Gmail received it: one received on Oct 16 would be the 4th of Oct 13–19.
  const [late] = await at('2026-10-19T11:00:00Z', { ...newsletter('Late'), receivedAt: '2026-10-16T09:00:00Z' });

  const by = new Map(recorded(world).map((r) => [r.messageId, [r.disposition, r.reason]]));
  assert.deepEqual(
    [one, two, three, four, plain, five, six, late].map((id) => by.get(id!)),
    [
      ['queued', undefined],
      ['queued', undefined],
      ['queued', undefined],
      ['held', 'over-the-cap'],
      ['queued', undefined],
      ['queued', undefined],
      ['held', 'over-the-cap'],
      ['held', 'over-the-cap'],
    ],
  );
});

test('bulk mail to a Registration waiting for verification is never capped, nor counted', async (t) => {
  const world = await registered(t);
  const ids = await delivered(world, ...['One', 'Two', 'Three', 'Four', 'Five'].map((s) => newsletter(s)));
  assert.deepEqual(
    recorded(world).map((r) => [r.messageId, r.disposition]),
    ids.map((id) => [id, 'queued']),
  );
});

test('a matched mail’s codes and sign-in links become placeholders before the bot keeps its text, and the text it keeps is gone after 90 days', async (t) => {
  const world = await registered(t);
  const code = '738291';
  const verify = 'https://app.codemindhq.dev/verify?token=Zx81kQ2mPa7Lr0vB5nTe&email=you%2Bcodemind%40gmail.com';
  const reset = 'https://app.codemindhq.dev/reset/9f8e7d6c5b4a39281706f5e4d3c2b1a0';
  const magic = 'https://links.codemindhq.dev/ls/click?upn=u001.Qm9vT2tTdXJlVGhpc0lzQVRva2Vu';
  await delivered(world, {
    from: 'Codemind <noreply@codemindhq.dev>',
    to: PLUS_ADDRESS,
    subject: `Your Codemind code is ${code}`,
    text: [
      'Welcome to Codemind!',
      `Your verification code is ${code}.`,
      `Or confirm your address: ${verify}`,
      `Forgot your password? Reset it: ${reset}`,
      'Read the docs at https://codemindhq.dev/docs before November 21, 2026.',
      'Or open https://app.codemindhq.dev/verify/k7Qm2x to sign in.',
      'Your backup code: 4KD-9XQ',
      '© 2026 Codemind Inc.',
    ].join('\n'),
  }, {
    // A mail in HTML alone: its links are read from their tags.
    from: 'Codemind <noreply@codemindhq.dev>',
    to: PLUS_ADDRESS,
    subject: 'Sign in to Codemind',
    html: `<html><head><style>p { color: #333 }</style></head><body><p>Sign in with one tap: <a href="${magic}&amp;src=email">Sign in</a></p><p>Or use the code <b>Q7XK2M</b>.</p><p>Your one-time code:</p><p>zq81ab</p></body></html>`,
  });

  for (const secret of [code, 'Zx81kQ2mPa7Lr0vB5nTe', '9f8e7d6c5b4a39281706f5e4d3c2b1a0', 'Qm9vT2tTdXJlVGhpc0lzQVRva2Vu', 'Q7XK2M', 'k7Qm2x', '4KD-9XQ', 'zq81ab']) {
    assert.deepEqual(whereItShows(world, secret), [], `${secret} shows nowhere: no model, Discord message, commit, log line or file`);
  }
  // What the bot keeps for the mail run that sorts it, outside git, holds the placeholders and the rest of the text.
  const kept = [
    'Your Codemind code is [code 1]',
    'Your verification code is [code 1].',
    'Or confirm your address: [link 1]',
    'Forgot your password? Reset it: [link 2]',
    'Read the docs at https://codemindhq.dev/docs before November 21, 2026.',
    'Or open [link 3] to sign in.',
    'Your backup code: [code 2]',
    '© 2026 Codemind Inc.',
    'Sign in with one tap: Sign in ( [link 1] )',
    'Or use the code [code 1].',
    'Your one-time code:\n[code 2]',
  ];
  // The first mail is the Registration's verification mail, which no mail run reads; the second goes to its mail run.
  for (const line of kept) {
    const where = onTheVm(world, line);
    assert.equal(where.length, 1, `${line} is kept once, in its mail's copy: ${where.join(', ')}`);
    assert.ok(where[0]!.startsWith(`${world.dataDir}/raw/gmail/`), where[0]);
  }
  assert.deepEqual(whereItShows(world, kept[1]!), onTheVm(world, kept[1]!), 'the verification mail reaches no model');
  assert.ok(whereItShows(world, kept.at(-2)!).includes('the model provider'), 'the other mail reaches its mail run, with its placeholders');

  await world.advanceTo('2027-01-10T07:59:00Z');
  assert.equal(onTheVm(world, kept[1]!).length, 1, 'kept until its 90 days are up');
  await world.advanceTo('2027-01-11T09:30:00Z'); // 01:30 PST, after the daily expiry
  for (const line of kept) assert.deepEqual(onTheVm(world, line), [], `${line} is gone`);
});

test('Gmail’s rate limits are obeyed: the bot waits 1 second, then twice as long each time, or as long as Retry-After asks', async (t) => {
  const world = await startWorld({ now: '2026-11-14T15:00:00Z' });
  t.after(() => world.stop());
  await world.assistant.whenIdle();
  world.gmail.limitNext({}, {}, { status: 403 }, { retryAfterSeconds: 30 });
  const [id] = await delivered(world, { from: 'Shop <news@shop.example>', text: 'Read once Gmail lets it.' }); // 15:00:05
  for (const when of ['15:00:05.999', '15:00:06', '15:00:07.999', '15:00:08', '15:00:11.999', '15:00:12', '15:00:41.999', '15:00:42']) {
    await world.advanceTo(`2026-11-14T${when}Z`);
  }

  const reads = world.gmail.requests.filter((r) => r.path === '/history').map((r) => r.at.slice(11, 23));
  assert.deepEqual(reads, ['15:00:05.000', '15:00:06.000', '15:00:08.000', '15:00:12.000', '15:00:42.000']);
  assert.deepEqual(
    world.logs.filter((l) => l.event === 'gmail.read-failed').map((l) => l.retryInSeconds),
    [1, 2, 4, 30],
  );
  assert.deepEqual(recorded(world).map((r) => r.messageId), [id]);
  // Once a read goes through, the reads are 5 seconds apart again.
  await world.advanceTo('2026-11-14T15:00:47Z');
  assert.equal(world.gmail.requests.filter((r) => r.path === '/history').at(-1)!.at, '2026-11-14T15:00:47.000Z');
});

test('a store that is lost starts from the mailbox’s history now: older mail counts as seen, and what comes after is read', async (t) => {
  const world = await startWorld({ now: '2026-11-14T15:00:00Z' });
  t.after(() => world.stop());
  const [before] = await delivered(world, { from: 'Shop <news@shop.example>', subject: 'Before', text: 'Read before the loss.' });
  // The live store is lost while the bot is down, and a mail comes meanwhile.
  const meanwhile = world.gmail.deliver({ from: 'Shop <news@shop.example>', subject: 'Meanwhile', text: 'Came while the store was lost.' });
  await world.outage('2026-11-14T16:00:00Z', () => {
    for (const file of ['assistant.sqlite', 'assistant.sqlite-wal', 'assistant.sqlite-shm']) rmSync(join(world.dataDir, file), { force: true });
  });
  const after = await delivered(world, { from: 'Shop <news@shop.example>', subject: 'After', text: 'Came after the restart.' });

  assert.deepEqual(recorded(world).map((r) => r.messageId), [before, ...after]);
  assert.deepEqual(world.gmail.readsOf(meanwhile), [], 'missing a mail is safer than handling one twice');
  assert.equal(world.logs.filter((l) => l.event === 'mail.history-started').length, 2);
});

test('Spam is read like the Inbox, Trash is ignored, and nothing in the mailbox is ever moved', async (t) => {
  const world = await registered(t);
  const [spam, trash, inbox] = await delivered(
    world,
    { from: 'Codemind <hello@codemindhq.dev>', to: PLUS_ADDRESS, subject: 'Welcome', text: 'Filed in Spam.', spam: true },
    { from: 'Codemind <hello@codemindhq.dev>', to: PLUS_ADDRESS, subject: 'Tips', text: 'Deleted at once.', trash: true },
    { from: 'Codemind <hello@codemindhq.dev>', to: PLUS_ADDRESS, subject: 'Getting started', text: 'In the Inbox.' },
  );

  assert.deepEqual(
    world.logs.filter((l) => l.event === 'mail.recorded').map(({ messageId, spam, product, disposition }) => ({ messageId, spam, product, disposition })),
    [
      { messageId: spam, spam: true, product: 'codemindhq.dev', disposition: 'queued' },
      { messageId: inbox, spam: false, product: 'codemindhq.dev', disposition: 'queued' },
    ],
  );
  assert.deepEqual(whereItShows(world, 'Deleted at once.'), [], 'mail in the Trash is neither recorded nor kept');
  assert.equal(world.gmail.readsOf(trash!).length, 1, 'the bot read it, and found it in the Trash');
  assert.deepEqual(world.gmail.changes, [], 'no request that would label, move, trash or delete');
});

test('an access token is traded again before Google’s hour is up, and again once Gmail refuses it, waiting as long as Google asks', async (t) => {
  const world = await startWorld({ now: '2026-11-14T15:00:00Z' });
  t.after(() => world.stop());
  await world.assistant.whenIdle();
  await world.advanceTo('2026-11-14T16:00:00Z');
  assert.deepEqual(world.gmail.refreshes.map((r) => r.at), ['2026-11-14T15:00:00.000Z', '2026-11-14T16:00:00.000Z'], 'a new one before the first ends');

  // Gmail stops taking it, and Google then limits the rate of trades once.
  world.gmail.revokeAccessTokens();
  world.gmail.limitTokenRefresh(90);
  const [id] = await delivered(world, { from: 'Shop <news@shop.example>', text: 'Read with a new access token.' }); // 16:00:05
  await world.advanceTo('2026-11-14T16:00:06Z');
  await world.advanceTo('2026-11-14T16:01:35.999Z');
  assert.equal(world.gmail.refreshes.length, 2, 'none before the 90 seconds are up');
  await world.advanceTo('2026-11-14T16:01:36Z');
  assert.deepEqual(world.logs.filter((l) => l.event === 'gmail.read-failed').map((l) => l.retryInSeconds), [1, 90]);
  assert.equal(world.gmail.refreshes.at(-1)!.at, '2026-11-14T16:01:36.000Z');
  assert.deepEqual(recorded(world).map((r) => r.messageId), [id]);
});

test('a mail deleted before it is read, one Gmail sends malformed, and the mailbox’s own drafts and sent mail cost no other mail', async (t) => {
  const world = await registered(t);
  await world.assistant.whenIdle();
  const gone = world.gmail.deliver({ from: 'Codemind <hello@codemindhq.dev>', text: 'Deleted before the read.' });
  world.gmail.remove(gone);
  const malformed = world.gmail.deliver({ from: 'Codemind <hello@codemindhq.dev>', text: 'Malformed.' });
  world.gmail.corrupt(malformed, (m) => {
    m.internalDate = '100000000000000000000';
    (m.payload as Record<string, unknown>).headers = { From: 'not a list' };
  });
  const draft = world.gmail.deliver({ from: SIGNUP_MAILBOX, to: 'hello@codemindhq.dev', text: 'A draft of the mailbox’s own.', own: 'DRAFT' });
  const sent = world.gmail.deliver({ from: SIGNUP_MAILBOX, to: 'hello@codemindhq.dev', text: 'Mail the mailbox sent.', own: 'SENT' });
  const fine = world.gmail.deliver({ from: 'Codemind <hello@codemindhq.dev>', subject: 'Charset', text: 'Read as UTF-8: café, whatever the charset says.', charset: 'x-no-such-charset' });
  await world.advanceTo(new Date(world.clock.now().getTime() + 5000).toISOString());

  assert.deepEqual(recorded(world).map((r) => r.messageId), [fine]);
  assert.deepEqual(world.logs.filter((l) => l.event === 'mail.gone').map((l) => l.messageId), [gone]);
  assert.deepEqual(world.logs.filter((l) => l.event === 'mail.unreadable').map((l) => l.messageId), [malformed]);
  assert.equal(onTheVm(world, 'Read as UTF-8: café, whatever the charset says.').length, 1, 'its text is kept, read as UTF-8');
  assert.deepEqual(whereItShows(world, 'A draft of the mailbox’s own.'), []);

  // The batch went through: the next read starts after it. The one mail recorded, matched to the Registration awaiting
  // verification, is read once more for a code or link (#58).
  await world.advanceTo(new Date(world.clock.now().getTime() + 5000).toISOString());
  for (const id of [gone, malformed, draft, sent, fine]) assert.equal(world.gmail.readsOf(id).length, id === fine ? 2 : 1, id);
});

test('the text of a mail kept before the store was lost still goes after 90 days', async (t) => {
  const world = await registered(t);
  await delivered(world, { from: 'Codemind <hello@codemindhq.dev>', to: PLUS_ADDRESS, subject: 'Tips', text: 'Kept before the store was lost.' });
  assert.equal(onTheVm(world, 'Kept before the store was lost.').length, 1);
  await world.outage('2026-10-13T08:00:00Z', () => {
    for (const file of ['assistant.sqlite', 'assistant.sqlite-wal', 'assistant.sqlite-shm']) rmSync(join(world.dataDir, file), { force: true });
  });
  assert.equal(onTheVm(world, 'Kept before the store was lost.').length, 1, 'the new store doesn’t index it');

  await world.advanceTo('2027-01-11T09:30:00Z'); // 01:30 PST, after the daily expiry, 90 days on
  assert.deepEqual(onTheVm(world, 'Kept before the store was lost.'), []);
});
