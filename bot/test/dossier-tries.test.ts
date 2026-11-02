// A Dossier that can't be written (#100): the day's list doesn't wait on it, and names it as not written, with why.
// It is tried again once a day, at the Miner's 01:00 PT start, highest Fit first, whether the Miner's pass or a
// Correction asked for it, and once a later try writes it, its date's list links it. A Launch gets at most
// `dossiers.tries` tries that end without a Dossier, across passes, restarts and both paths, and #status names the
// one stopped at the limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MINER_DAYS_FORUM, PRODUCTS_FORUM, STATUS, startWorld, type World } from './harness/world.ts';
import { fixtureDay, websiteOf } from './harness/fake-product-hunt.ts';
import type { SeenPost } from './harness/fake-discord.ts';
import type { ScriptedDossier } from './harness/fake-model.ts';
import { CODEMIND, serveProduct, XIRYN } from './harness/dossier-fixtures.ts';
import { correct, dayPost, dayPosted, lineOf, rejudges, until } from './harness/miner-day.ts';

/** guilds.run's Launch on Oct 12, at Fit 8 like Codemind's. */
const GUILDS = '1274741';

/** A Dossier the bot turns back every time: For you cites no Interest scope. */
const uncited: ScriptedDossier = {
  state: 'open',
  register: { text: 'Sign up with an email address.', sources: ['landing-page'] },
  whatItIs: { text: 'What its Launch says it is.', sources: ['launch'] },
  forYou: { text: 'Near something you want.', sources: ['launch'] },
  offers: [],
  note: null,
  rulesApplied: [],
};

/** Has the model record a Dossier the bot turns back, turn after turn, in each run for this Launch, until its cap. */
function keepsHittingItsCap(world: World, postId: string): void {
  const scripted = world.model.dossier;
  world.model.dossier = (run) => (run.postIds.includes(postId) ? uncited : scripted(run));
  world.model.again = (run) => (run.postIds.includes(postId) ? uncited : 'none');
}

/** The Dossier runs made for this Launch. */
const runsFor = (world: World, postId: string) => world.model.dossierRuns.filter((r) => r.postIds.includes(postId)).length;

test('a Dossier run that hits its cap doesn’t hold the day’s list, which goes out at once naming that Dossier as not written', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' }); // 00:30 PDT
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId, GUILDS]);
  serveProduct(world, CODEMIND);
  keepsHittingItsCap(world, CODEMIND.postId);

  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT

  assert.equal(runsFor(world, CODEMIND.postId), 1);
  const capped = world.model.dossierRuns.find((r) => r.postIds.includes(CODEMIND.postId))!;
  assert.ok(capped.dossierReplies.length >= 9, `the run was turned back ${capped.dossierReplies.length} times before its 10-turn cap`);
  const [guilds, ...more] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.equal(guilds!.title, 'guilds.run · Create multi-agent workflows that you can trust');
  assert.deepEqual(more, [], 'Codemind has no post');

  const [day] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(day?.title, 'Mon Oct 12 · 2 Dossiers · line 7', 'the day’s list goes out');
  const summary = day.messages[0]!.text.split('\n');
  assert.ok(summary.includes(`**Dossiers:** <#${guilds!.id}>`), summary.join('\n'));
  assert.ok(summary.includes('**Not written:** Codemind, because its Dossier run hit its turn cap (10 turns)'), summary.join('\n'));
  const line = day.messages[1]!.lines.find((l) => l.text.startsWith('**[Codemind]'))!;
  assert.match(line.text, /· Dossier · fit 8 · [^→]*$/, 'its line links no post');
});

