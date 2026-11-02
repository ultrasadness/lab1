// Sorting a Correction (#49): once the item a Correction was made on is redone, a run of the item's role proposes
// whether the Correction is fix only, an Interest scope change or a Rule. Fix only is recorded in the item's history;
// a proposed Interest scope change or Rule goes to #needs-you as a card, where the person keeps, edits or discards it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTEREST_SCOPE, MINER_DAYS_FORUM, NEEDS_YOU, PERSON, type World } from './harness/world.ts';
import { opensJudgingRun, opensRun, said, sorted } from './harness/fake-model.ts';
import { fixtureDay } from './harness/fake-product-hunt.ts';
import { correct, dayPosted, lineOf, rejudges, until } from './harness/miner-day.ts';
import { EPHEMERAL, popupOf, updateOf, type InteractionReply, type SeenMessage } from './harness/fake-discord.ts';

const ph = (slug: string) => `https://www.producthunt.com/posts/${slug}`;
const ANCHER = '1266729';
const EXCALICLAW = '1277092';
/** Oct 13's Kai, which the next day's run judges under the kept Rule. */
const KAI = '1259407';
const PURPLE = 0x9b59b6;
const [BLUE, GREY] = [1, 2];

const PLAIN_WORDS = { name: 'Plain words', statement: 'Write every free-text field in plain words, with no marketing language.' };
const WAITLIST = {
  name: "Waitlist isn't open signup",
  statement: 'A Launch that only lets you join a waitlist is no open signup: judge it two Fit lower than if anyone could sign up now.',
};

/** The person taps a button on a card in #needs-you, by its label. */
function tapCard(world: World, card: SeenMessage, label: string): Promise<InteractionReply> {
  const button = card.buttons.find((b) => b.label === label);
  if (!button) throw new Error(`No ${label} button on the card`);
  return world.discord.tap({ userId: PERSON, customId: button.customId, channelId: NEEDS_YOU, messageId: card.id });
}

test('a Correction sorted as fix only gets no card, and the day’s file records the sort with the Correction', async (t) => {
  const world = await dayPosted(t);
  world.git.commitAsPerson('rules/all/plain-words.md', `# ${PLAIN_WORDS.name}\n\n${PLAIN_WORDS.statement}\n`, 'Add a Rule');
  await world.advanceTo('2026-10-12T16:15:00Z'); // 09:15 PDT
  rejudges(world, ANCHER, { fit: 5, notAProduct: false, reason: 'knowledge workspace with no export at all' });
  world.model.sort = () => sorted('fix-only', { rulesApplied: [PLAIN_WORDS.name] });
  const runs = world.model.runs.length;

  await correct(world, 'Ancher 2.0', "It has no export at all, so it's further off.");
  await world.assistant.whenIdle();

  // Once the Launch is re-judged, a Miner-role run sorts the Correction, given the line before and after it.
  assert.deepEqual(
    world.model.runs.slice(runs).map((r) => [r.kind, r.postIds]),
    [
      ['miner-judging', [ANCHER]],
      ['correction-sorting', [ANCHER]],
    ],
  );
  const request = world.model.requests.find((r) => opensRun(r) && r.tools.includes('record_sort'))!;
  assert.equal(request.model, 'miner@openrouter');
  assert.deepEqual(request.tools, ['record_sort']);
  const prompt = said(request, 'user');
  assert.ok(prompt.includes(`<<<\n${INTEREST_SCOPE.trim()}\n>>>`), prompt);
  assert.ok(prompt.includes('<<<\nSkip · fit 6 · knowledge workspace for what you read and save; no word on export\n>>>'));
  assert.ok(prompt.includes("<<<\nIt has no export at all, so it's further off.\n>>>"));
  assert.ok(prompt.includes('<<<\nSkip · fit 5 · knowledge workspace with no export at all\n>>>'));

  assert.deepEqual(world.discord.cards(NEEDS_YOU), [], 'nothing waits on the person');
  assert.equal(
    lineOf(world, 'Ancher 2.0').line.text,
    `**[Ancher 2.0](${ph('ancher-2-0')})** · Skip · fit 5 after your Correction · knowledge workspace with no export at all\n-# was Skip · fit 6 · you wrote “It has no export at all, so it's further off.”`,
    'the line says nothing of a fix-only sort',
  );
  const file = world.git.file('days/2026-10-12.md')!;
  assert.ok(
    file.includes(
      `- [Ancher 2.0](${ph('ancher-2-0')}) · Skip · fit 5 after your Correction · knowledge workspace with no export at all · Rules applied: none` +
        ` · Corrected 2026-10-12 09:15 PT: was Skip · fit 6, you wrote "It has no export at all, so it's further off.", fix only (Rules applied: Plain words)\n`,
    ),
    file,
  );
  assert.deepEqual(world.discord.refused, []);
});

