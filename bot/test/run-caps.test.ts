// Every run is capped on wall clock, turns and tokens. A run that hits a cap is aborted. A Miner judging run is
// retried once on its own, because the Day's line needs every Fit; after that the person is told in the day's post
// which limit was hit, with one Retry that starts a fresh run under the same limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { EPHEMERAL } from './harness/fake-discord.ts';
import { MINER_DAYS_FORUM, PERSON, STATUS, startWorld } from './harness/world.ts';
import { fixtureDay, type FixturePost } from './harness/fake-product-hunt.ts';

const ids = (posts: FixturePost[]) => posts.map((p) => p.id);

test('a Miner run past its turn cap is aborted and retried once on its own, and the day goes out as usual', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  const day = fixtureDay('2026-10-12');
  world.productHunt.addFeatured(day, '2026-10-12T07:01:00Z');
  const first = ids(day.slice(0, 8));
  // The model runs away in the date's first run: it records nothing and calls its tool turn after turn.
  world.model.runaway = (run) => world.model.runs.length === 1 && run.postIds[0] === first[0];

  await world.advanceTo('2026-10-12T08:00:00Z');

  assert.deepEqual(
    world.model.runs.map((r) => r.postIds),
    [first, first, ids(day.slice(8, 16)), ids(day.slice(16))],
    'the capped run’s Launches were judged again, once, in a fresh run',
  );
  const runaway = world.model.runs[0]!;
  assert.ok(runaway.requests >= 20 && runaway.requests <= 21, `the run stopped at its 20-turn cap, after ${runaway.requests} requests`);
  const capped = world.logs.filter((l) => l.event === 'run.finished' && l.outcome === 'capped');
  assert.deepEqual(
    capped.map((l) => l.cap),
    [{ limit: 'turns', max: 20 }],
  );

  const posts = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.title, 'Mon Oct 12 · 4 Dossiers · line 7');
  assert.deepEqual(
    posts[0]!.messages.map((m) => m.headings[0]?.split('\n')[0]),
    ['## Miner · Mon Oct 12', '### Dossiers', '### Near misses · fit 6', '### Further off · fit 3–5', '### Far off · fit 0–2'],
    'a cap the automatic retry got past leaves no notice',
  );
});