test('a website redirect that stops on Product Hunt names why: the bot check there, or Product Hunt itself', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' }); // 00:30 PDT
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId, GUILDS]);
  // As on the VM on 2026-10-31 (#85): Cloudflare challenges the redirect itself, so the read stays on it.
  const challenge = { url: websiteOf(CODEMIND.postId), title: 'Just a moment...', text: 'Performing security verification', status: 403 };
  world.browser.page({ ...challenge, botCheck: 'Cloudflare challenge' });
  world.browser.redirect(websiteOf(GUILDS), 'https://www.producthunt.com/');
  world.browser.page({ url: 'https://www.producthunt.com/', title: 'Product Hunt', text: 'The best new products in tech.' });
  const notWritten = () => {
    const day = world.discord.forumPosts(MINER_DAYS_FORUM).find((p) => p.title.startsWith('Mon Oct 12'))!;
    return day.messages[0]!.text.split('\n').filter((l) => l.startsWith('**Not written:** '));
  };

  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT

  assert.equal(world.model.dossierRuns.length, 0, 'neither gets a Dossier run');
  assert.deepEqual(world.discord.forumPosts(PRODUCTS_FORUM), []);
  assert.deepEqual(notWritten(), [
    '**Not written:** guilds.run, because its website redirect leads back to Product Hunt',
    '**Not written:** Codemind, because its website redirect stops at a bot check (Cloudflare challenge) on Product Hunt',
  ]);

  // A bot check the browser service names but the bot doesn't know reads as one with no name.
  world.browser.page({ ...challenge, botCheck: 'Some new vendor' });
  await world.advanceTo('2026-10-13T08:00:00Z'); // the next 01:00 PDT start tries both again

  assert.equal(world.model.dossierRuns.length, 0);
  assert.deepEqual(notWritten(), [
    '**Not written:** guilds.run, because its website redirect leads back to Product Hunt',
    '**Not written:** Codemind, because its website redirect stops at a bot check on Product Hunt',
  ]);
});

test('a Launch whose redirect stops at a bot check gets its Dossier through a HEAD of the redirect, and its date links it', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' }); // 00:30 PDT
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId]);
  serveProduct(world, CODEMIND);
  // As on the VM on 2026-11-02 (#101): a read of the redirect is challenged, and a HEAD of it answers 301.
  const redirect = websiteOf(CODEMIND.postId);
  world.browser.page({ url: redirect, title: 'Just a moment...', text: 'Performing security verification', status: 403, botCheck: 'Cloudflare challenge' });
  world.browser.head(redirect, { status: 301, location: CODEMIND.landing.url });

  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT

  assert.deepEqual(world.browser.heads, [redirect]);
  assert.deepEqual(world.browser.reads.slice(0, 2), [redirect, CODEMIND.landing.url], 'the read that was challenged, then the landing page');
  const posts = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.equal(posts.length, 1, 'the Dossier is posted');
  const day = world.discord.forumPosts(MINER_DAYS_FORUM).find((p) => p.title.startsWith('Mon Oct 12'))!;
  assert.ok(day.messages[0]!.text.split('\n').includes(`**Dossiers:** <#${posts[0]!.id}>`), day.messages[0]!.text);
  assert.ok(!day.messages[0]!.text.includes('**Not written:**'), day.messages[0]!.text);
  assert.deepEqual(
    world.logs.filter((l) => l.event === 'dossier.redirect-head').map((l) => [l.postId, l.status, l.location]),
    [[CODEMIND.postId, 301, CODEMIND.landing.url]],
    'the log says the Dossier came this way',
  );
});

test('a read with no bot check on Product Hunt, and a read that reaches the landing page, send no HEAD', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' }); // 00:30 PDT
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId, GUILDS]);
  serveProduct(world, CODEMIND);
  world.browser.redirect(websiteOf(GUILDS), 'https://www.producthunt.com/');
  world.browser.page({ url: 'https://www.producthunt.com/', title: 'Product Hunt', text: 'The best new products in tech.' });

  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT

  assert.ok(world.browser.reads.includes(websiteOf(CODEMIND.postId)), 'a read reached the landing page');
  assert.ok(world.browser.reads.includes(websiteOf(GUILDS)), 'a read ended on Product Hunt with no bot check');
  assert.deepEqual(world.browser.heads, []);
});

