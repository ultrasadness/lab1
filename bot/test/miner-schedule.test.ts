// When the Miner runs: 01:00 America/Los_Angeles each day, once a day even when the clocks fall back, reading
// that Pacific day's own bounds. Raw Product Hunt responses stay 90 days outside git, then go.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MINER_DAYS_FORUM, startWorld } from './harness/world.ts';
import { fixtureDay } from './harness/fake-product-hunt.ts';

test('a day across the daylight-saving change is 25 hours long, and the Miner runs once at its first 01:00', async (t) => {
  const world = await startWorld({ now: '2026-11-01T07:30:00Z' }); // Sun Nov 1, 00:30 PDT
  t.after(() => world.stop());
  // On Sun Nov 1 the clocks fall back at 02:00 PDT, so 01:00 happens twice: 08:00Z (PDT) and 09:00Z (PST).
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-11-01T07:01:00Z');
  world.productHunt.addFeatured(fixtureDay('2026-10-13'), '2026-11-02T08:01:00Z');

  await world.advanceTo('2026-11-01T07:59:00Z');
  assert.equal(world.model.runs.length, 0, 'nothing runs before 01:00');

  await world.advanceTo('2026-11-01T08:00:00Z');
  const [nov1] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(nov1!.title, 'Sun Nov 1 · 4 Dossiers · line 7');
  assert.match(nov1!.messages[0]!.text, /\(https:\/\/www\.producthunt\.com\/leaderboard\/daily\/2026\/11\/1\)/);
  const nov1Reads = world.productHunt.requests.filter((r) => r.kind === 'posts');
  assert.ok(nov1Reads.length > 0);
  for (const read of nov1Reads) {
    assert.equal(read.variables.postedAfter, '2026-11-01T07:00:00.000Z', 'midnight PDT');
    assert.equal(read.variables.postedBefore, '2026-11-02T08:00:00.000Z', 'midnight PST, 25 hours later');
  }

  const runsAfterNov1 = world.model.runs.length;
  await world.advanceTo('2026-11-01T09:00:00Z'); // 01:00 again, now PST
  assert.equal(world.model.runs.length, runsAfterNov1, 'the second 01:00 starts nothing');
  assert.equal(world.discord.forumPosts(MINER_DAYS_FORUM).length, 1);

  await world.advanceTo('2026-11-02T08:30:00Z'); // 00:30 PST
  assert.equal(world.discord.forumPosts(MINER_DAYS_FORUM).length, 1);
  await world.advanceTo('2026-11-02T09:00:00Z'); // 01:00 PST
  const posts = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(posts.length, 2);
  assert.equal(posts[1]!.title, 'Mon Nov 2 · 3 Dossiers · line 7');
  const nov2Reads = world.productHunt.requests.filter((r) => r.kind === 'posts').slice(nov1Reads.length);
  for (const read of nov2Reads) {
    assert.equal(read.variables.postedAfter, '2026-11-02T08:00:00.000Z');
    assert.equal(read.variables.postedBefore, '2026-11-03T08:00:00.000Z');
  }
});

test('raw Product Hunt responses are kept for 90 days outside git, then deleted', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');

  await world.advanceTo('2026-10-12T08:00:00Z');

  const folder = join(world.dataDir, 'raw', 'producthunt', '2026-10-12');
  const files = readdirSync(folder);
  assert.equal(files.length, 1, '19 Launches came in one page');
  const raw = JSON.parse(readFileSync(join(folder, files[0]!), 'utf8')) as { data: { posts: { nodes: { id: string }[] } } };
  assert.deepEqual(
    raw.data.posts.nodes.map((n) => n.id),
    fixtureDay('2026-10-12').map((p) => p.id),
    'kept exactly as Product Hunt returned it',
  );

  await world.advanceTo('2027-01-09T09:00:00Z'); // 01:00 PST, 89 days on
  assert.ok(existsSync(join(folder, files[0]!)), 'still kept on day 89');

  await world.advanceTo('2027-01-10T09:00:00Z'); // 01:00 PST, 90 days on
  assert.ok(!existsSync(join(folder, files[0]!)), 'deleted once 90 days have passed');
});
