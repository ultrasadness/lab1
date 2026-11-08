// The Personal database: the person's own repo of Markdown on GitHub, which the bot writes through one lock that
// fast-forwards its checkout, writes, commits and pushes with the deploy key. Its first view is one `days/` file per
// Miner day, written from the live store once the day is judged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { INTEREST_SCOPE, MINER_DAYS_FORUM, NEEDS_YOU, PERSON, PRODUCTS_FORUM, startWorld, type World } from './harness/world.ts';
import { fixtureDay } from './harness/fake-product-hunt.ts';
import { opensJudgingRun, said } from './harness/fake-model.ts';
import { CODEMIND, serveProduct } from './harness/dossier-fixtures.ts';
import { until } from './harness/miner-day.ts';

const ph = (slug: string) => `https://www.producthunt.com/posts/${slug}`;

/** guilds.run's Launch on Oct 12, at Fit 8 like Codemind's and ahead of it on Product Hunt. */
const GUILDS = '1274741';

const OCT_12 = [
  '# Miner day · Mon 2026-10-12 PT',
  '',
  "Day's line 7, drawn 2026-10-12 01:00 PT: the 5th best Fit (⌈√19⌉ = 5) is 6, so the floor of 7 sets it.",
  '',
  '4 Dossiers · 15 Skips · 19 Featured Launches · [Data sourced from Product Hunt](https://www.producthunt.com/leaderboard/daily/2026/10/12)',
  '',
  `- [Google EmbeddingGemma 2](${ph('google-embeddinggemma-2')}) · Skip · fit 5 · open embedding model; weights on Hugging Face, nothing of its own to sign up for · Rules applied: none`,
  `- [ngram 2.0](${ph('ngram-2-0-2')}) · Skip · fit 3 · explainer and avatar video maker; video isn't in your scope · Rules applied: none`,
  `- [Base Code](${ph('base-code')}) · Skip · fit 5 · edit a codebase from the browser through pull requests; aimed at teams · Rules applied: none`,
  `- [guilds.run](${ph('guilds-run')}) · Dossier · fit 8 · open-source agent teams you can inspect; self-host free · Rules applied: none`,
  `- [Manifold MCP](${ph('manifold-mcp')}) · Skip · fit 2 · marketing data for agents; you left out marketing · Rules applied: none`,
  `- [Ancher 2.0](${ph('ancher-2-0')}) · Skip · fit 6 · knowledge workspace for what you read and save; no word on export · Rules applied: none`,
  `- [Hexis Cloud](${ph('hexis-cloud-2')}) · Skip · fit 5 · shared context and tools for agents, built for a company · Rules applied: none`,
  `- [Kudos 3.0](${ph('kudos-3-0')}) · Skip · fit 1 · card-rewards finder for Android; finance · Rules applied: none`,
  `- [Scrape Anything by Context.dev](${ph('scrape-anything-by-context-dev')}) · Skip · fit 6 · web-to-data API; a developer tool, pricing not stated · Rules applied: none`,
  `- [Bearconnect 2.0](${ph('bearconnect-2-0')}) · Skip · fit 0 · LinkedIn outreach; you left out sales · Rules applied: none`,
  `- [ExcaliClaw](${ph('excaliclaw')}) · Skip · fit 6 · diagram workspace your agent draws in over MCP; generous free plan · Rules applied: none`,
  `- [Dropstone CLI](${ph('dropstone-cli')}) · Dossier · fit 9 · terminal coding agent that keeps your corrections across sessions; free plan · Rules applied: none`,
  `- [Invited - AI Reminder Scanner](${ph('invited-ai-reminder-scanner')}) · Skip · fit 1 · reminder scanner for Android · Rules applied: none`,
  `- [Understory Notes](${ph('understory-notes')}) · Skip · fit 3 · notes for writing, but a Mac app · Rules applied: none`,
  `- [SquadRoom](${ph('squadroom')}) · Skip · fit 3 · AI employees for a company; needs a team · Rules applied: none`,
  `- [Milepost](${ph('milepost-2')}) · Skip · fit 2 · driving journal for iPhone; travel · Rules applied: none`,
  `- [Cube Forms](${ph('cube-forms')}) · Dossier · fit 7 · forms agents fill over MCP or HTTP; free · Rules applied: none`,
  `- [SalesRep.com](${ph('salesrep-com')}) · Skip · fit 0 · AI sales rep for shops; you left out sales · Rules applied: none`,
  `- [Codemind](${ph('codemind-2')}) · Dossier · fit 8 · your coding agent hands off tasks over MCP; free allowance to start · Rules applied: none`,
  '',
].join('\n');

