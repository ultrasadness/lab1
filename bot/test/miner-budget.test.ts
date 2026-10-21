// The Miner budget (ADR 0011): each model request is counted in notional dollars at the list price of its provider's
// model, and a Miner date may spend its budget. The budget is checked when a run starts, so a run that starts under it
// finishes. Once a date's budget is spent its remaining runs wait, the 06:00 PT line names the Miner budget, and only
// the 3-day window drops the date. Raising the budget in config and restarting lets the waiting runs go on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINER_DAYS_FORUM, PERSON, STATUS, startWorld, type World } from './harness/world.ts';
import { fixtureDay, type FixturePost } from './harness/fake-product-hunt.ts';

const ids = (posts: FixturePost[]) => posts.map((p) => p.id);

/**
 * Each reply counts 70,000 input tokens, 50,000 of them cached, and 15,000 output tokens. At the test model's $2, $0.20
 * and $10 per 1M, that is $0.04 + $0.01 + $0.15 = $0.20. A judging run makes two requests, the reply holding its
 * judgments and the closing one, so each run spends $0.40.
 */
const FORTY_CENTS_A_RUN = { prompt_tokens: 70_000, completion_tokens: 15_000, cached_tokens: 50_000 };

const statusAbout = (world: World, label: string) =>
  world.discord.textMessages(STATUS).map((l) => l.content).filter((c) => c.includes(label));

test('a Miner provider whose model has no price is a config error at start-up', async () => {
  await assert.rejects(
    startWorld({
      now: '2026-10-12T07:30:00Z',
      configure: (config) => {
        config.roles.miner.providers = [{ name: 'openrouter', model: 'judge-model-2' }];
      },
    }),
    /roles\.miner: openrouter serves judge-model-2, which has no price in prices/,
  );
});

test('once a date’s spend reaches its Miner budget part way, its remaining runs wait and the 06:00 PT line names the Miner budget', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z', configure: (config) => (config.budgets.miner = 0.7) });
  t.after(() => world.stop());
  const day = fixtureDay('2026-10-12');
  world.productHunt.addFeatured(day, '2026-10-12T07:01:00Z');
  world.model.usage = FORTY_CENTS_A_RUN;

  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT
  assert.deepEqual(
    world.model.runs.map((r) => r.postIds),
    [ids(day.slice(0, 8)), ids(day.slice(8, 16))],
    'after two runs the date has spent $0.80 of $0.70, so its third run waits',
  );
  assert.deepEqual(world.discord.forumPosts(MINER_DAYS_FORUM), [], 'no list goes out');

  // The retries start nothing, and at 06:00 PT the late line names the Miner budget.
  await world.stepThrough('2026-10-12T13:00:00Z', 30);
  assert.equal(world.model.runs.length, 2);
  const lines = world.discord.textMessages(STATUS);
  assert.deepEqual(
    lines.map((l) => l.content),
    [
      "Miner: Mon Oct 12's list is late: its Miner budget is spent ($0.80 of $0.70), so 3 of its 19 Featured Launches wait to be judged until the Miner budget is raised. The date leaves the 3-day catch-up at 01:00 PT Thu Oct 15.",
    ],
  );
  assert.ok(lines[0]!.silent);
  assert.ok(lines[0]!.mentionsNobody);

  // Only the 3-day window drops the date.
  await world.advanceTo('2026-10-15T07:59:00Z'); // 00:59 PDT Thu Oct 15
  assert.equal(world.model.runs.length, 2);
  assert.equal(statusAbout(world, 'Mon Oct 12').length, 1, 'still waiting, and not dropped');
  await world.advanceTo('2026-10-15T08:00:00Z');
  assert.equal(world.model.runs.length, 2);
  assert.deepEqual(statusAbout(world, 'Mon Oct 12').slice(1), ["Miner: dropped Mon Oct 12, outside the 3-day catch-up. Its list won't go out."]);
});

test('a run that starts under the Miner budget and finishes over it completes, and the day’s list goes out', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z', configure: (config) => (config.budgets.miner = 0.1) });
  t.after(() => world.stop());
  const day = fixtureDay('2026-10-12').slice(0, 8);
  world.productHunt.addFeatured(day, '2026-10-12T07:01:00Z');
  world.model.usage = FORTY_CENTS_A_RUN;

  // The run starts at $0 and spends $0.40, four times the budget.
  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.deepEqual(world.model.runs.map((r) => r.postIds), [ids(day)]);
  assert.equal(world.model.runs[0]!.requests, 2, 'the run made its closing request too');
  const posts = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(posts.length, 1);
  assert.match(posts[0]!.title, /^Mon Oct 12 · \d+ Dossiers? · line \d+$/);
  assert.match(posts[0]!.messages[0]!.text, /· 8 Featured Launches · Day's line/);
  assert.deepEqual(world.discord.textMessages(STATUS), []);
});

