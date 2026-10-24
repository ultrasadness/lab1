// Dossiers (#47): every Launch at or above the Day's line gets a cited Dossier, written by a registration-role run
// from the Launch, its Maker comment and the pages read from the Product's site, posted silently as the first message
// of the Product's one post in the Products forum, and written to the Personal database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EPHEMERAL } from './harness/fake-discord.ts';
import { INTEREST_SCOPE, MINER_DAYS_FORUM, NEEDS_YOU, PERSON, PRODUCTS_FORUM, STATUS, TOKENS, startWorld } from './harness/world.ts';
import { fixtureDay, websiteOf } from './harness/fake-product-hunt.ts';
import { said, type ScriptedDossier, type ScriptedOffer } from './harness/fake-model.ts';
import { ACYCLIC, CODEMIND, serveProduct, XIRYN } from './harness/dossier-fixtures.ts';

const ph = (slug: string) => `https://www.producthunt.com/posts/${slug}`;

/** Splits a prompt into the lines inside `<<<` / `>>>` data fences and the lines outside them. */
function fenced(prompt: string): { outside: string[]; inside: string[] } {
  const outside: string[] = [];
  const inside: string[] = [];
  let open = false;
  for (const line of prompt.split('\n')) {
    if (!open && line === '<<<') open = true;
    else if (open && line === '>>>') open = false;
    else (open ? inside : outside).push(line);
  }
  assert.equal(open, false, 'every fence is closed');
  return { outside, inside };
}

test('an Open Product’s Dossier is posted silently as the first message of its own post, in the card’s order', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' }); // 00:30 PDT
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId]);
  serveProduct(world, CODEMIND);

  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT

  const posts = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.equal(posts.length, 1);
  const [post] = posts;
  assert.equal(post!.title, 'Codemind · Delegate coding. Get back code that works.');
  assert.deepEqual(post!.tags, ['Walkthrough'], 'an Open Product is tagged with its Walkthrough (#53)');
  const [dossier, walkthrough, ...rest] = post!.messages;
  assert.match(walkthrough!.text, /^\*\*Walkthrough v1\*\* · /, 'after the Dossier, only its Walkthrough’s copy');
  assert.deepEqual(rest, []);
  assert.ok(dossier!.silent, 'the Dossier never notifies');
  assert.ok(dossier!.mentionsNobody);
  assert.equal(
    dossier!.text,
    [
      '## Codemind · Delegate coding. Get back code that works.',
      '**Open** · fit 8 · Mon Oct 12 · 1 Offer',
      `**Register:** Sign in with an emailed link or Google at app.codemindhq.dev; signing in creates the account. No card.⁴ ⁵ Walkthrough in <#${NEEDS_YOU}>.`,
      '**What it is:** A build service your coding agent calls over MCP: it writes the code for one task, tests it against your acceptance criteria and returns the files. A failed build is never charged.¹ ²',
      '**For you:** Fits coding agents and what runs around them: routine tasks handed off from Claude Code or OpenCode. Free plan.⁴ ⁶',
      '**Offers**',
      '- 100 verified builds free in your first month, then 50 a month · *no card · first month*³ ⁴',
      "**Note:** Paid top-ups aren't open yet; a verified build will cost $0.10 once they are.⁴",
      `**Launches:** [Mon Oct 12](${ph('codemind-2')}) · fit 8 · #19 of 19`,
      `-# ¹ [Launch](${ph('codemind-2')}) · ² [Maker comment](${ph('codemind-2')}?comment=1273823-c0) · ³ [landing page](https://codemindhq.dev/) · ⁴ [pricing page](https://codemindhq.dev/pricing/) · ⁵ [signup page](https://app.codemindhq.dev/) · ⁶ your Interest scope`,
      `-# Rules applied: none · read 01:00 PT Mon Oct 12 · Data sourced from [Product Hunt](${ph('codemind-2')})`,
    ].join('\n'),
  );
  assert.deepEqual(
    dossier!.buttons.map((b) => [b.label, b.disabled]),
    [
      ['Add Offer', false],
      ['Correct', false],
    ],
  );
  assert.deepEqual(world.discord.refused, []);

  // Add Offer and Correct come in #66; until then the person is told so, and nothing changes.
  await world.discord.connected();
  for (const button of dossier!.buttons) {
    const reply = await world.discord.tap({ userId: PERSON, customId: button.customId, channelId: post!.id, messageId: dossier!.id });
    assert.ok((reply.data?.flags ?? 0) & EPHEMERAL);
    assert.equal(reply.data?.content, "Correct and Add Offer aren't wired up yet. They arrive with Corrections to Dossiers.");
  }
  await world.assistant.whenIdle();
  assert.deepEqual(world.discord.forumPosts(PRODUCTS_FORUM), posts);
});