test("a HEAD's address that won't load, or that ends on Product Hunt, ends the try naming why", async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' }); // 00:30 PDT
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId]);
  const redirect = websiteOf(CODEMIND.postId);
  const address = 'https://codemindhq.dev/?ref=producthunt';
  world.browser.page({ url: redirect, title: 'Just a moment...', text: 'Performing security verification', status: 403, botCheck: 'Cloudflare challenge' });
  world.browser.head(redirect, { status: 301, location: address });
  world.browser.fail(address, { kind: 'timeout', message: 'the page took over 30 seconds' });
  const notWritten = () =>
    world.discord.forumPosts(MINER_DAYS_FORUM).find((p) => p.title.startsWith('Mon Oct 12'))!.messages[0]!.text.split('\n').filter((l) => l.startsWith('**Not written:** '));

  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT
  assert.deepEqual(notWritten(), ["**Not written:** Codemind, because its landing page won't load (timeout: the page took over 30 seconds)"]);

  // The address itself lands on Product Hunt's check, so the read kept is no landing page.
  world.browser.fail(address, undefined);
  world.browser.redirect(address, redirect);
  await world.advanceTo('2026-10-13T08:00:00Z');
  assert.deepEqual(notWritten(), ['**Not written:** Codemind, because its website redirect stops at a bot check (Cloudflare challenge) on Product Hunt']);
  assert.deepEqual(world.discord.forumPosts(PRODUCTS_FORUM), []);
});

test("a website that isn't Product Hunt's redirect gets no HEAD, even at a bot check", async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' }); // 00:30 PDT
  t.after(() => world.stop());
  const page = 'https://www.producthunt.com/posts/codemind';
  world.productHunt.addFeatured(
    fixtureDay('2026-10-12').map((post) => (post.id === CODEMIND.postId ? { ...post, website: page } : post)),
    '2026-10-12T07:01:00Z',
  );
  world.model.onlyDossiers([CODEMIND.postId]);
  world.browser.page({ url: page, title: 'Just a moment...', text: 'Performing security verification', status: 403, botCheck: 'Cloudflare challenge' });
  world.browser.head(page, { status: 301, location: CODEMIND.landing.url });

  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT

  assert.deepEqual(world.browser.heads, []);
  assert.deepEqual(world.discord.forumPosts(PRODUCTS_FORUM), []);
  assert.ok(world.logs.some((l) => l.event === 'dossier.redirect-unread' && l.website === page));
});

test('a HEAD that gives no address off Product Hunt ends the try as not written, and counts toward the limit', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' }); // 00:30 PDT
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId]);
  const redirect = websiteOf(CODEMIND.postId);
  world.browser.page({ url: redirect, title: 'Just a moment...', text: 'Performing security verification', status: 403, botCheck: 'Cloudflare challenge' });
  const STOPPED = '**Not written:** Codemind, because its website redirect stops at a bot check (Cloudflare challenge) on Product Hunt';
  const notWritten = (title: string) =>
    world.discord.forumPosts(MINER_DAYS_FORUM).find((p) => p.title.startsWith(title))!.messages[0]!.text.split('\n').filter((l) => l.startsWith('**Not written:** '));

  // Challenged too: the fake's HEAD answers 403 unless a test sets it.
  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT
  assert.deepEqual(notWritten('Mon Oct 12'), [STOPPED]);

  // Its answer points back at Product Hunt: never read as a landing page.
  world.browser.head(redirect, { status: 301, location: 'https://www.producthunt.com/posts/codemind' });
  await world.advanceTo('2026-10-13T08:00:00Z');
  assert.deepEqual(notWritten('Mon Oct 12'), [STOPPED]);

  // The HEAD itself fails, as when the network is down: the third try, the limit in the harness's config.
  world.browser.head(redirect, { kind: 'load-failed', message: 'fetch failed' });
  await world.advanceTo('2026-10-14T08:00:00Z');
  assert.deepEqual(notWritten('Mon Oct 12'), [STOPPED]);
  assert.deepEqual(world.browser.heads, [redirect, redirect, redirect]);
  assert.deepEqual(
    world.logs.filter((l) => l.event === 'dossier.redirect-unread').map((l) => [l.status, l.location, l.error]),
    [
      [403, null, undefined],
      [301, 'https://www.producthunt.com/posts/codemind', undefined],
      [undefined, undefined, 'load-failed: fetch failed'],
    ],
    'the log says what each HEAD answered, which is how to see that Product Hunt has closed this route',
  );
  assert.deepEqual(world.browser.reads.filter((url) => url.includes('producthunt.com/posts/')), [], 'an address on Product Hunt is not read');
  assert.deepEqual(world.discord.forumPosts(PRODUCTS_FORUM), []);
  assert.ok(world.discord.textMessages(STATUS).some((l) => l.content.includes('Codemind')), '#status hears it stopped at the limit');

  // Stopped at the limit: the next start sends no HEAD.
  await world.advanceTo('2026-10-15T08:00:00Z');
  assert.equal(world.browser.heads.length, 3);
});

