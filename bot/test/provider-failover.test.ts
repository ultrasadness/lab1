// Failover (#46, ADR 0011): the forwarder chooses which of a role's providers serves each model request, skipping one
// that can't, so losing one plan doesn't stop work. A run never hears of it, and #status gets one silent line when a
// provider drops out and one when it's back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CODEMIND, serveProduct } from './harness/dossier-fixtures.ts';
import { fixtureDay, websiteOf } from './harness/fake-product-hunt.ts';
import { correct, dayPost, dayPosted, lineOf, rejudges } from './harness/miner-day.ts';
import { opensRun, type Fault, type ModelRequest } from './harness/fake-model.ts';
import { MINER_DAYS_FORUM, NEEDS_YOU, PERSON, PRODUCTS_FORUM, STATUS, startWorld, TOKENS, type Config, type World } from './harness/world.ts';

const DAY = fixtureDay('2026-10-12').slice(0, 8);
/** guilds.run's Launch on Oct 12, a second Dossier beside Codemind's. */
const GUILDS = '1274741';

/** Both roles on ChatGPT Plus first, then OpenRouter, each with a model of its own. */
function plusThenOpenRouter(config: Config): void {
  config.providers.plus = { label: 'ChatGPT Plus', mailGroup: true };
  config.prices['judge-model-2'] = { input: 1, cached: 0.1, output: 5 };
  const providers = [{ name: 'plus', model: 'judge-model-1' }, { name: 'openrouter', model: 'judge-model-2' }];
  config.roles.miner.providers = providers;
  config.roles.registration.providers = providers;
}

const onProvider = (provider: string, fault: Fault) => (request: ModelRequest) => (request.model.endsWith(`@${provider}`) ? fault : undefined);

const asked = (world: World) => world.model.requests.map((r) => r.model);
const statusLines = (world: World) => world.discord.textMessages(STATUS).map((l) => l.content);
const titles = (world: World) => world.discord.forumPosts(MINER_DAYS_FORUM).map((p) => p.title);

/** A world at 00:30 PDT with a small day to judge, none of it reaching a Dossier. */
async function dayWorld(configure: (config: Config) => void = plusThenOpenRouter): Promise<World> {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z', configure });
  world.productHunt.addFeatured(DAY, '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([]);
  return world;
}

test('a provider at its limit with no reset time hands its request to the next one, says so once, is tried again every 30 minutes, and says when it is back', async (t) => {
  const world = await dayWorld();
  t.after(() => world.stop());
  world.model.fault = onProvider('plus', { answer: 'limit' });
  // One Launch goes unjudged, so the date's 30-minute passes each start a run.
  const judged = world.model.judgment;
  world.model.judgment = (postId) => (postId === DAY[0]!.id ? 'omit' : judged(postId));

  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT
  assert.deepEqual(asked(world), ['miner@plus', 'miner@openrouter', 'miner@openrouter'], 'the refused request moves on, and the next one skips Plus');
  const lines = world.discord.textMessages(STATUS);
  assert.deepEqual(lines.map((l) => l.content), ['ChatGPT Plus at its limit, trying again at 01:30 PT · Miner and registration on OpenRouter']);
  assert.ok(lines[0]!.silent);
  assert.ok(lines[0]!.mentionsNobody);

  // Still at its limit at the 01:30 pass: it is asked again, and nothing more is said.
  const before = asked(world).length;
  await world.advanceTo('2026-10-12T08:30:00Z');
  assert.deepEqual(asked(world).slice(before), ['miner@plus', 'miner@openrouter']);
  assert.equal(statusLines(world).length, 1);

  // Back by the 02:00 pass: it serves again, and #status hears.
  world.model.fault = () => undefined;
  world.model.judgment = judged;
  const atTwo = asked(world).length;
  await world.advanceTo('2026-10-12T09:00:00Z');
  assert.deepEqual(asked(world).slice(atTwo, atTwo + 2), ['miner@plus', 'miner@plus']);
  assert.deepEqual(statusLines(world).slice(1), ['ChatGPT Plus is back · Miner and registration on ChatGPT Plus']);
  assert.equal(titles(world).length, 1, 'the list went out');
});

test('a provider at its limit with a reset time is skipped until then, and its line says so', async (t) => {
  const world = await dayWorld();
  t.after(() => world.stop());
  world.model.fault = onProvider('plus', { answer: 'limit', resetsAt: new Date('2026-10-12T10:05:00Z') });
  const judged = world.model.judgment;
  world.model.judgment = (postId) => (postId === DAY[0]!.id ? 'omit' : judged(postId));

  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.deepEqual(statusLines(world), ['ChatGPT Plus at its limit until 03:05 PT · Miner and registration on OpenRouter']);

  // Past 30 minutes, and until the reset, the date's passes never ask it.
  await world.stepThrough('2026-10-12T10:00:00Z', 30);
  const passes = asked(world).slice(3);
  assert.equal(passes.length, 4, 'the passes at 01:30, 02:00, 02:30 and 03:00 went on');
  assert.ok(passes.every((name) => name === 'miner@openrouter'));

  // The pass after the reset asks it again.
  world.model.fault = () => undefined;
  await world.advanceTo('2026-10-12T10:30:00Z');
  assert.equal(asked(world).at(-1), 'miner@plus');
  assert.deepEqual(statusLines(world).filter((l) => l.includes('is back')), ['ChatGPT Plus is back · Miner and registration on ChatGPT Plus']);
});

for (const [name, resetsAt] of [
  ['already past', new Date('2026-10-12T07:00:00Z')],
  ['years away', new Date('2031-01-01T00:00:00Z')],
  ['no time at all', 'soon'],
  ['counted in seconds', String(Math.floor(Date.parse('2026-10-12T21:05:00Z') / 1000))],
] as const) {
  test(`a reset time ${name} counts as none, and the provider is tried again in 30 minutes`, async (t) => {
    const world = await dayWorld();
    t.after(() => world.stop());
    world.model.fault = onProvider('plus', { answer: 'limit', resetsAt });
    await world.advanceTo('2026-10-12T08:00:00Z');
    assert.deepEqual(statusLines(world), ['ChatGPT Plus at its limit, trying again at 01:30 PT · Miner and registration on OpenRouter']);
  });
}

test('a reset time on another day names the day', async (t) => {
  const world = await dayWorld();
  t.after(() => world.stop());
  world.model.fault = onProvider('plus', { answer: 'limit', resetsAt: new Date('2026-10-15T21:05:00Z') });
  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.deepEqual(statusLines(world), ['ChatGPT Plus at its limit until 14:05 PT Thu Oct 15 · Miner and registration on OpenRouter']);
});

test('a provider out of balance is skipped with a silent line saying to top it up, and no card while another provider serves', async (t) => {
  const world = await dayWorld();
  t.after(() => world.stop());
  world.model.fault = onProvider('plus', { answer: 'out-of-balance' });
  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.deepEqual(asked(world), ['miner@plus', 'miner@openrouter', 'miner@openrouter'], 'its next request skips it');
  assert.deepEqual(statusLines(world), ['ChatGPT Plus out of balance, top it up, trying again at 01:30 PT · Miner and registration on OpenRouter']);
  assert.deepEqual(world.discord.cards(NEEDS_YOU), []);
  assert.equal(titles(world).length, 1, 'the list went out');
});

test('a 5xx takes out only that role’s name on the provider, with a line of its own, and the role goes on to its next one', async (t) => {
  const world = await dayWorld();
  t.after(() => world.stop());
  world.model.fault = (request) => (request.model === 'miner@plus' ? { answer: 'server-error', status: 503 } : undefined);
  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.deepEqual(asked(world), ['miner@plus', 'miner@openrouter', 'miner@openrouter']);
  assert.deepEqual(statusLines(world), ['ChatGPT Plus failing for Miner (503), trying again at 01:30 PT · Miner on OpenRouter']);
});

test('a name with no channel, as on 2026-11-06, leaves the other role on the same provider untouched', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(DAY, '2026-10-12T07:01:00Z');
  world.model.judgment = (postId) => ({ fit: postId === DAY[0]!.id ? 9 : 3, notAProduct: false, reason: 'Near enough.' });
  world.model.fault = (request) => (request.model === 'registration@openrouter' ? { answer: 'no-channel' } : undefined);

  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.ok(asked(world).includes('miner@openrouter'));
  assert.deepEqual(statusLines(world), ['OpenRouter failing for registration (503 model_not_found), trying again at 01:30 PT · registration has no provider left']);
  assert.equal(titles(world).length, 1, 'the Miner judged the day and its list went out');
});