test('a Dossier run is a registration-role run given the Launch, its Maker comments, the three pages and the Interest scope', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  const day = fixtureDay('2026-10-12');
  // Codemind's maker answers a question with an Offer, in a reply after their first comment.
  const codemind = day.find((p) => p.id === CODEMIND.postId)!;
  codemind.comments.nodes.push({ body: '<p>Use code PHBUILD for 50 more builds.</p>', createdAt: '2026-10-12T09:00:00Z', parentId: '1273823-c3', userId: '875554' });
  world.productHunt.addFeatured(day, '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId]);
  serveProduct(world, CODEMIND);

  await world.advanceTo('2026-10-12T08:00:00Z');

  assert.deepEqual(
    world.browser.reads,
    [websiteOf(CODEMIND.postId), 'https://codemindhq.dev/pricing/', 'https://app.codemindhq.dev/', 'https://app.codemindhq.dev/'],
    'the website redirect the API returns, then the pricing and signup pages the landing page links to, then the signup page again for its Walkthrough, and nothing else',
  );
  const [run] = world.model.dossierRuns;
  assert.deepEqual(run?.postIds, [CODEMIND.postId]);
  const requests = world.model.requests.filter((r) => r.tools.includes('record_dossier'));
  assert.equal(requests.length, 2, 'one request records the Dossier, one closes the run');
  for (const request of requests) {
    assert.equal(request.model, 'registration@openrouter');
    assert.equal(request.authorization, `Bearer ${TOKENS.registrationKey}`);
    assert.deepEqual(request.tools, ['record_dossier'], 'a Dossier run is offered its record tool and nothing else');
  }
  const prompt = said(requests[0]!, 'user');
  const launch = fixtureDay('2026-10-12').find((p) => p.id === CODEMIND.postId)!;
  const inFences = fenced(prompt).inside.join('\n');
  for (const text of [
    INTEREST_SCOPE.trim(),
    launch.name,
    launch.tagline,
    launch.description,
    "Hi Product Hunt, I'm Andriy, and I built Codemind.",
    'Use code PHBUILD for 50 more builds.',
    CODEMIND.landing.text,
    CODEMIND.pricing!.text,
    CODEMIND.signup!.text,
    'Form 1: Email (email, required) · button Email me a link',
  ]) {
    assert.ok(inFences.includes(text), `the run is given, as fenced data: ${text.slice(0, 60)}`);
  }
  assert.match(prompt, /^Cite these sources by key: launch, maker-comment, landing-page, pricing-page, signup-page, interest-scope\.$/m);
  assert.match(prompt, /^2 Maker comments · source maker-comment:$/m, 'every comment by one of its makers counts');
  assert.match(prompt, /^Landing page · source landing-page · read 2026-10-12 01:00 PT$/m);
  assert.match(prompt, /^Plain code saw no bot check on load and no card fields\.$/m);
  assert.doesNotMatch(prompt, /votes|rank/i, 'never votes or rank');

  // Each read is kept as it came, outside git, for 90 days.
  const folder = join(world.dataDir, 'raw', 'pages', 'codemindhq.dev');
  const kept = readdirSync(folder).map((f) => (JSON.parse(readFileSync(join(folder, f), 'utf8')) as { url: string }).url);
  assert.deepEqual(kept.sort(), ['https://app.codemindhq.dev/', 'https://app.codemindhq.dev/', 'https://codemindhq.dev/pricing/', websiteOf(CODEMIND.postId)]);
  const run1 = world.logs.find((l) => l.event === 'run.finished' && l.kind === 'dossier');
  assert.equal(run1?.role, 'registration');
  assert.equal(run1?.outcome, 'settled');
});

