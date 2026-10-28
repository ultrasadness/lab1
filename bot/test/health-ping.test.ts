// The bot's healthchecks.io ping (#26, settled for go-live on #85): every 5 minutes, only while it is logged in to
// Discord and its store takes a write. 15 minutes without one, and the person's check emails them that the Assistant
// can't reach them on Discord.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { until } from './harness/miner-day.ts';
import { startWorld, type World } from './harness/world.ts';

test('the bot pings its check every 5 minutes while it is logged in to Discord', async (t) => {
  const world = await startWorld({ now: '2026-10-12T17:00:00Z' }); // 10:00 PDT
  t.after(() => world.stop());
  await loggedIn(world);

  await world.stepThrough('2026-10-12T17:20:00Z', 5);
  assert.deepEqual(world.healthchecks.pingsOf('bot'), [
    '2026-10-12T17:05:00.000Z',
    '2026-10-12T17:10:00.000Z',
    '2026-10-12T17:15:00.000Z',
    '2026-10-12T17:20:00.000Z',
  ]);
});

test('no ping goes out while the bot is off Discord, and pings start again once it is back on', async (t) => {
  const world = await startWorld({ now: '2026-10-12T17:00:00Z' }); // 10:00 PDT
  t.after(() => world.stop());
  await loggedIn(world);
  await world.advanceTo('2026-10-12T17:05:00Z');

  world.discord.cutGateway();
  // The gateway refusing the bot's next connection shows the bot knows it was dropped.
  await until(() => world.discord.gatewayRefusals > 0);
  await world.stepThrough('2026-10-12T17:20:00Z', 5);
  assert.deepEqual(world.healthchecks.pingsOf('bot'), ['2026-10-12T17:05:00.000Z'], 'so the check emails the person at 17:20');
  assert.deepEqual(
    world.logs.filter((e) => e.event === 'health.ping-withheld').map((e) => [e.at, e.why]),
    ['17:10', '17:15', '17:20'].map((time) => [`2026-10-12T${time}:00.000Z`, 'not logged in to Discord']),
  );

  const before = logins(world);
  world.discord.restoreGateway();
  await loggedIn(world, before);
  assert.ok(world.discord.resumes > 0, 'the bot resumed its session');
  await world.advanceTo('2026-10-12T17:25:00Z');
  assert.deepEqual(world.healthchecks.pingsOf('bot'), ['2026-10-12T17:05:00.000Z', '2026-10-12T17:25:00.000Z']);
});

test('no ping goes out once the bot drops its gateway connection, even before the connection has closed', async (t) => {
  const world = await startWorld({ now: '2026-10-12T17:00:00Z' }); // 10:00 PDT
  t.after(() => world.stop());
  await loggedIn(world);
  await world.advanceTo('2026-10-12T17:05:00Z');

  // Discord asks the bot to reconnect, then stops answering: the bot's close of the connection hangs, as on a
  // connection gone half-open, where a missed heartbeat ACK closes it the same way.
  world.discord.hangGateway();
  await until(() => world.logs.some((e) => e.event === 'discord.dropped'));
  await world.advanceTo('2026-10-12T17:10:00Z');
  assert.deepEqual(world.healthchecks.pingsOf('bot'), ['2026-10-12T17:05:00.000Z']);
  assert.deepEqual(
    world.logs.filter((e) => e.event === 'health.ping-withheld').map((e) => [e.at, e.why]),
    [['2026-10-12T17:10:00.000Z', 'not logged in to Discord']],
  );

  const before = logins(world);
  world.discord.releaseGateway();
  await loggedIn(world, before);
  await world.advanceTo('2026-10-12T17:15:00Z');
  assert.deepEqual(world.healthchecks.pingsOf('bot'), ['2026-10-12T17:05:00.000Z', '2026-10-12T17:15:00.000Z']);
});

test('a ping healthchecks.io refuses or drops is logged without its URL, and the next one goes out on time', async (t) => {
  const world = await startWorld({ now: '2026-10-12T17:00:00Z' }); // 10:00 PDT
  t.after(() => world.stop());
  await loggedIn(world);

  world.healthchecks.failNext('refuse', 'drop');
  await world.stepThrough('2026-10-12T17:15:00Z', 5);
  assert.deepEqual(world.healthchecks.pingsOf('bot'), ['2026-10-12T17:15:00.000Z']);
  const failed = world.logs.filter((e) => e.event === 'health.ping-failed');
  assert.deepEqual(
    failed.map((e) => e.at),
    ['2026-10-12T17:05:00.000Z', '2026-10-12T17:10:00.000Z'],
  );
  assert.equal(failed[0]!.status, 503);
  assert.ok(failed[1]!.error, 'the dropped ping says why it failed');
  // The ping URL is a token (ADR 0009), so no line names it.
  const uuid = new URL(world.healthchecks.pingUrl('bot')).pathname.slice(1);
  assert.ok(!world.logs.some((e) => JSON.stringify(e).includes(uuid)), 'no log line holds the ping URL');
});

test('no ping goes out while the store can’t take a write', async (t) => {
  const world = await startWorld({ now: '2026-10-12T17:00:00Z' }); // 10:00 PDT
  t.after(() => world.stop());
  await loggedIn(world);
  await world.advanceTo('2026-10-12T17:05:00Z');

  // Another writer holds the store's write lock past the 5 seconds the bot waits for it.
  const writer = new DatabaseSync(join(world.dataDir, 'assistant.sqlite'));
  writer.exec('BEGIN IMMEDIATE');
  await world.advanceTo('2026-10-12T17:10:00Z');
  writer.exec('ROLLBACK');
  writer.close();
  assert.deepEqual(
    world.logs.filter((e) => e.event === 'health.ping-withheld').map((e) => [e.at, e.why]),
    [['2026-10-12T17:10:00.000Z', 'the store can’t take a write']],
  );

  await world.advanceTo('2026-10-12T17:15:00Z');
  assert.deepEqual(world.healthchecks.pingsOf('bot'), ['2026-10-12T17:05:00.000Z', '2026-10-12T17:15:00.000Z']);
});

/** How many times the bot has logged in to Discord's gateway, a resumed session included. */
const logins = (world: World) => world.logs.filter((e) => e.event === 'discord.connected' || e.event === 'discord.resumed').length;

/** Waits until the bot has logged in to Discord's gateway more than `since` times. */
async function loggedIn(world: World, since = 0): Promise<void> {
  await until(() => logins(world) > since);
}