test('once the day is judged, its days/ file is committed and pushed to GitHub with the deploy key', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' }); // 00:30 PDT
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');

  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT

  assert.equal(world.git.file('days/2026-10-12.md'), OCT_12);
  assert.deepEqual(world.git.subjects('main', { leavingOut: 'products' }), ['Start the Personal database', 'Miner day Mon 2026-10-12 PT: 4 Dossiers, line 7']);
  const connections = world.git.connections();
  assert.ok(connections.some((c) => c.service === 'git-receive-pack'), 'the bot pushed');
  assert.ok(connections.every((c) => c.deployKey), 'every fetch and push came with the deploy key');
});

test('every date the bot writes to the Personal database carries its year and zone', async (t) => {
  const world = await startWorld({ now: '2026-10-14T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-14'), '2026-10-14T07:01:00Z');

  await world.advanceTo('2026-10-14T08:00:00Z');

  const file = world.git.file('days/2026-10-14.md')!;
  const dates = [...file.matchAll(/\b\d{4}-\d{2}-\d{2}\b(?: \d{2}:\d{2})?(?: PT\b)?/g)].map((m) => m[0]);
  assert.deepEqual(dates, ['2026-10-14 PT', '2026-10-14 01:00 PT']);
  assert.doesNotMatch(file, /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d/, 'no date without its year');
  assert.equal(file.split('\n').filter((l) => l.startsWith('- ')).length, 48, 'one line per Featured Launch');
  assert.match(
    file,
    /^- \[Microsoft Maia 300\]\(https:\/\/www\.producthunt\.com\/posts\/microsoft-maia-300\) · Skip · fit \d+, not a Product · Microsoft's AI chip announcement · Rules applied: none$/m,
  );
});

test('the bot fast-forwards before each run, so an Interest scope the person changes on GitHub reaches the next run', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  const added = 'Also in scope: tools for learning Chinese.';
  // While the first of the day's three runs is judging, the person edits the Interest scope on GitHub.
  const standIn = world.model.judgment;
  let edited = false;
  world.model.judgment = (postId) => {
    if (!edited) {
      edited = true;
      world.git.commitAsPerson('profile/interest-scope.md', `${INTEREST_SCOPE}\n${added}\n`, 'Widen the Interest scope');
    }
    return standIn(postId);
  };

  await world.advanceTo('2026-10-12T08:00:00Z');

  const runs = world.model.requests.filter(opensJudgingRun).map((r) => said(r, 'user'));
  assert.equal(runs.length, 3);
  assert.deepEqual(
    runs.map((prompt) => prompt.includes(added)),
    [false, true, true],
  );
  assert.deepEqual(world.git.subjects('main', { leavingOut: 'products' }), [
    'Start the Personal database',
    'Widen the Interest scope',
    'Miner day Mon 2026-10-12 PT: 4 Dossiers, line 7',
  ]);
});

test('the days/ file written again from the store is the same file, and gets no second commit', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  // Discord takes the day's post, but the bot never hears back, so the date's pass ends without its list.
  world.discord.loseReply('post', 1, MINER_DAYS_FORUM);
  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.equal(world.git.file('days/2026-10-12.md'), OCT_12);

  // The next pass, an hour later and after an upgrade that raised the floor, finishes the post and writes the day's
  // file again, from the line as it was drawn.
  await world.outage('2026-10-12T09:00:00Z', (config) => {
    config.miner.lineFloor = 8;
  });

  assert.equal(world.discord.forumPosts(MINER_DAYS_FORUM)[0]?.title, 'Mon Oct 12 · 4 Dossiers · line 7');
  assert.equal(world.git.file('days/2026-10-12.md'), OCT_12);
  assert.deepEqual(world.git.subjects('main', { leavingOut: 'products' }), ['Start the Personal database', 'Miner day Mon 2026-10-12 PT: 4 Dossiers, line 7']);
});