test('a Dossier whose run keeps hitting its cap is tried once a day, never at the 30-minute passes, and stops at the limit, across a restart', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' }); // 00:30 PDT
  t.after(() => world.stop());
  // Product Hunt shows nothing for Oct 13 or 14, so the Miner tries those dates every 30 minutes.
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId]);
  serveProduct(world, CODEMIND);
  keepsHittingItsCap(world, CODEMIND.postId);
  const dossierLines = () => world.discord.textMessages(STATUS).filter((l) => l.content.startsWith('Dossiers:'));

  await world.advanceTo('2026-10-12T08:00:00Z'); // Mon 01:00 PDT
  assert.equal(runsFor(world, CODEMIND.postId), 1);
  assert.equal(world.discord.forumPosts(MINER_DAYS_FORUM)[0]?.title, 'Mon Oct 12 · 1 Dossier · line 7');

  await world.stepThrough('2026-10-13T07:30:00Z', 30); // Tue 00:30 PDT
  assert.equal(runsFor(world, CODEMIND.postId), 1, 'nothing tries it again before the Miner’s next start');
  await world.advanceTo('2026-10-13T08:00:00Z'); // Tue 01:00 PDT
  assert.equal(runsFor(world, CODEMIND.postId), 2, 'the Miner’s start tries it again');
  await world.stepThrough('2026-10-13T12:00:00Z', 30);
  assert.ok(world.logs.filter((l) => l.event === 'miner.date-problem' && l.date === '2026-10-13').length >= 8, 'the 30-minute passes ran');
  assert.equal(runsFor(world, CODEMIND.postId), 2, 'the 30-minute passes leave it alone');

  await world.restart();
  assert.equal(runsFor(world, CODEMIND.postId), 2, 'a restart doesn’t try it again the same day');

  // The bot is down over Wednesday's start, so its first pass back tries it.
  await world.outage('2026-10-14T09:00:00Z'); // Wed 02:00 PDT
  assert.equal(runsFor(world, CODEMIND.postId), 3);
  assert.deepEqual(
    dossierLines().map((l) => l.content),
    [
      "Dossiers: Codemind's Dossier (Mon Oct 12) won't be tried again. Its 3 tries ended without one, the last because its Dossier run hit its turn cap (10 turns).",
    ],
  );
  assert.ok(dossierLines().every((l) => l.silent && l.mentionsNobody));

  await world.stepThrough('2026-10-14T12:00:00Z', 30);
  await world.advanceTo('2026-10-15T08:00:00Z'); // Thu 01:00 PDT
  await world.restart();
  assert.equal(runsFor(world, CODEMIND.postId), 3, 'a Dossier at the limit costs no further run');
  assert.equal(dossierLines().length, 1, 'the person is told once');
  const summary = world.discord.forumPosts(MINER_DAYS_FORUM)[0]!.messages[0]!.text;
  assert.ok(summary.includes('**Not written:** Codemind, because its Dossier run hit its turn cap (10 turns)'), summary);
});