test('after the Miner budget is raised in config and the bot restarts, the waiting runs go on', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z', configure: (config) => (config.budgets.miner = 0.7) });
  t.after(() => world.stop());
  const day = fixtureDay('2026-10-12');
  world.productHunt.addFeatured(day, '2026-10-12T07:01:00Z');
  world.model.usage = FORTY_CENTS_A_RUN;
  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.equal(world.model.runs.length, 2, 'the third run waits on the budget');

  await world.restart();
  assert.equal(world.model.runs.length, 2, 'a restart alone lets nothing go on');

  // ops/upgrade raises the budget to $1.20 and restarts the bot at 01:30 PDT.
  await world.outage('2026-10-12T08:30:00Z', (config) => (config.budgets.miner = 1.2));
  assert.deepEqual(
    world.model.runs.map((r) => r.postIds),
    [ids(day.slice(0, 8)), ids(day.slice(8, 16)), ids(day.slice(16))],
  );
  assert.deepEqual(
    world.discord.forumPosts(MINER_DAYS_FORUM).map((p) => p.title),
    ['Mon Oct 12 · 4 Dossiers · line 7'],
  );
  await world.advanceTo('2026-10-12T13:00:00Z');
  assert.deepEqual(world.discord.textMessages(STATUS), [], 'the list was out before 06:00 PT');
});

test('a date’s spend counts its automatic retries and Retry taps, and a Retry tapped once the budget is spent waits for a raise', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z', configure: (config) => (config.budgets.miner = 1.5) });
  t.after(() => world.stop());
  const day = fixtureDay('2026-10-12').slice(0, 8);
  world.productHunt.addFeatured(day, '2026-10-12T07:01:00Z');
  // The model runs away, and each reply counts 150,000 input and 1,000 output tokens: $0.31. A run passes its
  // 200,000-token cap on its second reply, so each run spends $0.62.
  world.model.runaway = () => true;
  world.model.usage = { prompt_tokens: 150_000, completion_tokens: 1_000, cached_tokens: 0 };

  // The run and its automatic retry are capped, spending $1.24.
  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.equal(world.model.runs.length, 2);
  await world.discord.connected();
  const tap = async (index: number) => {
    const [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
    const notice = post!.messages[index]!;
    await world.discord.tap({ userId: PERSON, customId: notice.lines[0]!.button!.customId, channelId: post!.id, messageId: notice.id });
    await world.assistant.whenIdle();
  };

  // Under budget, the person's Retry starts a run, which is capped too: $1.86.
  await tap(1);
  assert.equal(world.model.runs.length, 3);
  // Over budget, their next Retry waits.
  await tap(2);
  assert.equal(world.model.runs.length, 3, 'the Retry tapped over budget starts no run');
  assert.ok(world.model.runs.every((r) => r.requests === 2));

  await world.advanceTo('2026-10-12T13:00:00Z'); // 06:00 PDT
  assert.deepEqual(
    world.discord.textMessages(STATUS).map((l) => l.content),
    [
      "Miner: Mon Oct 12's list is late: its Miner budget is spent ($1.86 of $1.50), so all 8 of its Featured Launches wait to be judged until the Miner budget is raised. The date leaves the 3-day catch-up at 01:00 PT Thu Oct 15.",
    ],
  );

  // Once the budget is raised, the waiting Retry runs, and this time the model judges.
  world.model.runaway = () => false;
  world.model.usage = FORTY_CENTS_A_RUN;
  await world.outage('2026-10-12T14:00:00Z', (config) => (config.budgets.miner = 3));
  assert.deepEqual(world.model.runs.slice(3).map((r) => r.postIds), [ids(day)]);
  const [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.match(post!.title, /^Mon Oct 12 · \d+ Dossiers? · line \d+$/);
});

test('when the Launches left wait on an untapped Retry as well as the Miner budget, the 06:00 PT line names both', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z', configure: (config) => (config.budgets.miner = 1) });
  t.after(() => world.stop());
  const day = fixtureDay('2026-10-12').slice(0, 8);
  world.productHunt.addFeatured(day, '2026-10-12T07:01:00Z');
  // As above, each run spends $0.62: the run is capped at $0.62, and its automatic retry starts under budget and is
  // capped at $1.24, which leaves its Launches waiting on Retry.
  world.model.runaway = () => true;
  world.model.usage = { prompt_tokens: 150_000, completion_tokens: 1_000, cached_tokens: 0 };

  await world.advanceTo('2026-10-12T13:00:00Z'); // 06:00 PDT
  assert.equal(world.model.runs.length, 2);
  const [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.deepEqual(
    world.discord.textMessages(STATUS).map((l) => l.content),
    [
      `Miner: Mon Oct 12's list is late: its Miner budget is spent ($1.24 of $1.00), so all 8 of its Featured Launches wait to be judged until the Miner budget is raised. It waits on Retry in <#${post!.id}> too. The date leaves the 3-day catch-up at 01:00 PT Thu Oct 15.`,
    ],
  );

  // A raised budget alone starts nothing: the Launches still wait on the tap.
  world.model.runaway = () => false;
  world.model.usage = FORTY_CENTS_A_RUN;
  await world.outage('2026-10-12T14:00:00Z', (config) => (config.budgets.miner = 3));
  assert.equal(world.model.runs.length, 2);
});