test('a Correction sorted as a Rule goes to #needs-you on a purple card, and once kept, every later Miner run applies it', async (t) => {
  const world = await dayPosted(t);
  world.productHunt.addFeatured(fixtureDay('2026-10-13'), '2026-10-13T07:01:00Z');
  await world.advanceTo('2026-10-12T16:15:00Z'); // 09:15 PDT
  rejudges(world, ANCHER, { fit: 4, notAProduct: false, reason: 'knowledge workspace you can only join a waitlist for' });
  world.model.sort = () => sorted('rule', { rule: { ...WAITLIST, scope: 'miner', amends: false } });

  await correct(world, 'Ancher 2.0', 'You can only join a waitlist for it. A waitlist is no open signup, so it is further off.');
  await world.assistant.whenIdle();

  // The card mentions the person, and nothing is committed until they keep it.
  const [card, ...more] = world.discord.cards(NEEDS_YOU);
  assert.deepEqual(more, []);
  assert.equal(card!.accent, PURPLE);
  assert.deepEqual(card!.mentions, [PERSON]);
  assert.equal(
    card!.text,
    [
      `<@${PERSON}> **Proposed Rule · not an Approval**`,
      `**Waitlist isn't open signup** · Miner\n> ${WAITLIST.statement}`,
      '-# From your Correction on **Ancher 2.0** (Mon Oct 12): “You can only join a waitlist for it. A waitlist is no open signup, so it is further off.”',
      '-# Keep adds it to every later Miner run. Keeping it approves nothing: nothing is registered or sent.',
    ].join('\n'),
  );
  assert.deepEqual(
    card!.buttons.map((b) => [b.label, b.style, b.disabled]),
    [
      ['Keep', BLUE, false],
      ['Edit', GREY, false],
      ['Discard', GREY, false],
    ],
  );
  const subjects = world.git.subjects('main');
  assert.equal(world.git.file('rules/miner/waitlist-isnt-open-signup.md'), undefined);
  assert.ok(world.git.file('days/2026-10-12.md')!.includes('you wrote "You can only join a waitlist for it. A waitlist is no open signup, so it is further off."\n'));

  // Keep commits the Rule file, and the card shrinks to one line naming it.
  await world.advanceTo('2026-10-12T16:20:00Z'); // 09:20 PDT
  const keeping = await tapCard(world, card!, 'Keep');
  assert.equal(keeping.type, 7);
  await world.assistant.whenIdle();

  const path = 'rules/miner/waitlist-isnt-open-signup.md';
  assert.equal(
    world.git.file(path),
    [
      '---',
      'scope: miner',
      'taught-on:',
      '  - Launch 1266729 (Ancher 2.0) of Mon 2026-10-12 PT',
      'case: unproven',
      'created: 2026-10-12 09:20 PT',
      '---',
      '',
      "# Waitlist isn't open signup",
      '',
      WAITLIST.statement,
      '',
    ].join('\n'),
  );
  const [kept] = world.discord.cards(NEEDS_YOU);
  assert.equal(kept!.text, `✓ Rule kept · **Waitlist isn't open signup** · Miner · [${path}](${world.git.webUrl}/blob/main/${path})`);
  assert.deepEqual(kept!.buttons, []);
  assert.ok(
    world.git.file('days/2026-10-12.md')!.includes(`you wrote "You can only join a waitlist for it. A waitlist is no open signup, so it is further off.", taught the Rule "Waitlist isn't open signup"\n`),
  );
  assert.deepEqual(world.git.subjects('main').slice(subjects.length), [
    "Rule kept: Waitlist isn't open signup (Miner)",
    "Miner day Mon 2026-10-12 PT: Ancher 2.0's Correction taught a Rule, 0 Dossiers, line 7",
  ]);

  // The next day's runs load it, at the commit that kept it, and the line it changed names it.
  const keptAt = world.git.head();
  const logged = world.logs.length;
  rejudges(world, KAI, { fit: 2, notAProduct: false, reason: 'email and calendar assistant for founders; waitlist only', rulesApplied: [WAITLIST.name] });
  await world.advanceTo('2026-10-13T08:00:00Z'); // 01:00 PDT
  const oct13 = world.model.requests.filter((r) => opensJudgingRun(r) && said(r, 'user').includes(`Post id ${KAI}`));
  assert.equal(oct13.length, 1);
  assert.ok(said(oct13[0]!, 'system').includes(`Rule: ${WAITLIST.name}\nScope: Miner\n${WAITLIST.statement}`));
  const loaded = world.logs.slice(logged).filter((l) => l.event === 'run.rules-loaded');
  assert.equal(loaded.length, 4, "Oct 13's four judging runs");
  for (const entry of loaded) assert.deepEqual([entry.commit, entry.rules], [keptAt, [WAITLIST.name]]);
  const oct13Post = world.discord.forumPosts(MINER_DAYS_FORUM)[1]!;
  const kai = oct13Post.messages.flatMap((m) => m.lines).find((l) => l.text.startsWith('**[Kai]('))!;
  assert.match(kai.text, /· Skip · fit 2 · email and calendar assistant for founders; waitlist only \(Rule: Waitlist isn't open signup\)$/);
  assert.deepEqual(world.discord.refused, []);
});

/** Oct 12 posted, then a Correction of Ancher 2.0 at 09:15 PDT that its sorting run proposes as the waitlist Rule. */
async function ruleProposed(t: { after(fn: () => Promise<void>): void }): Promise<{ world: World; card: SeenMessage }> {
  const world = await dayPosted(t);
  await world.advanceTo('2026-10-12T16:15:00Z'); // 09:15 PDT
  rejudges(world, ANCHER, { fit: 4, notAProduct: false, reason: 'knowledge workspace you can only join a waitlist for' });
  world.model.sort = () => sorted('rule', { rule: { ...WAITLIST, scope: 'miner', amends: false } });
  await correct(world, 'Ancher 2.0', 'You can only join a waitlist for it. A waitlist is no open signup, so it is further off.');
  await world.assistant.whenIdle();
  return { world, card: world.discord.cards(NEEDS_YOU)[0]! };
}

test('Edit rewords a proposed Rule in a pop-up, and Keep then commits it as edited, never as first proposed', async (t) => {
  const { world, card } = await ruleProposed(t);

  const opened = await tapCard(world, card, 'Edit');
  const popup = popupOf(opened)!;
  assert.deepEqual(popup.title, 'Edit proposed Rule');
  assert.deepEqual(
    popup.fields.map((f) => [f.customId, f.label, f.multiline, f.maxLength, f.value]),
    [
      ['name', 'Name', false, 60, WAITLIST.name],
      ['statement', 'Rule', true, 600, WAITLIST.statement],
    ],
  );
  const statement = 'A Launch you can only join a waitlist for is no open signup: judge it at most 4.';
  const reply = await world.discord.submitPopup({
    userId: PERSON,
    customId: popup.customId,
    channelId: NEEDS_YOU,
    messageId: card.id,
    fields: { name: 'Waitlists are not signup', statement },
  });
  const edited = updateOf(reply)!;
  assert.ok(edited.text.includes(`**Waitlists are not signup** · Miner\n> ${statement}\n`), edited.text);
  assert.ok(edited.text.endsWith('\n-# You edited it.'));
  assert.deepEqual(world.discord.cards(NEEDS_YOU)[0]!.text, edited.text, 'the card itself reads so');

  // A Keep from a screen still showing the Rule as first proposed is turned away.
  const stale = await tapCard(world, card, 'Keep');
  assert.ok((stale.data?.flags ?? 0) & EPHEMERAL);
  assert.equal(stale.data?.content, 'It was edited since; the card now shows it as edited.');
  assert.equal(world.git.file('rules/miner/waitlist-isnt-open-signup.md'), undefined);

  await tapCard(world, world.discord.cards(NEEDS_YOU)[0]!, 'Keep');
  await world.assistant.whenIdle();
  assert.equal(world.git.file('rules/miner/waitlist-isnt-open-signup.md'), undefined);
  assert.ok(world.git.file('rules/miner/waitlists-are-not-signup.md')!.endsWith(`\n# Waitlists are not signup\n\n${statement}\n`));
  assert.match(world.discord.cards(NEEDS_YOU)[0]!.text, /^✓ Rule kept · \*\*Waitlists are not signup\*\* · Miner · /);
  assert.deepEqual(world.discord.refused, []);
});

test('Discard leaves the Correction fix only: nothing is committed but the day’s file saying so', async (t) => {
  const { world, card } = await ruleProposed(t);
  const subjects = world.git.subjects('main');

  const reply = await tapCard(world, card, 'Discard');
  assert.equal(updateOf(reply)!.text, 'Discarded · your Correction on **Ancher 2.0** (Mon Oct 12) stays fix only');
  await world.assistant.whenIdle();

  const [discarded] = world.discord.cards(NEEDS_YOU);
  assert.equal(discarded!.text, 'Discarded · your Correction on **Ancher 2.0** (Mon Oct 12) stays fix only');
  assert.deepEqual(discarded!.buttons, []);
  assert.deepEqual(world.git.subjects('main').slice(subjects.length), ["Miner day Mon 2026-10-12 PT: Ancher 2.0's Correction is fix only, 0 Dossiers, line 7"]);
  assert.ok(world.git.file('days/2026-10-12.md')!.includes('so it is further off.", fix only, its proposal discarded\n'));
  const again = await tapCard(world, card, 'Keep');
  assert.equal(again.data?.content, 'It was discarded already.');
  assert.deepEqual(world.discord.refused, []);
});

test('a Correction that overlaps a kept Rule becomes a proposed amendment of it, never a second Rule beside it', async (t) => {
  const world = await dayPosted(t);
  // The person wrote the Rule in git, with the item it came from on one line, and an all-scope Rule of wording.
  const path = 'rules/miner/waitlist-isnt-open-signup.md';
  const written = ['---', 'scope: miner', 'taught-on: written in git', 'created: 2026-10-11', '---', '', `# ${WAITLIST.name}`, '', WAITLIST.statement, ''];
  world.git.commitAsPerson(path, written.join('\n'), 'Keep the waitlist Rule');
  world.git.commitAsPerson('rules/all/plain-words.md', `# ${PLAIN_WORDS.name}\n\n${PLAIN_WORDS.statement}\n`, 'Add a Rule');
  await world.advanceTo('2026-10-12T17:00:00Z'); // 10:00 PDT
  rejudges(world, EXCALICLAW, { fit: 4, notAProduct: false, reason: 'diagram workspace for agents; invite-only beta', rulesApplied: [WAITLIST.name] });
  const statement = 'A Launch that only lets you join a waitlist or ask for an invite is no open signup: judge it two Fit lower than if anyone could sign up now.';
  // The drafter first proposes a Rule of the same name beside the kept one, and is told to amend it instead.
  world.model.sort = () => sorted('rule', { rule: { name: WAITLIST.name, statement, scope: 'miner', amends: false } });
  world.model.sortAgain = () => sorted('rule', { rule: { name: WAITLIST.name, statement, scope: 'miner', amends: true }, rulesApplied: [PLAIN_WORDS.name] });

  await correct(world, 'ExcaliClaw', 'It is invite-only for now. An invite-only beta is no open signup either.');
  await world.assistant.whenIdle();

  const [sorting] = world.model.sortingRuns;
  const request = world.model.requests.find((r) => opensRun(r) && r.tools.includes('record_sort'))!;
  assert.ok(said(request, 'system').includes(`Rule: ${WAITLIST.name}\nScope: Miner\n${WAITLIST.statement}`), 'the drafter sees the kept Rule');
  assert.deepEqual(sorting!.sortReplies, [
    `A Rule named "${WAITLIST.name}" is kept already. Amend it, with amends true, or name the new Rule differently.`,
    'Recorded the sort.',
  ]);
  const [card, ...more] = world.discord.cards(NEEDS_YOU);
  assert.deepEqual(more, []);
  assert.equal(card!.accent, PURPLE);
  assert.equal(
    card!.text,
    [
      `<@${PERSON}> **Proposed Rule · not an Approval**`,
      `Amends **${WAITLIST.name}** · Miner`,
      'Now:',
      `> ${WAITLIST.statement}`,
      'Would be:',
      `> ${statement}`,
      '-# From your Correction on **ExcaliClaw** (Mon Oct 12): “It is invite-only for now. An invite-only beta is no open signup either.”',
      '-# Keep rewrites it for every later Miner run; a kept Rule never changes without you. Keeping it approves nothing: nothing is registered or sent.',
      '-# Rules applied: Plain words',
    ].join('\n'),
  );

  await world.advanceTo('2026-10-12T17:05:00Z'); // 10:05 PDT
  await tapCard(world, card!, 'Keep');
  await world.assistant.whenIdle();

  const amended = (taughtOn: string[], at: string, now: string) =>
    ['---', 'scope: miner', 'taught-on:', ...taughtOn.map((i) => `  - ${i}`), 'created: 2026-10-11', `amended: ${at}`, '---', '', `# ${WAITLIST.name}`, '', now, ''].join('\n');
  const excaliclaw = `Launch ${EXCALICLAW} (ExcaliClaw) of Mon 2026-10-12 PT`;
  assert.equal(world.git.file(path), amended(['written in git', excaliclaw], '2026-10-12 10:05 PT', statement));
  assert.deepEqual(world.git.subjects('main').slice(-2), [
    `Rule amended: ${WAITLIST.name} (Miner)`,
    "Miner day Mon 2026-10-12 PT: ExcaliClaw's Correction amended a Rule, 0 Dossiers, line 7",
  ]);
  assert.equal(world.discord.cards(NEEDS_YOU)[0]!.text, `✓ Rule amended · **${WAITLIST.name}** · Miner · [${path}](${world.git.webUrl}/blob/main/${path})`);
  assert.ok(world.git.file('days/2026-10-12.md')!.includes(`An invite-only beta is no open signup either.", amended the Rule "${WAITLIST.name}" (Rules applied: Plain words)\n`));

  // Amended again from another Correction, the Rule keeps each item it was taught on.
  rejudges(world, ANCHER, { fit: 4, notAProduct: false, reason: 'knowledge workspace you can only join a waitlist for', rulesApplied: [WAITLIST.name] });
  const again = `${statement} A beta that asks you to apply counts too.`;
  world.model.sort = () => sorted('rule', { rule: { name: WAITLIST.name, statement: again, scope: 'miner', amends: true } });
  await correct(world, 'Ancher 2.0', 'You have to apply to get in, which is a waitlist by another name.');
  await world.assistant.whenIdle();
  await world.advanceTo('2026-10-12T17:30:00Z'); // 10:30 PDT
  await tapCard(world, world.discord.cards(NEEDS_YOU)[1]!, 'Keep');
  await world.assistant.whenIdle();
  assert.equal(world.git.file(path), amended(['written in git', excaliclaw, `Launch ${ANCHER} (Ancher 2.0) of Mon 2026-10-12 PT`], '2026-10-12 10:30 PT', again));
  assert.deepEqual(world.discord.refused, []);
});

test('a Correction sorted as an Interest scope change shows it before and after, and Keep commits it for every later run', async (t) => {
  const world = await dayPosted(t);
  world.productHunt.addFeatured(fixtureDay('2026-10-13'), '2026-10-13T07:01:00Z');
  await world.advanceTo('2026-10-12T16:15:00Z'); // 09:15 PDT
  rejudges(world, ANCHER, { fit: 3, notAProduct: false, reason: 'knowledge workspace that keeps your notes in; no export' });
  const reworded = { section: 'Want', remove: 'Personal knowledge: notes, reading and documents I can export.', add: 'Personal knowledge: notes, reading and documents, from tools that export them.' };
  const added = { section: "Don't want", remove: null, add: 'Notes or knowledge tools that keep your notes in, with no export.' };
  // The drafter first names a section the Interest scope doesn't have, and is told which it has.
  world.model.sort = () => sorted('interest-scope', { changes: [{ ...reworded, section: 'Wants' }, added] });
  world.model.sortAgain = () => sorted('interest-scope', { changes: [reworded, added] });

  await correct(world, 'Ancher 2.0', 'A notes tool I can’t export from is no use to me at all.');
  await world.assistant.whenIdle();

  assert.equal(
    world.model.sortingRuns[0]!.sortReplies[0],
    `changes[0]: the Interest scope has no section "Wants". Its sections are "Want", "Don't want", "Leans".`,
  );
  const [card, ...more] = world.discord.cards(NEEDS_YOU);
  assert.deepEqual(more, []);
  assert.equal(card!.accent, PURPLE);
  assert.equal(
    card!.text,
    [
      `<@${PERSON}> **Proposed Interest scope change · not an Approval**`,
      '**Want**, now:',
      '- AI coding agents and what runs around them: harnesses, orchestration, review, agent memory.',
      '- Developer tools and APIs I can use from a terminal or my Linux server.',
      '- Model access: LLM APIs, gateways and inference, especially with free credits.',
      '- Running one small server: monitoring, deploys, Docker.',
      '- Personal knowledge: notes, reading and documents I can export.',
      '- iPhone apps for study and getting things done.',
      '**Want**, would be:',
      '- AI coding agents and what runs around them: harnesses, orchestration, review, agent memory.',
      '- Developer tools and APIs I can use from a terminal or my Linux server.',
      '- Model access: LLM APIs, gateways and inference, especially with free credits.',
      '- Running one small server: monitoring, deploys, Docker.',
      '- Personal knowledge: notes, reading and documents, from tools that export them.',
      '- iPhone apps for study and getting things done.',
      "**Don't want**, now:",
      '- Sales, marketing, SEO, ads, social growth, recruiting.',
      '- Software only for Mac or Android (no Mac; my phone is an iPhone).',
      '- Finance, lending, accounting, shopping.',
      '- Games, lifestyle, health, food, travel.',
      '- Tools that need a company or team to be useful.',
      "**Don't want**, would be:",
      '- Sales, marketing, SEO, ads, social growth, recruiting.',
      '- Software only for Mac or Android (no Mac; my phone is an iPhone).',
      '- Finance, lending, accounting, shopping.',
      '- Games, lifestyle, health, food, travel.',
      '- Tools that need a company or team to be useful.',
      '- Notes or knowledge tools that keep your notes in, with no export.',
      '-# From your Correction on **Ancher 2.0** (Mon Oct 12): “A notes tool I can’t export from is no use to me at all.”',
      '-# Keep commits it to the Interest scope in your Profile, which every later Miner and Dossier run reads. Keeping it approves nothing: nothing is registered or sent.',
    ].join('\n'),
  );
  assert.equal(world.git.file('profile/interest-scope.md'), INTEREST_SCOPE, 'nothing changes before Keep');

  // Edit holds the whole Interest scope as proposed, and the person words the new line their own way.
  const proposed = INTEREST_SCOPE.replace(reworded.remove, reworded.add).replace(
    '- Tools that need a company or team to be useful.\n',
    `- Tools that need a company or team to be useful.\n- ${added.add}\n`,
  );
  const popup = popupOf(await tapCard(world, card!, 'Edit'))!;
  assert.equal(popup.title, 'Edit proposed Interest scope');
  assert.deepEqual(
    popup.fields.map((f) => [f.customId, f.label, f.multiline, f.value]),
    [['interest-scope', 'Interest scope', true, proposed]],
  );
  const send = (scope: string) =>
    world.discord.submitPopup({ userId: PERSON, customId: popup.customId, channelId: NEEDS_YOU, messageId: card!.id, fields: { 'interest-scope': scope } });
  // The Interest scope as it is now, or one whose changes wouldn't fit the card, is turned back.
  assert.equal((await send(INTEREST_SCOPE)).data?.content, 'That is the Interest scope as it is now. Edit it again, or Discard the proposal.');
  const sprawling = proposed.replace('## Leans\n', `## Leans\n${'- Tools I can script from a terminal count for more.\n'.repeat(50)}`);
  assert.ok(sprawling.length <= 4000, 'within what the pop-up’s field takes');
  assert.equal((await send(sprawling)).data?.content, 'That is too long to show on one Discord card. Edit it shorter.');
  const after = proposed.replace(added.add, 'Note tools with no export.');
  const reply = await send(after);
  const edited = updateOf(reply)!.text;
  assert.ok(edited.includes("**Don't want**, would be:\n"), edited);
  assert.ok(edited.includes('\n- Tools that need a company or team to be useful.\n- Note tools with no export.\n-# From your Correction'));
  assert.ok(edited.endsWith('\n-# You edited it.'));

  await tapCard(world, world.discord.cards(NEEDS_YOU)[0]!, 'Keep');
  await world.assistant.whenIdle();

  assert.equal(world.git.file('profile/interest-scope.md'), after);
  assert.deepEqual(world.git.subjects('main').slice(-2), [
    'Interest scope changed by your Correction on Ancher 2.0, Mon Oct 12',
    "Miner day Mon 2026-10-12 PT: Ancher 2.0's Correction changed the Interest scope, 0 Dossiers, line 7",
  ]);
  const path = 'profile/interest-scope.md';
  assert.equal(world.discord.cards(NEEDS_YOU)[0]!.text, `✓ Interest scope changed · [${path}](${world.git.webUrl}/blob/main/${path})`);
  assert.ok(world.git.file('days/2026-10-12.md')!.includes('is no use to me at all.", changed the Interest scope\n'));
  assert.deepEqual(world.git.file('rules/miner/notes-tools.md'), undefined, 'no Rule, and no case');

  // The next day's runs judge against it.
  const requests = world.model.requests.length;
  await world.advanceTo('2026-10-13T08:00:00Z'); // 01:00 PDT
  const oct13 = world.model.requests.slice(requests).filter(opensJudgingRun);
  assert.equal(oct13.length, 4);
  for (const request of oct13) assert.ok(said(request, 'user').includes(`Interest scope:\n<<<\n${after.trim()}\n>>>`));
  assert.deepEqual(world.discord.refused, []);
});

test('a Correction asking for what a Hard limit forbids is declined on its day line, naming the limit, with no card', async (t) => {
  const world = await dayPosted(t);
  await world.advanceTo('2026-10-12T16:15:00Z'); // 09:15 PDT
  rejudges(world, ANCHER, { fit: 4, notAProduct: false, reason: 'knowledge workspace you can only join a waitlist for' });
  const limit = 'No cancelling an account or waitlist spot, no unsubscribing, and never suggesting either';
  // The drafter first names the limit in its own words, and is told to name it as listed.
  world.model.sort = () => sorted('declined', { hardLimit: 'No cancelling waitlist spots' });
  world.model.sortAgain = () => sorted('declined', { hardLimit: limit });

  await correct(world, 'Ancher 2.0', 'It is only a waitlist. From now on, cancel my spot on any waitlist like this.');
  await world.assistant.whenIdle();

  const request = world.model.requests.find((r) => opensRun(r) && r.tools.includes('record_sort'))!;
  assert.ok(said(request, 'user').includes(`The Hard limits, which no Correction or Rule can change:\n`), 'the run is given the Hard limits');
  assert.ok(said(request, 'user').includes(`\n- ${limit}`));
  assert.equal(world.model.sortingRuns[0]!.sortReplies[0], 'hardLimit must be one of the Hard limits, exactly as the message lists it.');
  assert.deepEqual(world.discord.cards(NEEDS_YOU), [], 'nothing waits on the person');
  assert.equal(
    lineOf(world, 'Ancher 2.0').line.text,
    `**[Ancher 2.0](${ph('ancher-2-0')})** · Skip · fit 4 after your Correction · knowledge workspace you can only join a waitlist for` +
      `\n-# was Skip · fit 6 · you wrote “It is only a waitlist. From now on, cancel my spot on any waitlist like this.” · declined: a Hard limit forbids it (${limit})`,
  );
  assert.ok(world.git.file('days/2026-10-12.md')!.includes(`cancel my spot on any waitlist like this.", declined: a Hard limit forbids it (${limit})\n`));
  assert.equal(world.git.subjects('main').at(-1), "Miner day Mon 2026-10-12 PT: Ancher 2.0's Correction is declined, 0 Dossiers, line 7");
  assert.deepEqual(world.discord.refused, []);
});

test('Keep is refused while the Rule would take its runs past the Rule budget, and the card stays open saying why', async (t) => {
  const world = await dayPosted(t, [], (config) => (config.rules.budgetTokens = 50));
  await world.advanceTo('2026-10-12T16:15:00Z'); // 09:15 PDT
  rejudges(world, ANCHER, { fit: 4, notAProduct: false, reason: 'knowledge workspace you can only join a waitlist for' });
  world.model.sort = () => sorted('rule', { rule: { ...WAITLIST, scope: 'miner', amends: false } });
  await correct(world, 'Ancher 2.0', 'You can only join a waitlist for it. A waitlist is no open signup, so it is further off.');
  await world.assistant.whenIdle();
  const subjects = world.git.subjects('main');

  await tapCard(world, world.discord.cards(NEEDS_YOU)[0]!, 'Keep');
  await world.assistant.whenIdle();

  const [card] = world.discord.cards(NEEDS_YOU);
  const why = card!.text.match(/\n-# Not kept: keeping it would put the Rules of Miner runs at about ([\d,]+) tokens, past the Rule budget of about 50\. Edit it shorter, or Discard it\.$/);
  assert.ok(why, card!.text);
  const tokens = Number(why[1]!.replace(/,/g, ''));
  assert.ok(tokens > 50, `${tokens} tokens`);
  assert.deepEqual(
    card!.buttons.map((b) => [b.label, b.disabled]),
    [
      ['Keep', false],
      ['Edit', false],
      ['Discard', false],
    ],
    'the card stays open',
  );
  assert.equal(world.git.file('rules/miner/waitlist-isnt-open-signup.md'), undefined);
  assert.deepEqual(world.git.subjects('main'), subjects, 'nothing is committed');

  // ops/upgrade raises the Rule budget to what the Rule takes, and Keep then keeps it.
  await world.outage('2026-10-12T17:00:00Z', (config) => (config.rules.budgetTokens = tokens));
  await tapCard(world, world.discord.cards(NEEDS_YOU)[0]!, 'Keep');
  await world.assistant.whenIdle();
  assert.ok(world.git.file('rules/miner/waitlist-isnt-open-signup.md'));
  assert.match(world.discord.cards(NEEDS_YOU)[0]!.text, /^✓ Rule kept · /);
  assert.deepEqual(world.discord.refused, []);
});

test('a kept Rule whose card Discord can’t edit yet is shown in git at once, and on its card at the next start', async (t) => {
  const { world, card } = await ruleProposed(t);
  world.discord.uneditable.add(NEEDS_YOU);

  await tapCard(world, card, 'Keep');
  await world.assistant.whenIdle();

  assert.ok(world.git.file('rules/miner/waitlist-isnt-open-signup.md'));
  assert.ok(world.git.file('days/2026-10-12.md')!.includes(`taught the Rule "${WAITLIST.name}"\n`), 'the item’s history shows it');
  assert.ok(world.discord.cards(NEEDS_YOU)[0]!.text.endsWith('\n-# Keeping…'), 'the card still says it is being kept');

  world.discord.uneditable.delete(NEEDS_YOU);
  await world.restart();
  assert.match(world.discord.cards(NEEDS_YOU)[0]!.text, /^✓ Rule kept · \*\*Waitlist isn't open signup\*\* · Miner · /);
  assert.deepEqual(world.git.subjects('main').filter((s) => s.startsWith('Rule kept')), [`Rule kept: ${WAITLIST.name} (Miner)`], 'kept once');
});

test('a Keep the bot is killed in, once its Rule file is queued, is done at the next start: one commit, and nothing says Not kept', async (t) => {
  const { world, card } = await ruleProposed(t);
  const path = 'rules/miner/waitlist-isnt-open-signup.md';
  // GitHub takes the push of the Rule's commit and never answers, so the bot stands between queuing the file and
  // shrinking the card.
  world.git.holdPushes = true;

  await tapCard(world, card, 'Keep');
  await until(() => world.git.connections().some((c) => c.held));
  world.git.holdPushes = false;
  await world.kill();

  assert.equal(world.git.file(path), undefined, 'GitHub doesn’t hold the Rule yet');
  assert.ok(world.discord.cards(NEEDS_YOU)[0]!.text.endsWith('\n-# Keeping…'), 'the card still says it is being kept');

  await world.restart();

  assert.ok(world.git.file(path)!.includes(WAITLIST.statement), 'GitHub holds the Rule');
  assert.deepEqual(world.git.subjects('main').filter((s) => s.startsWith('Rule kept')), [`Rule kept: ${WAITLIST.name} (Miner)`], 'in one commit');
  const [shrunk, ...others] = world.discord.cards(NEEDS_YOU);
  assert.match(shrunk!.text, /^✓ Rule kept · \*\*Waitlist isn't open signup\*\* · Miner · /);
  assert.deepEqual(others, []);
  assert.deepEqual(world.logs.filter((l) => l.event === 'proposal.not-kept'), [], 'nothing says Not kept');
  assert.ok(!world.git.file('days/2026-10-12.md')!.includes('Not kept'));
  assert.deepEqual(world.discord.refused, []);
});

test('a proposal’s card Discord refuses outright goes out at the Corrections’ next try, once', async (t) => {
  const world = await dayPosted(t);
  await world.advanceTo('2026-10-12T16:15:00Z'); // 09:15 PDT
  rejudges(world, ANCHER, { fit: 4, notAProduct: false, reason: 'knowledge workspace you can only join a waitlist for' });
  world.model.sort = () => sorted('rule', { rule: { ...WAITLIST, scope: 'miner', amends: false } });
  world.discord.refuseNextMessage(NEEDS_YOU);

  await correct(world, 'Ancher 2.0', 'You can only join a waitlist for it. A waitlist is no open signup, so it is further off.');
  await world.assistant.whenIdle();

  assert.deepEqual(world.discord.refused.map((r) => r.path), [`/channels/${NEEDS_YOU}/messages`], 'Discord refused the card');
  assert.deepEqual(world.discord.cards(NEEDS_YOU), []);
  assert.ok(world.logs.some((l) => l.event === 'correction.unsorted'), 'the sort’s work is left to do');

  await world.advanceTo('2026-10-12T16:45:00Z'); // the Corrections' next try, 30 minutes on

  const [card, ...others] = world.discord.cards(NEEDS_YOU);
  assert.ok(card!.text.includes(WAITLIST.statement), 'the card went out');
  assert.deepEqual(others, []);
  assert.equal(world.model.sortingRuns.length, 1, 'from the sort already made');

  await world.advanceTo('2026-10-12T17:15:00Z');
  await world.restart();
  assert.equal(world.discord.cards(NEEDS_YOU).length, 1, 'once');
  assert.equal(world.discord.refused.length, 1);
});

test('an Interest scope change too long to show on one card is turned back, and the Correction stays fix only', async (t) => {
  const world = await dayPosted(t);
  // The person's Interest scope has grown long: its Want section shown twice would pass Discord's 4,000 characters.
  const wants = Array.from({ length: 24 }, (_, i) => `- Want ${i + 1}: ${'tools that run from a terminal on my own Linux server '.repeat(2).trim()}.`);
  const scope = ['## Want', ...wants, '', "## Don't want", '- Sales.', '', '## Leans', '- A free plan counts for more.', ''].join('\n');
  world.git.commitAsPerson('profile/interest-scope.md', scope, 'Say more of what I want');
  await world.advanceTo('2026-10-12T16:15:00Z'); // 09:15 PDT
  rejudges(world, ANCHER, { fit: 3, notAProduct: false, reason: 'knowledge workspace that keeps your notes in; no export' });
  world.model.sort = () => sorted('interest-scope', { changes: [{ section: 'Want', remove: null, add: 'Notes I can export.' }] });

  await correct(world, 'Ancher 2.0', 'A notes tool I can’t export from is no use to me at all.');
  await world.assistant.whenIdle();

  assert.equal(
    world.model.sortingRuns[0]!.sortReplies[0],
    'That proposal is too long to show on one Discord card. Sort the Correction otherwise.',
  );
  assert.deepEqual(world.discord.cards(NEEDS_YOU), []);
  assert.equal(world.git.file('profile/interest-scope.md'), scope);
  assert.ok(world.git.file('days/2026-10-12.md')!.includes(`is no use to me at all.", fix only, as it couldn't be sorted: its run recorded no sort\n`));
  assert.deepEqual(world.discord.refused, []);
});

test('Keep is refused when git changed what it would replace since the proposal, and the card says so', async (t) => {
  const world = await dayPosted(t);
  const path = 'rules/miner/waitlist-isnt-open-signup.md';
  world.git.commitAsPerson(path, `# ${WAITLIST.name}\n\n${WAITLIST.statement}\n`, 'Keep the waitlist Rule');
  await world.advanceTo('2026-10-12T16:15:00Z'); // 09:15 PDT
  rejudges(world, ANCHER, { fit: 3, notAProduct: false, reason: 'knowledge workspace that keeps your notes in; no export' });
  rejudges(world, EXCALICLAW, { fit: 4, notAProduct: false, reason: 'diagram workspace for agents; invite-only beta' });
  const amendment = `${WAITLIST.statement} An invite-only beta counts too.`;
  world.model.sort = (run) =>
    run.postIds.includes(ANCHER)
      ? sorted('interest-scope', { changes: [{ section: "Don't want", remove: null, add: 'Notes tools with no export.' }] })
      : sorted('rule', { rule: { name: WAITLIST.name, statement: amendment, scope: 'miner', amends: true } });
  await correct(world, 'Ancher 2.0', 'A notes tool I can’t export from is no use to me.');
  await correct(world, 'ExcaliClaw', 'An invite-only beta is no open signup either.');
  await world.assistant.whenIdle();
  const [scopeCard, ruleCard] = world.discord.cards(NEEDS_YOU);

  // Meanwhile the person changes both files on GitHub.
  const scope = `${INTEREST_SCOPE.trimEnd()}\n- Working offline counts for more.\n`;
  world.git.commitAsPerson('profile/interest-scope.md', scope, 'Add a Lean');
  const reworded = `# ${WAITLIST.name}\n\nA waitlist-only Launch is judged two Fit lower.\n`;
  world.git.commitAsPerson(path, reworded, 'Reword the waitlist Rule');
  await tapCard(world, scopeCard!, 'Keep');
  await tapCard(world, ruleCard!, 'Keep');
  await world.assistant.whenIdle();

  const [scopeNow, ruleNow] = world.discord.cards(NEEDS_YOU);
  assert.ok(
    scopeNow!.text.endsWith('\n-# Not kept: the Interest scope changed in git since this was proposed. Discard it, and Correct again for a new proposal.'),
    scopeNow!.text,
  );
  assert.ok(
    ruleNow!.text.endsWith(`\n-# Not kept: the Rule "${WAITLIST.name}" changed in git since this was proposed. Discard this, and Correct again for a new proposal.`),
    ruleNow!.text,
  );
  assert.equal(world.git.file('profile/interest-scope.md'), scope, 'the person’s edits stand');
  assert.equal(world.git.file(path), reworded);
  assert.deepEqual(world.discord.refused, []);
});

test('Keep is refused while a Rule of the same name is kept, and a new Rule never takes another Rule’s file', async (t) => {
  const { world, card } = await ruleProposed(t);
  // Since the proposal, the person kept a Rule of the same name in the all scope, and wrote another in a file the
  // Rule renamed below would take.
  world.git.commitAsPerson('rules/all/waitlists.md', `# ${WAITLIST.name}\n\nNever count a waitlist as signup.\n`, 'Add a Rule');
  world.git.commitAsPerson('rules/miner/waitlist-is-no-signup.md', '# Something else\n\nJudge hardware at 0.\n', 'Add a Rule');

  await tapCard(world, card, 'Keep');
  await world.assistant.whenIdle();
  const refusedCard = world.discord.cards(NEEDS_YOU)[0]!;
  assert.ok(
    refusedCard.text.endsWith(`\n-# Not kept: a Rule named "${WAITLIST.name}" is kept already, in rules/all/waitlists.md. Edit this one's name, or Discard it.`),
    refusedCard.text,
  );

  const popup = popupOf(await tapCard(world, refusedCard, 'Edit'))!;
  await world.discord.submitPopup({
    userId: PERSON,
    customId: popup.customId,
    channelId: NEEDS_YOU,
    messageId: card.id,
    fields: { name: 'Waitlist is no signup', statement: WAITLIST.statement },
  });
  await tapCard(world, world.discord.cards(NEEDS_YOU)[0]!, 'Keep');
  await world.assistant.whenIdle();

  assert.ok(world.git.file('rules/miner/waitlist-is-no-signup-2.md')!.endsWith(`\n# Waitlist is no signup\n\n${WAITLIST.statement}\n`));
  assert.equal(world.git.file('rules/miner/waitlist-is-no-signup.md'), '# Something else\n\nJudge hardware at 0.\n');
  assert.match(world.discord.cards(NEEDS_YOU)[0]!.text, /^✓ Rule kept · \*\*Waitlist is no signup\*\* · Miner · \[rules\/miner\/waitlist-is-no-signup-2\.md\]/);
  assert.deepEqual(world.discord.refused, []);
});

test('an Interest scope too long for a pop-up can’t be edited on Discord, but its change can still be kept', async (t) => {
  const world = await dayPosted(t);
  const wants = Array.from({ length: 40 }, (_, i) => `- Want ${i + 1}: ${'tools that run from a terminal on my own Linux server '.repeat(2).trim()}.`);
  const scope = ['## Want', ...wants, '', "## Don't want", '- Sales.', '', '## Leans', '- A free plan counts for more.', ''].join('\n');
  assert.ok(scope.length > 4000, `${scope.length} characters`);
  world.git.commitAsPerson('profile/interest-scope.md', scope, 'Say more of what I want');
  await world.advanceTo('2026-10-12T16:15:00Z'); // 09:15 PDT
  rejudges(world, ANCHER, { fit: 3, notAProduct: false, reason: 'knowledge workspace that keeps your notes in; no export' });
  world.model.sort = () => sorted('interest-scope', { changes: [{ section: 'Leans', remove: null, add: 'An export of my notes counts for more.' }] });
  await correct(world, 'Ancher 2.0', 'A notes tool I can’t export from is no use to me at all.');
  await world.assistant.whenIdle();

  const [card] = world.discord.cards(NEEDS_YOU);
  const edit = await tapCard(world, card!, 'Edit');
  assert.ok((edit.data?.flags ?? 0) & EPHEMERAL);
  assert.equal(edit.data?.content, 'It is too long to edit on Discord. Keep or Discard it, then edit profile/interest-scope.md in git.');

  await tapCard(world, card!, 'Keep');
  await world.assistant.whenIdle();
  assert.equal(world.git.file('profile/interest-scope.md'), scope.replace('- A free plan counts for more.\n', '- A free plan counts for more.\n- An export of my notes counts for more.\n'));
  assert.deepEqual(world.discord.refused, []);
});
