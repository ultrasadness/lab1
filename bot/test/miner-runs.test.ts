// How a Miner date is judged: Pi runs of at most 8 Launches in Product Hunt order, each judgment kept as it is
// made, inputs drawn only from Product Hunt data with Maker comments matched by user id, and every judgment and
// run recorded with its role, provider, model and exact tokens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINER_DAYS_FORUM, TOKENS, startWorld } from './harness/world.ts';
import { fixtureDay, type FixturePost } from './harness/fake-product-hunt.ts';

const ids = (posts: FixturePost[]) => posts.map((p) => p.id);

test('runs judge at most 8 Launches each, in Product Hunt order', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  const day = fixtureDay('2026-10-12');
  world.productHunt.addFeatured(day, '2026-10-12T07:01:00Z');

  await world.advanceTo('2026-10-12T08:00:00Z');

  assert.deepEqual(
    world.model.runs.map((r) => r.postIds),
    [ids(day.slice(0, 8)), ids(day.slice(8, 16)), ids(day.slice(16))],
  );
});

test('nothing is posted until every Launch is judged, and a re-run judges only the Launches without a judgment', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  const day = fixtureDay('2026-10-12');
  world.productHunt.addFeatured(day, '2026-10-12T07:01:00Z');
  const unjudged = new Set([day[2]!.id, day[17]!.id, day[18]!.id]);
  const standIn = world.model.judgment;
  world.model.judgment = (postId) => (unjudged.has(postId) ? 'omit' : standIn(postId));

  await world.advanceTo('2026-10-12T08:00:00Z');

  assert.deepEqual(world.discord.forumPosts(MINER_DAYS_FORUM), [], 'no list goes out with Launches unjudged');
  const unfinished = world.logs.find((l) => l.event === 'miner.date-unfinished');
  assert.deepEqual(unfinished?.withoutJudgment, [...unjudged]);

  // The model judges them this time. The bot restarts, as after an outage, and picks the date up.
  world.model.judgment = standIn;
  const runsBefore = world.model.runs.length;
  world.clock.advanceTo('2026-10-12T08:30:00Z');
  await world.restart();

  assert.deepEqual(
    world.model.runs.slice(runsBefore).map((r) => r.postIds),
    [[...unjudged]],
    'only the three Launches without a judgment were judged again',
  );
  const posts = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.title, 'Mon Oct 12 · 4 Dossiers · line 7');
  assert.equal(posts[0]!.messages.flatMap((m) => m.lines).length, 19);
});

test('a Maker comment is a comment by one of the Launch’s makers, found on any page of comments, never guessed', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  const day = fixtureDay('2026-10-12');
  // guilds.run: its first comment is by someone who isn't among its makers; its maker's comment comes later, and
  // here 20 more comments push it onto the second page.
  const guilds = day.find((p) => p.name === 'guilds.run')!;
  const filler = Array.from({ length: 20 }, (_, i) => ({
    body: `<p>Congrats on the launch, number ${i}!</p>`,
    createdAt: '2026-10-12T07:10:00Z',
    parentId: null,
    userId: String(7000000 + i),
  }));
  guilds.comments.nodes = [...filler, ...guilds.comments.nodes];
  world.productHunt.addFeatured(day, '2026-10-12T07:01:00Z');

  await world.advanceTo('2026-10-12T08:00:00Z');

  const sent = world.model.requests.map((r) => r.raw).join('\n');
  assert.match(sent, /3rd maker here! I have a PhD in cognitive science/, "the maker's own comment reaches the model");
  assert.doesNotMatch(sent, /Getting AI to handle long-running tasks reliably/, "a comment by someone who isn't a maker never does");
  assert.doesNotMatch(sent, /Congrats on the launch, number/, 'nor do other people’s comments');
  // EmbeddingGemma 2 lists no makers, so it has no Maker comment, whatever its comments say.
  assert.doesNotMatch(sent, /small enough to run on a phone/);
  assert.ok(
    world.productHunt.requests.some((r) => r.kind === 'comments' && r.variables.id === guilds.id),
    'the second page of comments was read',
  );
});

test('each judgment and each run records its role, provider, model and exact tokens; the forwarder adds the role key', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.usage = { prompt_tokens: 1234, completion_tokens: 56, cached_tokens: 200 };
  world.model.upstreamModel = 'deepseek-v4-flash';

  await world.advanceTo('2026-10-12T08:00:00Z');

  const judged = world.logs.filter((l) => l.event === 'miner.judged');
  assert.equal(judged.length, 19);
  for (const j of judged) {
    assert.equal(j.role, 'miner');
    assert.equal(j.provider, 'openrouter');
    assert.equal(j.model, 'deepseek-v4-flash');
    // One reply judges a whole run's Launches, so a judgment names that request and its exact tokens.
    assert.deepEqual(j.requestTokens, { input: 1234, cached: 200, output: 56 });
  }
  const runs = world.logs.filter((l) => l.event === 'run.finished');
  assert.equal(runs.length, 3);
  for (const run of runs) {
    const ofRun = judged.filter((j) => j.runId === run.runId);
    assert.equal(new Set(ofRun.map((j) => j.requestId)).size, 1, "a run's judgments share the reply that held them");
    assert.equal(run.role, 'miner');
    assert.equal(run.outcome, 'settled');
    assert.deepEqual(run.providers, ['openrouter']);
    assert.deepEqual(run.models, ['deepseek-v4-flash']);
    // Each run made two requests: one with the judgments, one closing reply.
    assert.equal(run.requests, 2);
    assert.deepEqual(run.tokens, { input: 2468, cached: 400, output: 112 });
  }
  for (const request of world.model.requests) {
    assert.equal(request.model, 'miner@openrouter');
    assert.equal(request.authorization, `Bearer ${TOKENS.minerKey}`);
    assert.deepEqual(request.tools, ['record_judgment'], 'a Miner run is offered its record tool and nothing else');
  }
});