test('a Product that needs no account says so, with no Walkthrough, and its post is tagged no account', async (t) => {
  const world = await startWorld({ now: '2026-10-13T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-13'), '2026-10-13T07:01:00Z');
  world.model.onlyDossiers([XIRYN.postId]);
  serveProduct(world, XIRYN);

  await world.advanceTo('2026-10-13T08:00:00Z');

  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.equal(post!.title, 'Xiryn · The open-source personal agent that runs on your computer');
  assert.deepEqual(post!.tags, ['no account']);
  assert.equal(
    post!.messages[0]!.text,
    [
      '## Xiryn · The open-source personal agent that runs on your computer',
      '**No account needed** · fit 8 · Tue Oct 13 · no Walkthrough',
      '**Register:** Nothing to register: one command installs it on Mac, Windows or Linux with about 4 GB free. It needs a key for one model provider, or a local model.² ³',
      '**What it is:** A personal agent on your own computer. Each agent works on its own Linux desktop in Docker, browsing, researching, coding and filling forms; you control it from Telegram.¹ ²',
      '**For you:** Fits tools you can use from your Linux server and Docker, and is open source.⁴',
      `**Offers:** none in the Launch text or on the site. The [Launch page](${ph('xiryn')}) may show a promo.`,
      `**Launches:** [Tue Oct 13](${ph('xiryn')}) · fit 8 · #21 of 29`,
      `-# ¹ [Launch](${ph('xiryn')}) · ² [Maker comment](${ph('xiryn')}?comment=1277481-c0) · ³ [landing page](https://xiryn.com/) · ⁴ your Interest scope`,
      `-# Rules applied: none · read 01:00 PT Tue Oct 13 · Data sourced from [Product Hunt](${ph('xiryn')})`,
    ].join('\n'),
  );
  assert.deepEqual(world.browser.reads, [websiteOf(XIRYN.postId)], 'the landing page links to no pricing or signup page');
  const prompt = said(world.model.requests.find((r) => r.tools.includes('record_dossier'))!, 'user');
  assert.match(prompt, /^Pricing page: the landing page links to no pricing page\.$/m);
  assert.match(prompt, /^Signup page: the landing page links to no signup page\.$/m);
});

test('a Product that signs in only with Google or GitHub is named so in Register, from its signup page', async (t) => {
  const world = await startWorld({ now: '2026-10-14T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-14'), '2026-10-14T07:01:00Z');
  world.model.onlyDossiers([ACYCLIC.postId]);
  serveProduct(world, ACYCLIC);

  await world.advanceTo('2026-10-14T08:00:00Z');

  assert.deepEqual(
    world.browser.reads,
    [websiteOf(ACYCLIC.postId), 'https://acyclic.dev/auth', 'https://acyclic.dev/auth'],
    'its only sign-in link is the signup page, which its Walkthrough reads again',
  );
  const prompt = said(world.model.requests.find((r) => r.tools.includes('record_dossier'))!, 'user');
  assert.ok(fenced(prompt).inside.includes('Welcome to Acyclic · Continue with Google · Continue with GitHub'), 'the run sees the signup page');
  assert.match(prompt, /^Maker comment: none$/m, 'none of its makers commented');
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.deepEqual(post!.tags, ['Walkthrough']);
  const lines = post!.messages[0]!.text.split('\n');
  assert.equal(lines[1], '**Open** · fit 7 · Wed Oct 14');
  assert.equal(
    lines[2],
    `**Register:** Sign-in only with Google or GitHub at acyclic.dev/auth, so a Handoff with the Signup mailbox Google account.³ Walkthrough in <#${NEEDS_YOU}>.`,
  );
  assert.equal(
    lines.at(-2),
    `-# ¹ [Launch](${ph('acyclic')}) · ² [landing page](https://acyclic.dev/) · ³ [signup page](https://acyclic.dev/auth) · ⁴ your Interest scope`,
  );
  assert.ok(lines.includes(`**Launches:** [Wed Oct 14](${ph('acyclic')}) · fit 7 · #30 of 48`));
});

