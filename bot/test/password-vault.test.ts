// The Password vault at Approval (#54, ADR 0004, ADR 0009): approving a Walkthrough with a password field creates one
// vault item before the Registration starts, with a password the bot makes, and the only way out for that password is
// `bw`. While Bitwarden is unavailable the Approval is held, and Approve answers that it waits. Fills by reference and
// replacement passwords are #56's, settled on #54.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODEMIND } from './harness/dossier-fixtures.ts';
import { REGISTRATIONS } from './harness/fake-bitwarden.ts';
import { until } from './harness/miner-day.ts';
import { whereItShows } from './harness/secrets.ts';
import { approve, walkthroughPut, WITH_PASSWORD } from './harness/walkthrough-day.ts';
import { NEEDS_YOU, PERSON, PRODUCTS_FORUM, TOKENS } from './harness/world.ts';

test('approving a Walkthrough with a password field creates one vault item, and its password shows nowhere but `bw`', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  assert.equal(world.bitwarden.calls.length, 0, 'Bitwarden is untouched until an Approval needs it');

  await world.advanceTo('2026-10-12T16:03:00Z'); // 09:03 PDT
  await approve(world);
  await world.assistant.whenIdle();

  const [item, ...others] = world.bitwarden.items;
  assert.deepEqual(others, [], 'one item');
  assert.equal(item!.name, 'Codemind', 'named after the Product');
  assert.deepEqual(item!.login.uris.map((u) => u.uri), ['https://codemindhq.dev'], 'its website is the root domain, which AutoFill needs');
  assert.equal(item!.login.username, 'you+codemind@gmail.com', 'its username is the Signup identity');
  assert.deepEqual(item!.collectionIds, [REGISTRATIONS], 'in the Registrations collection');

  const { password } = item!.login;
  assert.equal(password.length, 24);
  for (const [what, chars] of [['a lowercase letter', /[a-z]/], ['an uppercase letter', /[A-Z]/], ['a digit', /[0-9]/], ['a symbol', /[^a-zA-Z0-9]/]] as const) {
    assert.match(password, chars, `the password has ${what}`);
  }

  assert.deepEqual(whereItShows(world, password), []);
  const create = world.bitwarden.calls.find((call) => call.args[0] === 'create')!;
  assert.ok(create.stdin, 'the item reaches `bw` on stdin');

  // The session key stays in the bot's memory, and reaches `bw` only through its environment.
  const [session] = world.bitwarden.sessionKeys;
  assert.ok(session);
  assert.deepEqual(whereItShows(world, session), []);
  assert.ok(create.env.includes('BW_SESSION'));

  // `bw login` prints a session key of its own inside its message, as the real one was seen to: it goes nowhere.
  const [loginKey] = world.bitwarden.loginKeys;
  assert.ok(loginKey);
  assert.deepEqual(whereItShows(world, loginKey), []);

  // Nothing listens, and nothing changes or deletes an item.
  assert.deepEqual(world.bitwarden.calls.map((call) => call.args[0]).filter((command) => ['serve', 'edit', 'delete', 'restore', 'move'].includes(command!)), []);

  // The Registration then starts, and its form is filled (#56): the card locks, and the post and git say so.
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.equal(world.discord.cards(NEEDS_YOU)[0]!.text, `✅ Approved v1 09:03 · **Codemind** · <#${post!.id}>`);
  assert.deepEqual(post!.tags, ['Registering']);
  assert.ok(post!.messages.at(-1)!.text.startsWith('**Registration** · submitted 09:03 PT Mon Oct 12 · awaiting verification · Walkthrough v1 approved 09:03 PT Mon Oct 12'));
  assert.ok(
    world.git.file('products/codemindhq.dev/registration.md')!.includes(`- 2026-10-12 09:03 PT · Walkthrough v1 approved · you+codemind@gmail.com · password in the Password vault, item ${item!.id}\n`),
    'the record holds the item id',
  );
  assert.ok(world.logs.some((line) => line.event === 'vault-item.created' && line.itemId === item!.id));
  assert.deepEqual(world.discord.refused, []);
});

test('a Walkthrough with no password field creates no item, and never runs `bw`', async (t) => {
  const world = await walkthroughPut(t, CODEMIND);
  await approve(world);
  await world.assistant.whenIdle();

  // Its form is filled with no password, so nothing reads one back either (#56).
  assert.equal(world.bitwarden.calls.length, 0);
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.deepEqual(post!.tags, ['Registering']);
  assert.match(post!.messages.at(-1)!.text, /^\*\*Registration\*\* · submitted [^·]+ · awaiting verification · Walkthrough v1 approved/);
  assert.equal(world.browser.presses.length, 1);
  assert.ok(!world.git.file('products/codemindhq.dev/registration.md')!.includes('Password vault'));
});