test('a run whose provider drops out mid-run carries on with the next one, and a judgment names the provider and model that made it', async (t) => {
  const world = await dayWorld();
  t.after(() => world.stop());
  world.model.upstreamModels = { plus: 'gpt-6', openrouter: 'judge-model-2' };
  // Plus takes the run's first request, and is at its limit by its second.
  world.model.fault = (request) => (request.model === 'miner@plus' && !opensRun(request) ? { answer: 'limit' } : undefined);

  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.deepEqual(asked(world), ['miner@plus', 'miner@plus', 'miner@openrouter']);
  assert.equal(world.model.judgingRuns.length, 1, 'one run, which never heard of it');
  const finished = world.logs.find((l) => l.event === 'run.finished');
  assert.equal(finished?.outcome, 'settled');
  assert.deepEqual(finished?.providers, ['plus', 'openrouter']);
  assert.deepEqual(finished?.models, ['gpt-6', 'judge-model-2']);
  const judged = world.logs.filter((l) => l.event === 'miner.judged');
  assert.equal(judged.length, DAY.length);
  assert.ok(judged.every((l) => l.provider === 'plus' && l.model === 'gpt-6'), 'its judgments came in the reply Plus gave');
  assert.equal(titles(world).length, 1);
});

test('a judgment in a reply the next provider gave names that provider, and the one that refused is no provider of the run', async (t) => {
  const world = await dayWorld();
  t.after(() => world.stop());
  world.model.upstreamModels = { plus: 'gpt-6', openrouter: 'judge-model-2' };
  world.model.fault = onProvider('plus', { answer: 'limit' });

  await world.advanceTo('2026-10-12T08:00:00Z');
  const judged = world.logs.filter((l) => l.event === 'miner.judged');
  assert.ok(judged.length > 0 && judged.every((l) => l.provider === 'openrouter' && l.model === 'judge-model-2'));
  assert.deepEqual(world.logs.find((l) => l.event === 'run.finished')?.providers, ['openrouter']);
});

for (const [name, fault, line] of [
  ['a connection that ends with no answer', { answer: 'hang-up' }, 'ChatGPT Plus failing for Miner (the gateway gave no answer), trying again at 01:30 PT · Miner on OpenRouter'],
  ['a reply cut part way', { answer: 'cut-reply' }, 'ChatGPT Plus failing for Miner (its reply was cut off), trying again at 01:30 PT · Miner on OpenRouter'],
  ['a mid-stream limit', { answer: 'error-in-stream', code: 429 }, 'ChatGPT Plus at its limit, trying again at 01:30 PT · Miner and registration on OpenRouter'],
  ['a mid-stream empty balance', { answer: 'error-in-stream', code: 402 }, 'ChatGPT Plus out of balance, top it up, trying again at 01:30 PT · Miner and registration on OpenRouter'],
  ['a stream that just ends part way', { answer: 'ended-early' }, 'ChatGPT Plus failing for Miner (its reply was cut off), trying again at 01:30 PT · Miner on OpenRouter'],
  ['a mid-stream error naming the request', { answer: 'error-in-stream', code: 400 }, 'ChatGPT Plus failing for Miner (an error part way through its reply), trying again at 01:30 PT · Miner on OpenRouter'],
  ['a mid-stream error with a code that is no status', { answer: 'error-in-stream', code: 'oops' }, 'ChatGPT Plus failing for Miner (500 oops), trying again at 01:30 PT · Miner on OpenRouter'],
  ['a mid-stream error with nothing after it', { answer: 'error-in-stream', code: 429, hangs: true }, 'ChatGPT Plus at its limit, trying again at 01:30 PT · Miner and registration on OpenRouter'],
] as const) {
  test(`${name} moves the run to the next provider`, async (t) => {
    const world = await dayWorld();
    t.after(() => world.stop());
    world.model.fault = onProvider('plus', fault);

    await world.advanceTo('2026-10-12T08:00:00Z');
    assert.equal(asked(world)[0], 'miner@plus');
    assert.ok(asked(world).slice(1).every((n) => n === 'miner@openrouter'), asked(world).join());
    assert.deepEqual(statusLines(world), [line]);
    assert.equal(world.logs.find((l) => l.event === 'run.finished')?.outcome, 'settled', 'Pi retried, and the run never failed');
    assert.equal(titles(world).length, 1);
  });
}