test('a Dossier a Correction asks for joins the same queue when its run hits its cap, and its tries count toward the same limit', async (t) => {
  const world = await dayPosted(t);
  await world.advanceTo('2026-10-12T16:15:00Z'); // Mon 09:15 PDT
  rejudges(world, CODEMIND.postId, { fit: 8, notAProduct: false, reason: 'your coding agent hands off tasks over MCP; free allowance to start' });
  serveProduct(world, CODEMIND);
  keepsHittingItsCap(world, CODEMIND.postId);

  await correct(world, 'Codemind', 'This is squarely what I want.');
  await world.assistant.whenIdle();
  assert.equal(runsFor(world, CODEMIND.postId), 1);
  const { line } = lineOf(world, 'Codemind');
  assert.equal(
    line.text,
    `**[Codemind](https://www.producthunt.com/posts/codemind-2)** · Dossier · fit 8 after your Correction · your coding agent hands off tasks over MCP; free allowance to start` +
      '\n-# was Skip · fit 6 · you wrote “This is squarely what I want.”',
    'the Correction finishes without waiting for the Dossier',
  );
  assert.equal(line.button!.disabled, false);
  assert.ok(dayPost(world).messages[0]!.text.includes('**Not written:** Codemind, because its Dossier run hit its turn cap (10 turns)'));

  await world.stepThrough('2026-10-13T07:30:00Z', 30); // Tue 00:30 PDT
  assert.equal(runsFor(world, CODEMIND.postId), 1, 'nothing tries it again before the Miner’s next start');
  await world.advanceTo('2026-10-13T08:00:00Z');
  await world.advanceTo('2026-10-14T08:00:00Z');
  assert.equal(runsFor(world, CODEMIND.postId), 3);
  assert.deepEqual(
    world.discord.textMessages(STATUS).filter((l) => l.content.startsWith('Dossiers:')).map((l) => l.content),
    [
      "Dossiers: Codemind's Dossier (Mon Oct 12) won't be tried again. Its 3 tries ended without one, the last because its Dossier run hit its turn cap (10 turns).",
    ],
  );

  // Another Correction keeps it above the line, and asks for no run past the limit.
  rejudges(world, CODEMIND.postId, { fit: 9, notAProduct: false, reason: 'exactly the coding agent you asked for' });
  await correct(world, 'Codemind', 'Even better than that.');
  await world.assistant.whenIdle();
  assert.match(lineOf(world, 'Codemind').line.text, /· Dossier · fit 9 after your Correction · exactly the coding agent you asked for\n/);
  assert.equal(runsFor(world, CODEMIND.postId), 3, 'a Dossier at the limit costs no further run');
});

test('a Dossier run the bot stops itself, as at shutdown, isn’t counted as a try', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z', configure: (config) => void (config.dossiers.tries = 1) });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId]);
  serveProduct(world, CODEMIND);
  keepsHittingItsCap(world, CODEMIND.postId);
  // In the first run, the model stops answering on its second turn, so the run is under way when the bot stops.
  const turnedBack = world.model.again;
  world.model.again = (run, refusal) => {
    if (world.model.dossierRuns.length === 1) world.model.hold = true;
    return turnedBack(run, refusal);
  };

  world.clock.advanceTo('2026-10-12T08:00:00Z');
  await until(() => (world.model.dossierRuns[0]?.requests ?? 0) >= 3);
  world.model.hold = false;
  const pages = join(world.dataDir, 'raw', 'pages', 'codemindhq.dev');
  const readBefore = readdirSync(pages);
  // At the same moment, so the restarted bot reads the Dossier's pages again under the same time as the stopped run.
  await world.restart();

  const read = readdirSync(pages);
  assert.equal(read.length, 2 * readBefore.length, 'each page read at the same moment is kept twice');
  assert.ok(read.every((name) => name.startsWith('2026-10-12T08-00-00-000Z-')), read.join(', '));
  assert.ok(world.logs.some((l) => l.event === 'run.finished' && l.kind === 'dossier' && l.outcome === 'stopped'));
  assert.equal(runsFor(world, CODEMIND.postId), 2, 'the run the bot stopped left the one try the limit allows');
  assert.deepEqual(
    world.discord.textMessages(STATUS).filter((l) => l.content.startsWith('Dossiers:')).map((l) => l.content),
    ["Dossiers: Codemind's Dossier (Mon Oct 12) won't be tried again. Its one try ended without one, because its Dossier run hit its turn cap (10 turns)."],
  );
  assert.ok(world.discord.forumPosts(MINER_DAYS_FORUM)[0]!.messages[0]!.text.includes('**Not written:** Codemind, because its Dossier run hit its turn cap'));
});

