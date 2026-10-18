// A Miner day, end to end: at 01:00 PT the Assistant fetches the date's Featured Launches, judges each one in
// Pi runs, draws the Day's line and posts the day's list as one silent post in the Miner days forum.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINER_DAYS_FORUM, startWorld } from './harness/world.ts';
import { fixtureDay } from './harness/fake-product-hunt.ts';

const ph = (slug: string) => `https://www.producthunt.com/posts/${slug}`;

test('a 19-Launch day is judged at 01:00 PT and posted as one silent post, by band', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' }); // 00:30 PDT
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');

  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT

  const posts = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(posts.length, 1);
  const [summary, ...bands] = posts[0]!.messages;
  assert.equal(posts[0]!.title, 'Mon Oct 12 · 4 Dossiers · line 7');

  assert.match(summary!.text, /\*\*4 Dossiers\*\* · 15 Skips · 19 Featured Launches/);
  assert.match(summary!.text, /the 5th best Fit \(⌈√19⌉ = 5\) is 6, so the floor of 7 sets it/);
  assert.match(summary!.text, /\[Data sourced from Product Hunt\]\(https:\/\/www\.producthunt\.com\/leaderboard\/daily\/2026\/10\/12\)/);

  assert.deepEqual(
    bands.map((m) => m.headings),
    [['### Dossiers'], ['### Near misses · fit 6'], ['### Further off · fit 3–5'], ['### Far off · fit 0–2']],
  );
  assert.deepEqual(
    bands[0]!.lines.map((l) => l.text),
    [
      `**[Dropstone CLI](${ph('dropstone-cli')})** · Dossier · fit 9 · terminal coding agent that keeps your corrections across sessions; free plan`,
      `**[guilds.run](${ph('guilds-run')})** · Dossier · fit 8 · open-source agent teams you can inspect; self-host free`,
      `**[Codemind](${ph('codemind-2')})** · Dossier · fit 8 · your coding agent hands off tasks over MCP; free allowance to start`,
      `**[Cube Forms](${ph('cube-forms')})** · Dossier · fit 7 · forms agents fill over MCP or HTTP; free`,
    ],
  );
  assert.deepEqual(
    bands[1]!.lines.map((l) => l.text),
    [
      `**[Ancher 2.0](${ph('ancher-2-0')})** · Skip · fit 6 · knowledge workspace for what you read and save; no word on export`,
      `**[Scrape Anything by Context.dev](${ph('scrape-anything-by-context-dev')})** · Skip · fit 6 · web-to-data API; a developer tool, pricing not stated`,
      `**[ExcaliClaw](${ph('excaliclaw')})** · Skip · fit 6 · diagram workspace your agent draws in over MCP; generous free plan`,
    ],
  );
  assert.deepEqual(
    bands.map((m) => m.lines.length),
    [4, 3, 6, 6],
  );

  const lines = bands.flatMap((m) => m.lines);
  assert.ok(lines.every((l) => l.button?.label === 'Correct'), 'every line has its own Correct button');
  assert.equal(new Set(lines.map((l) => l.button?.customId)).size, 19);
  for (const message of posts[0]!.messages) {
    assert.ok(message.silent, 'the day post never notifies');
    assert.ok(message.mentionsNobody, 'the day post mentions nobody');
  }
});