test('a 400 is the request’s own fault: it goes back to the run, and no provider drops out', async (t) => {
  const world = await dayWorld();
  t.after(() => world.stop());
  world.model.fault = onProvider('plus', { answer: 'bad-request' });

  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.ok(asked(world).every((n) => n === 'miner@plus'), 'the next provider is never asked');
  assert.equal(world.logs.find((l) => l.event === 'run.finished')?.outcome, 'failed');
  assert.deepEqual(statusLines(world), []);
});

test('a role with no provider left starts no run, and the 06:00 PT line names why; the date goes on once one is back', async (t) => {
  const world = await dayWorld();
  t.after(() => world.stop());
  world.model.fault = () => ({ answer: 'limit' });

  // The first run finds out, and fails once both have refused.
  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.deepEqual(asked(world).slice(0, 2), ['miner@plus', 'miner@openrouter']);
  assert.deepEqual(statusLines(world), [
    'ChatGPT Plus at its limit, trying again at 01:30 PT · Miner and registration on OpenRouter',
    'OpenRouter at its limit, trying again at 01:30 PT · Miner and registration have no provider left',
  ]);
  const started = world.logs.filter((l) => l.event === 'run.started').length;

  // Before the 30 minutes are up, nothing is asked, and a start of the bot starts no run.
  await world.restart();
  assert.equal(world.logs.filter((l) => l.event === 'run.started').length, started, 'no run starts with no provider left');

  // Each pass after that tries them again, with nothing more said.
  await world.stepThrough('2026-10-12T13:00:00Z', 30);
  assert.ok(world.logs.filter((l) => l.event === 'run.started').length > started);
  const lines = statusLines(world);
  assert.equal(lines.length, 3);
  assert.match(lines[2]!, /^Miner: Mon Oct 12's list is late: Miner has no provider left: ChatGPT Plus at its limit \(trying again at \d\d:\d\d PT\), OpenRouter at its limit \(trying again at \d\d:\d\d PT\)\. The Miner tries again every 30 minutes until the date leaves the 3-day catch-up at 01:00 PT Thu Oct 15\.$/);
  assert.deepEqual(world.discord.cards(NEEDS_YOU), [], 'a limit needs nothing of the person');

  world.model.fault = () => undefined;
  await world.advanceTo('2026-10-12T13:30:00Z');
  assert.equal(titles(world).length, 1);
  assert.deepEqual(statusLines(world).filter((l) => l.includes('is back')), ['ChatGPT Plus is back · Miner and registration on ChatGPT Plus', 'OpenRouter is back']);
});

test('an empty balance that leaves a role with no provider gets one card, which shrinks to a line once it is back', async (t) => {
  const world = await dayWorld();
  t.after(() => world.stop());
  world.model.fault = (request) => (request.model.endsWith('@plus') ? { answer: 'limit' } : { answer: 'out-of-balance' });

  await world.advanceTo('2026-10-12T08:00:00Z');
  const cards = world.discord.cards(NEEDS_YOU);
  assert.equal(cards.length, 1);
  assert.match(cards[0]!.text, new RegExp(`<@${PERSON}> \\*\\*OpenRouter is out of balance\\*\\*`));
  assert.match(cards[0]!.text, /Miner and registration have no provider left\. Work waits, and the bot tries again every 30 minutes, so topping it up is all this needs\./);

  // Passes go by, still empty: no second card.
  await world.stepThrough('2026-10-12T09:30:00Z', 30);
  assert.equal(world.discord.cards(NEEDS_YOU).length, 1);

  world.model.fault = onProvider('plus', { answer: 'limit' });
  await world.advanceTo('2026-10-12T10:00:00Z');
  assert.equal(world.discord.cards(NEEDS_YOU).length, 1);
  assert.match(world.discord.cards(NEEDS_YOU)[0]!.text, /^OpenRouter's balance is back, at 03:00 PT\.$/);
  assert.equal(titles(world).length, 1);
});

test('a role’s only provider out of balance leaves it with none: a card, and the 06:00 PT line names why', async (t) => {
  const world = await dayWorld((config) => void config);
  t.after(() => world.stop());
  world.model.fault = () => ({ answer: 'out-of-balance' });

  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.equal(world.discord.cards(NEEDS_YOU).length, 1);
  assert.deepEqual(statusLines(world), ['OpenRouter out of balance, top it up, trying again at 01:30 PT · Miner and registration have no provider left']);

  await world.advanceTo('2026-10-12T13:00:00Z');
  assert.equal(world.discord.cards(NEEDS_YOU).length, 1);
  assert.match(statusLines(world)[1]!, /^Miner: Mon Oct 12's list is late: Miner has no provider left: OpenRouter out of balance\. The Miner tries again/);
});

test('with no provider left for its role, a Dossier spends no try: the list goes out naming it, no more runs start, and it is written once a provider is back', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId, GUILDS]);
  serveProduct(world, CODEMIND);
  world.model.fault = (request) => (request.model === 'registration@openrouter' ? { answer: 'no-channel' } : undefined);

  await world.advanceTo('2026-10-12T08:00:00Z');
  const dossierRuns = () => world.logs.filter((l) => l.event === 'run.started' && l.kind === 'dossier').length;
  assert.equal(dossierRuns(), 1, 'the first finds out, and the second never starts');
  const summary = () => dayPost(world).messages[0]!.text;
  const why = 'because registration has no provider left: OpenRouter failing (503 model\\_not\\_found)';
  assert.ok(summary().includes(`**Not written:** Codemind, ${why}`), summary());
  assert.equal(summary().split('\n').filter((l) => l.startsWith('**Not written:** ') && l.endsWith(why)).length, 2, summary());
  assert.equal(world.discord.forumPosts(PRODUCTS_FORUM).length, 0);

  // More passes than the 3 tries a Dossier gets, each asking once, and none of them counting.
  await world.stepThrough('2026-10-12T10:30:00Z', 30);
  assert.equal(dossierRuns(), 6, 'one a pass, to see if the name works yet');
  assert.deepEqual(world.logs.filter((l) => l.event === 'dossier.unwritten' || l.event === 'dossier.stopped'), []);
  assert.deepEqual(statusLines(world), ['OpenRouter failing for registration (503 model_not_found), trying again at 01:30 PT · registration has no provider left']);

  // A provider is back, and both are written at the next pass, in a list that links them.
  world.model.fault = () => undefined;
  await world.advanceTo('2026-10-12T11:00:00Z');
  assert.equal(world.discord.forumPosts(PRODUCTS_FORUM).length, 2);
  assert.ok(!summary().includes('Not written'), summary());
  assert.deepEqual(statusLines(world).slice(1), ['OpenRouter is back for registration']);

  // Nothing is left to do, so the passes stop.
  const runs = world.logs.filter((l) => l.event === 'run.started').length;
  await world.advanceTo('2026-10-12T11:30:00Z');
  assert.equal(world.logs.filter((l) => l.event === 'run.started').length, runs);
});