test('Offers come only from the Launch, its Maker comment, the landing page and the pricing page, each marked with what it needs', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId]);
  serveProduct(world, CODEMIND);
  const offer = { code: null, card: 'not stated', deadline: null, cap: null, condition: null } as const;
  const offers: ScriptedOffer[] = [
    { ...offer, what: '3 months of Pro free', code: 'PHCODE', deadline: 'until Oct 31', sources: ['launch'] },
    { ...offer, what: '$20 in build credits', card: 'needed', sources: ['maker-comment'] },
    { ...offer, what: '100 verified builds free', card: 'not needed', cap: 'first 500 signups', sources: ['landing-page'] },
    { ...offer, what: 'A year of Team at half price', condition: 'a public post about Codemind', sources: ['pricing-page'] },
  ];
  // First the model cites an Offer to the signup page alone; told why, it records the Dossier again without it.
  const fromSignup: ScriptedOffer = { ...offer, what: 'Early access', sources: ['signup-page'] };
  world.model.dossier = (run) => (run.postIds.includes(CODEMIND.postId) ? { ...CODEMIND.dossier, offers: [...offers, fromSignup] } : 'none');
  world.model.again = () => ({ ...CODEMIND.dossier, offers });

  await world.advanceTo('2026-10-12T08:00:00Z');

  const [run] = world.model.dossierRuns;
  assert.match(
    run!.dossierReplies[0]!,
    /offers\[4\] must come from the Launch description, the Maker comment, the landing page or the pricing page\./,
    'the run is told which Offer has no source an Offer may come from',
  );
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  const text = post!.messages[0]!.text;
  assert.match(text, /^\*\*Open\*\* · fit 8 · Mon Oct 12 · 4 Offers$/m);
  const block = text.slice(text.indexOf('**Offers**'), text.indexOf('**Note:**')).trim().split('\n');
  assert.deepEqual(block, [
    '**Offers**',
    '- 3 months of Pro free · *code `PHCODE` · card not stated · until Oct 31*¹',
    '- **Yours to act on:** $20 in build credits · *card needed*²',
    '- 100 verified builds free · *no card · first 500 signups*³',
    '- **Yours to act on:** A year of Team at half price · *card not stated · a public post about Codemind*⁴',
  ]);
  assert.doesNotMatch(text, /Early access/);
});

/** A sentence of `length` characters, made of words. */
const sentence = (start: string, length: number) => {
  let text = start;
  for (let i = 0; text.length < length; i++) text += ` word${i}`;
  return `${text.slice(0, length - 1).trimEnd()}.`;
};

/** Codemind's Dossier with every part as long as a record may make it, which runs past Discord's 4,000 characters. */
function longest(): ScriptedDossier {
  const d = CODEMIND.dossier;
  const offer = {
    code: 'PRODUCTHUNT-LAUNCH-WEEK-2026AB',
    card: 'needed',
    deadline: sentence('until the end of', 30),
    cap: sentence('for the first signups', 40),
    condition: sentence('a public post about it', 80),
  } as const;
  return {
    ...d,
    register: { ...d.register, text: sentence('Register at app.codemindhq.dev', 300) },
    whatItIs: { ...d.whatItIs, text: sentence('What it is', 600) },
    forYou: { ...d.forYou, text: sentence('For you', 400) },
    note: { ...d.note!, text: sentence('A note', 400) },
    offers: [1, 2, 3, 4, 5].map((n) => ({ ...offer, what: sentence(`Offer ${n}`, 120), sources: ['pricing-page'] })),
  };
}

