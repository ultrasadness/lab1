// The last door (#54, ADR 0009): the bot refuses any model request, at the forwarder, any Discord payload and any commit
// to the Personal database holding the exact value of a Secret it holds, and posts one #needs-you notice naming the
// token to replace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ScriptedWalkthrough } from './harness/fake-model.ts';
import { fixtureDay } from './harness/fake-product-hunt.ts';
import { whoReceived } from './harness/secrets.ts';
import { approve, walkthroughPut, WITH_PASSWORD } from './harness/walkthrough-day.ts';
import { NEEDS_YOU, PERSON, PRODUCTS_FORUM, startWorld, TOKENS, type World } from './harness/world.ts';

/** Every Secret the bot holds from its credentials, by the name `ops/token` knows it under. */
const TOKEN_VALUES: Record<string, string> = {
  'discord-bot-token': TOKENS.discord,
  'producthunt-token': TOKENS.productHunt,
  'newapi-key-miner': TOKENS.minerKey,
  'newapi-key-registration': TOKENS.registrationKey,
  'newapi-key-mail': TOKENS.mailKey,
  'personal-database-deploy-key': TOKENS.deployKey.trim(),
  'bitwarden-api-key': TOKENS.bitwardenClientSecret,
  'bitwarden-master-password': TOKENS.bitwardenMasterPassword,
};

/** The #needs-you cards that tell the person to replace something, naming this. */
const noticesNaming = (world: World, name: string) => world.discord.cards(NEEDS_YOU).filter((card) => card.text.includes(`Replace ${name}`));

const refusals = (world: World, door: string, secret: string) => world.logs.filter((line) => line.event === 'secret.refused' && line.door === door && line.secret === secret).length;

test('a model that echoes a token is refused at the forwarder, the day’s file never reaches GitHub, and the person is told which token to replace', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' }); // 00:30 PDT
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  // Its first run's one reply judges up to 8 Launches: each judgment's reason holds one more Secret. The fake says them
  // back in the request after it, as a model that somehow learned them would.
  const values = Object.values(TOKEN_VALUES);
  let told = 0;
  world.model.onlyDossiers([]);
  const quiet = world.model.judgment;
  world.model.judgment = (postId) => {
    const judgment = quiet(postId);
    if (judgment === 'omit') return judgment;
    const value = values[told++];
    return value === undefined ? judgment : { ...judgment, reason: `It said ${value}` };
  };
  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT
  await world.discord.connected();
  await world.assistant.whenIdle();

  assert.ok(told >= values.length, 'the reply held every Secret');
  for (const [name, value] of Object.entries(TOKEN_VALUES)) {
    assert.ok(refusals(world, 'a model request', name) > 0, `${name} is refused at the forwarder`);
    // The fake's reply held it, but the request that would say it back never left the bot, and neither did a card or a commit.
    assert.deepEqual(whoReceived(world, value), [], name);
    const [notice, ...more] = noticesNaming(world, name);
    assert.deepEqual(more, [], `one notice for ${name}`);
    assert.ok(notice, `a notice names ${name}`);
    assert.deepEqual(notice.mentions, [PERSON], 'a notice in #needs-you notifies the person');
    assert.ok(notice.text.includes(`sudo ops/token ${name}`), notice.text);
    for (const secret of values) assert.ok(!notice.text.includes(secret), 'the notice names the token, never its value');
  }
  assert.deepEqual(world.discord.refused, []);
});

test('a file holding a Secret is refused at the commit: it never reaches GitHub, and later files still do', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' }); // 00:30 PDT
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  // One judgment's reason holds a token, so the date's file does once the date is judged.
  world.model.onlyDossiers([]);
  const quiet = world.model.judgment;
  let said = false;
  world.model.judgment = (postId) => {
    const judgment = quiet(postId);
    if (judgment === 'omit' || said) return judgment;
    said = true;
    return { ...judgment, reason: `It said ${TOKENS.productHunt}` };
  };
  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT
  await world.discord.connected();
  await world.stepThrough('2026-10-12T10:00:00Z', 30);

  assert.ok(refusals(world, 'a commit to the Personal database', 'producthunt-token') > 0, 'the door was reached');
  assert.equal(world.git.file('days/2026-10-12.md'), undefined, 'the file stays as it was: here, not there');
  assert.deepEqual(whoReceived(world, TOKENS.productHunt), []);
  assert.equal(noticesNaming(world, 'producthunt-token').length, 1, 'one notice, whichever door stopped it first');

  world.productHunt.addFeatured(fixtureDay('2026-10-13'), '2026-10-13T07:01:00Z');
  await world.advanceTo('2026-10-13T08:00:00Z'); // 01:00 PDT
  await world.stepThrough('2026-10-13T09:00:00Z', 30);
  assert.ok(world.git.file('days/2026-10-13.md'), 'the next date’s file goes out');
  assert.deepEqual(whoReceived(world, TOKENS.productHunt), []);
});

