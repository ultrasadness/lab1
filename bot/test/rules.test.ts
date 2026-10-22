// Rules reaching runs (#49): each kept Rule is a file in the Personal database, `rules/<scope>/<slug>.md`, and our
// Pi extension puts every Rule in a run's scope into its prompt at the start, the all scope's with them. A record
// names the Rules it applied, and the day line and the Dossier's foot show them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCTS_FORUM, startWorld } from './harness/world.ts';
import { fixtureDay } from './harness/fake-product-hunt.ts';
import { opensJudgingRun, opensRun, said, sorted } from './harness/fake-model.ts';
import { CODEMIND, serveProduct } from './harness/dossier-fixtures.ts';
import { correct, dayPosted, lineOf, rejudges } from './harness/miner-day.ts';

const ph = (slug: string) => `https://www.producthunt.com/posts/${slug}`;
const ANCHER = '1266729';

/** A Rule file as the person might write it in git, with the front matter a kept Rule has. */
const ruleFile = (scope: string, name: string, statement: string) =>
  ['---', `scope: ${scope}`, 'taught-on: written in git', 'case: unproven', 'created: 2026-10-11', '---', '', `# ${name}`, '', statement, ''].join('\n');

const WAITLIST = {
  path: 'rules/miner/waitlist-isnt-open-signup.md',
  name: "Waitlist isn't open signup",
  statement: 'A Launch that only lets you join a waitlist is no open signup: judge it two Fit lower than if anyone could sign up now.',
};
const PLAIN_WORDS = {
  path: 'rules/all/plain-words.md',
  name: 'Plain words',
  statement: 'Write every free-text field in plain words, with no marketing language.',
};
const OFFER_DEADLINES = {
  path: 'rules/dossier/offer-deadlines.md',
  name: 'Offer deadlines',
  statement: 'Give every Offer its deadline as a date, or say that none is stated.',
};

test('a Miner Rule the person commits in git loads into every later Miner run, and the line it changed names it', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' }); // 00:30 PDT
  t.after(() => world.stop());
  for (const rule of [WAITLIST, PLAIN_WORDS, OFFER_DEADLINES]) {
    const scope = rule.path.split('/')[1]!;
    world.git.commitAsPerson(rule.path, ruleFile(scope, rule.name, rule.statement), `Add the Rule ${rule.name}`);
  }
  // A Rule the person wrote with no front matter or heading loads too, known by its file's name.
  world.git.commitAsPerson('rules/all/short-reasons.md', 'Keep every reason under 15 words.\n', 'Add a Rule');
  const commit = world.git.head();
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([]);
  const standIn = world.model.judgment;
  world.model.judgment = (postId) =>
    postId === ANCHER ? { fit: 4, notAProduct: false, reason: 'knowledge workspace you can only join a waitlist for', rulesApplied: [WAITLIST.name] } : standIn(postId);

  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT

  // Each judging run's prompt holds the Miner and all-scope Rules, whole, and no other scope's.
  const opening = world.model.requests.filter(opensJudgingRun);
  assert.equal(opening.length, 3);
  for (const request of opening) {
    const system = said(request, 'system');
    assert.ok(system.includes(`Rule: ${WAITLIST.name}\n`), system);
    assert.ok(system.includes(WAITLIST.statement));
    assert.ok(system.includes(`Rule: ${PLAIN_WORDS.name}\n`));
    assert.ok(system.includes(PLAIN_WORDS.statement));
    assert.ok(system.includes('\nRule: short-reasons\nScope: all\nKeep every reason under 15 words.'));
    assert.ok(!system.includes(OFFER_DEADLINES.statement), 'a Dossier Rule stays out of Miner runs');
  }
  // Each run logs the commit of the Rules it loaded.
  const loaded = world.logs.filter((l) => l.event === 'run.rules-loaded');
  assert.equal(loaded.length, 3);
  for (const entry of loaded) {
    assert.equal(entry.commit, commit);
    assert.deepEqual(entry.rules, [PLAIN_WORDS.name, 'short-reasons', WAITLIST.name]);
  }

  // The line the Rule changed ends naming it, on Discord and in the day's file.
  assert.equal(
    lineOf(world, 'Ancher 2.0').line.text,
    `**[Ancher 2.0](${ph('ancher-2-0')})** · Skip · fit 4 · knowledge workspace you can only join a waitlist for (Rule: ${WAITLIST.name})`,
  );
  assert.ok(lineOf(world, 'ExcaliClaw').line.text.endsWith('generous free plan'), 'a line no Rule changed names none');
  const file = world.git.file('days/2026-10-12.md')!;
  assert.ok(
    file.includes(`- [Ancher 2.0](${ph('ancher-2-0')}) · Skip · fit 4 · knowledge workspace you can only join a waitlist for · Rules applied: Waitlist isn't open signup\n`),
    file,
  );
  assert.deepEqual(world.discord.refused, []);
});