test('a run a provider served, whose role then ran out of providers, is a failed run and counts as a try', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId]);
  serveProduct(world, CODEMIND);
  // A record the bot turns back makes the run ask again, and by then the provider is out.
  world.model.dossier = () => ({ ...CODEMIND.dossier, whatItIs: { text: 'No sources.', sources: [] } });
  world.model.fault = (request) => (request.model === 'registration@openrouter' && !opensRun(request) ? { answer: 'server-error', status: 500 } : undefined);

  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.deepEqual(world.logs.filter((l) => l.event === 'dossier.unwritten').map((l) => l.tries), [1]);
  assert.deepEqual(world.logs.filter((l) => l.event === 'dossier.waiting'), []);
});

test('a Correction made with no provider left waits rather than being not re-judged, and its run goes once one is back', async (t) => {
  const world = await dayPosted(t);
  await world.advanceTo('2026-10-12T16:15:00Z'); // 09:15 PDT
  rejudges(world, CODEMIND.postId, { fit: 5, notAProduct: false, reason: 'not for you after all' });
  world.model.fault = () => ({ answer: 'limit' });

  await correct(world, 'Codemind', 'Not what I want.');
  await world.assistant.whenIdle();
  assert.deepEqual(world.logs.filter((l) => l.event === 'correction.unjudged'), []);
  assert.ok(!lineOf(world, 'Codemind').line.text.includes('after your Correction'));

  world.model.fault = () => undefined;
  await world.advanceTo('2026-10-12T16:45:00Z');
  assert.match(lineOf(world, 'Codemind').line.text, /fit 5 after your Correction/);
});