test('a Dossier over 4,000 characters is rewritten once, shortening only What it is, For you and Note', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId]);
  serveProduct(world, CODEMIND);
  const first = longest();
  world.model.dossier = (run) => (run.postIds.includes(CODEMIND.postId) ? first : 'none');
  let toldOver = 0;
  let rewrite: ScriptedDossier | undefined;
  // The rewrite shortens the three parts by a third of the overrun each, and drops an Offer, which isn't its to drop.
  const rewriteOf = world.model.rewrite;
  world.model.rewrite = (run, over, d) => {
    toldOver = over;
    const shorter = rewriteOf(run, over, d);
    if (shorter === 'none') return shorter;
    return (rewrite = { ...shorter, offers: shorter.offers.slice(1) });
  };

  await world.advanceTo('2026-10-12T08:00:00Z');

  assert.ok(toldOver > 0, 'the run was told how far over it was');
  assert.match(world.model.dossierRuns[0]!.dossierReplies[0]!, new RegExp(`runs ${toldOver.toLocaleString('en-US')} characters over Discord's 4,000`));
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  const card = post!.messages[0]!;
  assert.ok(card.textLength <= 4000, `${card.textLength} characters`);
  assert.doesNotMatch(card.text, /Shortened to fit Discord/, 'the rewrite fit');
  const shortened = [
    ['What it is', first.whatItIs, rewrite!.whatItIs],
    ['For you', first.forYou, rewrite!.forYou],
    ['Note', first.note!, rewrite!.note!],
  ] as const;
  for (const [label, was, part] of shortened) {
    assert.ok(part.text.length < was.text.length, `the rewrite shortened ${label}`);
    assert.match(card.text, new RegExp(`^\\*\\*${label}:\\*\\* ${part.text.trim()}[¹²³⁴⁵ ]+$`, 'm'), `${label} is the rewrite's`);
  }
  assert.ok(card.text.includes(`**Register:** ${first.register.text}³ ⁴`), 'Register stays as first recorded');
  assert.equal(card.text.match(/^- \*\*Yours to act on:\*\* Offer \d/gm)?.length, 5, 'no Offer is dropped');
  assert.deepEqual(world.discord.refused, []);
});

test('a Dossier still over 4,000 characters after its rewrite is cut to fit, and git keeps it whole', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId]);
  serveProduct(world, CODEMIND);
  const first = longest();
  world.model.dossier = (run) => (run.postIds.includes(CODEMIND.postId) ? first : 'none');
  world.model.rewrite = (_run, _over, d) => d; // the rewrite is no shorter

  await world.advanceTo('2026-10-12T08:00:00Z');

  assert.deepEqual(world.discord.refused, [], 'Discord took the Dossier');
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  const card = post!.messages[0]!;
  assert.ok(card.textLength <= 4000 && card.textLength > 3900, `${card.textLength} characters: cut no more than it needs`);
  const lines = card.text.split('\n');
  for (const [label, part] of [['What it is', first.whatItIs], ['For you', first.forYou], ['Note', first.note!]] as const) {
    const line = lines.find((l) => l.startsWith(`**${label}:** `))!;
    const shown = line.slice(`**${label}:** `.length).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹ ]+$/, '');
    assert.ok(shown.endsWith('…') && part.text.startsWith(shown.slice(0, -1)), `${label} is cut at a word: ${shown.slice(-30)}`);
  }
  assert.ok(lines.includes(`**Register:** ${first.register.text}³ ⁴ Walkthrough in <#${NEEDS_YOU}>.`), 'Register is never cut');
  assert.equal(lines.filter((l) => /^- \*\*Yours to act on:\*\* Offer \d/.test(l)).length, 5, 'nor is any Offer');
  assert.equal(
    lines.at(-1),
    `-# Shortened to fit Discord · [full Dossier in git ↗](${world.git.webUrl}/blob/main/products/codemindhq.dev/dossier.md)`,
  );
  const file = world.git.file('products/codemindhq.dev/dossier.md')!;
  for (const part of [first.whatItIs, first.forYou, first.note!]) assert.ok(file.includes(part.text), 'dossier.md holds the whole Dossier');
});