test('a push GitHub refuses leaves the commit in the checkout, and the bot pushes it once GitHub takes pushes again', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.git.refusePushes = true;

  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.equal(world.discord.forumPosts(MINER_DAYS_FORUM)[0]?.title, 'Mon Oct 12 · 4 Dossiers · line 7', 'the day still posts');
  assert.ok(world.git.connections().some((c) => c.service === 'git-receive-pack' && c.refused), 'GitHub refused the push');
  assert.equal(world.git.file('days/2026-10-12.md'), undefined);

  // A restart while GitHub still refuses loses nothing: the commit waits in the checkout.
  world.clock.advanceTo('2026-10-12T08:10:00Z');
  await world.restart();
  assert.deepEqual(world.git.subjects('main', { leavingOut: 'products' }), ['Start the Personal database']);

  world.git.refusePushes = false;
  await world.advanceTo('2026-10-12T08:39:00Z');
  assert.equal(world.git.file('days/2026-10-12.md'), undefined, 'the next try is 30 minutes after the last');
  await world.advanceTo('2026-10-12T08:40:00Z');
  assert.equal(world.git.file('days/2026-10-12.md'), OCT_12);
  assert.deepEqual(world.git.subjects('main', { leavingOut: 'products' }), ['Start the Personal database', 'Miner day Mon 2026-10-12 PT: 4 Dossiers, line 7']);
});

test('once the histories diverge, the bot stops committing and tells the person once, and commits again after their merge', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.productHunt.addFeatured(fixtureDay('2026-10-13'), '2026-10-13T07:01:00Z');
  // GitHub refuses the day's push, so its commit waits in the checkout, and meanwhile the person commits on GitHub.
  world.git.refusePushes = true;
  await world.advanceTo('2026-10-12T08:00:00Z');
  world.git.commitAsPerson('ideas.md', 'Run the Miner on weekends too?\n', 'Note an idea');

  // The next try finds the histories diverged, but the card waits until its branch is on GitHub.
  await world.advanceTo('2026-10-12T08:30:00Z');
  assert.deepEqual(world.git.branches(), ['main']);
  // The day's Dossiers' Walkthroughs wait in #needs-you too; the Personal database's cards are among them.
  const databaseCards = () => world.discord.cards(NEEDS_YOU).filter((c) => /Personal database/.test(c.text));
  assert.deepEqual(databaseCards(), []);

  world.git.refusePushes = false;
  await world.advanceTo('2026-10-12T09:00:00Z');

  const [branch, ...others] = world.git.branches().filter((b) => b !== 'main');
  assert.deepEqual(others, []);
  assert.match(branch!, /^assistant\//);
  assert.equal(world.git.file('days/2026-10-12.md', branch), OCT_12, "the Assistant's commit waits on its own branch");
  assert.equal(world.git.file('days/2026-10-12.md'), undefined);
  assert.deepEqual(world.git.subjects('main', { leavingOut: 'products' }), ['Start the Personal database', 'Note an idea']);
  let cards = databaseCards();
  assert.equal(cards.length, 1);
  const card = cards[0]!;
  assert.deepEqual(card.mentions, [PERSON], 'the card notifies the person');
  assert.ok(!card.silent);
  assert.match(card.text, /Personal database: the histories have diverged/);
  assert.match(card.text, /stopped committing/);
  assert.ok(card.text.includes(`merge \`${branch}\` into \`main\` with **Create a merge commit**`), card.text);
  const link = card.lines.at(-1)?.button;
  assert.equal(link?.label, 'Merge on GitHub');
  assert.equal(link?.url, `${world.git.webUrl}/compare/main...${branch}?expand=1`);

  // The next day's work carries on, and its file waits.
  await world.advanceTo('2026-10-13T08:00:00Z');
  assert.equal(world.discord.forumPosts(MINER_DAYS_FORUM).at(-1)?.title, 'Tue Oct 13 · 3 Dossiers · line 7');
  assert.equal(world.git.file('days/2026-10-13.md'), undefined);
  assert.equal(databaseCards().length, 1, 'the person is told once');

  // The person merges the Assistant's branch on GitHub, and the next try picks up from there.
  world.git.mergeAsPerson(branch!);
  await world.advanceTo('2026-10-13T08:30:00Z');

  assert.equal(world.git.file('days/2026-10-12.md'), OCT_12);
  assert.match(world.git.file('days/2026-10-13.md')!, /^# Miner day · Tue 2026-10-13 PT\n/);
  assert.deepEqual(world.git.subjects('main', { leavingOut: 'products' }), [
    'Start the Personal database',
    'Note an idea',
    `Merge branch '${branch}'`,
    'Miner day Tue 2026-10-13 PT: 3 Dossiers, line 7',
  ]);
  cards = databaseCards();
  assert.equal(cards.length, 1);
  assert.match(cards[0]!.text, /^Personal database: the histories rejoined at 01:30 PT Tue Oct 13\. The Assistant is committing again\.$/);
  assert.deepEqual(cards[0]!.lines, [], 'the card shrank to a line');
});

/** Leaves a lock file in the checkout, as a git command that dies holding it does. */
function leaveLock(world: World, lock: string): void {
  const file = join(world.checkout, '.git', lock);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '');
}