test('a Retry tapped with no provider left waits, and its run goes at a later pass once one is back', async (t) => {
  const world = await dayWorld();
  t.after(() => world.stop());
  world.model.runaway = () => true;
  world.model.usage = { prompt_tokens: 150_000, completion_tokens: 1_000, cached_tokens: 0 };
  await world.advanceTo('2026-10-12T08:00:00Z');
  await world.discord.connected();
  const [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  const notice = post!.messages[1]!;
  assert.equal(world.model.judgingRuns.length, 2, 'the run and its automatic retry were capped');

  world.model.runaway = () => false;
  world.model.usage = { prompt_tokens: 2400, completion_tokens: 380, cached_tokens: 0 };
  world.model.fault = () => ({ answer: 'limit' });
  await world.discord.tap({ userId: PERSON, customId: notice.lines[0]!.button!.customId, channelId: post!.id, messageId: notice.id });
  await world.assistant.whenIdle();
  assert.deepEqual(world.logs.filter((l) => l.event === 'lane.job-failed'), []);

  world.model.fault = () => undefined;
  await world.advanceTo('2026-10-12T08:30:00Z');
  await world.assistant.whenIdle();
  assert.match(world.discord.forumPosts(MINER_DAYS_FORUM)[0]!.title, /^Mon Oct 12 · \d+ Dossiers? · line \d+$/);
});

test('a 401 on a key whose quota is spent is reported as gateway quota spent, with a card, and not as a dead token; both go when it is topped up', async (t) => {
  const world = await dayWorld();
  t.after(() => world.stop());
  world.model.spentKeys.add(TOKENS.minerKey);

  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.deepEqual(statusLines(world), ['Gateway quota spent for Miner, top it up in new-api, trying again at 01:30 PT · Miner has no provider left']);
  const cards = world.discord.cards(NEEDS_YOU);
  assert.equal(cards.length, 1);
  assert.match(cards[0]!.text, /Gateway quota spent/);
  assert.deepEqual(world.logs.filter((l) => l.event === 'forwarder.key-refused'), []);

  await world.advanceTo('2026-10-12T13:00:00Z');
  assert.match(statusLines(world)[1]!, /^Miner: Mon Oct 12's list is late: Miner has no provider left: gateway quota spent\. /);

  world.model.spentKeys.delete(TOKENS.minerKey);
  await world.advanceTo('2026-10-12T13:30:00Z');
  assert.equal(titles(world).length, 1);
  assert.deepEqual(statusLines(world).slice(2), ['Gateway quota is back for Miner']);
  assert.match(world.discord.cards(NEEDS_YOU)[0]!.text, /^Gateway quota for Miner is back, at 06:30 PT\.$/);
});

test('new-api’s 403 for its user’s quota takes every role at once, with one line and one card, and any role’s served request ends it', async (t) => {
  const world = await dayWorld();
  t.after(() => world.stop());
  world.model.fault = () => ({ answer: 'user-quota' });

  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.deepEqual(asked(world), ['miner@plus'], 'the next provider is behind the same user, and is not asked');
  assert.deepEqual(statusLines(world), ['Gateway quota spent for Miner and registration, top it up in new-api, trying again at 01:30 PT · Miner and registration have no provider left']);
  assert.equal(world.discord.cards(NEEDS_YOU).length, 1);

  world.model.fault = () => undefined;
  await world.advanceTo('2026-10-12T08:30:00Z');
  assert.deepEqual(statusLines(world).slice(1), ['Gateway quota is back for Miner and registration']);
  assert.match(world.discord.cards(NEEDS_YOU)[0]!.text, /^Gateway quota for Miner and registration is back, at 01:30 PT\.$/);
});

test('new-api’s 403 for a key’s quota takes only that role’s providers', async (t) => {
  const world = await dayWorld();
  t.after(() => world.stop());
  world.model.fault = (request) => (request.model.startsWith('miner@') ? { answer: 'key-quota' } : undefined);

  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.deepEqual(asked(world), ['miner@plus']);
  assert.deepEqual(statusLines(world), ['Gateway quota spent for Miner, top it up in new-api, trying again at 01:30 PT · Miner has no provider left']);
  assert.equal(world.discord.cards(NEEDS_YOU).length, 1);
});

test('a 401 on a key with quota left is the provider refusing its own key: that name is failing, and the next provider serves', async (t) => {
  const world = await dayWorld();
  t.after(() => world.stop());
  world.model.fault = onProvider('plus', { answer: 'provider-key-refused' });

  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.deepEqual(statusLines(world), ['ChatGPT Plus failing for Miner (its own key refused, 401), trying again at 01:30 PT · Miner on OpenRouter']);
  assert.deepEqual(world.discord.cards(NEEDS_YOU), []);
  assert.equal(titles(world).length, 1);
});

test('a 401 on a key new-api doesn’t know leaves the role with no provider, naming the command that replaces it, and is never called spent', async (t) => {
  const world = await dayWorld();
  t.after(() => world.stop());
  world.model.revokeKey(TOKENS.minerKey);

  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.deepEqual(statusLines(world), ['new-api refused Miner’s key, replace it with `sudo ops/token newapi-key-miner`, trying again at 01:30 PT · Miner has no provider left']);
  assert.deepEqual(world.discord.cards(NEEDS_YOU), [], 'the notice is #70’s');
  const started = world.logs.filter((l) => l.event === 'run.started').length;
  await world.restart();
  assert.equal(world.logs.filter((l) => l.event === 'run.started').length, started, 'no run starts');

  await world.advanceTo('2026-10-12T13:00:00Z'); // 06:00 PDT
  assert.match(statusLines(world)[1]!, /^Miner: Mon Oct 12's list is late: Miner has no provider left: new-api refused its key\. /);

  world.model.restoreKey(TOKENS.minerKey);
  await world.advanceTo('2026-10-12T13:30:00Z');
  assert.equal(titles(world).length, 1);
  assert.deepEqual(statusLines(world).slice(2), ['new-api takes Miner’s key again']);
});

for (const [name, body] of [
  ['it can’t read', 'not json'],
  ['with no count in it', '{"code":true,"data":{}}'],
] as const) {
  test(`a 401 whose usage answer is one ${name} goes back to the run, since nothing tells why`, async (t) => {
    const world = await dayWorld();
    t.after(() => world.stop());
    world.model.fault = () => ({ answer: 'provider-key-refused' });
    world.model.usageBody = body;

    await world.advanceTo('2026-10-12T08:00:00Z');
    assert.ok(world.logs.some((l) => l.event === 'forwarder.key-unread' && l.role === 'miner'));
    assert.equal(world.logs.find((l) => l.event === 'run.finished')?.outcome, 'failed');
    assert.deepEqual(statusLines(world), [], 'no provider dropped out');
  });
}

for (const [body, line] of [
  ['{"error":{"code":{"toString":null}}}', 'ChatGPT Plus failing for Miner (403), trying again at 01:30 PT · Miner on OpenRouter'],
  ['null', 'ChatGPT Plus failing for Miner (403), trying again at 01:30 PT · Miner on OpenRouter'],
  ['not json', 'ChatGPT Plus failing for Miner (403), trying again at 01:30 PT · Miner on OpenRouter'],
  ['{"error":"text"}', 'ChatGPT Plus failing for Miner (403), trying again at 01:30 PT · Miner on OpenRouter'],
] as const) {
  test(`a refusal whose body is \`${body}\` still moves the request on`, async (t) => {
    const world = await dayWorld();
    t.after(() => world.stop());
    world.model.fault = onProvider('plus', { answer: 'odd-body', status: 403, body });

    await world.advanceTo('2026-10-12T08:00:00Z');
    assert.deepEqual(statusLines(world), [line]);
    assert.deepEqual(world.logs.filter((l) => l.event === 'forwarder.failed'), []);
    assert.equal(titles(world).length, 1);
  });
}

for (const body of ['{"error":{"metadata":"text"}}', '{"error":{"metadata":{"headers":{"X-RateLimit-Reset":{}}}}}']) {
  test(`a 429 whose body is \`${body}\` gives no reset time`, async (t) => {
    const world = await dayWorld();
    t.after(() => world.stop());
    world.model.fault = onProvider('plus', { answer: 'odd-body', status: 429, body });

    await world.advanceTo('2026-10-12T08:00:00Z');
    assert.deepEqual(statusLines(world), ['ChatGPT Plus at its limit, trying again at 01:30 PT · Miner and registration on OpenRouter']);
  });
}

/** What new-api counted for a failed reply it closed itself, as the capture of it recorded. The forwarder relies on no one number. */
function countedByNewApi(row: string): { prompt_tokens: number; completion_tokens: number; prompt_tokens_details: { cached_tokens: number } } {
  const { chat } = JSON.parse(readFileSync(new URL('./fixtures/new-api/answers.json', import.meta.url), 'utf8')) as { chat: Record<string, { parts: string[] }> };
  return JSON.parse(chat[row]!.parts.find((part) => part.includes('"usage"'))!.replace(/^data: /, '')).usage;
}

for (const [name, fault, row] of [
  ['though its usage comes after its error', { answer: 'error-in-stream', code: 429 }, 'stream-error-event'],
  ['when new-api closed it after a cut', { answer: 'cut-reply' }, 'stream-cut'],
] as const) {
  test(`what a reply that failed part way spent counts, ${name}`, async (t) => {
    const world = await dayWorld();
    t.after(() => world.stop());
    world.model.fault = onProvider('plus', fault);

    await world.advanceTo('2026-10-12T08:00:00Z');
    assert.deepEqual(asked(world), ['miner@plus', 'miner@openrouter', 'miner@openrouter']);
    // On top of what the reply cut off spent, 2,400 input and 380 output tokens from each of the next provider's two.
    const counted = countedByNewApi(row);
    assert.deepEqual(world.logs.find((l) => l.event === 'run.finished')?.tokens, {
      input: counted.prompt_tokens + 4800,
      cached: counted.prompt_tokens_details.cached_tokens,
      output: counted.completion_tokens + 760,
    });
  });
}

// The rows of the capture of new-api no other test reads, so that a changed one fails here.
for (const [row, fault, line] of [
  ['plus-limit', { answer: 'captured', row: 'plus-limit' }, 'ChatGPT Plus at its limit, trying again at 01:30 PT · Miner and registration on OpenRouter'],
  ['plain-429', { answer: 'captured', row: 'plain-429' }, 'ChatGPT Plus at its limit, trying again at 01:30 PT · Miner and registration on OpenRouter'],
  ['retry-after-only', { answer: 'captured', row: 'retry-after-only' }, 'ChatGPT Plus at its limit, trying again at 01:30 PT · Miner and registration on OpenRouter'],
  ['deepseek-402', { answer: 'captured', row: 'deepseek-402' }, 'ChatGPT Plus out of balance, top it up, trying again at 01:30 PT · Miner and registration on OpenRouter'],
  ['upstream-403', { answer: 'captured', row: 'upstream-403' }, 'ChatGPT Plus failing for Miner (403), trying again at 01:30 PT · Miner on OpenRouter'],
  ['unreachable', { answer: 'captured', row: 'unreachable' }, 'ChatGPT Plus failing for Miner (500 do_request_failed), trying again at 01:30 PT · Miner on OpenRouter'],
  ['upstream-500', { answer: 'server-error', status: 500 }, 'ChatGPT Plus failing for Miner (500), trying again at 01:30 PT · Miner on OpenRouter'],
  ['upstream-502', { answer: 'server-error', status: 502 }, 'ChatGPT Plus failing for Miner (502 bad_response_status_code), trying again at 01:30 PT · Miner on OpenRouter'],
] as const) {
  test(`the capture of new-api’s \`${row}\` moves the request on, and #status says why`, async (t) => {
    const world = await dayWorld();
    t.after(() => world.stop());
    world.model.fault = onProvider('plus', fault);

    await world.advanceTo('2026-10-12T08:00:00Z');
    assert.deepEqual(statusLines(world), [line]);
    assert.equal(titles(world).length, 1);
  });
}

test('the capture of a reply new-api served whole reads as served: nothing drops out, and its usage is read', async (t) => {
  const world = await dayWorld();
  t.after(() => world.stop());
  world.model.fault = onProvider('plus', { answer: 'captured', row: 'ok' });

  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.ok(asked(world).length > 0 && asked(world).every((name) => name === 'miner@plus'), asked(world).join());
  assert.deepEqual(statusLines(world), []);
  assert.deepEqual(world.logs.filter((l) => l.event === 'forwarder.usage-missing'), []);
});

test('a provider further down its role’s list is still tried again: a request asks it first once its time is up, and it says when it is back', async (t) => {
  const world = await dayWorld();
  t.after(() => world.stop());
  world.model.fault = (request) => (request.model.endsWith('@plus') ? { answer: 'limit' } : { answer: 'out-of-balance' });
  world.productHunt.addFeatured(fixtureDay('2026-10-13').slice(0, 8), '2026-10-13T07:01:00Z');

  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.equal(world.discord.cards(NEEDS_YOU).length, 1);

  // Both have recovered. Plus takes the first request, by the order, and OpenRouter the next, being due.
  world.model.fault = () => undefined;
  const before = asked(world).length;
  await world.advanceTo('2026-10-12T08:30:00Z');
  assert.deepEqual(asked(world).slice(before), ['miner@plus', 'miner@openrouter']);
  assert.deepEqual(statusLines(world).slice(2), ['ChatGPT Plus is back · Miner and registration on ChatGPT Plus', 'OpenRouter is back']);
  assert.match(world.discord.cards(NEEDS_YOU)[0]!.text, /^OpenRouter's balance is back, at 01:30 PT\.$/);

  // Nothing is due now, so the order is the order again.
  const afterBack = asked(world).length;
  await world.advanceTo('2026-10-13T08:00:00Z');
  assert.deepEqual(asked(world).slice(afterBack), ['miner@plus', 'miner@plus']);
});

test('a provider still out when it is due moves the request on, and stays out with nothing more said', async (t) => {
  const world = await dayWorld();
  t.after(() => world.stop());
  // Plus is at its limit for one minute, and OpenRouter is out of balance from then on.
  world.model.fault = (request) =>
    request.model === 'miner@openrouter' ? { answer: 'out-of-balance' } : world.model.requests.length === 1 ? { answer: 'limit', resetsAt: new Date('2026-10-12T08:01:00Z') } : undefined;

  await world.advanceTo('2026-10-12T08:00:00Z');
  const lines = statusLines(world);
  assert.equal(lines.length, 2, lines.join('\n'));

  const before = asked(world).length;
  await world.advanceTo('2026-10-12T08:30:00Z');
  assert.deepEqual(asked(world).slice(before), ['miner@plus', 'miner@openrouter', 'miner@plus'], 'Plus by the order, OpenRouter due and refusing, then Plus');
  assert.equal(statusLines(world).length, 3, 'only Plus’s back line');
});

test('a provider that changes why it is out says so: one at its limit that runs out of balance gets the line saying to top it up', async (t) => {
  const world = await dayWorld();
  t.after(() => world.stop());
  world.model.fault = onProvider('plus', { answer: 'limit' });
  const judged = world.model.judgment;
  world.model.judgment = (postId) => (postId === DAY[0]!.id ? 'omit' : judged(postId));

  await world.advanceTo('2026-10-12T08:00:00Z');
  world.model.fault = onProvider('plus', { answer: 'out-of-balance' });
  await world.advanceTo('2026-10-12T08:30:00Z');
  assert.deepEqual(statusLines(world), [
    'ChatGPT Plus at its limit, trying again at 01:30 PT · Miner and registration on OpenRouter',
    'ChatGPT Plus out of balance, top it up, trying again at 02:00 PT · Miner and registration on OpenRouter',
  ]);

  // Still out of balance at the next try: nothing more is said.
  await world.advanceTo('2026-10-12T09:00:00Z');
  assert.equal(statusLines(world).length, 2);
});

test('a card Discord refused goes out at the next try', async (t) => {
  const world = await dayWorld((config) => void config);
  t.after(() => world.stop());
  world.model.fault = () => ({ answer: 'out-of-balance' });
  world.discord.refuseNextMessage(NEEDS_YOU);

  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.deepEqual(world.discord.cards(NEEDS_YOU), []);
  await world.advanceTo('2026-10-12T08:30:00Z');
  assert.equal(world.discord.cards(NEEDS_YOU).length, 1);
  await world.advanceTo('2026-10-12T09:00:00Z');
  assert.equal(world.discord.cards(NEEDS_YOU).length, 1, 'and only once');
});

test('a card Discord wouldn’t shrink is shrunk at the bot’s next start', async (t) => {
  const world = await dayWorld((config) => void config);
  t.after(() => world.stop());
  world.model.fault = () => ({ answer: 'out-of-balance' });
  await world.advanceTo('2026-10-12T08:00:00Z');
  const card = () => world.discord.cards(NEEDS_YOU)[0]!.text;
  assert.match(card(), /OpenRouter is out of balance/);

  world.discord.uneditable.add(NEEDS_YOU);
  world.model.fault = () => undefined;
  await world.advanceTo('2026-10-12T08:30:00Z');
  assert.ok(statusLines(world).includes('OpenRouter is back · Miner and registration on OpenRouter'), 'it is back');
  assert.match(card(), /OpenRouter is out of balance/, 'and Discord took no edit');

  world.discord.uneditable.delete(NEEDS_YOU);
  await world.restart();
  assert.match(card(), /^OpenRouter's balance is back, at 01:30 PT\.$/);
  assert.equal(statusLines(world).filter((l) => l.includes('is back')).length, 1, 'said once');
});

test('a Dossier due at the Miner’s start while its role has no provider waits for one, rather than for the next day’s start', async (t) => {
  const world = await startWorld({
    now: '2026-10-12T07:30:00Z',
    configure: (config) => {
      config.providers.plus = { label: 'ChatGPT Plus', mailGroup: true };
      config.roles.registration.providers = [{ name: 'plus', model: 'judge-model-1' }];
    },
  });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId, GUILDS]);
  serveProduct(world, CODEMIND);
  // Codemind's page won't load, which counts one try. guilds.run's Dossier is written, and its Walkthrough's run finds
  // Plus at its limit until after the next start.
  world.browser.fail(websiteOf(CODEMIND.postId), { kind: 'timeout', message: 'the page took over 30 seconds' });
  world.model.fault = (request) => (request.tools.includes('record_walkthrough') ? { answer: 'limit', resetsAt: new Date('2026-10-13T09:15:00Z') } : undefined);
  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.deepEqual(world.logs.filter((l) => l.event === 'dossier.unwritten').map((l) => l.tries), [1]);
  assert.equal(world.discord.forumPosts(PRODUCTS_FORUM).length, 1);

  world.browser.fail(websiteOf(CODEMIND.postId), undefined);
  world.model.fault = () => undefined;
  world.productHunt.addFeatured(fixtureDay('2026-10-13').slice(0, 8), '2026-10-13T07:01:00Z');
  await world.advanceTo('2026-10-13T08:00:00Z'); // Tue 01:00 PDT, with Plus still out
  assert.equal(world.discord.forumPosts(PRODUCTS_FORUM).length, 1, 'no run could start');

  await world.stepThrough('2026-10-13T09:30:00Z', 30); // 02:30 PDT, past the reset
  assert.equal(world.discord.forumPosts(PRODUCTS_FORUM).length, 2, 'written the same day');
});

test('a line Discord refused goes out with the next request served, and a restart during a cooldown keeps skipping the provider and says nothing twice', async (t) => {
  const world = await dayWorld();
  t.after(() => world.stop());
  world.model.fault = onProvider('plus', { answer: 'limit', resetsAt: new Date('2026-10-12T20:00:00Z') });
  world.discord.refuseNextMessage(STATUS);
  const judged = world.model.judgment;
  world.model.judgment = (postId) => (postId === DAY[0]!.id ? 'omit' : judged(postId));

  await world.advanceTo('2026-10-12T08:00:00Z');
  const line = 'ChatGPT Plus at its limit until 13:00 PT · Miner and registration on OpenRouter';
  assert.deepEqual(statusLines(world), [line]);
  assert.ok(world.discord.refused.some((r) => r.reason.includes('refuse this message')), 'Discord refused it the first time');

  const before = asked(world).length;
  await world.restart();
  assert.ok(asked(world).length > before, 'the restart’s pass asked for a judgment');
  assert.ok(asked(world).slice(before).every((name) => name === 'miner@openrouter'), 'and Plus stays out');
  assert.deepEqual(statusLines(world), [line]);
});

test('a mail-cleared role may list only routes in the mail group', async (t) => {
  const withMail = (config: Config, mailGroup: boolean) => {
    config.providers.deepseek = { label: 'DeepSeek', mailGroup };
    (config.roles as Record<string, { providers: { name: string; model: string }[] }>).mail = { providers: [{ name: 'deepseek', model: 'judge-model-1' }] };
  };
  await assert.rejects(startWorld({ now: '2026-10-12T07:30:00Z', configure: (config) => withMail(config, false) }), /roles\.mail: deepseek isn't in the mail group, and a mail-cleared role may list only routes that are \(ADR 0010\)/);

  // Another role may list that route, and so may this one once it is in the group.
  const world = await startWorld({
    now: '2026-10-12T07:30:00Z',
    configure: (config) => {
      withMail(config, true);
      config.providers.other = { label: 'Other', mailGroup: false };
      config.roles.miner.providers = [{ name: 'other', model: 'judge-model-1' }];
    },
  });
  t.after(() => world.stop());
});

test('a provider with no label is a config error at start-up', async () => {
  await assert.rejects(
    startWorld({ now: '2026-10-12T07:30:00Z', configure: (config) => (config.roles.miner.providers = [{ name: 'unnamed', model: 'judge-model-1' }]) }),
    /roles\.miner: unnamed needs its label in providers/,
  );
});

test('the shipped config names each provider its roles list, and tries a provider again after 30 minutes', () => {
  const shipped = JSON.parse(readFileSync(new URL('../../config/assistant.json', import.meta.url), 'utf8')) as Config;
  for (const { providers } of Object.values(shipped.roles)) {
    for (const { name } of providers) assert.ok(shipped.providers[name]?.label, `${name} has a label`);
  }
  assert.equal(shipped.gateway.retryMinutes, 30);
});

test('a day judged by more than one provider says so in its summary, and a day judged by one says nothing', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z', configure: plusThenOpenRouter });
  t.after(() => world.stop());
  const day = fixtureDay('2026-10-12').slice(0, 12);
  world.productHunt.addFeatured(day, '2026-10-12T07:01:00Z');
  world.productHunt.addFeatured(fixtureDay('2026-10-13').slice(0, 8), '2026-10-13T07:01:00Z');
  world.model.onlyDossiers([]);
  // Plus judges the first run's 8 Launches, and is at its limit by the second run.
  world.model.fault = (request) => (request.model === 'miner@plus' && world.model.judgingRuns.length > 0 ? { answer: 'limit' } : undefined);

  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.ok(dayPost(world).messages[0]!.text.includes('-# Judged by ChatGPT Plus (8) and OpenRouter (4)\n'), dayPost(world).messages[0]!.text);

  world.model.fault = onProvider('plus', { answer: 'limit' });
  await world.advanceTo('2026-10-13T08:00:00Z');
  const second = world.discord.forumPosts(MINER_DAYS_FORUM).find((p) => p.title.startsWith('Tue Oct 13'))!;
  assert.ok(!second.messages[0]!.text.includes('Judged by'), second.messages[0]!.text);
});

for (const junk of ['data: null', 'data: 5', 'data: "text"', 'data: {"choices":[null],"model":7}']) {
  test(`a stream holding \`${junk}\` is read past, and its provider still serves`, async (t) => {
    const world = await dayWorld();
    t.after(() => world.stop());
    world.model.junkLine = junk;

    await world.advanceTo('2026-10-12T08:00:00Z');
    assert.deepEqual(asked(world), ['miner@plus', 'miner@plus']);
    assert.deepEqual(world.logs.filter((l) => l.event === 'forwarder.failed'), []);
    assert.deepEqual(statusLines(world), []);
    assert.equal(titles(world).length, 1);
  });
}

test('a Dossier a Correction asks for while its role has no provider waits, and is written within 30 minutes of one coming back', async (t) => {
  const world = await dayPosted(t);
  await world.advanceTo('2026-10-12T16:15:00Z'); // 09:15 PDT
  serveProduct(world, CODEMIND);
  rejudges(world, CODEMIND.postId, { fit: 8, notAProduct: false, reason: 'your coding agent hands off tasks over MCP' });
  world.model.fault = (request) => (request.model === 'registration@openrouter' ? { answer: 'no-channel' } : undefined);

  await correct(world, 'Codemind', 'This is squarely what I want.');
  await world.assistant.whenIdle();
  assert.deepEqual(world.discord.forumPosts(PRODUCTS_FORUM), []);
  assert.ok(dayPost(world).messages[0]!.text.includes('**Not written:** Codemind, because registration has no provider left'), dayPost(world).messages[0]!.text);
  assert.deepEqual(world.logs.filter((l) => l.event === 'dossier.unwritten'), [], 'no try counted');

  world.model.fault = () => undefined;
  await world.advanceTo('2026-10-12T16:45:00Z');
  assert.equal(world.discord.forumPosts(PRODUCTS_FORUM).length, 1, 'a pass came without waiting for the Miner’s next start');
  assert.ok(!dayPost(world).messages[0]!.text.includes('Not written'));
});

test('a Walkthrough preparation with no provider left reads no signup page, and goes at a later try once one is back', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId]);
  serveProduct(world, CODEMIND);
  world.model.fault = (request) => (request.tools.includes('record_walkthrough') ? { answer: 'no-channel' } : undefined);

  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.equal(world.discord.forumPosts(PRODUCTS_FORUM).length, 1, 'the Dossier went first');
  assert.deepEqual(world.discord.cards(NEEDS_YOU), [], 'no Walkthrough yet, and a failing name asks nothing of the person');
  assert.deepEqual(statusLines(world), ['OpenRouter failing for registration (503 model_not_found), trying again at 01:30 PT · registration has no provider left']);

  // The start of the bot tries again at once: with no provider left that reads nothing and starts nothing.
  const reads = world.browser.reads.length;
  const runs = world.logs.filter((l) => l.event === 'run.started' && l.kind === 'walkthrough-preparation').length;
  await world.restart();
  assert.equal(world.browser.reads.length, reads);
  assert.equal(world.logs.filter((l) => l.event === 'run.started' && l.kind === 'walkthrough-preparation').length, runs);

  world.model.fault = () => undefined;
  await world.advanceTo('2026-10-12T08:30:00Z');
  assert.equal(world.discord.cards(NEEDS_YOU).length, 1, 'its card is out');
});
