// Correcting a Miner judgment (#48): Correct on a line of the day's list opens a one-field pop-up, and the person's
// Correction re-judges only that Launch, against the date's stored line. The line shows "re-judging…" in place, then
// the new judgment "after your Correction", and never moves bands. A Skip that crosses the line becomes a Dossier, a
// Dossier that falls below it is withdrawn, and the day's file in the Personal database is rewritten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { EPHEMERAL, popupOf, updateOf, type InteractionReply, type SeenLine, type SeenMessage, type SeenPost } from './harness/fake-discord.ts';
import { MINER_DAYS_FORUM, PERSON, PRODUCTS_FORUM, TOKENS, startWorld, type World } from './harness/world.ts';
import { fixtureDay, websiteOf } from './harness/fake-product-hunt.ts';
import { opensJudgingRun, said, type ScriptedJudgment } from './harness/fake-model.ts';
import { CODEMIND, serveProduct, type FixtureProduct } from './harness/dossier-fixtures.ts';

const ph = (slug: string) => `https://www.producthunt.com/posts/${slug}`;
const ANCHER = '1266729';
const EXCALICLAW = '1277092';

/** Oct 12 posted at 01:00 PDT with no Launch at or above its line of 7, but these Products' Launches. */
async function dayPosted(t: { after(fn: () => Promise<void>): void }, dossiers: FixtureProduct[] = []): Promise<World> {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' }); // 00:30 PDT
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers(dossiers.map((d) => d.postId));
  for (const product of dossiers) serveProduct(world, product);
  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT
  await world.discord.connected();
  return world;
}

const dayPost = (world: World): SeenPost => world.discord.forumPosts(MINER_DAYS_FORUM)[0]!;

/** The day post's line for a Launch, by its name, with the message it is in. */
function lineOf(world: World, name: string): { post: SeenPost; message: SeenMessage; line: SeenLine } {
  const post = dayPost(world);
  for (const message of post.messages) {
    const line = message.lines.find((l) => l.text.startsWith(`**[${name}](`));
    if (line) return { post, message, line };
  }
  throw new Error(`No line for ${name} in the day post`);
}

/** Waits until the condition holds, for at most 10 seconds. */
async function until(condition: () => boolean): Promise<void> {
  for (let waited = 0; !condition(); waited += 20) {
    if (waited > 10_000) throw new Error('Waited 10 seconds in vain');
    await delay(20);
  }
}

/** Has the model judge this Launch so from now on, as a re-judging run would. */
function rejudges(world: World, postId: string, judgment: ScriptedJudgment): void {
  const before = world.model.judgment;
  world.model.judgment = (id) => (id === postId ? judgment : before(id));
}

/** The person taps Correct on the Launch's line and sends what it got wrong. Resolves with the bot's reply to that. */
async function correct(world: World, name: string, what: string): Promise<InteractionReply> {
  const { post, message, line } = lineOf(world, name);
  const opened = await world.discord.tap({ userId: PERSON, customId: line.button!.customId, channelId: post.id, messageId: message.id });
  const popup = popupOf(opened)!;
  return world.discord.submitPopup({
    userId: PERSON,
    customId: popup.customId,
    channelId: post.id,
    messageId: message.id,
    fields: { [popup.fields[0]!.customId]: what },
  });
}

test('Correct on a day line opens a one-field pop-up with the current judgment above "What did it get wrong?"', async (t) => {
  const world = await dayPosted(t);
  const { post, message, line } = lineOf(world, 'Ancher 2.0');
  const runs = world.model.runs.length;

  const reply = await world.discord.tap({ userId: PERSON, customId: line.button!.customId, channelId: post.id, messageId: message.id });

  assert.deepEqual(popupOf(reply), {
    customId: line.button!.customId,
    title: 'Correct · Ancher 2.0',
    texts: ['**Skip · fit 6** · knowledge workspace for what you read and save; no word on export'],
    fields: [{ customId: 'what', label: 'What did it get wrong?', required: true, multiline: true, maxLength: 1000 }],
  });
  assert.deepEqual(world.discord.refused, []);
  await world.assistant.whenIdle();
  assert.equal(world.model.runs.length, runs, 'opening the pop-up starts no run');
  assert.deepEqual(dayPost(world), post, 'the day post is as it was');
});

