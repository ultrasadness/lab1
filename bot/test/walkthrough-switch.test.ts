// The Walkthroughs switch (#99): `walkthroughs.on` in the config, changed through ops/upgrade. While Walkthroughs are
// off, a Dossier says nothing of one and nothing prepares one. The bot needs the Signup mailbox's address either way,
// since it reads that mailbox (#57). Turning them on prepares a Walkthrough for each open or waitlisted Dossier posted while they were off,
// however old it is. The config shipped with them off from go-live (#85) until #109 turned them on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NEEDS_YOU, PERSON, PRODUCTS_FORUM, startWorld } from './harness/world.ts';
import { fixtureDay, websiteOf } from './harness/fake-product-hunt.ts';
import { ACYCLIC, CODEMIND, serveProduct } from './harness/dossier-fixtures.ts';

/** The config the bot ships with. */
const SHIPPED = JSON.parse(readFileSync(new URL('../../config/assistant.json', import.meta.url), 'utf8')) as { walkthroughs: { on: boolean }; signupMailbox: string };

/** Walkthroughs off, as the config shipped from go-live (#85) until #109. */
const withWalkthroughsOff = <C extends object>(config: C) => Object.assign(config, { walkthroughs: { on: false } });

const REGISTER = '**Register:** Sign in with an emailed link or Google at app.codemindhq.dev; signing in creates the account. No card.⁴ ⁵';

test('with Walkthroughs off, an Open Product’s Dossier says nothing of a Walkthrough, and none is prepared', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z', configure: (config) => (config.walkthroughs.on = false) }); // 00:30 PDT
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId]);
  serveProduct(world, CODEMIND);

  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT
  // A Walkthrough that can't be prepared is tried again every 30 minutes, so the day goes on a while.
  await world.stepThrough('2026-10-12T16:00:00Z', 30);

  const [post, ...others] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.deepEqual(others, []);
  assert.deepEqual(post!.tags, [], 'no tag: the Walkthrough tag is for one waiting on the person');
  const [dossier, ...rest] = post!.messages;
  assert.deepEqual(rest, [], 'no copy of a Walkthrough');
  assert.ok(dossier!.text.split('\n').includes(REGISTER), dossier!.text);
  assert.doesNotMatch(dossier!.text, /Walkthrough/);
  assert.deepEqual(
    world.browser.reads,
    [websiteOf(CODEMIND.postId), 'https://codemindhq.dev/pricing/', 'https://app.codemindhq.dev/'],
    'the signup page is read once, for the Dossier',
  );
  assert.deepEqual(world.model.walkthroughRuns, []);
  assert.deepEqual(world.discord.cards(NEEDS_YOU), []);
  assert.deepEqual(world.discord.refused, []);
});

test('the config ships with Walkthroughs on and the Signup mailbox’s address (#109), which the bot needs whether they are on or off (#57)', async (t) => {
  assert.deepEqual(SHIPPED.walkthroughs, { on: true });
  const shipped = await startWorld({
    now: '2026-10-12T07:30:00Z',
    configure: (config) => Object.assign(config, { walkthroughs: { ...SHIPPED.walkthroughs }, signupMailbox: SHIPPED.signupMailbox }),
  });
  t.after(() => shipped.stop());
  assert.ok(shipped.logs.some((l) => l.event === 'assistant.started'));

  // An unset address is a config error at start-up, with Walkthroughs on or off.
  for (const on of [true, false]) {
    await assert.rejects(
      startWorld({ now: '2026-10-12T07:30:00Z', configure: (config) => Object.assign(config, { walkthroughs: { on }, signupMailbox: 'set when Walkthroughs turn on' }) }),
      /signupMailbox must be the Signup mailbox's address, with no \+/,
    );
  }
});

test('turning Walkthroughs on prepares one for each Open Product whose Dossier was posted while they were off, oldest first', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z', configure: withWalkthroughsOff }); // 00:30 PDT
  t.after(() => world.stop());
  for (const date of ['2026-10-12', '2026-10-13', '2026-10-14']) world.productHunt.addFeatured(fixtureDay(date), `${date}T07:01:00Z`);
  world.model.onlyDossiers([CODEMIND.postId, ACYCLIC.postId]);
  serveProduct(world, CODEMIND);
  serveProduct(world, ACYCLIC);
  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT Mon Oct 12: Codemind's Dossier
  await world.advanceTo('2026-10-13T08:00:00Z');
  await world.advanceTo('2026-10-14T08:00:00Z'); // 01:00 PDT Wed Oct 14: Acyclic's Dossier
  const before = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.deepEqual(
    before.map((p) => [p.title.split(' · ')[0], p.tags]),
    [
      ['Codemind', []],
      ['Acyclic', []],
    ],
  );
  assert.equal(world.discord.cards(NEEDS_YOU).length, 0);

  // ops/upgrade turns them on, with the Signup mailbox's address, at 09:00 PST Thu Nov 12, a month on.
  world.clock.advanceTo('2026-10-14T09:00:00Z');
  await world.outage('2026-11-12T17:00:00Z', (config) => Object.assign(config, { walkthroughs: { on: true } }));

  assert.deepEqual(world.model.walkthroughRuns.map((r) => r.rootDomain), ['codemindhq.dev', 'acyclic.dev'], 'the oldest Dossier’s first');
  const cards = world.discord.cards(NEEDS_YOU);
  assert.deepEqual(
    cards.map((c) => c.text.split('\n')[0]),
    [`<@${PERSON}> **Walkthrough v1 · Codemind**`, `<@${PERSON}> **Walkthrough v1 · Acyclic**`],
  );
  const [card] = cards;
  assert.ok(card!.text.includes('as **you+codemind@gmail.com**'), card!.text);
  assert.ok(card!.text.endsWith('signup page read 09:00 PT Thu Nov 12'), card!.text);
  assert.deepEqual(
    card!.buttons.map((b) => [b.label, b.disabled]),
    [
      ['Approve', false],
      ['Correct', false],
      ['Dismiss', false],
    ],
  );
  const posts = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.deepEqual(posts.map((p) => p.id), before.map((p) => p.id), 'no new post');
  assert.deepEqual(posts.map((p) => p.tags), [['Walkthrough'], ['Walkthrough']]);
  const [dossier, copy, ...rest] = posts[0]!.messages;
  assert.deepEqual(rest, []);
  assert.ok(dossier!.text.split('\n').includes(`${REGISTER} Walkthrough in <#${NEEDS_YOU}>.`), dossier!.text);
  assert.match(copy!.text, /^\*\*Walkthrough v1\*\* · /);
  assert.deepEqual(world.discord.refused, []);
});