/** The locks the bot's log says it removed, oldest first. */
const locksRemoved = (world: World) => world.logs.filter((l) => l.event === 'personal-database.lock-removed').map((l) => l.lock);

/** The lines that say a sync, or the fetch in it, failed. */
const failures = (world: World) => world.logs.filter((l) => /^personal-database\.(sync|fetch)-failed$/.test(l.event));

test('a sync removes a lock left in the checkout of a running bot, as a git command killed at its limit leaves one, and goes on', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  await world.assistant.whenIdle();
  leaveLock(world, 'index.lock');

  await world.advanceTo('2026-10-12T08:00:00Z');

  assert.equal(world.git.file('days/2026-10-12.md'), OCT_12);
  assert.deepEqual(locksRemoved(world), ['.git/index.lock'], 'one line names the lock');
  assert.deepEqual(failures(world), []);
  assert.ok(!existsSync(join(world.checkout, '.git', 'index.lock')));
});

test('a bot killed and a lock left in the checkout: the commit it made and the files still queued reach GitHub at the next start, each once', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([GUILDS, CODEMIND.postId]);
  serveProduct(world, CODEMIND);
  // GitHub refuses the day's push, so its commit waits in the checkout. guilds.run's Dossier then queues its files, and
  // the provider holds Codemind's run, with no sync to come before the kill.
  world.git.refusePushes = true;
  const scripted = world.model.dossier;
  world.model.dossier = (run) => {
    if (run.postIds.includes(CODEMIND.postId)) world.model.hold = true;
    return scripted(run);
  };
  world.clock.advanceTo('2026-10-12T08:00:00Z');
  // A judging run and two Dossier runs come first, which took over 10 seconds on a loaded machine.
  await until(() => world.model.dossierRuns[1]?.requests === 2, 40);

  await world.kill();

  assert.deepEqual(world.logs.filter((l) => l.event === 'personal-database.committed').map((l) => l.path), ['days/2026-10-12.md'], 'the one commit the old bot made');
  assert.equal(world.discord.forumPosts(PRODUCTS_FORUM)[0]?.title.startsWith('guilds.run'), true, "guilds.run's Dossier was written");
  assert.deepEqual(world.git.subjects('main'), ['Start the Personal database']);
  leaveLock(world, 'index.lock');
  world.git.refusePushes = false;
  world.model.hold = false;
  world.model.dossier = scripted;

  // The clock stays put, so what reaches GitHub here reached it at this start, and not at a later retry.
  await world.restart();

  assert.deepEqual(world.git.subjects('main'), [
    'Start the Personal database',
    'Miner day Mon 2026-10-12 PT: 2 Dossiers, line 7',
    'Dossier v1: guilds.run (p1274741.example)',
    'Notes file for the person: guilds.run (p1274741.example)',
    'Registration file: guilds.run (p1274741.example), none yet',
    'Dossier v1: Codemind (codemindhq.dev)',
    'Notes file for the person: Codemind (codemindhq.dev)',
    'Registration file: Codemind (codemindhq.dev), none yet',
  ]);
  assert.deepEqual(locksRemoved(world), ['.git/index.lock']);
  assert.deepEqual(failures(world), []);
});