test('a 48-Launch day: the floor sets the line, and long bands split into parts within Discord’s limits', async (t) => {
  const world = await startWorld({ now: '2026-10-14T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-14'), '2026-10-14T07:01:00Z');

  await world.advanceTo('2026-10-14T08:00:00Z');

  const [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(post!.title, 'Wed Oct 14 · 6 Dossiers · line 7');
  const [summary, ...bands] = post!.messages;
  assert.match(summary!.text, /\*\*6 Dossiers\*\* · 42 Skips · 48 Featured Launches/);
  assert.match(summary!.text, /the 7th best Fit \(⌈√48⌉ = 7\) is 6, so the floor of 7 sets it/);
  assert.deepEqual(
    bands.map((m) => [m.headings[0], m.lines.length]),
    [
      ['### Dossiers', 6],
      ['### Near misses · fit 6', 4],
      ['### Further off · fit 3–5 (1/2)', 9],
      ['### Further off · fit 3–5 (2/2)', 8],
      ['### Far off · fit 0–2 (1/2)', 10],
      ['### Far off · fit 0–2 (2/2)', 9],
      ['### Not Products', 2],
    ],
  );
  assert.deepEqual(
    bands[0]!.lines.map((l) => l.text.match(/^\*\*\[([^\]]+)\]/)![1]),
    ['Inferock', 'Reason', 'Tiden', 'Make0 Brain', 'Hindsight 1.0 + Memlake', 'Acyclic'],
    'Dossiers go by Fit, then Product Hunt rank',
  );
  assert.equal(
    bands[6]!.lines[0]!.text,
    `**[Microsoft Maia 300](${ph('microsoft-maia-300')})** · Skip · not a Product · Microsoft's AI chip announcement`,
  );
  for (const message of post!.messages) {
    assert.ok(message.componentCount <= 40 && message.textLength <= 4000);
  }
  assert.deepEqual(world.discord.refused, []);
});

