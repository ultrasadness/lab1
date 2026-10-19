// The Miner keeps going through outages and late days. It judges any date of the last 3 that isn't done, oldest
// first, and posts each date's list on its own. Older dates are dropped, named in one #status line. A date that
// can't finish is tried again every 30 minutes, and one #status line says so if its list isn't out by 06:00 PT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINER_DAYS_FORUM, STATUS, startWorld, type World } from './harness/world.ts';
import { fixtureDay } from './harness/fake-product-hunt.ts';

const DATES = ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'];
const TITLES: Record<string, string> = {
  '2026-10-11': 'Sun Oct 11 · 1 Dossier · line 7',
  '2026-10-12': 'Mon Oct 12 · 4 Dossiers · line 7',
  '2026-10-13': 'Tue Oct 13 · 3 Dossiers · line 7',
  '2026-10-14': 'Wed Oct 14 · 6 Dossiers · line 7',
};

/** Product Hunt features each fixture day on its own date. */
function featureEveryDay(world: World): void {
  for (const date of DATES) world.productHunt.addFeatured(fixtureDay(date), `${date}T07:01:00Z`);
}

const titles = (world: World) => world.discord.forumPosts(MINER_DAYS_FORUM).map((p) => p.title);

/** The order the bot judged and posted dates in, from its log. */
function workOrder(world: World): string[] {
  return world.logs.flatMap((l) => {
    if (l.event === 'run.started') return [`judge ${String(l.item)}`];
    if (l.event === 'miner.posted') return [`post ${String(l.date)}`];
    return [];
  }).filter((step, i, all) => step !== all[i - 1]);
}

test('after a 3-day outage, each missed date is judged when the bot is back, oldest first, and posted on its own', async (t) => {
  const world = await startWorld({ now: '2026-10-11T07:30:00Z' }); // Sun Oct 11, 00:30 PDT
  t.after(() => world.stop());
  featureEveryDay(world);
  await world.advanceTo('2026-10-11T08:00:00Z');
  assert.deepEqual(titles(world), [TITLES['2026-10-11']]);

  // Down from 02:00 PDT Sun Oct 11 to 09:30 PDT Wed Oct 14: three 01:00 starts missed.
  world.clock.advanceTo('2026-10-11T09:00:00Z');
  await world.outage('2026-10-14T16:30:00Z');

  assert.deepEqual(titles(world), DATES.map((d) => TITLES[d]));
  assert.deepEqual(
    workOrder(world),
    ['judge 2026-10-11', 'post 2026-10-11', 'judge 2026-10-12', 'post 2026-10-12', 'judge 2026-10-13', 'post 2026-10-13', 'judge 2026-10-14', 'post 2026-10-14'],
  );
  assert.deepEqual(world.discord.textMessages(STATUS), [], 'nothing was dropped, and no list is late');
});

test('after a 4-day outage the oldest missed date is dropped, named in one silent #status line', async (t) => {
  const world = await startWorld({ now: '2026-10-11T07:30:00Z' }); // Sun Oct 11, 00:30 PDT
  t.after(() => world.stop());
  featureEveryDay(world);
  await world.assistant.whenIdle();

  // Down from 00:30 PDT Sun Oct 11 to 09:30 PDT Wed Oct 14: four 01:00 starts missed.
  await world.outage('2026-10-14T16:30:00Z');

  assert.deepEqual(titles(world), ['2026-10-12', '2026-10-13', '2026-10-14'].map((d) => TITLES[d]));
  const reads = world.productHunt.requests.filter((r) => r.kind === 'posts').map((r) => r.variables.postedAfter);
  assert.ok(!reads.includes('2026-10-11T07:00:00.000Z'), 'the dropped date is never read');
  const lines = world.discord.textMessages(STATUS);
  assert.deepEqual(
    lines.map((l) => l.content),
    ["Miner: dropped Sun Oct 11, outside the 3-day catch-up. Its list won't go out."],
  );
  for (const line of lines) {
    assert.ok(line.silent, 'every #status line is silent');
    assert.ok(line.mentionsNobody);
  }

  await world.restart();
  assert.equal(world.discord.textMessages(STATUS).length, 1, 'the drop is named once');
});