test('a Dossier of Markdown characters, which escaping doubles, is cut to fit at a word, keeping every Offer and citation', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId]);
  serveProduct(world, CODEMIND);
  // As a page might steer a model to write: every part as long as it may be, all of it characters Discord would format.
  const marks = (length: number) => '*_'.repeat(length).slice(0, length);
  const d = longest();
  const offer = { ...d.offers[0]!, what: marks(120), deadline: marks(30), cap: marks(40), condition: marks(80) };
  const steered: ScriptedDossier = { ...d, register: { ...d.register, text: marks(300) }, offers: Array.from({ length: 10 }, () => offer) };
  world.model.dossier = (run) => (run.postIds.includes(CODEMIND.postId) ? steered : 'none');
  world.model.rewrite = (_run, _over, first) => first;

  await world.advanceTo('2026-10-12T08:00:00Z');

  assert.deepEqual(world.discord.refused, []);
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  const card = post!.messages[0]!;
  assert.ok(card.textLength <= 4000, `${card.textLength} characters`);
  const lines = card.text.split('\n');
  assert.match(lines.find((l) => l.startsWith('**Register:** '))!, /…³ ⁴ Walkthrough in <#\d+>\.$/, 'Register is cut at a word, its citations kept');
  const offers = lines.filter((l) => l.startsWith('- **Yours to act on:** '));
  assert.equal(offers.length, 10, 'every Offer stays');
  for (const line of offers) assert.match(line, /…\*³$/, 'each Offer is cut, its citation kept');
  assert.ok(lines.includes(`**Launches:** [Mon Oct 12](${ph('codemind-2')}) · fit 8 · #19 of 19`), 'and the Launches');
  assert.match(card.text, /\n-# Shortened to fit Discord · \[full Dossier in git ↗\]\(.+\/products\/codemindhq\.dev\/dossier\.md\)$/);
  assert.equal(world.discord.forumPosts(MINER_DAYS_FORUM)[0]?.title, 'Mon Oct 12 · 1 Dossier · line 7', 'the day goes on');
  const file = world.git.file('products/codemindhq.dev/dossier.md')!;
  assert.equal(file.split('\n').filter((l) => l.startsWith('- **Yours to act on:** ')).length, 10);
  assert.doesNotMatch(file, /…/, 'git keeps the whole Dossier');
});

test('each Product gets a folder in the Personal database, and its notes.md is the person’s alone', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.productHunt.addFeatured(fixtureDay('2026-10-13'), '2026-10-13T07:01:00Z');
  const guilds = '1274741'; // guilds.run, on a plain `.example` site of its own
  world.model.onlyDossiers([CODEMIND.postId, guilds, XIRYN.postId]);
  serveProduct(world, CODEMIND);
  serveProduct(world, XIRYN);
  // The person already keeps notes on Codemind, before it has a Dossier.
  world.git.commitAsPerson('products/codemindhq.dev/notes.md', 'Ask about student pricing.\n', 'Note Codemind');

  await world.advanceTo('2026-10-12T08:00:00Z');

  assert.equal(
    world.git.file('products/codemindhq.dev/dossier.md'),
    [
      '# Codemind · Delegate coding. Get back code that works.',
      '',
      '**Open** · fit 8 · Mon 2026-10-12 PT · 1 Offer · `codemindhq.dev`',
      '',
      '**Register:** Sign in with an emailed link or Google at app.codemindhq.dev; signing in creates the account. No card. ([pricing page](https://codemindhq.dev/pricing/), [signup page](https://app.codemindhq.dev/))',
      '',
      `**What it is:** A build service your coding agent calls over MCP: it writes the code for one task, tests it against your acceptance criteria and returns the files. A failed build is never charged. ([Launch](${ph('codemind-2')}), [Maker comment](${ph('codemind-2')}?comment=1273823-c0))`,
      '',
      '**For you:** Fits coding agents and what runs around them: routine tasks handed off from Claude Code or OpenCode. Free plan. ([pricing page](https://codemindhq.dev/pricing/), [your Interest scope](../../profile/interest-scope.md))',
      '',
      '**Offers**',
      '',
      '- 100 verified builds free in your first month, then 50 a month · *no card · first month* ([landing page](https://codemindhq.dev/), [pricing page](https://codemindhq.dev/pricing/))',
      '',
      "**Note:** Paid top-ups aren't open yet; a verified build will cost \\$0.10 once they are. ([pricing page](https://codemindhq.dev/pricing/))",
      '',
      `**Launches:** [Mon 2026-10-12 PT](${ph('codemind-2')}) · fit 8 · #19 of 19`,
      '',
      `<sub>Rules applied: none · read 2026-10-12 01:00 PT · Data sourced from [Product Hunt](${ph('codemind-2')})</sub>`,
      '',
      '<sub>The bot rewrites this file whenever the Dossier changes. [Registration](registration.md) · [Notes](notes.md)</sub>',
      '',
    ].join('\n'),
  );
  assert.equal(
    world.git.file('products/codemindhq.dev/registration.md'),
    '# Codemind · Delegate coding. Get back code that works. · Registration\n\n<!-- Appended by the bot at milestones from the live store. Edits here are not read back. -->\nNo Registration yet.\n',
  );
  assert.equal(world.git.file('products/codemindhq.dev/notes.md'), 'Ask about student pricing.\n', 'the notes the person kept stay as they were');
  assert.equal(world.git.file(`products/p${guilds}.example/notes.md`), '', 'a new Product’s notes.md starts empty');
  assert.deepEqual(world.git.subjects().slice(-5), [
    'Dossier v1: Codemind (codemindhq.dev)',
    'Registration file: Codemind (codemindhq.dev), none yet',
    `Dossier v1: guilds.run (p${guilds}.example)`,
    `Notes file for the person: guilds.run (p${guilds}.example)`,
    `Registration file: guilds.run (p${guilds}.example), none yet`,
  ]);

  // The person writes notes; the bot's later work, and a restart, leave them alone.
  world.git.commitAsPerson(`products/p${guilds}.example/notes.md`, 'Try it on the VM.\n', 'Note guilds.run');
  await world.restart();
  await world.advanceTo('2026-10-13T08:00:00Z');
  assert.ok(world.git.file('products/xiryn.com/dossier.md'), 'the next day’s Dossier is written');
  assert.equal(world.git.file(`products/p${guilds}.example/notes.md`), 'Try it on the VM.\n');
  assert.equal(world.git.file('products/codemindhq.dev/notes.md'), 'Ask about student pricing.\n');
  assert.ok(!world.git.subjects().slice(-4).some((s) => s.includes('guilds.run') || s.includes('Codemind')));
});