test('the day’s list sizes its Dossiers band as if every Dossier had its post, so one written on a later try keeps its line where it was', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z', configure: (config) => void (config.walkthroughs.on = false) });
  t.after(() => world.stop());
  // Seven Dossiers, with names and reasons so long that their seven lines fit in one message only without links.
  const dossierIds = ['1277000', '1274741', '1273823', '1276516', '1266729', '1277092', '1277022'];
  const day = fixtureDay('2026-10-12').map((p) => (dossierIds.includes(p.id) ? { ...p, name: `${p.name} ${'*Extra*_name_'.repeat(5)}`.slice(0, 60) } : p));
  world.productHunt.addFeatured(day, '2026-10-12T07:01:00Z');
  const standIn = world.model.judgment;
  world.model.judgment = (postId) => {
    const j = standIn(postId);
    if (j === 'omit' || !dossierIds.includes(postId)) return j;
    return { ...j, fit: Math.max(j.fit, 7), reason: `${j.reason}; ${'*'.repeat(240)}`.slice(0, 231) };
  };
  for (const id of dossierIds) world.browser.fail(websiteOf(id), { kind: 'timeout', message: 'the page took over 30 seconds' });

  await world.advanceTo('2026-10-12T08:00:00Z');
  const [before] = world.discord.forumPosts(MINER_DAYS_FORUM);
  const dossierBand = (post: SeenPost) => post.messages.filter((m) => m.headings[0]?.startsWith('### Dossiers'));
  const names = (post: SeenPost) => post.messages.map((m) => m.lines.map((l) => l.text.slice(0, l.text.indexOf(']('))));
  assert.equal(dossierBand(before!).length, 2, 'the band is split in two');
  const unlinked = dossierBand(before!).reduce((sum, m) => sum + m.textLength, 0);
  assert.ok(unlinked < 4000, `though its lines take ${unlinked} characters before their Dossiers are written`);
  assert.equal(world.model.dossierRuns.length, 0);

  for (const id of dossierIds) world.browser.fail(websiteOf(id), undefined);
  await world.advanceTo('2026-10-13T08:00:00Z');
  assert.equal(world.model.dossierRuns.length, 7);
  const [after] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.deepEqual(names(after!), names(before!), 'every line is in the message it was posted in');
  const lines = dossierBand(after!).flatMap((m) => m.lines);
  assert.equal(lines.length, 7);
  assert.ok(lines.every((l) => / → <#\d+>$/.test(l.text)), 'each now links its post');
  assert.ok(dossierBand(after!).reduce((sum, m) => sum + m.textLength, 0) > 4000, 'which one message couldn’t hold');
  for (const message of after!.messages) assert.ok(message.textLength <= 4000, `${message.textLength} characters`);
  assert.deepEqual(world.discord.refused, []);
});

/** How a site that never answers fails, at length. */
const TIMED_OUT = 'the page took over 30 seconds, '.repeat(10).trim();

/**
 * Posts Oct 13 with its first `count` Launches at Fit 8, each named as `rename` makes it, and every other below the line,
 * none of their sites answering, at length. Resolves with the day's summary and each of its Not written lines.
 */
async function unwrittenDay(
  t: { after(fn: () => Promise<void>): void },
  count: number,
  rename: (name: string) => string = (name) => name,
): Promise<{ title: string; textLength: number; notWritten: string[] }> {
  const world = await startWorld({ now: '2026-10-13T07:30:00Z' }); // Tue 00:30 PDT
  t.after(() => world.stop());
  const dossierIds = fixtureDay('2026-10-13').slice(0, count).map((p) => p.id);
  const day = fixtureDay('2026-10-13').map((p) => (dossierIds.includes(p.id) ? { ...p, name: rename(p.name) } : p));
  world.productHunt.addFeatured(day, '2026-10-13T07:01:00Z');
  const standIn = world.model.judgment;
  world.model.judgment = (postId) => {
    const j = standIn(postId);
    if (j === 'omit') return j;
    return dossierIds.includes(postId) ? { ...j, fit: 8, notAProduct: false } : { ...j, fit: Math.min(j.fit, 6) };
  };
  for (const id of dossierIds) world.browser.fail(websiteOf(id), { kind: 'timeout', message: TIMED_OUT });

  await world.advanceTo('2026-10-13T08:00:00Z');
  assert.deepEqual(world.discord.refused, []);
  const [post] = world.discord.forumPosts(MINER_DAYS_FORUM);
  const summary = post!.messages[0]!;
  return { title: post!.title, textLength: summary.textLength, notWritten: summary.text.split('\n').filter((l) => l.startsWith('**Not written:** ')) };
}


test('a day with many Dossiers not written keeps its summary within Discord’s limit by cutting why each wasn’t', async (t) => {
  const { title, textLength, notWritten } = await unwrittenDay(t, 20);
  assert.equal(title, 'Tue Oct 13 · 20 Dossiers · line 8');
  assert.ok(textLength <= 4000, `${textLength} characters`);
  assert.equal(notWritten.length, 20, 'each one is named');
  for (const line of notWritten) {
    const why = line.slice(line.indexOf(', because ') + ', because '.length);
    assert.ok(why.startsWith("its landing page won't load (timeout: the page took over 30 seconds, "), line);
    assert.ok(why.length <= 80 && why.endsWith('…'), `why is cut to 80 characters of its ${TIMED_OUT.length + 40}: ${why}`);
  }
});

test('a summary that can’t hold even 80 characters of why each Dossier wasn’t written names each one alone', async (t) => {
  const { title, textLength, notWritten } = await unwrittenDay(t, 29, (name) => `${name} ${'*Extra*_name_'.repeat(2)}`.slice(0, 60));
  assert.equal(title, 'Tue Oct 13 · 29 Dossiers · line 8');
  assert.ok(textLength <= 4000, `${textLength} characters`);
  assert.equal(notWritten.length, 29, 'each one is named');
  for (const line of notWritten) assert.doesNotMatch(line, /, because /);
});

test('the queue’s pass tries the highest Fit first, and the oldest Launch first among equal Fits', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z', configure: (config) => void (config.walkthroughs.on = false) });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.productHunt.addFeatured(fixtureDay('2026-10-13'), '2026-10-13T07:01:00Z');
  // Codemind on Oct 12 and OpenCode 2.0, ranked above it, on Oct 13 are at Fit 8; Xiryn on Oct 13 at Fit 9.
  const OPENCODE = '1278232';
  world.model.onlyDossiers([CODEMIND.postId, XIRYN.postId, OPENCODE]);
  const judged = world.model.judgment;
  world.model.judgment = (postId) => {
    const j = judged(postId);
    return j !== 'omit' && postId === XIRYN.postId ? { ...j, fit: 9 } : j;
  };
  serveProduct(world, CODEMIND);
  serveProduct(world, XIRYN);
  const queued = [CODEMIND.postId, XIRYN.postId, OPENCODE];
  for (const id of queued) world.browser.fail(websiteOf(id), { kind: 'load-failed', message: 'net::ERR_CONNECTION_REFUSED' });

  await world.advanceTo('2026-10-12T08:00:00Z');
  await world.advanceTo('2026-10-13T08:00:00Z');
  assert.equal(world.discord.forumPosts(MINER_DAYS_FORUM).length, 2);
  assert.equal(world.model.dossierRuns.length, 0);

  for (const id of queued) world.browser.fail(websiteOf(id), undefined);
  await world.advanceTo('2026-10-14T08:00:00Z');
  assert.deepEqual(
    world.model.dossierRuns.map((r) => r.postIds),
    [[XIRYN.postId], [CODEMIND.postId], [OPENCODE]],
  );
});