test('when Fits run high, the ⌈√N⌉-th best Fit sets the line and every Launch tied at it gets a Dossier', async (t) => {
  const world = await startWorld({ now: '2026-10-14T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-14'), '2026-10-14T07:01:00Z');
  // A provider that judges 2 points higher than the stand-ins, as in #9.
  const standIn = world.model.judgment;
  world.model.judgment = (postId) => {
    const j = standIn(postId);
    return j === 'omit' ? j : { ...j, fit: Math.min(10, j.fit + 2) };
  };

  await world.advanceTo('2026-10-14T08:00:00Z');

  const [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(post!.title, 'Wed Oct 14 · 10 Dossiers · line 8');
  assert.match(post!.messages[0]!.text, /the 7th best Fit \(⌈√48⌉ = 7\) is 8, above the floor of 7, so it sets the line/);
  const dossiers = post!.messages[1]!;
  assert.equal(dossiers.headings[0], '### Dossiers');
  assert.equal(dossiers.lines.length, 10);
  assert.equal(dossiers.lines.filter((l) => l.text.includes('· Dossier · fit 8 ·')).length, 4, 'all four Launches tied at the line');
  assert.equal(post!.messages[2]!.headings[0], '### Near misses · fit 7');
});

test('when the ⌈√N⌉-th best Fit is the floor itself, the summary says so', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  const standIn = world.model.judgment;
  world.model.judgment = (postId) => {
    const j = standIn(postId);
    return j === 'omit' ? j : { ...j, fit: Math.min(10, j.fit + 1) };
  };

  await world.advanceTo('2026-10-12T08:00:00Z');

  const [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(post!.title, 'Mon Oct 12 · 7 Dossiers · line 7');
  assert.match(post!.messages[0]!.text, /the 5th best Fit \(⌈√19⌉ = 5\) is 7, the same as the floor\./);
});

test('a Launch that is not a Product is Skipped whatever its Fit, and never counts toward the line', async (t) => {
  const world = await startWorld({ now: '2026-10-14T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-14'), '2026-10-14T07:01:00Z');
  const standIn = world.model.judgment;
  world.model.judgment = (postId) => {
    const j = standIn(postId);
    if (j === 'omit') return j;
    // With the two hardware Launches at Fit 10 counted, the 7th best Fit would be 9.
    return j.notAProduct ? { ...j, fit: 10 } : { ...j, fit: Math.min(10, j.fit + 2) };
  };

  await world.advanceTo('2026-10-14T08:00:00Z');

  const [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(post!.title, 'Wed Oct 14 · 10 Dossiers · line 8');
  const notProducts = post!.messages.at(-1)!;
  assert.equal(notProducts.headings[0], '### Not Products');
  assert.deepEqual(
    notProducts.lines.map((l) => l.text.replace(/^\*\*\[([^\]]+)\].*?· (Skip · not a Product) ·.*$/, '$1 · $2')),
    ['Microsoft Maia 300 · Skip · not a Product', 'Apple HomePod mini 2 · Skip · not a Product'],
  );
});

test('every message stays within Discord’s limits, however long the names and reasons', async (t) => {
  const world = await startWorld({ now: '2026-10-14T07:30:00Z' });
  t.after(() => world.stop());
  const day = fixtureDay('2026-10-14').map((p) => ({ ...p, name: `${p.name} ${'*Extra*_name_'.repeat(3)}`.slice(0, 60) }));
  world.productHunt.addFeatured(day, '2026-10-14T07:01:00Z');
  const standIn = world.model.judgment;
  world.model.judgment = (postId) => {
    const j = standIn(postId);
    // Formatting characters are escaped on Discord, so this 240-character reason takes far more room there.
    return j === 'omit' ? j : { ...j, reason: `${j.reason}; [see](https://example.com) <@123> ${'*bold* '.repeat(40)}`.slice(0, 240) };
  };

  await world.advanceTo('2026-10-14T08:00:00Z');

  assert.deepEqual(world.discord.refused, [], 'Discord accepted every message');
  const [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  const lines = post!.messages.flatMap((m) => m.lines);
  assert.equal(lines.length, 48, 'every Launch is still on the list');
  for (const message of post!.messages) {
    assert.ok(message.textLength <= 4000, `${message.textLength} characters`);
    assert.ok(message.componentCount <= 40, `${message.componentCount} components`);
  }
  assert.ok(post!.messages.length > 8, 'bands split into more parts to fit');
  for (const line of lines) {
    assert.doesNotMatch(line.text, /(?<!\\)\[see\]\(/, 'a model-written link is shown as text');
    assert.doesNotMatch(line.text, /(?<!\\)<@123>/, 'a model-written mention is shown as text');
  }
});

test('only the date’s Featured Launches are read, through the API, a page at a time', async (t) => {
  const world = await startWorld({ now: '2026-10-14T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-14'), '2026-10-14T07:01:00Z');
  world.productHunt.addFeatured(fixtureDay('2026-10-13'), '2026-10-13T07:01:00Z'); // the day before
  world.productHunt.addUnfeatured(fixtureDay('2026-10-11'), '2026-10-14T09:30:00Z'); // posted the same day, not featured

  await world.advanceTo('2026-10-14T08:00:00Z');

  const [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  const names = post!.messages.flatMap((m) => m.lines).map((l) => l.text.match(/^\*\*\[([^\]]+)\]/)![1]);
  const featured = fixtureDay('2026-10-14').map((p) => p.name.trim());
  assert.deepEqual([...names].sort(), [...featured].sort());
  const dayReads = world.productHunt.requests.filter((r) => r.kind === 'posts');
  assert.equal(dayReads.length, 3, '48 Launches come in pages of 20');
  for (const read of dayReads) {
    assert.equal(read.variables.postedAfter, '2026-10-14T07:00:00.000Z');
    assert.equal(read.variables.postedBefore, '2026-10-15T07:00:00.000Z');
  }
  const asked = new Set(world.model.runs.flatMap((r) => r.postIds));
  assert.deepEqual([...asked].sort(), fixtureDay('2026-10-14').map((p) => p.id).sort());
});

test('a Launch that moves in the ranking while the day is read is listed once, and none is missed', async (t) => {
  const world = await startWorld({ now: '2026-10-14T07:30:00Z' });
  t.after(() => world.stop());
  const day = fixtureDay('2026-10-14');
  world.productHunt.addFeatured(day, '2026-10-14T07:01:00Z');
  // Votes swap the 20th and 21st Launches between the first page and the second.
  world.productHunt.onPostsPage = (served) => {
    if (served === 1) world.productHunt.swapRanks(day[19]!.id, day[20]!.id);
  };

  await world.advanceTo('2026-10-14T08:00:00Z');

  const [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(post?.title, 'Wed Oct 14 · 6 Dossiers · line 7');
  const listed = post!.messages.flatMap((m) => m.lines).map((l) => l.button?.customId);
  assert.deepEqual([...listed].sort(), day.map((p) => `correct:launch:${p.id}`).sort());
});