test('a Dossier whose landing page won’t load is named in the day’s list as not written, and each day it still won’t counts as a try', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  const guilds = '1274741';
  world.model.onlyDossiers([CODEMIND.postId, guilds]);
  serveProduct(world, CODEMIND);
  world.browser.fail(CODEMIND.landing.url, { kind: 'load-failed', message: 'net::ERR_CONNECTION_REFUSED at https://codemindhq.dev/' });
  const landingReads = () => world.browser.reads.filter((url) => url === websiteOf(CODEMIND.postId)).length;

  await world.advanceTo('2026-10-12T08:00:00Z');
  const [guildsPost, ...more] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.equal(guildsPost!.title, 'guilds.run · Create multi-agent workflows that you can trust', 'the other Dossier goes out');
  assert.deepEqual(more, []);
  const [day] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(day?.title, 'Mon Oct 12 · 2 Dossiers · line 7', 'the day’s list goes out');
  assert.ok(
    day.messages[0]!.text.includes(
      `**Dossiers:** <#${guildsPost!.id}>\n**Not written:** Codemind, because its landing page won't load (load-failed: net::ERR\\_CONNECTION\\_REFUSED at https://codemindhq.dev/)`,
    ),
    day.messages[0]!.text,
  );
  assert.equal(landingReads(), 1);
  assert.equal(world.model.dossierRuns.length, 1, 'no run is made without the landing page');

  // The site stays down through two more of the Miner's starts, the last try the limit allows.
  await world.advanceTo('2026-10-13T08:00:00Z');
  await world.advanceTo('2026-10-14T08:00:00Z');
  assert.equal(landingReads(), 3);
  assert.deepEqual(
    world.discord.textMessages(STATUS).filter((l) => l.content.startsWith('Dossiers:')).map((l) => l.content),
    [
      "Dossiers: Codemind's Dossier (Mon Oct 12) won't be tried again. Its 3 tries ended without one, the last because its landing page won't load (load-failed: net::ERR_CONNECTION_REFUSED at https://codemindhq.dev/).",
    ],
  );

  world.browser.fail(CODEMIND.landing.url, undefined);
  await world.advanceTo('2026-10-15T08:00:00Z');
  assert.equal(landingReads(), 3, 'its page isn’t read again');
  assert.equal(world.model.dossierRuns.length, 1);
  assert.equal(world.discord.forumPosts(PRODUCTS_FORUM).length, 1);

  // Raising the limit through ops/upgrade, which restarts the bot, lets it try once more.
  await world.outage('2026-10-15T09:00:00Z', (config) => void (config.dossiers.tries = 4));
  assert.equal(landingReads(), 4);
  const [, codemindPost] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.equal(codemindPost?.title, 'Codemind · Delegate coding. Get back code that works.');
  assert.ok(world.discord.forumPosts(MINER_DAYS_FORUM)[0]!.messages[0]!.text.includes(`**Dossiers:** <#${guildsPost!.id}> · <#${codemindPost.id}>`));
});