test('a Dossier Rule the person commits in git loads into the next Dossier run, and the Dossier’s foot names it', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' }); // 00:30 PDT
  t.after(() => world.stop());
  for (const rule of [WAITLIST, PLAIN_WORDS, OFFER_DEADLINES]) {
    const scope = rule.path.split('/')[1]!;
    world.git.commitAsPerson(rule.path, ruleFile(scope, rule.name, rule.statement), `Add the Rule ${rule.name}`);
  }
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId]);
  serveProduct(world, CODEMIND);
  const plain = world.model.dossier;
  world.model.dossier = (run) => {
    const d = plain(run);
    return d === 'none' ? d : { ...d, rulesApplied: [OFFER_DEADLINES.name, PLAIN_WORDS.name] };
  };

  await world.advanceTo('2026-10-12T08:00:00Z'); // 01:00 PDT

  // The Dossier run's prompt holds the Dossier and all-scope Rules, and no Miner Rule.
  const [request, ...others] = world.model.requests.filter((r) => opensRun(r) && r.tools.includes('record_dossier'));
  assert.deepEqual(others, []);
  const system = said(request!, 'system');
  assert.ok(system.includes(`Rule: ${OFFER_DEADLINES.name}\n`), system);
  assert.ok(system.includes(OFFER_DEADLINES.statement));
  assert.ok(system.includes(PLAIN_WORDS.statement));
  assert.ok(!system.includes(WAITLIST.statement), 'a Miner Rule stays out of Dossier runs');

  // The foot names them, in the order the record gave, on Discord and in git.
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  const dossier = post!.messages[0]!.text;
  assert.ok(dossier.includes('\n-# Rules applied: Offer deadlines, Plain words · read 01:00 PT Mon Oct 12 · '), dossier);
  assert.ok(world.git.file('products/codemindhq.dev/dossier.md')!.includes('<sub>Rules applied: Offer deadlines, Plain words · read 2026-10-12 01:00 PT · '));
  assert.deepEqual(world.discord.refused, []);
});

test('a record naming a Rule its run didn’t load is turned back, and a Rule it loaded is named as its file names it', async (t) => {
  const world = await dayPosted(t);
  for (const rule of [WAITLIST, OFFER_DEADLINES]) {
    const scope = rule.path.split('/')[1]!;
    world.git.commitAsPerson(rule.path, ruleFile(scope, rule.name, rule.statement), `Add the Rule ${rule.name}`);
  }
  await world.advanceTo('2026-10-12T16:15:00Z'); // 09:15 PDT
  rejudges(world, ANCHER, { fit: 4, notAProduct: false, reason: 'knowledge workspace you can only join a waitlist for', rulesApplied: ["WAITLIST  isn't open signup"] });
  world.model.sort = () => sorted('fix-only', { rulesApplied: [OFFER_DEADLINES.name] });
  world.model.sortAgain = () => sorted('fix-only');

  await correct(world, 'Ancher 2.0', 'You can only join a waitlist for it.');
  await world.assistant.whenIdle();

  assert.match(lineOf(world, 'Ancher 2.0').line.text, / · knowledge workspace you can only join a waitlist for \(Rule: Waitlist isn't open signup\)\n-# was /);
  assert.deepEqual(world.model.sortingRuns[0]!.sortReplies, [
    `rulesApplied names "${OFFER_DEADLINES.name}", which isn't one of this run's Rules. This run's Rules are: ${WAITLIST.name}.`,
    'Recorded the sort.',
  ]);
});