test('a Correction re-judges only its Launch: the line shows "re-judging…", then the new judgment in place', async (t) => {
  const world = await dayPosted(t);
  const before = lineOf(world, 'Ancher 2.0');
  const runs = world.model.runs.length;
  await world.advanceTo('2026-10-12T16:15:00Z'); // 09:15 PDT
  rejudges(world, ANCHER, { fit: 5, notAProduct: false, reason: 'knowledge workspace with no export at all' });

  const reply = await correct(world, 'Ancher 2.0', "It has no export at all, so it's further off.");

  // The pop-up's answer rewrites the line's message at once, with the line re-judging and its Correct off.
  const rejudging = updateOf(reply)!.lines.find((l) => l.text.startsWith('**[Ancher 2.0]('))!;
  assert.equal(
    rejudging.text,
    `**[Ancher 2.0](${ph('ancher-2-0')})** · re-judging… · knowledge workspace for what you read and save; no word on export\n-# you wrote “It has no export at all, so it's further off.”`,
  );
  assert.equal(rejudging.button?.disabled, true);

  await world.assistant.whenIdle();
  const after = lineOf(world, 'Ancher 2.0');
  assert.equal(
    after.line.text,
    `**[Ancher 2.0](${ph('ancher-2-0')})** · Skip · fit 5 after your Correction · knowledge workspace with no export at all\n-# was Skip · fit 6 · you wrote “It has no export at all, so it's further off.”`,
  );
  assert.equal(after.line.button?.disabled, false, 'Correct is on again');
  assert.equal(after.message.id, before.message.id, 'the line never moves bands');
  assert.deepEqual(after.message.headings, ['### Near misses · fit 6']);
  assert.equal(after.message.lines.indexOf(after.line), before.message.lines.indexOf(before.line), 'nor moves within its band');
  const post = dayPost(world);
  assert.equal(post.title, 'Mon Oct 12 · 0 Dossiers · line 7', 'the line never moves, and the outcome stays a Skip');
  assert.deepEqual(world.discord.refused, []);

  // One run, of the Miner role, re-judged only that Launch, given what the person wrote.
  const [run, ...more] = world.model.runs.slice(runs);
  assert.deepEqual(more, []);
  assert.deepEqual(run!.postIds, [ANCHER]);
  const request = world.model.requests.find((r) => opensJudgingRun(r) && said(r, 'user').includes(`Post id ${ANCHER}`) && said(r, 'user').includes('further off'))!;
  assert.equal(request.model, 'miner@openrouter');
  assert.equal(request.authorization, `Bearer ${TOKENS.minerKey}`);
  assert.deepEqual(request.tools, ['record_judgment']);
  const prompt = said(request, 'user');
  assert.ok(prompt.includes("<<<\nIt has no export at all, so it's further off.\n>>>"), 'what the person wrote reaches the model as data');
  assert.ok(prompt.includes('<<<\nknowledge workspace for what you read and save; no word on export\n>>>'), 'so does the judgment it corrects');

  // The day's file shows the new judgment, in a commit of its own.
  const file = world.git.file('days/2026-10-12.md')!;
  assert.ok(
    file.includes(
      `- [Ancher 2.0](${ph('ancher-2-0')}) · Skip · fit 5 after your Correction · knowledge workspace with no export at all · Rules applied: none` +
        ` · Corrected 2026-10-12 09:15 PT: was Skip · fit 6, you wrote "It has no export at all, so it's further off."\n`,
    ),
    file,
  );
  assert.ok(file.includes('0 Dossiers · 19 Skips · 19 Featured Launches'));
  assert.deepEqual(world.git.subjects('main', { leavingOut: 'products' }).slice(-2), [
    'Miner day Mon 2026-10-12 PT: 0 Dossiers, line 7',
    'Miner day Mon 2026-10-12 PT: Ancher 2.0 corrected, 0 Dossiers, line 7',
  ]);
});

