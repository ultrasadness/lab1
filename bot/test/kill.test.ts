// Killing the bot mid-step (#96): `world.kill()` ends the bot where it stands, with no stop, as a crash does. The old
// bot never acts again, however the outside world answers what it left open, and a fresh one carries on from the same
// live store and Personal database checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fixtureDay } from './harness/fake-product-hunt.ts';
import { until } from './harness/miner-day.ts';
import { MINER_DAYS_FORUM, startWorld, type World } from './harness/world.ts';

/** Everything an outside service has seen of the bot, and what it logged, to compare before and after. */
const outside = (world: World) => ({
  modelRequests: world.model.requests.length,
  discordCalls: world.discord.calls.length,
  gatewayLogins: world.discord.identifies.length,
  gatewayResumes: world.discord.resumes,
  productHuntRequests: world.productHunt.requests.length,
  browserReads: world.browser.reads.length + world.browser.heads.length,
  gitConnections: world.git.connections().length,
  pings: world.healthchecks.pings.length,
  logLines: world.logs.length,
});

/**
 * Every file the bot writes on the VM, byte for byte: the live store, the raw inputs and the Personal database's
 * checkout. A write by the old bot can show nowhere else while no bot is up, and this compares the files whole, without
 * reading what they hold.
 */
const filesWritten = (world: World) =>
  Object.fromEntries(
    [world.dataDir, world.checkout].flatMap((dir) =>
      readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .map((file) => join(dir, file))
        .filter((path) => statSync(path).isFile())
        .map((path) => [path, readFileSync(path).toString('base64')]),
    ),
  );

test('the bot killed while the provider holds its request never acts again, and a fresh one carries on from the same store', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' }); // 00:30 PDT
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([]);
  // The first judging run records its judgments, and the provider holds its next request.
  const judged = world.model.judgment;
  world.model.judgment = (postId) => {
    world.model.hold = true;
    return judged(postId);
  };
  world.clock.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT, the Miner's start
  await until(() => world.model.requests.length === 2);
  const [first] = world.model.judgingRuns;
  assert.ok(world.processesRunning() > 0, 'its run is going');

  await world.kill();
  assert.equal(world.processesRunning(), 0, 'its run went with it');
  const atKill = outside(world);
  const written = filesWritten(world);
  assert.ok(join(world.dataDir, 'assistant.sqlite') in written, 'the live store is among them');
  assert.equal(world.logs.filter((l) => l.event === 'assistant.stopped').length, 0, "the bot's stop never ran");
  assert.equal(world.logs.filter((l) => l.event === 'run.finished').length, 0, 'nor did it end its run');

  // The old bot gets every chance to wake: the provider answers from now on, its timers come due, Discord is ready for
  // it, and real time goes by.
  world.model.judgment = judged;
  world.model.hold = false;
  await world.advanceTo('2026-10-12T08:40:00Z'); // past the run's 10-minute cap, a ping's 5 minutes and a 30-minute retry
  await delay(500);
  assert.deepEqual(outside(world), atKill, 'no outside call, and no log line');
  assert.deepEqual(filesWritten(world), written, 'no store write, and nothing else written');
  assert.deepEqual(world.discord.forumPosts(MINER_DAYS_FORUM), [], 'no list went out');

  // A fresh bot picks the date up from the same store, without judging again what the old one kept.
  await world.restart();
  const later = world.model.judgingRuns.slice(1).flatMap((r) => r.postIds);
  assert.ok(later.length > 0, 'the Launches left are judged');
  assert.deepEqual(later.filter((postId) => first!.postIds.includes(postId)), [], 'those the old bot kept are not judged again');
  const [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(post!.messages.flatMap((m) => m.lines).length, 19, 'the day goes out whole');
  assert.ok(world.git.file('days/2026-10-12.md')!.includes('Ancher 2.0'), 'and to GitHub');
  assert.equal(world.logs.filter((l) => l.event === 'assistant.stopped').length, 0);
});

test('the bot killed while GitHub holds its push leaves no git command running, and a fresh one pushes the commit from the same checkout', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' }); // 00:30 PDT
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12').slice(0, 8), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([]);
  world.git.holdPushes = true;
  world.clock.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT, the Miner's start
  await until(() => world.git.connections().some((c) => c.held));
  assert.ok(world.processesRunning() > 0, 'git is still pushing');
  world.git.holdPushes = false;

  await world.kill();

  assert.equal(world.processesRunning(), 0, 'the push went with the bot');
  assert.equal(world.git.file('days/2026-10-12.md'), undefined);

  await world.restart();

  assert.equal(world.git.subjects('main').filter((s) => s.startsWith('Miner day')).length, 1, 'the commit the old bot made, once');
  assert.ok(world.git.file('days/2026-10-12.md'));
});
