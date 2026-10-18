// A Miner date's list goes out once: an empty answer from Product Hunt is never taken as the date's set, and a post
// or message Discord took while the bot never heard back is read back from Discord, not sent again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINER_DAYS_FORUM, startWorld } from './harness/world.ts';
import { fixtureDay } from './harness/fake-product-hunt.ts';

test('a post or message Discord took before the bot stopped is read back, never sent twice', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.discord.loseReply('post');

  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.equal(world.discord.forumPosts(MINER_DAYS_FORUM).length, 1, 'Discord has the post; the bot never heard back');

  world.discord.loseReply('message', 2);
  await world.restart();
  await world.restart();

  const posts = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(posts.length, 1, 'one post for the day');
  assert.equal(posts[0]!.title, 'Mon Oct 12 · 4 Dossiers · line 7');
  assert.deepEqual(
    posts[0]!.messages.map((m) => m.headings[0]?.split('\n')[0]),
    ['## Miner · Mon Oct 12', '### Dossiers', '### Near misses · fit 6', '### Further off · fit 3–5', '### Far off · fit 0–2'],
    'each message once, in order',
  );
  assert.equal(world.model.runs.length, 3, 'the restarts judged nothing again');
});

test('a post Discord took is found again even once the forum has archived it', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.discord.loseReply('post');

  await world.advanceTo('2026-10-12T08:00:00Z');
  const [taken] = world.discord.forumPosts(MINER_DAYS_FORUM);
  // The bot is down for two hours, past the forum's one-hour auto-archive.
  world.discord.archive(taken!.id, '2026-10-12T09:00:00Z');
  world.clock.advanceTo('2026-10-12T10:00:00Z');
  await world.restart();

  const posts = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(posts.length, 1, 'one post for the day');
  assert.deepEqual(
    posts[0]!.messages.map((m) => m.headings[0]?.split('\n')[0]),
    ['## Miner · Mon Oct 12', '### Dossiers', '### Near misses · fit 6', '### Further off · fit 3–5', '### Far off · fit 0–2'],
  );
});

test('an empty answer from Product Hunt posts nothing, and the date is read again next time', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());

  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.deepEqual(world.discord.forumPosts(MINER_DAYS_FORUM), []);
  assert.ok(world.logs.some((l) => l.event === 'miner.nothing-featured' && l.date === '2026-10-12'));

  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.clock.advanceTo('2026-10-12T08:30:00Z');
  await world.restart();

  const [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(post!.title, 'Mon Oct 12 · 4 Dossiers · line 7');
});