const runsStarted = (world: World) => world.logs.filter((l) => l.event === 'run.started');
const judgingRuns = (world: World) => runsStarted(world).length;

/** How many judging runs each try started, by when it started. */
function runsPerTry(world: World): Record<string, number> {
  const tries: Record<string, number> = {};
  for (const run of runsStarted(world)) tries[run.at] = (tries[run.at] ?? 0) + 1;
  return tries;
}

test('a date that can’t finish is tried every 30 minutes, and one silent #status line at 06:00 PT says it’s late and why', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.failing = true; // every Miner provider refuses

  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT
  const perTry = judgingRuns(world);
  assert.equal(perTry, 3);
  await world.advanceTo('2026-10-12T08:29:00Z');
  assert.equal(judgingRuns(world), perTry, 'nothing before 30 minutes');
  // A whole try every 30 minutes from 01:00 to 05:30 PDT, and no line yet.
  await world.stepThrough('2026-10-12T12:30:00Z', 1);
  assert.deepEqual(runsPerTry(world), {
    '2026-10-12T08:00:00.000Z': perTry,
    '2026-10-12T08:30:00.000Z': perTry,
    '2026-10-12T09:00:00.000Z': perTry,
    '2026-10-12T09:30:00.000Z': perTry,
    '2026-10-12T10:00:00.000Z': perTry,
    '2026-10-12T10:30:00.000Z': perTry,
    '2026-10-12T11:00:00.000Z': perTry,
    '2026-10-12T11:30:00.000Z': perTry,
    '2026-10-12T12:00:00.000Z': perTry,
    '2026-10-12T12:30:00.000Z': perTry,
  });
  assert.deepEqual(world.discord.textMessages(STATUS), []);

  await world.advanceTo('2026-10-12T13:00:00Z'); // 06:00 PDT
  assert.equal(judgingRuns(world), 11 * perTry);
  const lines = world.discord.textMessages(STATUS);
  assert.equal(lines.length, 1);
  assert.match(
    lines[0]!.content,
    /^Miner: Mon Oct 12's list is late: its judging runs are failing \(.+\)\. The Miner tries again every 30 minutes until the date leaves the 3-day catch-up at 01:00 PT Thu Oct 15\.$/,
  );
  assert.ok(lines[0]!.silent);
  assert.ok(lines[0]!.mentionsNobody);

  // The providers come back, and the next try, at 06:30 PDT, posts the list.
  world.model.failing = false;
  await world.advanceTo('2026-10-12T13:29:00Z');
  assert.deepEqual(titles(world), []);
  await world.advanceTo('2026-10-12T13:30:00Z');
  assert.deepEqual(titles(world), [TITLES['2026-10-12']]);
  await world.advanceTo('2026-10-13T07:00:00Z');
  assert.equal(world.discord.textMessages(STATUS).length, 1, 'the late line is said once');
});

test('a date that never finishes is tried until it leaves the 3-day window, then dropped with a #status line', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.failing = true;
  await world.advanceTo('2026-10-12T13:00:00Z'); // 06:00 PDT Mon Oct 12

  const before = judgingRuns(world);
  await world.advanceTo('2026-10-15T07:59:00Z'); // 00:59 PDT Thu Oct 15: its last minute in the window
  assert.ok(judgingRuns(world) > before, 'still tried in its last minute in the window');
  const tries = judgingRuns(world);
  await world.advanceTo('2026-10-15T08:00:00Z'); // 01:00 PDT Thu Oct 15
  assert.equal(judgingRuns(world), tries, 'not tried once the window has moved past it');
  const aboutOct12 = world.discord.textMessages(STATUS).map((l) => l.content).filter((c) => c.includes('Mon Oct 12'));
  assert.equal(aboutOct12.length, 2);
  assert.match(aboutOct12[0]!, /^Miner: Mon Oct 12's list is late/);
  assert.equal(aboutOct12[1], "Miner: dropped Mon Oct 12, outside the 3-day catch-up. Its list won't go out.");

  const dropped = judgingRuns(world);
  world.model.failing = false;
  await world.advanceTo('2026-10-15T09:00:00Z');
  assert.equal(judgingRuns(world), dropped, 'a dropped date is never judged again');
  assert.deepEqual(titles(world), []);
});