test('a Skip corrected to at or above the line becomes a Dossier with its Product post, and the day post counts it', async (t) => {
  const world = await dayPosted(t);
  // Judged at 6 on the day, a near miss.
  const before = lineOf(world, 'Codemind');
  assert.match(before.line.text, /· Skip · fit 6 ·/);
  assert.equal(dayPost(world).title, 'Mon Oct 12 · 0 Dossiers · line 7');
  serveProduct(world, CODEMIND);
  rejudges(world, CODEMIND.postId, { fit: 8, notAProduct: false, reason: 'your coding agent hands off tasks over MCP; free allowance to start' });

  await correct(world, 'Codemind', 'I hand coding tasks off to agents all the time. This is squarely what I want.');
  await world.assistant.whenIdle();

  // Its Dossier is posted as any other, as the first message of its own Product post.
  const [product] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.equal(product?.title, 'Codemind · Delegate coding. Get back code that works.');
  assert.match(product!.messages[0]!.text, /^## Codemind · Delegate coding\. Get back code that works\.\n\*\*Open\*\* · fit 8 · Mon Oct 12 · 1 Offer\n/);
  assert.equal(world.model.dossierRuns.length, 1);

  const post = dayPost(world);
  assert.equal(post.title, 'Mon Oct 12 · 1 Dossier · line 7', 'the day post is renamed with the new count');
  assert.match(post.messages[0]!.text, /\*\*1 Dossier\*\* · 18 Skips · 19 Featured Launches · Day's line \*\*7\*\*/);
  assert.ok(post.messages[0]!.text.includes(`**Dossiers:** <#${product!.id}>`), 'the summary links its Product post');
  const after = lineOf(world, 'Codemind');
  assert.equal(
    after.line.text,
    `**[Codemind](${ph('codemind-2')})** · Dossier · fit 8 after your Correction · your coding agent hands off tasks over MCP; free allowance to start → <#${product!.id}>` +
      '\n-# was Skip · fit 6 · you wrote “I hand coding tasks off to agents all the time. This is squarely what I want.”',
  );
  assert.equal(after.message.id, before.message.id, 'the line stays among the near misses');
  assert.deepEqual(after.message.headings, ['### Near misses · fit 6']);
  assert.deepEqual(world.discord.refused, []);

  const file = world.git.file('days/2026-10-12.md')!;
  assert.ok(file.includes('1 Dossier · 18 Skips · 19 Featured Launches'));
  assert.ok(file.includes(`- [Codemind](${ph('codemind-2')}) · Dossier · fit 8 after your Correction · your coding agent hands off tasks over MCP; free allowance to start`));
  assert.ok(world.git.file('products/codemindhq.dev/dossier.md'), 'the Dossier is in the Personal database too');
  assert.equal(world.git.subjects('main', { leavingOut: 'products' }).at(-1), 'Miner day Mon 2026-10-12 PT: Codemind corrected, 1 Dossier, line 7');
});

test('a Dossier corrected below the line is withdrawn: its post is closed as Skipped, and a later Correction puts it back', async (t) => {
  const world = await dayPosted(t, [CODEMIND]);
  const [product] = world.discord.forumPosts(PRODUCTS_FORUM);
  const dossier = product!.messages[0]!;
  assert.equal(dayPost(world).title, 'Mon Oct 12 · 1 Dossier · line 7');
  const before = lineOf(world, 'Codemind');
  rejudges(world, CODEMIND.postId, { fit: 5, notAProduct: false, reason: 'a build service for teams that bill clients; not how you code' });

  await correct(world, 'Codemind', "I don't buy builds; I run my own agents.");
  await world.assistant.whenIdle();

  // The post stays as the record, closed, with the Skip line and the Correction in place of the Dossier.
  const [withdrawn, ...others] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.deepEqual(others, [], 'nothing is deleted or posted anew');
  assert.equal(withdrawn!.id, product!.id);
  assert.equal(withdrawn!.closed, true);
  assert.deepEqual(withdrawn!.tags, ['Skipped']);
  assert.equal(withdrawn!.messages.length, 1);
  assert.equal(
    withdrawn!.messages[0]!.text,
    [
      '## Codemind · Delegate coding. Get back code that works.',
      "**Withdrawn** · your Correction put it below Mon Oct 12's line of 7.",
      `**[Codemind](${ph('codemind-2')})** · Skip · fit 5 after your Correction · a build service for teams that bill clients; not how you code`,
      "-# was Dossier · fit 8 · you wrote “I don't buy builds; I run my own agents.”",
    ].join('\n'),
  );
  assert.deepEqual(withdrawn!.messages[0]!.buttons, [], 'a withdrawn Dossier has nothing left to tap');

  const post = dayPost(world);
  assert.equal(post.title, 'Mon Oct 12 · 0 Dossiers · line 7');
  assert.doesNotMatch(post.messages[0]!.text, /\*\*Dossiers:\*\*/, 'the summary links no Product post');
  const after = lineOf(world, 'Codemind');
  assert.equal(after.message.id, before.message.id, 'the line stays in the Dossiers band');
  assert.equal(
    after.line.text,
    `**[Codemind](${ph('codemind-2')})** · Skip · fit 5 after your Correction · a build service for teams that bill clients; not how you code` +
      `\n-# was Dossier · fit 8 · you wrote “I don't buy builds; I run my own agents.” · Dossier withdrawn <#${product!.id}>`,
  );
  assert.ok(world.git.file('days/2026-10-12.md')!.includes('0 Dossiers · 19 Skips'));

  // Corrected back above the line, the Product keeps its one post: open again, with its Dossier and no Skipped tag.
  rejudges(world, CODEMIND.postId, { fit: 8, notAProduct: false, reason: 'your coding agent hands off tasks over MCP; free allowance to start' });
  await correct(world, 'Codemind', 'Its free builds are worth having after all.');
  await world.assistant.whenIdle();

  const [back, ...more] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.deepEqual(more, []);
  assert.equal(back!.closed, false);
  assert.deepEqual(back!.tags, []);
  assert.equal(back!.messages[0]!.text, dossier.text, 'its Dossier is back as it was');
  assert.deepEqual(back!.messages[0]!.buttons, dossier.buttons);
  assert.equal(world.model.dossierRuns.length, 1, 'the Dossier isn’t written again');
  assert.equal(dayPost(world).title, 'Mon Oct 12 · 1 Dossier · line 7');
  assert.match(lineOf(world, 'Codemind').line.text, new RegExp(`· Dossier · fit 8 after your Correction · .* → <#${product!.id}>\\n-# was Skip · fit 5 · you wrote “Its free builds are worth having after all\\.”$`));
  assert.deepEqual(world.discord.refused, []);
});

test('two Corrections on one day are each re-judged in turn, and a Launch corrected twice keeps both in its history', async (t) => {
  const world = await dayPosted(t);
  await world.advanceTo('2026-10-12T16:15:00Z'); // 09:15 PDT
  rejudges(world, ANCHER, { fit: 4, notAProduct: false, reason: 'knowledge workspace with no export at all' });
  rejudges(world, EXCALICLAW, { fit: 5, notAProduct: false, reason: 'diagram workspace for agents; you rarely draw' });
  // Each reply is slow to end, so the second Correction is sent while the first is still re-judging.
  world.model.endDelayMs = 1000;
  const runs = world.model.runs.length;

  await correct(world, 'Ancher 2.0', 'No export, so it is no use to me.');
  const reply = await correct(world, 'ExcaliClaw', 'I hardly ever draw diagrams.');

  const both = updateOf(reply)!.lines.filter((l) => /^\*\*\[(Ancher 2\.0|ExcaliClaw)\]/.test(l.text));
  assert.deepEqual(
    both.map((l) => [l.text.split('\n')[0]!.replace(/\]\(.*?\)/, ']').split(' · ').slice(0, 2).join(' · '), l.button?.disabled]),
    [
      ['**[Ancher 2.0]** · re-judging…', true],
      ['**[ExcaliClaw]** · re-judging…', true],
    ],
    'both lines show re-judging, in the one message they share',
  );
  await world.assistant.whenIdle();
  world.model.endDelayMs = 0;

  assert.match(lineOf(world, 'Ancher 2.0').line.text, /· Skip · fit 4 after your Correction · knowledge workspace with no export at all\n-# was Skip · fit 6 · you wrote “No export, so it is no use to me\.”$/);
  assert.match(lineOf(world, 'ExcaliClaw').line.text, /· Skip · fit 5 after your Correction · diagram workspace for agents; you rarely draw\n-# was Skip · fit 6 · you wrote “I hardly ever draw diagrams\.”$/);

  // Corrected again, the line says what it was just before.
  await world.advanceTo('2026-10-12T17:40:00Z'); // 10:40 PDT
  rejudges(world, ANCHER, { fit: 2, notAProduct: false, reason: 'a workspace you would never move your notes into' });
  await correct(world, 'Ancher 2.0', 'Even further off: it keeps my notes hostage.');
  await world.assistant.whenIdle();

  const ancher = lineOf(world, 'Ancher 2.0');
  assert.match(ancher.line.text, /· Skip · fit 2 after your Correction · a workspace you would never move your notes into\n-# was Skip · fit 4 · you wrote “Even further off: it keeps my notes hostage\.”$/);
  assert.deepEqual(ancher.message.headings, ['### Near misses · fit 6'], 'still among the near misses, where the day put it');
  assert.deepEqual(
    world.model.runs.slice(runs).map((r) => r.postIds),
    [[ANCHER], [EXCALICLAW], [ANCHER]],
    'one run for each Correction, in the order they were sent',
  );

  const file = world.git.file('days/2026-10-12.md')!;
  assert.ok(
    file.includes(
      `- [Ancher 2.0](${ph('ancher-2-0')}) · Skip · fit 2 after your Correction · a workspace you would never move your notes into · Rules applied: none` +
        ' · Corrected 2026-10-12 09:15 PT: was Skip · fit 6, you wrote "No export, so it is no use to me."' +
        ' · Corrected 2026-10-12 10:40 PT: was Skip · fit 4, you wrote "Even further off: it keeps my notes hostage."\n',
    ),
    file,
  );
  assert.ok(
    file.includes(
      `- [ExcaliClaw](${ph('excaliclaw')}) · Skip · fit 5 after your Correction · diagram workspace for agents; you rarely draw · Rules applied: none` +
        ' · Corrected 2026-10-12 09:15 PT: was Skip · fit 6, you wrote "I hardly ever draw diagrams."\n',
    ),
  );
  assert.deepEqual(world.git.subjects('main', { leavingOut: 'products' }).slice(-3), [
    'Miner day Mon 2026-10-12 PT: Ancher 2.0 corrected, 0 Dossiers, line 7',
    'Miner day Mon 2026-10-12 PT: ExcaliClaw corrected, 0 Dossiers, line 7',
    'Miner day Mon 2026-10-12 PT: Ancher 2.0 corrected, 0 Dossiers, line 7',
  ]);
  assert.deepEqual(world.discord.refused, []);
});

test('a Correction runs even once its date’s Miner budget is spent, and its run counts against that date', async (t) => {
  const world = await dayPosted(t);
  const finished = () => world.logs.filter((l) => l.event === 'run.finished' && l.role === 'miner' && l.item === '2026-10-12');
  const spent = finished().reduce((sum, l) => sum + Number(l.dollars), 0);
  // ops/upgrade lowers the Miner budget below what Oct 12 has spent, and the bot restarts at 09:00 PDT.
  await world.outage('2026-10-12T16:00:00Z', (config) => (config.budgets.miner = spent / 2));
  rejudges(world, ANCHER, { fit: 5, notAProduct: false, reason: 'knowledge workspace with no export at all' });

  await correct(world, 'Ancher 2.0', "It has no export at all, so it's further off.");
  await world.assistant.whenIdle();

  assert.match(lineOf(world, 'Ancher 2.0').line.text, /· Skip · fit 5 after your Correction ·/);
  assert.equal(finished().length, 4, 'the Correction’s run is a Miner run on Oct 12, beside the day’s three');
  assert.equal(world.logs.filter((l) => l.event === 'miner.run-held').length, 0, 'nothing was held');
});

test('a Correction cut short by a stop runs again at the next start, ahead of the Miner’s next day', async (t) => {
  const world = await dayPosted(t);
  world.productHunt.addFeatured(fixtureDay('2026-10-13'), '2026-10-13T07:01:00Z');
  rejudges(world, ANCHER, { fit: 5, notAProduct: false, reason: 'knowledge workspace with no export at all' });
  const runs = world.model.runs.length;
  world.model.hold = true; // the provider takes the request and never answers

  await correct(world, 'Ancher 2.0', "It has no export at all, so it's further off.");
  await until(() => world.model.runs.length > runs);
  // Correct is off while the line is re-judging; a tap from a screen that hasn't caught up is turned away.
  const { post, message, line } = lineOf(world, 'Ancher 2.0');
  assert.equal(line.button?.disabled, true);
  const again = await world.discord.tap({ userId: PERSON, customId: line.button!.customId, channelId: post.id, messageId: message.id });
  assert.ok((again.data?.flags ?? 0) & EPHEMERAL);
  assert.equal(again.data?.content, 'Ancher 2.0 is being re-judged after your Correction already.');
  // The bot stops mid-run, and starts again once Oct 13's Miner start has passed.
  await world.outage('2026-10-13T08:30:00Z', () => (world.model.hold = false));

  assert.match(lineOf(world, 'Ancher 2.0').line.text, /· Skip · fit 5 after your Correction ·/);
  const [stopped, ...after] = world.model.runs.slice(runs);
  assert.deepEqual(stopped!.postIds, [ANCHER]);
  assert.deepEqual(after[0]!.postIds, [ANCHER], 'the Correction runs first');
  assert.ok(after.length > 1 && after.slice(1).every((r) => r.kind === 'miner-judging' && !r.postIds.includes(ANCHER)), 'then the Miner judges Oct 13');
  assert.equal(world.discord.forumPosts(MINER_DAYS_FORUM).length, 2);
});

test('a Correction whose run records no judgment leaves the line as it was, says why, and Correct is on again', async (t) => {
  const world = await dayPosted(t);
  const subjects = world.git.subjects('main');
  const runs = world.model.runs.length;
  world.model.hold = true;

  await correct(world, 'Ancher 2.0', "It has no export at all, so it's further off.");
  await until(() => world.model.runs.length > runs);
  world.clock.advanceTo('2026-10-12T08:10:00Z'); // the run's 10 minutes are up
  await world.assistant.whenIdle();

  const { line } = lineOf(world, 'Ancher 2.0');
  assert.equal(
    line.text,
    `**[Ancher 2.0](${ph('ancher-2-0')})** · Skip · fit 6 · knowledge workspace for what you read and save; no word on export` +
      "\n-# Your Correction “It has no export at all, so it's further off.” couldn't be re-judged: its run hit its time cap (10 min). Correct to try again.",
  );
  assert.equal(line.button?.disabled, false);
  assert.equal(dayPost(world).title, 'Mon Oct 12 · 0 Dossiers · line 7');
  assert.deepEqual(world.git.subjects('main'), subjects, 'the day’s file is written again just as it was, and gets no commit');

  // Corrected again, it is re-judged.
  world.model.hold = false;
  rejudges(world, ANCHER, { fit: 5, notAProduct: false, reason: 'knowledge workspace with no export at all' });
  await correct(world, 'Ancher 2.0', 'It has no export at all.');
  await world.assistant.whenIdle();
  assert.match(lineOf(world, 'Ancher 2.0').line.text, /· Skip · fit 5 after your Correction · .*\n-# was Skip · fit 6 · you wrote “It has no export at all\.”$/);
});

test('a long Correction on a day of long names and reasons keeps every message, and the pop-up, within Discord’s limits', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  const day = fixtureDay('2026-10-12').map((p) => ({ ...p, name: `${p.name} ${'*Extra*_name_'.repeat(5)}`.slice(0, 60) }));
  world.productHunt.addFeatured(day, '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([]);
  const standIn = world.model.judgment;
  // Formatting characters are escaped on Discord, so a 240-character reason takes far more room there.
  const long = (reason: string) => `${reason.slice(0, 10)}${'*'.repeat(230)}`;
  world.model.judgment = (postId) => {
    const j = standIn(postId);
    return j === 'omit' ? j : { ...j, reason: long(j.reason) };
  };
  await world.advanceTo('2026-10-12T08:00:00Z');
  await world.discord.connected();
  // The first line of the fullest message, with the least room to spare.
  const post = dayPost(world);
  const message = post.messages.slice(1).reduce((a, b) => (b.textLength > a.textLength ? b : a));
  assert.ok(message.textLength > 3700, `${message.textLength} characters`);
  const line = message.lines[0]!;
  const postId = line.button!.customId.replace('correct:launch:', '');
  rejudges(world, postId, { fit: 4, notAProduct: false, reason: long('further off than it looked') });

  const opened = await world.discord.tap({ userId: PERSON, customId: line.button!.customId, channelId: post.id, messageId: message.id });
  const popup = popupOf(opened)!;
  assert.equal(popup.title.length, 45);
  assert.ok(popup.title.endsWith('…'));
  const reply = await world.discord.submitPopup({
    userId: PERSON,
    customId: popup.customId,
    channelId: post.id,
    messageId: message.id,
    fields: { what: `${'It has *no* export at all, [see](https://example.com) <@123>. '.repeat(20)}`.slice(0, 1000) },
  });
  assert.equal(reply.type, 7);
  await world.assistant.whenIdle();

  assert.deepEqual(world.discord.refused, [], 'Discord accepted every edit');
  const after = world.discord.forumPosts(MINER_DAYS_FORUM)[0]!.messages.find((m) => m.id === message.id)!;
  assert.ok(after.textLength <= 4000, `${after.textLength} characters`);
  const corrected = after.lines.find((l) => l.text.includes('after your Correction'))!;
  assert.match(corrected.text, /\n-# was Skip · fit \d · you wrote “(It has \\\*no\\\* export at all, \\\[see\\\]\(https:\/\/example\.com\) \\<@123\\>\..*)?…”$/);
});

test('a Skip corrected above the line whose Dossier can’t be written yet says so, and its Dossier follows 30 minutes later', async (t) => {
  const world = await dayPosted(t);
  await world.advanceTo('2026-10-12T16:15:00Z'); // 09:15 PDT
  rejudges(world, CODEMIND.postId, { fit: 8, notAProduct: false, reason: 'your coding agent hands off tasks over MCP; free allowance to start' });

  // Its site doesn't load yet.
  serveProduct(world, CODEMIND);
  world.browser.fail(websiteOf(CODEMIND.postId), { kind: 'timeout', message: 'the page took over 30 seconds' });
  await correct(world, 'Codemind', 'This is squarely what I want.');
  await world.assistant.whenIdle();

  assert.deepEqual(world.discord.forumPosts(PRODUCTS_FORUM), []);
  assert.equal(dayPost(world).title, 'Mon Oct 12 · 1 Dossier · line 7');
  assert.equal(
    lineOf(world, 'Codemind').line.text,
    `**[Codemind](${ph('codemind-2')})** · Dossier · fit 8 after your Correction · your coding agent hands off tasks over MCP; free allowance to start` +
      "\n-# was Skip · fit 6 · you wrote “This is squarely what I want.” · the Dossier for Codemind couldn't be written: its landing page won't load (timeout: the page took over 30 seconds)",
  );

  world.browser.fail(websiteOf(CODEMIND.postId), undefined);
  await world.advanceTo('2026-10-12T16:45:00Z'); // 09:45 PDT
  const [product] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.ok(product);
  assert.equal(
    lineOf(world, 'Codemind').line.text,
    `**[Codemind](${ph('codemind-2')})** · Dossier · fit 8 after your Correction · your coding agent hands off tasks over MCP; free allowance to start → <#${product.id}>` +
      '\n-# was Skip · fit 6 · you wrote “This is squarely what I want.”',
  );
  assert.ok(dayPost(world).messages[0]!.text.includes(`**Dossiers:** <#${product.id}>`));
});

test('a Dossier whose forum tags can’t be read yet is withdrawn 30 minutes later, never closed without its Skipped tag', async (t) => {
  const world = await dayPosted(t, [CODEMIND]);
  const [product] = world.discord.forumPosts(PRODUCTS_FORUM);
  await world.advanceTo('2026-10-12T16:15:00Z'); // 09:15 PDT
  rejudges(world, CODEMIND.postId, { fit: 5, notAProduct: false, reason: 'a build service for teams that bill clients; not how you code' });
  world.discord.unreadable.add(PRODUCTS_FORUM);

  await correct(world, 'Codemind', "I don't buy builds; I run my own agents.");
  await world.assistant.whenIdle();

  assert.deepEqual(world.discord.forumPosts(PRODUCTS_FORUM), [product], 'the Dossier and its post are as they were');
  assert.equal(dayPost(world).title, 'Mon Oct 12 · 0 Dossiers · line 7');
  assert.match(
    lineOf(world, 'Codemind').line.text,
    /\n-# was Dossier · fit 8 · you wrote “I don't buy builds; I run my own agents\.” · the Dossier for Codemind can't be withdrawn while the Products forum's tags can't be read$/,
  );

  world.discord.unreadable.delete(PRODUCTS_FORUM);
  await world.advanceTo('2026-10-12T16:45:00Z'); // 09:45 PDT
  const [withdrawn] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.equal(withdrawn!.closed, true);
  assert.deepEqual(withdrawn!.tags, ['Skipped']);
  assert.match(withdrawn!.messages[0]!.text, /^## Codemind · Delegate coding\. Get back code that works\.\n\*\*Withdrawn\*\*/);
  assert.match(lineOf(world, 'Codemind').line.text, new RegExp(`you wrote “I don't buy builds; I run my own agents\\.” · Dossier withdrawn <#${product!.id}>$`));
  assert.deepEqual(world.discord.refused, []);
});