test('a Dossier run that records no Dossier leaves it out of the day’s list until the Miner’s next start writes it, and the list then links it', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  const guilds = '1274741';
  world.model.onlyDossiers([CODEMIND.postId, guilds]);
  serveProduct(world, CODEMIND);
  const scripted = world.model.dossier;
  world.model.dossier = (run) => (run.postIds.includes(CODEMIND.postId) ? 'none' : scripted(run));

  await world.advanceTo('2026-10-12T08:00:00Z');
  const [guildsPost] = world.discord.forumPosts(PRODUCTS_FORUM);
  let [day] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.ok(day!.messages[0]!.text.includes('**Not written:** Codemind, because its Dossier run recorded no Dossier'), day!.messages[0]!.text);
  const codemindLine = () => world.discord.forumPosts(MINER_DAYS_FORUM)[0]!.messages[1]!.lines.find((l) => l.text.startsWith('**[Codemind]'))!.text;
  assert.doesNotMatch(codemindLine(), /→/);

  world.model.dossier = scripted;
  await world.advanceTo('2026-10-13T08:00:00Z');
  assert.equal(world.model.dossierRuns.length, 3, 'the Miner’s next start runs it again');
  const [, codemindPost] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.equal(codemindPost!.title, 'Codemind · Delegate coding. Get back code that works.', 'posted as any other');
  assert.ok(codemindPost!.messages[0]!.silent);
  [day] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(day!.title, 'Mon Oct 12 · 2 Dossiers · line 7');
  assert.ok(day!.messages[0]!.text.includes(`**Dossiers:** <#${guildsPost!.id}> · <#${codemindPost!.id}>\n-# Line:`), day!.messages[0]!.text);
  assert.match(codemindLine(), new RegExp(`· Dossier · fit 8 · .* → <#${codemindPost!.id}>$`));
  assert.ok(world.git.file('products/codemindhq.dev/dossier.md'));
});

test('Products are keyed by root domain: a Launch of a Product that has a post gets no second one', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.productHunt.addFeatured(fixtureDay('2026-10-13'), '2026-10-13T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId, XIRYN.postId]);
  serveProduct(world, CODEMIND);
  // The next day's Launch leads to another page on Codemind's own domain.
  world.browser.redirect(websiteOf(XIRYN.postId), 'https://beta.codemindhq.dev/');
  world.browser.page({ url: 'https://beta.codemindhq.dev/', title: 'Codemind beta', text: 'The next Codemind.' });

  await world.advanceTo('2026-10-12T08:00:00Z');
  await world.advanceTo('2026-10-13T08:00:00Z');

  const [post, ...more] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.equal(post!.title, 'Codemind · Delegate coding. Get back code that works.');
  assert.deepEqual(more, [], 'one post per Product');
  assert.equal(world.model.dossierRuns.length, 1);
  const days = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.equal(days.length, 2);
  assert.match(days[1]!.messages[1]!.lines[0]!.text, new RegExp(`^\\*\\*\\[Xiryn\\].* · Dossier · fit 8 · .* → <#${post!.id}>$`));
});

test('a Product post Discord took while the bot never heard back is found again, never posted twice', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId]);
  serveProduct(world, CODEMIND);
  world.discord.loseReply('post', 1, PRODUCTS_FORUM);

  await world.advanceTo('2026-10-12T08:00:00Z');
  assert.equal(world.discord.forumPosts(PRODUCTS_FORUM).length, 1, 'Discord has the post; the bot never heard back');
  assert.deepEqual(world.discord.forumPosts(MINER_DAYS_FORUM), []);

  world.clock.advanceTo('2026-10-12T08:10:00Z');
  await world.restart();

  const posts = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.equal(posts.length, 1, 'one post for the Product');
  assert.equal(world.model.dossierRuns.length, 1, 'and one Dossier run');
  const [day] = world.discord.forumPosts(MINER_DAYS_FORUM);
  assert.ok(day!.messages[0]!.text.includes(`**Dossiers:** <#${posts[0]!.id}>`));
});