test('a Dossier waiting for a later try whose Launch a Correction puts below its line isn’t tried again', async (t) => {
  const world = await dayPosted(t);
  await world.advanceTo('2026-10-12T16:15:00Z'); // Mon 09:15 PDT
  rejudges(world, CODEMIND.postId, { fit: 8, notAProduct: false, reason: 'your coding agent hands off tasks over MCP; free allowance to start' });
  serveProduct(world, CODEMIND);
  world.browser.fail(websiteOf(CODEMIND.postId), { kind: 'timeout', message: 'the page took over 30 seconds' });
  await correct(world, 'Codemind', 'This is squarely what I want.');
  await world.assistant.whenIdle();
  assert.ok(dayPost(world).messages[0]!.text.includes('**Not written:** Codemind'));

  await world.advanceTo('2026-10-12T17:15:00Z'); // Mon 10:15 PDT
  rejudges(world, CODEMIND.postId, { fit: 5, notAProduct: false, reason: 'a build service for teams that bill clients; not how you code' });
  await correct(world, 'Codemind', "On second thought, I don't buy builds.");
  await world.assistant.whenIdle();
  assert.ok(!dayPost(world).messages[0]!.text.includes('Not written'), 'a Skip has no Dossier to write');

  world.browser.fail(websiteOf(CODEMIND.postId), undefined);
  await world.advanceTo('2026-10-13T08:00:00Z'); // Tue 01:00 PDT
  assert.equal(runsFor(world, CODEMIND.postId), 0);
  assert.deepEqual(world.discord.forumPosts(PRODUCTS_FORUM), []);
});