test('a Handoff with a password field gets its item too, as the person finishes it through AutoFill', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD, { change: (w) => ({ ...w, termsBan: 'Accounts must be created by a person.' }) });
  await approve(world);
  await world.assistant.whenIdle();

  assert.equal(world.bitwarden.items.length, 1);
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.deepEqual(post!.tags, ['handed off']);
  assert.ok(post!.messages.at(-1)!.text.startsWith('**Registration** · handed off'));
});

test('while Bitwarden is unavailable an Approval is held, Approve says it waits, and it goes on by itself once Bitwarden is back', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  const before = world.discord.forumPosts(PRODUCTS_FORUM)[0]!;
  world.bitwarden.down = true;

  await world.advanceTo('2026-10-12T16:03:00Z'); // 09:03 PDT
  await approve(world);
  await world.assistant.whenIdle();

  const card = world.discord.cards(NEEDS_YOU)[0]!;
  assert.ok(card.text.endsWith('-# Approved 09:03. Waiting for Bitwarden: the Registration starts once its new password is saved.'), card.text);
  assert.deepEqual(
    card.buttons.map((b) => [b.label, b.disabled]),
    [['Approve', true], ['Correct', false], ['Dismiss', true], ['Stop', false]],
    'the Approval is kept, so only its Registration\'s Stop and Correct can be tapped (#56)',
  );
  assert.equal(world.bitwarden.items.length, 0);
  const held = world.discord.forumPosts(PRODUCTS_FORUM)[0]!;
  assert.equal(held.messages.length, before.messages.length, 'the Registration has not started: no status message');
  assert.deepEqual(held.tags, ['Walkthrough']);
  assert.ok(!world.git.file('products/codemindhq.dev/registration.md')?.includes('approved'));
  assert.ok(world.logs.some((line) => line.event === 'password-vault.unavailable'), 'its log line says why');

  // A second tap keeps one Approval.
  const again = await world.discord.tap({ userId: PERSON, customId: card.buttons[0]!.customId, channelId: NEEDS_YOU, messageId: card.id });
  assert.equal(again.data?.content, 'Already approved at 09:03.');

  // Bitwarden is tried again, and the card isn't edited each time.
  const edits = world.discord.calls.filter((call) => call.startsWith(`PATCH /channels/${NEEDS_YOU}/`)).length;
  const tries = world.bitwarden.calls.length;
  await world.advanceTo('2026-10-12T16:08:00Z'); // 09:08 PDT
  assert.ok(world.bitwarden.calls.length > tries, 'tried again');
  assert.equal(world.bitwarden.items.length, 0);
  assert.equal(world.discord.calls.filter((call) => call.startsWith(`PATCH /channels/${NEEDS_YOU}/`)).length, edits);

  world.bitwarden.down = false;
  await world.advanceTo('2026-10-12T16:13:00Z'); // 09:13 PDT
  assert.equal(world.bitwarden.items.length, 1);
  const started = world.discord.forumPosts(PRODUCTS_FORUM)[0]!;
  assert.deepEqual(started.tags, ['Registering']);
  assert.ok(
    started.messages.at(-1)!.text.startsWith('**Registration** · submitted 09:13 PT Mon Oct 12 · awaiting verification · Walkthrough v1 approved 09:03 PT Mon Oct 12'),
    'approved when it was tapped, and filled once Bitwarden was back',
  );
  assert.equal(world.discord.cards(NEEDS_YOU)[0]!.text, `✅ Approved v1 09:03 · **Codemind** · <#${started.id}>`);
  assert.deepEqual(world.discord.refused, []);
});

test('an Approval held across a restart goes on at the bot’s next start', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  world.bitwarden.down = true;
  await approve(world);
  await world.assistant.whenIdle();
  assert.equal(world.bitwarden.items.length, 0);

  await world.restart();
  assert.equal(world.bitwarden.items.length, 0, 'still held');
  const messages = world.discord.forumPosts(PRODUCTS_FORUM)[0]!.messages.length;

  world.bitwarden.down = false;
  await world.restart();
  assert.equal(world.bitwarden.items.length, 1);
  assert.equal(world.discord.forumPosts(PRODUCTS_FORUM)[0]!.messages.length, messages + 1, 'its one status message');
});

test('an account that sees anything but the Registrations collection is held: the item never goes elsewhere', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  world.bitwarden.addCollection('Everything');
  await approve(world);
  await world.assistant.whenIdle();

  assert.equal(world.bitwarden.items.length, 0);
  assert.ok(world.logs.some((line) => line.event === 'password-vault.unavailable' && /2 collections/.test(String(line.why))));

  world.bitwarden.removeOtherCollections();
  await world.advanceTo('2026-10-12T08:10:00Z');
  assert.deepEqual(world.bitwarden.items.map((item) => item.collectionIds), [[REGISTRATIONS]]);
});