test('a Secret in a run’s first request never reaches the provider, as a URL carries it or with JSON’s escapes', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' }); // 00:30 PDT
  t.after(() => world.stop());
  // A Launch's text, from outside, somehow holds the master password, with the characters URLs and JSON each escape.
  const [first, ...rest] = fixtureDay('2026-10-12');
  world.productHunt.addFeatured(
    [{ ...first!, description: `See https://example.com/?key=${encodeURIComponent(TOKENS.bitwardenMasterPassword)} and "${TOKENS.bitwardenMasterPassword}"` }, ...rest],
    '2026-10-12T07:01:00Z',
  );
  world.model.onlyDossiers([]);
  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT
  await world.discord.connected();
  await world.assistant.whenIdle();

  assert.deepEqual(whoReceived(world, TOKENS.bitwardenMasterPassword), []);
  assert.ok(refusals(world, 'a model request', 'bitwarden-master-password') > 0);
  assert.equal(noticesNaming(world, 'bitwarden-master-password').length, 1);
  assert.ok(world.logs.some((line) => line.event === 'run.finished' && line.outcome === 'failed'), 'the run that held it fails');
});

/** Has the Walkthrough fill the signup form's Company field with this value. */
const companyIs = (value: string) => (walkthrough: ScriptedWalkthrough) => ({
  ...walkthrough,
  fields: walkthrough.fields.map((f) => (f.field === 3 ? { field: 3, fill: 'value', value } : f)),
});

test('a card holding a Secret is refused at Discord, however often it is tried, with one notice', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD, { change: companyIs(TOKENS.productHunt) });

  assert.deepEqual(whoReceived(world, TOKENS.productHunt), [], 'nobody outside received it');
  const first = refusals(world, 'a Discord message', 'producthunt-token');
  assert.ok(first > 0, 'refused at Discord');
  assert.equal(noticesNaming(world, 'producthunt-token').length, 1);
  assert.ok(!world.discord.cards(NEEDS_YOU).some((card) => card.text.includes('Walkthrough v1')), 'the card holding it did not go out');
  assert.deepEqual(world.discord.refused, [], 'Discord had nothing to refuse: the bot stopped it first');

  // The Walkthrough is tried again every 30 minutes, and the person isn't told again each time.
  await world.advanceTo('2026-10-12T08:31:00Z');
  assert.ok(refusals(world, 'a Discord message', 'producthunt-token') > first, 'it was tried again');
  assert.equal(noticesNaming(world, 'producthunt-token').length, 1);
  assert.deepEqual(whoReceived(world, TOKENS.productHunt), []);
});

test('a notice Discord doesn’t take is sent at the next refusal', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD, {
    change: companyIs(TOKENS.productHunt),
    before: (w) => w.discord.refuseNextMessage(NEEDS_YOU),
  });
  // The model request that says it back is refused first, and Discord refuses that notice. The card is refused next.
  assert.ok(world.logs.some((line) => line.event === 'secret.notice-failed' && line.secret === 'producthunt-token'), 'Discord refused the first');
  assert.ok(refusals(world, 'a model request', 'producthunt-token') > 0);
  assert.ok(refusals(world, 'a Discord message', 'producthunt-token') > 0);
  assert.equal(noticesNaming(world, 'producthunt-token').length, 1, 'the next refusal sent it');
});

test('a generated password is held too: a model echoing it is refused, and the notice says how to replace it', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  await approve(world);
  await world.assistant.whenIdle();
  const [item] = world.bitwarden.items;
  const { password } = item!.login;

  // The next day's run says it back, as though a page had shown it.
  world.productHunt.addFeatured(fixtureDay('2026-10-13'), '2026-10-13T07:01:00Z');
  const quiet = world.model.judgment;
  let said = 0;
  world.model.judgment = (postId) => {
    const judgment = quiet(postId);
    if (judgment === 'omit' || said++ > 0) return judgment;
    return { ...judgment, fit: 1, reason: `It said ${password}` };
  };
  await world.advanceTo('2026-10-13T08:00:00Z'); // 01:00 PDT
  await world.assistant.whenIdle();

  assert.ok(said > 0);
  assert.ok(world.logs.some((line) => line.event === 'secret.refused' && line.secret === 'the password of Codemind'));
  const [notice, ...more] = noticesNaming(world, 'the password of Codemind');
  assert.deepEqual(more, []);
  assert.ok(notice, 'a notice names it');
  assert.ok(notice.text.includes('Bitwarden › Registrations › Codemind'), notice.text);
  assert.ok(!notice.text.includes(password));
  assert.deepEqual(whoReceived(world, password), []);
  assert.ok(!world.discord.forumPosts(PRODUCTS_FORUM)[0]!.messages.some((m) => m.text.includes(password)));
});