test('when the automatic retry is capped too, the day’s post opens with a notice and Retry, and Retry finishes the day', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  const day = fixtureDay('2026-10-12');
  world.productHunt.addFeatured(day, '2026-10-12T07:01:00Z');
  const first = ids(day.slice(0, 8));
  world.model.runaway = (run) => run.postIds[0] === first[0];

  await world.advanceTo('2026-10-12T08:00:00Z');

  assert.deepEqual(
    world.model.runs.map((r) => r.postIds),
    [first, first, ids(day.slice(8, 16)), ids(day.slice(16))],
    'one automatic retry, then the other Launches are judged',
  );
  let [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(post?.title, 'Mon Oct 12 · judging', 'the day’s post opens before its list');
  assert.equal(post!.messages.length, 2);
  const [waiting, notice] = post!.messages;
  assert.match(waiting!.text, /^## Miner · Mon Oct 12\n11 of 19 Featured Launches judged/);
  assert.match(notice!.text, /A judging run of 8 Launches hit its turn cap \(20 turns\), and so did its automatic retry/);
  const retry = notice!.lines[0]!.button!;
  assert.equal(retry.label, 'Retry');
  for (const message of post!.messages) {
    assert.ok(message.silent);
    assert.ok(message.mentionsNobody);
  }

  // Until the person taps Retry, the 30-minute retries leave the capped Launches alone, and at 06:00 PT the late
  // line says the list waits on Retry.
  await world.advanceTo('2026-10-12T13:00:00Z');
  assert.equal(world.model.runs.length, 4, 'the capped Launches were not run again');
  assert.deepEqual(
    world.discord.textMessages(STATUS).map((l) => l.content),
    [
      `Miner: Mon Oct 12's list is late: it waits on Retry in <#${post!.id}>, because a judging run of 8 Launches hit its turn cap (20 turns), and so did its automatic retry. The date leaves the 3-day catch-up at 01:00 PT Thu Oct 15.`,
    ],
  );

  // The person taps Retry at 07:12 PT; this time the model judges.
  world.model.runaway = () => false;
  await world.advanceTo('2026-10-12T14:12:00Z');
  await world.discord.connected();
  const tapped = await world.discord.tap({ userId: PERSON, customId: retry.customId, channelId: post!.id, messageId: notice!.id });
  assert.equal(tapped.type, 7, 'the tap rewrites the notice in place');
  await world.assistant.whenIdle();

  assert.deepEqual(world.model.runs.slice(4).map((r) => r.postIds), [first], 'Retry started one fresh run of the capped Launches');
  [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(world.discord.forumPosts(MINER_DAYS_FORUM).length, 1, 'still one post for the day');
  assert.equal(post!.title, 'Mon Oct 12 · 4 Dossiers · line 7');
  assert.deepEqual(
    post!.messages.map((m) => m.headings[0]?.split('\n')[0]),
    ['## Miner · Mon Oct 12', undefined, '### Dossiers', '### Near misses · fit 6', '### Further off · fit 3–5', '### Far off · fit 0–2'],
    'the summary is edited in place and the bands follow the notice',
  );
  assert.match(post!.messages[0]!.text, /\*\*4 Dossiers\*\* · 15 Skips · 19 Featured Launches/);
  const after = post!.messages[1]!;
  assert.match(after.text, /hit its turn cap \(20 turns\), and so did its automatic retry/);
  assert.match(after.text, /Retried at 07:12 PT/);
  assert.equal(after.lines[0]!.button?.disabled, true, 'Retry can’t be tapped twice');

  const again = await world.discord.tap({ userId: PERSON, customId: retry.customId, channelId: post!.id, messageId: notice!.id });
  assert.ok((again.data?.flags ?? 0) & EPHEMERAL);
  assert.equal(again.data?.content, 'Already retried at 07:12 PT.');
  await world.assistant.whenIdle();
  assert.equal(world.model.runs.length, 5, 'a second tap starts nothing');
});

test('time and token caps stop runs too, and a run Retry started is never retried on its own', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12').slice(0, 8), '2026-10-12T07:01:00Z');
  world.model.hold = true; // the provider takes each request and never answers

  world.clock.advanceTo('2026-10-12T08:00:00Z');
  await until(() => world.model.requests.length === 1);
  world.clock.advanceTo('2026-10-12T08:10:00Z'); // the run's 10 minutes are up
  await until(() => world.model.requests.length === 2);
  world.clock.advanceTo('2026-10-12T08:20:00Z'); // and so are its retry's
  await world.assistant.whenIdle();

  let [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(post?.title, 'Mon Oct 12 · judging');
  assert.match(post!.messages[0]!.text, /0 of 8 Featured Launches judged/);
  assert.match(post!.messages[1]!.text, /A judging run of 8 Launches hit its time cap \(10 min\), and so did its automatic retry/);

  // On Retry the model runs away, each reply counting 151,000 tokens.
  world.model.hold = false;
  world.model.runaway = () => true;
  world.model.usage = { prompt_tokens: 150_000, completion_tokens: 1_000, cached_tokens: 0 };
  await world.discord.connected();
  const first = post!.messages[1]!;
  await world.discord.tap({ userId: PERSON, customId: first.lines[0]!.button!.customId, channelId: post!.id, messageId: first.id });
  await world.assistant.whenIdle();

  assert.equal(world.model.runs.length, 3, 'no automatic retry after a run the person started');
  assert.equal(world.model.runs[2]!.requests, 2, 'the run stopped at its token cap, after its second reply');
  [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(post!.messages.length, 3);
  assert.match(post!.messages[1]!.text, /Retried at 01:20 PT/);
  assert.match(post!.messages[2]!.text, /The run your Retry started for 8 Launches hit its token cap \(200,000 tokens\)/);

  // A second Retry, and this time the model judges.
  world.model.runaway = () => false;
  world.model.usage = { prompt_tokens: 2400, completion_tokens: 380, cached_tokens: 0 };
  const second = post!.messages[2]!;
  await world.discord.tap({ userId: PERSON, customId: second.lines[0]!.button!.customId, channelId: post!.id, messageId: second.id });
  await world.assistant.whenIdle();

  assert.equal(world.model.runs.length, 4);
  [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.match(post!.title, /^Mon Oct 12 · \d+ Dossiers? · line \d+$/);
  assert.match(post!.messages[0]!.text, /^## Miner · Mon Oct 12\n.* · 8 Featured Launches · Day's line/);
  assert.ok(post!.messages.slice(3).length > 0);
  assert.ok(post!.messages.slice(3).every((m) => m.headings[0]?.startsWith('### ')), 'the bands follow both notices');
});

test('when a run and its automatic retry hit different caps, the notice names both', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12').slice(0, 8), '2026-10-12T07:01:00Z');
  world.model.hold = true;

  world.clock.advanceTo('2026-10-12T08:00:00Z');
  await until(() => world.model.requests.length === 1);
  // The first run is still waiting on its reply; its automatic retry will run away instead.
  world.model.hold = false;
  world.model.runaway = () => true;
  world.clock.advanceTo('2026-10-12T08:10:00Z');
  await world.assistant.whenIdle();

  const [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.match(
    post!.messages[1]!.text,
    /A judging run of 8 Launches hit its time cap \(10 min\), and its automatic retry hit its turn cap \(20 turns\)\./,
  );
});

test('a Retry the bot stopped in the middle of runs again after the restart, still with no automatic retry', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12').slice(0, 8), '2026-10-12T07:01:00Z');
  world.model.runaway = () => true;
  await world.advanceTo('2026-10-12T08:00:00Z');
  let [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  const notice = post!.messages[1]!;

  // The Retry run waits on the provider when the bot stops.
  world.model.hold = true;
  await world.discord.connected();
  await world.discord.tap({ userId: PERSON, customId: notice.lines[0]!.button!.customId, channelId: post!.id, messageId: notice.id });
  await until(() => world.model.runs.length === 3);
  world.model.hold = false;
  await world.restart();

  assert.equal(world.model.runs.length, 4, 'the Retry ran once more, and nothing ran on its own after it');
  [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(post!.messages.length, 3);
  assert.match(post!.messages[2]!.text, /The run your Retry started for 8 Launches hit its turn cap \(20 turns\)/);
});

test('a Retry on a date the window has moved past is refused', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12').slice(0, 8), '2026-10-12T07:01:00Z');
  world.model.runaway = () => true;
  await world.advanceTo('2026-10-12T08:00:00Z');
  const [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  const notice = post!.messages[1]!;

  world.model.runaway = () => false;
  await world.advanceTo('2026-10-15T08:00:00Z'); // 01:00 PDT Thu Oct 15
  await world.discord.connected();
  const tapped = await world.discord.tap({ userId: PERSON, customId: notice.lines[0]!.button!.customId, channelId: post!.id, messageId: notice.id });
  await world.assistant.whenIdle();

  assert.ok((tapped.data?.flags ?? 0) & EPHEMERAL);
  assert.equal(tapped.data?.content, "Mon Oct 12 left the 3-day catch-up and was dropped, so there's nothing to retry.");
  assert.equal(world.model.runs.length, 2, 'nothing ran');
  assert.ok(world.discord.textMessages(STATUS).some((l) => l.content.startsWith('Miner: dropped Mon Oct 12,')));

  // The post that opened early says the date was dropped, and its Retry is off.
  const [closed] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(closed!.title, 'Mon Oct 12 · dropped');
  assert.match(closed!.messages[0]!.text, /^## Miner · Mon Oct 12\nDropped at 01:00 PT Thu Oct 15, outside the 3-day catch-up\./);
  assert.equal(closed!.messages[1]!.lines[0]!.button?.disabled, true);
});

/** Waits for something the bot does in the background, for at most 10 seconds. */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting');
    await delay(20);
  }
}