test('a master password that no longer unlocks Bitwarden holds the Approval, without losing the login', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  world.bitwarden.masterPassword = 'the person changed it';
  await approve(world);
  await world.assistant.whenIdle();
  assert.equal(world.bitwarden.items.length, 0);
  assert.ok(world.logs.some((line) => line.event === 'password-vault.unavailable'));
  assert.deepEqual(whereItShows(world, TOKENS.bitwardenMasterPassword), []);
  assert.deepEqual(whereItShows(world, TOKENS.bitwardenClientSecret), []);

  // `ops/token bitwarden-master-password` replaces it, and its restart brings the new one.
  world.bitwarden.masterPassword = TOKENS.bitwardenMasterPassword;
  await world.restart();
  assert.equal(world.bitwarden.items.length, 1);
  assert.equal(world.bitwarden.calls.filter((call) => call.args[0] === 'login').length, 1, 'a login lasts across runs');
});

test('a bitwarden-api-key token that holds no key holds the Approval, and says why in the log', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD, { start: { bitwardenApiKey: 'not a key' } });
  await approve(world);
  await world.assistant.whenIdle();

  assert.equal(world.bitwarden.items.length, 0);
  assert.deepEqual(world.bitwarden.calls.map((call) => call.args[0]), ['status'], 'no login is tried without a key');
  assert.ok(world.logs.some((line) => line.event === 'password-vault.unavailable' && /holds no client_id/.test(String(line.why))));
  assert.ok(world.discord.cards(NEEDS_YOU)[0]!.text.includes('Waiting for Bitwarden'));
});

test('a `bw` command that never answers is killed at its time limit, holds the Approval, and leaves one item', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD, {
    start: {
      configure: (config) => {
        config.bitwarden.timeoutSeconds = 2;
      },
    },
  });
  world.bitwarden.holdCreate = 'before';
  await approve(world);
  await until(() => world.bitwarden.heldCreate);
  await world.assistant.whenIdle();

  assert.equal(world.bitwarden.items.length, 0);
  assert.ok(world.logs.some((line) => line.event === 'password-vault.unavailable' && /longer than 2 s/.test(String(line.why))), 'the time limit ended it');
  assert.equal(world.processesRunning(), 0, 'nothing of it is left running');

  // The fake's own start can pass 2 seconds on a busy machine, so give it a few tries.
  world.bitwarden.holdCreate = null;
  for (let minutes = 10; minutes <= 40 && world.bitwarden.items.length === 0; minutes += 10) {
    await world.advanceTo(`2026-10-12T08:${minutes}:00Z`);
  }
  assert.equal(world.bitwarden.items.length, 1);
  assert.deepEqual(world.discord.forumPosts(PRODUCTS_FORUM)[0]!.tags, ['Registering']);
});

for (const [when, stops] of [
  ['before the Password vault has the item', 'before'],
  ['once the Password vault has the item', 'after'],
] as const) {
  test(`the bot killed while \`bw\` creates an item, ${when}, leaves one item`, async (t) => {
    const world = await walkthroughPut(t, WITH_PASSWORD);
    world.bitwarden.holdCreate = stops;
    await approve(world);
    await until(() => world.bitwarden.heldCreate);

    await world.kill();
    assert.equal(world.bitwarden.items.length, stops === 'after' ? 1 : 0);
    world.bitwarden.holdCreate = null;
    await world.restart();

    const [item, ...others] = world.bitwarden.items;
    assert.deepEqual(others, [], 'one item');
    assert.ok(world.git.file('products/codemindhq.dev/registration.md')!.includes(`item ${item!.id}\n`), 'the record names that item');
    assert.deepEqual(world.discord.forumPosts(PRODUCTS_FORUM)[0]!.tags, ['Registering']);
    assert.equal(world.logs.some((line) => line.event === 'vault-item.found'), stops === 'after', 'read back when it got there');
  });
}

test('a create that fails after the Password vault took the item is read back, not made twice', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  world.bitwarden.failAfterCreate = true;
  await approve(world);
  await world.assistant.whenIdle();
  assert.equal(world.bitwarden.items.length, 1);
  assert.ok(world.discord.cards(NEEDS_YOU)[0]!.text.includes('Waiting for Bitwarden'), 'an answer it never got counts as unavailable');

  world.bitwarden.failAfterCreate = false;
  await world.advanceTo('2026-10-12T08:10:00Z');
  assert.equal(world.bitwarden.items.length, 1, 'one item');
  assert.ok(world.logs.some((line) => line.event === 'vault-item.found' && line.itemId === world.bitwarden.items[0]!.id));
  assert.deepEqual(world.discord.forumPosts(PRODUCTS_FORUM)[0]!.tags, ['Registering']);
});