test('a list Discord can’t edit when a later try writes one of its Dossiers links it at a pass 30 minutes on', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' }); // Mon 00:30 PDT
  t.after(() => world.stop());
  // Oct 13's list goes out with no Dossier, so only the edit left undone brings the Miner back 30 minutes on.
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.productHunt.addFeatured(fixtureDay('2026-10-13'), '2026-10-13T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId]);
  serveProduct(world, CODEMIND);
  const scripted = world.model.dossier;
  world.model.dossier = (run) => (run.postIds.includes(CODEMIND.postId) ? 'none' : scripted(run));
  await world.advanceTo('2026-10-12T08:00:00Z');
  const [monday] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.ok(monday!.messages[0]!.text.includes('**Not written:** Codemind, because its Dossier run recorded no Dossier'));

  world.model.dossier = scripted;
  world.discord.uneditable.add(monday!.id);
  await world.advanceTo('2026-10-13T08:00:00Z'); // Tue 01:00 PDT
  const [product] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.equal(product?.title, 'Codemind · Delegate coding. Get back code that works.');
  assert.equal(world.discord.forumPosts(MINER_DAYS_FORUM)[1]?.title, 'Tue Oct 13 · 0 Dossiers · line 7');
  assert.ok(world.discord.forumPosts(MINER_DAYS_FORUM)[0]!.messages[0]!.text.includes('**Not written:** Codemind'), 'the edit didn’t go through');

  world.discord.uneditable.delete(monday!.id);
  await world.advanceTo('2026-10-13T08:30:00Z');
  const summary = world.discord.forumPosts(MINER_DAYS_FORUM)[0]!.messages[0]!.text;
  assert.ok(summary.includes(`**Dossiers:** <#${product.id}>\n-# Line:`), summary);
  assert.equal(runsFor(world, CODEMIND.postId), 2, 'the Dossier isn’t written again');
});

test('a Dossier a later try writes, whose post Discord took without the bot hearing back, is found at a pass 30 minutes on', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' }); // Mon 00:30 PDT
  t.after(() => world.stop());
  // Oct 13's list goes out with no Dossier, so only the post left unknown brings the Miner back 30 minutes on.
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.productHunt.addFeatured(fixtureDay('2026-10-13'), '2026-10-13T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId]);
  serveProduct(world, CODEMIND);
  const scripted = world.model.dossier;
  world.model.dossier = (run) => (run.postIds.includes(CODEMIND.postId) ? 'none' : scripted(run));
  await world.advanceTo('2026-10-12T08:00:00Z');

  world.model.dossier = scripted;
  world.discord.loseReply('post', 1, PRODUCTS_FORUM);
  await world.advanceTo('2026-10-13T08:00:00Z'); // Tue 01:00 PDT
  assert.equal(world.discord.forumPosts(PRODUCTS_FORUM).length, 1, 'Discord has the post; the bot never heard back');
  const before = world.discord.forumPosts(MINER_DAYS_FORUM)[0]!.messages[0]!.text;
  assert.ok(!before.includes('Not written') && !before.includes('**Dossiers:**'), 'the list has it written, with no post to link yet');

  await world.advanceTo('2026-10-13T08:30:00Z');
  const [product, ...more] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.deepEqual(more, [], 'never posted twice');
  const summary = world.discord.forumPosts(MINER_DAYS_FORUM)[0]!.messages[0]!.text;
  assert.ok(summary.includes(`**Dossiers:** <#${product!.id}>\n-# Line:`), summary);
  assert.equal(runsFor(world, CODEMIND.postId), 2, 'the Dossier isn’t written again');
});