// The other locks #103's trial found stopping a sync. GitHub has moved on in each test, since ORIG_HEAD.lock stops only
// the fast-forward, and the lock on the tracking ref only the fetch before it: with that lock left, a commit and its
// push still go through, until GitHub has moved on.
for (const lock of ['HEAD.lock', 'ORIG_HEAD.lock', 'refs/heads/main.lock', 'refs/remotes/origin/main.lock']) {
  test(`a sync removes a ${lock} left in the checkout, fast-forwards and pushes`, async (t) => {
    const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
    t.after(() => world.stop());
    world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
    await world.assistant.whenIdle();
    world.git.commitAsPerson('ideas.md', 'Run the Miner on weekends too?\n', 'Note an idea');
    leaveLock(world, lock);

    await world.advanceTo('2026-10-12T08:00:00Z');

    assert.deepEqual(world.git.subjects('main', { leavingOut: 'products' }), ['Start the Personal database', 'Note an idea', 'Miner day Mon 2026-10-12 PT: 4 Dossiers, line 7']);
    assert.deepEqual(locksRemoved(world), [`.git/${lock}`]);
    assert.deepEqual(failures(world), []);
  });
}

test("a tag's lock left in the checkout stops no sync, since the bot's fetch takes no tags", async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  await world.assistant.whenIdle();
  world.git.commitAsPerson('ideas.md', 'Run the Miner on weekends too?\n', 'Note an idea');
  world.git.tagAsPerson('v1');
  leaveLock(world, 'refs/tags/v1.lock');

  await world.advanceTo('2026-10-12T08:00:00Z');

  assert.deepEqual(world.git.subjects('main', { leavingOut: 'products' }), ['Start the Personal database', 'Note an idea', 'Miner day Mon 2026-10-12 PT: 4 Dossiers, line 7']);
  assert.deepEqual(locksRemoved(world), []);
  assert.deepEqual(failures(world), []);
});

test("a lock that stops no sync stays where it is, such as those of git's auto gc, which can outlive its command", async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  await world.assistant.whenIdle();
  const locks = ['gc.pid.lock', 'gc.log.lock', 'objects/info/commit-graph.lock', 'packed-refs.lock'];
  for (const lock of locks) leaveLock(world, lock);

  await world.advanceTo('2026-10-12T08:00:00Z');

  assert.equal(world.git.file('days/2026-10-12.md'), OCT_12);
  assert.deepEqual(locksRemoved(world), []);
  assert.deepEqual(failures(world), []);
  assert.deepEqual(locks.filter((lock) => !existsSync(join(world.checkout, '.git', lock))), [], 'each is still there');
});

test('a sync that fails for another reason removes no lock, logs the failure and tries again after the retry time', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  await world.assistant.whenIdle();
  const index = join(world.checkout, '.git', 'index');
  writeFileSync(index, 'not an index');

  await world.advanceTo('2026-10-12T08:00:00Z');

  assert.equal(world.discord.forumPosts(MINER_DAYS_FORUM)[0]?.title, 'Mon Oct 12 · 4 Dossiers · line 7', 'the day still posts');
  assert.equal(world.git.file('days/2026-10-12.md'), undefined);
  const failed = failures(world);
  assert.ok(failed.length > 0);
  assert.ok(failed.every((l) => l.event === 'personal-database.sync-failed' && /git reset failed/.test(String(l.error))), JSON.stringify(failed));
  assert.deepEqual(locksRemoved(world), []);

  await world.advanceTo('2026-10-12T08:29:00Z');
  assert.equal(failures(world).length, failed.length, 'the next try is 30 minutes after the last');
  await world.advanceTo('2026-10-12T08:30:00Z');
  assert.equal(failures(world).length, failed.length + 1, 'and it fails the same way, until someone mends the checkout');

  rmSync(index);
  await world.advanceTo('2026-10-12T09:00:00Z');
  assert.equal(world.git.file('days/2026-10-12.md'), OCT_12);
  assert.deepEqual(locksRemoved(world), []);
});
