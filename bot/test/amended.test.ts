// The amended Walkthrough (#115, #10, #12): a page that newly asks for something, a required field with no approved
// value, other terms or a new box asking for agreement, or another host, goes back to the person as a new version of
// the Walkthrough they approved, showing only what the page asks for. Its Approval lets filling resume on that page in
// the same session, and the person's Edit of a proposed value is a Correction. Each test reads what Discord, the
// browser, the model provider, GitHub and the log saw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEEDS_YOU, PERSON, PRODUCTS_FORUM, type World } from './harness/world.ts';
import { approve, walkthroughPut, WITH_PASSWORD } from './harness/walkthrough-day.ts';
import { finish, plainFill, said, sorted } from './harness/fake-model.ts';
import { popupOf, updateOf, type SeenMessage } from './harness/fake-discord.ts';
import { logged, registrationFile, standing, statusOf, tapCard } from './harness/registration-views.ts';
import type { FakeField, FakePage } from './harness/fake-browser.ts';
import type { FixtureProduct } from './harness/dossier-fixtures.ts';

const SIGNUP = WITH_PASSWORD.signup!;
const [EMAIL, PASSWORD, COMPANY] = SIGNUP.forms![0]!.fields as [FakeField, FakeField, FakeField];

/** Codemind with its signup page changed, as a test needs it. */
const codemind = (change: Partial<FakePage>): FixtureProduct => ({ ...WITH_PASSWORD, signup: { ...SIGNUP, ...change } });

/** Codemind's signup form with these fields and buttons. */
const form = (fields: FakeField[], submit = 'Create account') => [{ ...SIGNUP.forms![0]!, fields, submits: [{ label: submit, disabled: false }] }];

/** Codemind, whose form now requires its Company field, which the Walkthrough leaves empty. */
const COMPANY_REQUIRED = codemind({ forms: form([EMAIL, PASSWORD, { ...COMPANY, required: true }]) });

const presses = (world: World) => world.browser.presses;
const laterCards = (world: World) => world.discord.cards(NEEDS_YOU).slice(1);

/** The person taps Edit beside a proposed value of a card, by the field's label, and sends the pop-up with `value`. */
async function edit(world: World, card: SeenMessage, field: string, value: string) {
  const line = card.lines.find((l) => l.text.startsWith(`+ **${field}** · `));
  if (!line?.button) throw new Error(`No Edit beside ${field}: ${card.text}`);
  const opened = await world.discord.tap({ userId: PERSON, customId: line.button.customId, channelId: NEEDS_YOU, messageId: card.id });
  const popup = popupOf(opened)!;
  const sent = await world.discord.submitPopup({ userId: PERSON, customId: popup.customId, channelId: NEEDS_YOU, messageId: card.id, fields: { [popup.fields[0]!.customId]: value } });
  return { opened, sent };
}

test('a required field nobody approved comes back as an amended Walkthrough, and its Approval fills that page in the same session', async (t) => {
  const world = await walkthroughPut(t, COMPANY_REQUIRED, { before: (w) => (w.model.amendment = () => ({ fields: [{ field: 1, fill: 'value', value: 'Personal' }], rulesApplied: [] })) });
  await approve(world);
  await world.assistant.whenIdle();

  assert.deepEqual(presses(world), [], 'nothing is pressed while the page asks for more');
  const [run] = world.model.amendmentRuns;
  assert.match(run!.prompt, /^Page 1 of the signup form of this Product requires the fields below/m);
  assert.match(run!.prompt, /^Field 1 \(text, required\): Company$/m);

  const [card, ...more] = laterCards(world);
  assert.equal(more.length, 0);
  assert.deepEqual(card!.mentions, [PERSON]);
  assert.match(card!.text, /^<@\d+> \*\*Amended Walkthrough v2 · Codemind\*\*\nPage 1 of Codemind's signup form asks for what v1 didn't approve, so the Assistant pressed nothing there\./);
  assert.deepEqual(
    card!.lines.filter((l) => l.button).map((l) => [l.text, l.button!.label]),
    [['+ **Company** · Personal (required on page 1)', 'Edit']],
    'only what the page asks for, with an Edit beside its value',
  );
  assert.match(card!.text, /\*\*What v1 approved:\*\* Email · you\+codemind@gmail\.com; Password · new random one; Company · left empty/);
  assert.match(card!.text, /Values proposed from your Profile and the Dossier/);
  assert.match(card!.text, /Left alone, it closes 01:00 PT Tue Oct 13, 24 hours after its Approval/);
  assert.deepEqual(card!.buttons.map((b) => b.label), ['Approve', 'Stop']);
  assert.equal(standing(world), 'page 1 failed the page check');
  const copies = () => world.discord.forumPosts(PRODUCTS_FORUM)[0]!.messages.filter((m) => m.text.startsWith('**Amended Walkthrough'));
  assert.deepEqual(copies().map((m) => [m.text.split('\n')[0], m.silent, m.buttons.length]), [[`**Amended Walkthrough v2** · put to you in <#${NEEDS_YOU}> 01:00 PT Mon Oct 12`, true, 0]], 'a copy in the post');

  const reply = await tapCard(world, -1, 'Approve');
  await world.assistant.whenIdle();

  assert.match(updateOf(reply)!.text, /^✓ Codemind · amended Walkthrough v2 approved 01:00 PT Mon Oct 12 · <#\d+>$/);
  const [press, ...again] = presses(world);
  assert.equal(again.length, 0);
  assert.deepEqual(press!.values, { email: 'you+codemind@gmail.com', password: press!.values.password, company: 'Personal' });
  assert.equal(world.browser.sessions.length, 1, 'filled in the same session');
  assert.equal(press!.session, world.browser.sessions[0]!.id);
  assert.equal(world.model.fillRuns.at(-1)!.page, 1, 'filling resumed on that page');
  assert.match(standing(world), /awaiting verification$/);
  assert.match(statusOf(world).text, / · Walkthrough v1 approved 01:00 PT Mon Oct 12, amended by v2, as you\+codemind@gmail\.com/);
  assert.match(registrationFile(world), /^- 2026-10-12 01:00 PT · amended Walkthrough v2 approved: page 1 asked for Company$/m);
  assert.deepEqual(logged(world, 'registration.amended').map((l) => [l.page, l.version]), [[1, 2]]);
});

test('a fill run names the button of a page whose required field has no approved value, which it can’t call stuck, and the page check puts it to the person', async (t) => {
  const world = await walkthroughPut(t, COMPANY_REQUIRED, { before: (w) => (w.model.amendment = () => ({ fields: [{ field: 1, fill: 'value', value: 'Personal' }], rulesApplied: [] })) });
  // The model first stops at the empty Company, as the fill run's instructions once told it to.
  world.model.fill = (run, snapshot) => (run.snapshots === 1 ? [finish({ result: 'stuck', reason: 'value-missing' }), { tool: 'snapshot', args: {} }] : plainFill(run.prompt, snapshot));
  await approve(world);
  await world.assistant.whenIdle();

  const [fill] = world.model.fillRuns;
  const [refused, ...finishes] = fill!.fillReplies.filter((r) => r.tool === 'finish');
  assert.doesNotMatch(refused!.reply, /^Finished/, 'value-missing is no reason a fill run may give');
  assert.match(finishes.at(-1)!.reply, /^Finished/);
  const system = said(world.model.requests.find((r) => r.tools.includes('finish'))!, 'system');
  assert.match(system, /a required one the Walkthrough gives no value included: plain code's page check finds it once you name the button/);
  assert.doesNotMatch(system, /value-missing/);
  assert.match(laterCards(world)[0]!.text, /^<@\d+> \*\*Amended Walkthrough v2 · Codemind\*\*/);
});

test('a page whose check fails only on fields the Walkthrough gives values, which the fill run left empty, is filled again, with nothing put to the person', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  // The first fill run names the button without filling the email and password the Walkthrough approves.
  world.model.fill = (run, snapshot) => (world.model.fillRuns.indexOf(run) === 0 ? [finish({ result: 'button', button: 'b1' })] : plainFill(run.prompt, snapshot));
  await approve(world);
  await world.assistant.whenIdle();

  assert.deepEqual(world.model.amendmentRuns, []);
  assert.deepEqual(laterCards(world), [], 'nothing waits on the person');
  assert.deepEqual(world.model.fillRuns.map((r) => r.page), [1, 1]);
  assert.deepEqual(presses(world).map((p) => p.values.email), ['you+codemind@gmail.com']);
  assert.deepEqual(logged(world, 'registration.filled-again').map((l) => l.page), [1]);
});

test('a page that asks again for what an approved amended Walkthrough left empty gets an amended Walkthrough of its own, which is approved too', async (t) => {
  // The run has no value to propose, and the person approves the version as it stands, twice.
  const world = await walkthroughPut(t, COMPANY_REQUIRED);
  await approve(world);
  await world.assistant.whenIdle();
  assert.ok(laterCards(world)[0]!.lines.some((l) => l.text === '+ **Company** · no value proposed: Edit to give one (required on page 1)'));

  for (const version of [2, 3]) {
    const reply = await tapCard(world, -1, 'Approve');
    await world.assistant.whenIdle();
    assert.match(updateOf(reply)!.text, new RegExp(`^✓ Codemind · amended Walkthrough v${version} approved`));
    assert.match(laterCards(world).at(-1)!.text, new RegExp(`^<@\\d+> \\*\\*Amended Walkthrough v${version + 1} · Codemind\\*\\*`), 'the page asks again');
  }
  assert.match(registrationFile(world), /amended Walkthrough v3 approved: page 1 asked for Company$/m);
  assert.deepEqual(logged(world, 'discord.interaction-failed'), []);
  assert.deepEqual(presses(world), []);
});

test("the person's Edit of a proposed value is a Correction: a new version on the same card, sorted under the Walkthrough Rules, and its Approval fills that value", async (t) => {
  const COMPANY_RULE = { name: 'Company on forms', statement: 'Give Acme Labs as the company a signup form asks for.' };
  const world = await walkthroughPut(t, COMPANY_REQUIRED, { before: (w) => (w.model.amendment = () => ({ fields: [{ field: 1, fill: 'value', value: 'Personal' }], rulesApplied: [] })) });
  world.model.sort = () => sorted('rule', { rule: { ...COMPANY_RULE, scope: 'registration', amends: false } });
  await approve(world);
  await world.assistant.whenIdle();
  const v2 = laterCards(world)[0]!;

  const { opened, sent } = await edit(world, v2, 'Company', 'Acme Labs');
  const popup = popupOf(opened)!;
  assert.deepEqual([popup.title, popup.fields.map((f) => [f.label, f.value])], ['Edit · Company', [['Company', 'Personal']]]);
  const v3 = updateOf(sent)!;
  assert.match(v3.text, /^<@\d+> \*\*Amended Walkthrough v3 · Codemind\*\*/, 'a new version, on the same card');
  assert.ok(v3.lines.some((l) => l.text === '+ **Company** · Acme Labs (required on page 1)' && l.button?.label === 'Edit'));
  assert.match(v3.text, /-# v3: you edited Company, which counts as a Correction\./);
  await world.assistant.whenIdle();
  assert.equal(laterCards(world).length, 2, 'the same card, and the proposed Rule after it');
  const copies = world.discord.forumPosts(PRODUCTS_FORUM)[0]!.messages.filter((m) => m.text.startsWith('**Amended Walkthrough'));
  assert.deepEqual(copies.map((m) => m.text.split(' · ')[0]), ['**Amended Walkthrough v2**', '**Amended Walkthrough v3**'], 'each version gets its copy in the post');

  // Its sorting run is given the version before the Edit, what changed, and the version after.
  const [sorting] = world.model.sortingRuns;
  assert.match(sorting!.prompt, /Company should be “Acme Labs”, not “Personal”/);
  assert.match(sorting!.prompt, /\+ \*\*Company\*\* · Personal \(required on page 1\)[\s\S]*\+ \*\*Company\*\* · Acme Labs \(required on page 1\)/);
  const proposal = laterCards(world)[1]!;
  assert.ok(proposal.text.startsWith(`<@${PERSON}> **Proposed Rule · not an Approval**\n**${COMPANY_RULE.name}** · `), proposal.text);

  // A tap on Approve as the card showed v2, before the Edit, approves nothing.
  const stale = await world.discord.tap({ userId: PERSON, customId: v2.buttons.find((b) => b.label === 'Approve')!.customId, channelId: NEEDS_YOU, messageId: v2.id });
  assert.match(JSON.stringify(stale), /earlier version/);
  assert.deepEqual(presses(world), []);

  await tapCard(world, 1, 'Approve');
  await world.assistant.whenIdle();
  assert.equal(presses(world).at(-1)!.values.company, 'Acme Labs');
  const file = registrationFile(world);
  assert.match(file, /^- 2026-10-12 01:00 PT · amended Walkthrough v2 corrected by your Edit: Company should be “Acme Labs”, not “Personal”, as v3/m);
  assert.match(file, /^- 2026-10-12 01:00 PT · amended Walkthrough v3 approved: page 1 asked for Company$/m);
});

/** Page 2 of the form, which the Walkthrough never saw, at this URL with these fields. */
const page2 = (url: string, fields: FakeField[]): FakePage => ({
  url,
  title: 'Step 2',
  text: 'Step 2 of creating your account',
  forms: [{ formElement: true, action: null, method: 'post', fields, submits: [{ label: 'Create account', disabled: false }], links: [] }],
});

/** Codemind, whose page 1 now leads with Continue to this page 2. */
async function twoPages(t: { after(fn: () => Promise<void>): void }, page: FakePage): Promise<World> {
  const world = await walkthroughPut(t, codemind({ forms: form([EMAIL, PASSWORD, COMPANY], 'Continue'), next: page.url }), { before: (w) => w.browser.page(page) });
  await approve(world);
  await world.assistant.whenIdle();
  return world;
}

test('new terms on a later page come back as an amended Walkthrough linking them, with no run, and its Approval accepts them there', async (t) => {
  // The page ticks a box, or turns on a switch, accepting its own Data Terms, which v1 never linked; the page check
  // judges a switch as a box (browser/test/page-check.test.ts).
  for (const type of ['checkbox', 'switch']) {
    await t.test(type, async (t) => {
      const box: FakeField = { type, name: 'data-terms', label: 'I accept the Data Terms', required: false, autocomplete: null, links: [{ text: 'Data Terms', href: 'https://codemindhq.dev/data-terms' }], checked: true };
      const world = await twoPages(t, page2('https://app.codemindhq.dev/step-2', [box]));

      assert.deepEqual(presses(world).map((p) => p.button), ['Continue'], "page 2's button isn't pressed");
      assert.deepEqual(world.model.amendmentRuns, [], 'plain code proposes ticking a box, so no run');
      const [card] = laterCards(world);
      assert.match(card!.text, /^<@\d+> \*\*Amended Walkthrough v2 · Codemind\*\*\nPage 2 of Codemind's signup form asks for what v1 didn't approve/);
      assert.ok(card!.lines.some((l) => l.text === '+ **I accept the Data Terms** · ticked (on page 2)' && l.button?.label === 'Edit'), 'a box the page ticked, and needs no tick');
      assert.match(card!.text, /\n\+ \*\*Terms\*\* · you accept \[Data Terms\]\(https:\/\/codemindhq\.dev\/data-terms\)/);
      assert.doesNotMatch(card!.text, /Values proposed from your Profile/);

      await tapCard(world, -1, 'Approve');
      await world.assistant.whenIdle();
      const [, pressed] = presses(world);
      assert.deepEqual([pressed!.button, pressed!.values['data-terms']], ['Create account', 'ticked']);
      const checks = world.browser.sessionRequests.filter((r) => r.path === '/plain-code/press');
      assert.deepEqual(checks.at(-1)!.body.terms, ['https://codemindhq.dev/data-terms'], "page 2's press takes the terms the person approved");
      assert.match(registrationFile(world), /amended Walkthrough v2 approved: page 2 asked for I accept the Data Terms, the terms at https:\/\/codemindhq\.dev\/data-terms$/m);
    });
  }
});

test('a required box the person left unticked, and a choice whose approved option a later page no longer offers, are asked about again', async (t) => {
  await t.test('a required box left unticked', async (t) => {
    const box: FakeField = { type: 'checkbox', name: 'data-terms', label: 'I accept the Data Terms', required: true, autocomplete: null, links: [{ text: 'Data Terms', href: 'https://codemindhq.dev/data-terms' }] };
    const world = await twoPages(t, page2('https://app.codemindhq.dev/step-2', [box]));
    const { sent } = await edit(world, laterCards(world)[0]!, 'I accept the Data Terms', 'left unticked');
    assert.match(updateOf(sent)!.text, /Amended Walkthrough v3/);
    await world.assistant.whenIdle();
    await tapCard(world, 1, 'Approve');
    await world.assistant.whenIdle();

    // The page still requires it, so it asks again, and nothing is filled again on its own (settled by the person on #115).
    assert.deepEqual(logged(world, 'registration.filled-again'), []);
    const again = laterCards(world).at(-1)!;
    assert.match(again.text, /^<@\d+> \*\*Amended Walkthrough v4 · Codemind\*\*/);
    assert.ok(again.lines.some((l) => l.text === '+ **I accept the Data Terms** · ticked (required on page 2)'));
    assert.deepEqual(presses(world).map((p) => p.button), ['Continue']);
  });

  await t.test('an option no longer offered', async (t) => {
    const role = (options: string[], required: boolean): FakeField => ({ type: 'select', name: 'role', label: 'Role', required, autocomplete: null, links: [], options: options.map((label) => ({ label, value: label.toLowerCase(), selected: false })) });
    const world = await walkthroughPut(t, codemind({ forms: form([EMAIL, PASSWORD, COMPANY, role(['Developer', 'Manager'], false)]) }), {
      change: (w) => ({ ...w, fields: w.fields.map((f) => (f.field === 4 ? { field: 4, fill: 'choice', value: 'Developer' } : f)) }),
      before: (w) => (w.model.amendment = () => ({ fields: [{ field: 1, fill: 'choice', value: 'Engineer' }], rulesApplied: [] })),
    });
    // Since the read, the form requires its Role, and offers other ones.
    world.browser.page({ ...SIGNUP, forms: form([EMAIL, PASSWORD, COMPANY, role(['Engineer', 'Manager'], true)]) });
    world.model.fill = (run, snapshot) => (world.model.fillRuns.indexOf(run) === 0 ? [finish({ result: 'button', button: 'b1' })] : plainFill(run.prompt, snapshot));
    await approve(world);
    await world.assistant.whenIdle();

    assert.deepEqual(logged(world, 'registration.filled-again'), [], 'Developer is no option of the page, so it is no value the field takes');
    assert.match(world.model.amendmentRuns[0]!.prompt, /^Field 1 \(select, required; options Engineer \/ Manager\): Role$/m);
    assert.ok(laterCards(world)[0]!.lines.some((l) => l.text === '+ **Role** · Engineer (required on page 1)'));
  });
});

test("a link beside a field that isn't a box is no terms to accept, and a box the page ticks but doesn't require isn't called required", async (t) => {
  const help: FakeField = { type: 'text', name: 'team', label: 'Team name', required: true, autocomplete: null, links: [{ text: "What's this?", href: 'https://codemindhq.dev/help/teams' }] };
  const box: FakeField = { type: 'checkbox', name: 'data-terms', label: 'I accept the Data Terms', required: false, autocomplete: null, links: [{ text: 'Data Terms', href: 'https://codemindhq.dev/data-terms' }], checked: true };
  const world = await walkthroughPut(t, WITH_PASSWORD, { before: (w) => (w.model.amendment = () => ({ fields: [{ field: 1, fill: 'value', value: 'Platform' }], rulesApplied: [] })) });
  world.browser.page({ ...SIGNUP, forms: form([EMAIL, PASSWORD, COMPANY, help, box]) });
  await approve(world);
  await world.assistant.whenIdle();

  const [card] = laterCards(world);
  assert.deepEqual(
    card!.lines.filter((l) => l.button).map((l) => l.text),
    ['+ **Team name** · Platform (required on page 1)', '+ **I accept the Data Terms** · ticked (on page 1)'],
  );
  assert.match(card!.text, /\n\+ \*\*Terms\*\* · you accept \[Data Terms\]\(https:\/\/codemindhq\.dev\/data-terms\)/);
  assert.doesNotMatch(card!.text, /help\/teams/, 'the help link is no document to accept');
});

test('a later page on another host of the Product comes back as an amended Walkthrough naming it, and the check of that page takes it', async (t) => {
  const world = await twoPages(t, page2('https://codemindhq.dev/step-2', [{ type: 'text', name: 'team', label: 'Team', required: false, autocomplete: null, links: [] }]));

  const [card] = laterCards(world);
  assert.match(card!.text, /\n\+ \*\*Signup host\*\* · codemindhq\.dev, from page 2 on, in place of app\.codemindhq\.dev/);
  assert.deepEqual(card!.lines.filter((l) => l.button), [], 'nothing to edit');
  assert.deepEqual(card!.buttons.map((b) => b.label), ['Approve', 'Stop']);

  await tapCard(world, -1, 'Approve');
  await world.assistant.whenIdle();
  assert.deepEqual(presses(world).map((p) => [p.url, p.button]), [
    ['https://app.codemindhq.dev/', 'Continue'],
    ['https://codemindhq.dev/step-2', 'Create account'],
  ]);
  const presses_ = world.browser.sessionRequests.filter((r) => r.path === '/plain-code/press').map((r) => r.body.signupHost);
  assert.deepEqual(presses_, ['app.codemindhq.dev', 'codemindhq.dev']);
  assert.equal(world.browser.requestsTo('/session/domains'), 0, 'the host is on the Product’s root domain, which the session holds');
});

test('a page the session finds off its domains comes back as an amended Walkthrough naming its host, whose Approval adds it to the open session', async (t) => {
  const vendor: FakePage = { url: 'https://accounts.signin.example/sign-up', title: 'Sign up', text: 'Create your account · Secured by Signin', forms: form([EMAIL, PASSWORD]) };
  // Since the read, the signup page sends its visitors to an auth vendor's.
  const world = await walkthroughPut(t, WITH_PASSWORD);
  world.browser.page(vendor);
  world.browser.redirect(SIGNUP.url, vendor.url);
  await approve(world);
  await world.assistant.whenIdle();

  const [fill] = world.model.fillRuns;
  assert.match(fill!.fillReplies[0]!.reply, /off the Walkthrough's domains, so it goes to the person now/);
  const [card] = laterCards(world);
  assert.match(card!.text, /\n\+ \*\*Signup host\*\* · accounts\.signin\.example, from page 1 on, in place of app\.codemindhq\.dev/);
  assert.match(card!.text, /Page 1 is off the Walkthrough's domains, so plain code couldn't read what else it asks for/);
  assert.deepEqual(world.browser.sessions[0]!.domains, ['codemindhq.dev', 'app.codemindhq.dev']);

  await tapCard(world, -1, 'Approve');
  await world.assistant.whenIdle();
  assert.deepEqual(world.browser.sessions[0]!.domains, ['codemindhq.dev', 'app.codemindhq.dev', 'accounts.signin.example'], 'added to the open session');
  const [press] = presses(world);
  assert.deepEqual([press!.url, press!.session, press!.values.email], [vendor.url, world.browser.sessions[0]!.id, 'you+codemind@gmail.com']);
  assert.equal(world.browser.sessions.length, 1);
  assert.match(standing(world), /awaiting verification$/);
});

test("a page the session finds on a sign-in provider's host meets the oauth-only wall: Hand off with Google, and abandoned at once with any other", async (t) => {
  for (const [provider, url, says] of [
    ['Google', 'https://accounts.google.com/o/oauth2/v2/auth', /sign up on your own device with Google, choosing the Signup mailbox's own Google account/],
    ['GitHub', 'https://github.com/login/oauth/authorize', null],
  ] as const) {
    await t.test(provider, async (t) => {
      const signIn: FakePage = { url, title: `Sign in with ${provider}`, text: `Sign in with ${provider} to continue to Codemind`, forms: form([EMAIL], 'Next') };
      // Since the read, the signup page sends its visitors to the provider's sign-in (settled by the person on #115).
      const world = await walkthroughPut(t, WITH_PASSWORD);
      world.browser.page(signIn);
      world.browser.redirect(SIGNUP.url, signIn.url);
      await approve(world);
      await world.assistant.whenIdle();

      assert.deepEqual(logged(world, 'registration.wall-met').map((l) => l.wall), ['oauth-only']);
      assert.deepEqual(logged(world, 'registration.amended'), [], 'no amended Walkthrough names its host');
      assert.equal(world.browser.requestsTo('/session/domains'), 0);
      if (says) {
        const [card] = laterCards(world);
        assert.match(card!.text, says);
        assert.deepEqual(card!.buttons.map((b) => b.label), ['Hand off', 'Stop']);
      } else {
        assert.equal(standing(world), `**abandoned** · at a wall: it signs in only through ${provider}, whose mail would land outside the Signup mailbox`);
        assert.deepEqual(laterCards(world), []);
      }
    });
  }
});

test("a box the person edits to left unticked accepts none of its documents: the card names them no more, and the page's press takes none", async (t) => {
  const box: FakeField = { type: 'checkbox', name: 'data-terms', label: 'I accept the Data Terms', required: false, autocomplete: null, links: [{ text: 'Data Terms', href: 'https://codemindhq.dev/data-terms' }], checked: true };
  const world = await twoPages(t, page2('https://app.codemindhq.dev/step-2', [box]));
  const v2 = laterCards(world)[0]!;

  const { sent } = await edit(world, v2, 'I accept the Data Terms', 'left unticked');
  const v3 = updateOf(sent)!;
  assert.ok(v3.lines.some((l) => l.text === '+ **I accept the Data Terms** · left unticked (on page 2)'));
  assert.doesNotMatch(v3.text, /\+ \*\*Terms\*\*/, 'settled by the person on #115');
  await world.assistant.whenIdle();

  await tapCard(world, 1, 'Approve');
  await world.assistant.whenIdle();
  const [, pressed] = presses(world);
  assert.deepEqual([pressed!.button, pressed!.values['data-terms']], ['Create account', 'left unticked']);
  assert.deepEqual(world.browser.sessionRequests.filter((r) => r.path === '/plain-code/press').at(-1)!.body.terms, []);
  assert.match(registrationFile(world), /amended Walkthrough v3 approved: page 2 asked for I accept the Data Terms$/m);
});

test("an amended Walkthrough's copy that Discord refuses is sent again 5 minutes on", async (t) => {
  const world = await walkthroughPut(t, COMPANY_REQUIRED, { before: (w) => (w.model.amendment = () => ({ fields: [{ field: 1, fill: 'value', value: 'Personal' }], rulesApplied: [] })) });
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  const copies = () => world.discord.forumPosts(PRODUCTS_FORUM)[0]!.messages.filter((m) => m.text.startsWith('**Amended Walkthrough'));
  await approve(world);
  await world.assistant.whenIdle();
  // The status message went to the post at the Approval; the next message there is the copy, which Discord refuses.
  world.discord.refuseNextMessage(post!.id);
  const { sent } = await edit(world, laterCards(world)[0]!, 'Company', 'Acme Labs');
  assert.match(updateOf(sent)!.text, /Amended Walkthrough v3/);
  await world.assistant.whenIdle();
  assert.deepEqual(copies().map((m) => m.text.split(' · ')[0]), ['**Amended Walkthrough v2**']);
  assert.equal(logged(world, 'registration.amended-copy-unposted').length, 1);

  await world.advanceTo('2026-10-12T08:05:00Z');
  assert.deepEqual(copies().map((m) => m.text.split(' · ')[0]), ['**Amended Walkthrough v2**', '**Amended Walkthrough v3**']);
});

test('a page that fails on a value the person can see beside a required field nobody approved goes to the amended Walkthrough first, then to a Submit tap', async (t) => {
  // The page presets Company, which nobody approved, and requires a Role, which the Walkthrough never saw.
  const role: FakeField = { type: 'text', name: 'role', label: 'Role', required: true, autocomplete: null, links: [] };
  const world = await walkthroughPut(t, codemind({ forms: form([EMAIL, PASSWORD, { ...COMPANY, value: 'Acme Inc' }]) }), {
    before: (w) => (w.model.amendment = () => ({ fields: [{ field: 1, fill: 'value', value: 'Founder' }], rulesApplied: [] })),
  });
  // Since the read, the form asks for a Role too.
  world.browser.page({ ...SIGNUP, forms: form([EMAIL, PASSWORD, { ...COMPANY, value: 'Acme Inc' }, role]) });
  await approve(world);
  await world.assistant.whenIdle();

  const [card] = laterCards(world);
  assert.match(card!.text, /^<@\d+> \*\*Amended Walkthrough v2 · Codemind\*\*/, 'the press can’t pass while Role is empty (settled by the person on #59)');
  assert.deepEqual(card!.lines.filter((l) => l.button).map((l) => l.text), ['+ **Role** · Founder (required on page 1)'], 'only what the page newly asks for');
  assert.match(world.model.amendmentRuns[0]!.prompt, /^Field 1 \(text, required\): Role$/m);

  await tapCard(world, -1, 'Approve');
  await world.assistant.whenIdle();
  const tap = laterCards(world).at(-1)!;
  assert.match(tap.text, /^<@\d+> \*\*Submit\? · Codemind\*\*\nPage 1 holds what the Walkthrough didn't approve: unapproved-value on “Company”/);
  assert.deepEqual(presses(world), []);
  assert.equal(world.browser.sessions.length, 1);
});

test('an amended Walkthrough whose run records no values waits at Hand off and Stop, saying why', async (t) => {
  const world = await walkthroughPut(t, COMPANY_REQUIRED, { before: (w) => (w.model.amendment = () => 'none') });
  await approve(world);
  await world.assistant.whenIdle();

  assert.equal(world.model.amendmentRuns.length, 1);
  const [card, ...more] = laterCards(world);
  assert.equal(more.length, 0);
  assert.match(card!.text, /^<@\d+> \*\*A page check failed · Codemind\*\*\nPage 1 doesn't match the Walkthrough, so the Assistant didn't press its button: invalid \(valueMissing\) on “Company”\. Nothing was submitted\.\nIt couldn't be put to you as an amended Walkthrough: its run recorded no values\./);
  assert.deepEqual(card!.buttons.map((b) => b.label), ['Hand off', 'Stop']);
  assert.deepEqual(logged(world, 'registration.amended-unprepared').map((l) => l.why), ['its run recorded no values']);
});

/** A field whose label is all characters Discord would format, so that it takes twice its length on a card. */
const formatted = (n: number, required: boolean): FakeField => ({ type: 'text', name: `f${n}`, label: `${'|'.repeat(40)} ${n}`, required, autocomplete: null, links: [] });
/** A required box linking documents at long addresses, named in characters Discord would format. */
const box = (n: number, links: number): FakeField => ({
  type: 'checkbox',
  name: `box-${n}`,
  label: `${'|'.repeat(40)} box ${n}`,
  required: true,
  autocomplete: null,
  links: Array.from({ length: links }, (_, m) => ({ text: '*'.repeat(60), href: `https://codemindhq.dev/${`${n}${m}`.repeat(100).slice(0, 170)}` })),
});
/** The fields a Walkthrough approved, left empty, and the five a page then requires, for a card near Discord's limit. */
const APPROVED = Array.from({ length: 12 }, (_, n) => formatted(n + 1, false));
const ASKED = Array.from({ length: 5 }, (_, n) => formatted(20 + n, true));

test('a page that asks for a password the Walkthrough has none for, or for more than one card can hold, waits at Hand off and Stop, saying why', async (t) => {

  await t.test('a password', async (t) => {
    const world = await walkthroughPut(t, codemind({ forms: form([EMAIL]) }));
    // Since the read, the form asks for a password too, which the Walkthrough has no vault item for (ADR 0004).
    world.browser.page({ ...SIGNUP, forms: form([EMAIL, { ...PASSWORD, name: 'new-password', label: 'Choose a password' }]) });
    await approve(world);
    await world.assistant.whenIdle();

    assert.deepEqual(world.model.amendmentRuns, [], 'plain code proposes it, so no run');
    const [card, ...more] = laterCards(world);
    assert.equal(more.length, 0);
    assert.ok(card!.text.includes("It couldn't be put to you as an amended Walkthrough: page 1 asks for a password, and the approved Walkthrough has none."), card!.text);
    assert.deepEqual(card!.buttons.map((b) => b.label), ['Hand off', 'Stop']);
  });

  await t.test('a box linking a document at an address too long to show', async (t) => {
    const world = await walkthroughPut(t, codemind({ forms: form([EMAIL]) }));
    const long: FakeField = { type: 'checkbox', name: 'data-terms', label: 'I accept the Data Terms', required: true, autocomplete: null, links: [{ text: 'Data Terms', href: `https://codemindhq.dev/${'legal/'.repeat(40)}` }] };
    world.browser.page({ ...SIGNUP, forms: form([EMAIL, long]) });
    await approve(world);
    await world.assistant.whenIdle();

    const [card] = laterCards(world);
    assert.ok(card!.text.includes("It couldn't be put to you as an amended Walkthrough: the box “I accept the Data Terms” links a document whose address can't be shown whole."), card!.text);
    assert.deepEqual(card!.buttons.map((b) => b.label), ['Hand off', 'Stop']);
  });

  await t.test('more fields than a card holds Edits beside', async (t) => {
    const world = await walkthroughPut(t, codemind({ forms: form([EMAIL]) }));
    world.browser.page({ ...SIGNUP, forms: form([EMAIL, ...Array.from({ length: 9 }, (_, n) => formatted(30 + n, true))]) });
    await approve(world);
    await world.assistant.whenIdle();

    assert.deepEqual(world.model.amendmentRuns, [], 'no run is spent on a page no card can put to you');
    const [card] = laterCards(world);
    assert.ok(card!.text.includes("It couldn't be put to you as an amended Walkthrough: page 1 asks for 9 fields, more than one card can put to you."), card!.text);
  });

  await t.test('more than one card holds', async (t) => {
    const world = await walkthroughPut(t, codemind({ forms: form([EMAIL, ...APPROVED]) }), {
      before: (w) => (w.model.amendment = () => ({ fields: ASKED.map((_, i) => ({ field: i + 1, fill: 'value' as const, value: '*'.repeat(80) })), rulesApplied: [] })),
    });
    // Since the read, the form asks for five more fields and three boxes, which link five documents between them.
    world.browser.page({ ...SIGNUP, forms: form([EMAIL, ...APPROVED, ...ASKED, box(1, 2), box(2, 2), box(3, 1)]) });
    await approve(world);
    await world.assistant.whenIdle();

    assert.equal(world.model.amendmentRuns.length, 1);
    const [card, ...more] = laterCards(world);
    assert.equal(more.length, 0);
    assert.ok(card!.text.includes("It couldn't be put to you as an amended Walkthrough: it doesn't fit on one Discord card."), card!.text);
    assert.deepEqual(card!.buttons.map((b) => b.label), ['Hand off', 'Stop']);
  });
});

test('an Edit whose value would make the card too long for Discord is refused, and the card stays the one to approve', async (t) => {
  const world = await walkthroughPut(t, codemind({ forms: form([EMAIL, ...APPROVED]) }), {
    before: (w) => (w.model.amendment = () => ({ fields: ASKED.map((_, i) => ({ field: i + 1, fill: 'value' as const, value: i < 3 ? '*'.repeat(80) : 'x' })), rulesApplied: [] })),
  });
  world.browser.page({ ...SIGNUP, forms: form([EMAIL, ...APPROVED, ...ASKED, box(1, 2), box(2, 2), box(3, 1)]) });
  await approve(world);
  await world.assistant.whenIdle();
  const v2 = laterCards(world)[0]!;
  assert.match(v2.text, /^<@\d+> \*\*Amended Walkthrough v2 · Codemind\*\*/, 'it fits as prepared');

  // A fourth value of 80 characters, each of which Discord would format, takes the card past its 4,000.
  const line = v2.lines.filter((l) => l.button)[3]!;
  const opened = await world.discord.tap({ userId: PERSON, customId: line.button!.customId, channelId: NEEDS_YOU, messageId: v2.id });
  const popup = popupOf(opened)!;
  const sent = await world.discord.submitPopup({ userId: PERSON, customId: popup.customId, channelId: NEEDS_YOU, messageId: v2.id, fields: { [popup.fields[0]!.customId]: '*'.repeat(80) } });
  assert.match(JSON.stringify(sent), /makes the card too long for Discord/);
  await world.assistant.whenIdle();
  assert.deepEqual(world.model.sortingRuns, [], 'no Correction was kept');

  const reply = await tapCard(world, -1, 'Approve');
  assert.match(updateOf(reply)!.text, /^✓ Codemind · amended Walkthrough v2 approved/);
});

test('an amended Walkthrough whose run has no provider left waits, starting no run, and is prepared once one is back', async (t) => {
  const world = await walkthroughPut(t, COMPANY_REQUIRED, { before: (w) => (w.model.amendment = () => ({ fields: [{ field: 1, fill: 'value', value: 'Personal' }], rulesApplied: [] })) });
  world.model.fault = (request) => (request.tools.includes('record_amendment') ? { answer: 'no-channel' } : undefined);
  await approve(world);
  await world.assistant.whenIdle();

  assert.deepEqual(laterCards(world), [], 'no card yet, and none with Hand off');
  assert.match(statusOf(world).text, /An amended Walkthrough of what it asks for is being prepared for you/);
  const runs = () => logged(world, 'run.started').filter((l) => l.kind === 'amended-walkthrough').length;
  assert.equal(runs(), 1);

  await world.advanceTo('2026-10-12T08:20:00Z'); // the lane tries again every 5 minutes
  assert.equal(runs(), 1, 'no run starts while no provider is left');

  world.model.fault = () => undefined;
  await world.advanceTo('2026-10-12T08:35:00Z'); // the provider is back at 01:30 PT
  assert.equal(runs(), 2);
  assert.match(laterCards(world)[0]!.text, /^<@\d+> \*\*Amended Walkthrough v2 · Codemind\*\*/);
});

test('Stop on an amended Walkthrough ends the Registration, and its card shrinks to say so', async (t) => {
  const world = await walkthroughPut(t, COMPANY_REQUIRED);
  await approve(world);
  await world.assistant.whenIdle();

  const reply = await tapCard(world, -1, 'Stop');
  await world.assistant.whenIdle();
  assert.match(updateOf(reply)!.text, /^✓ Codemind · stopped by you; nothing submitted · <#\d+>$/);
  assert.equal(standing(world), '**abandoned** · stopped by you; nothing submitted');
  assert.deepEqual(world.browser.openSessions, []);
  assert.deepEqual(presses(world), []);
});

test("approving an amended Walkthrough doesn't move the 24-hour clock, which runs from the Approval that started the Registration", async (t) => {
  const world = await walkthroughPut(t, COMPANY_REQUIRED, { before: (w) => (w.model.amendment = () => ({ fields: [{ field: 1, fill: 'value', value: 'Personal' }], rulesApplied: [] })) });
  // Once the amended Walkthrough is approved, the page shows a bot check, which waits on the person.
  world.model.fill = (run, snapshot) => (world.model.fillRuns.indexOf(run) === 0 ? plainFill(run.prompt, snapshot) : [finish({ result: 'wall', wall: 'bot-check' })]);
  await approve(world); // 01:00 PT Mon Oct 12
  await world.assistant.whenIdle();

  await world.advanceTo('2026-10-13T07:00:00Z'); // 00:00 PT Tue Oct 13
  await tapCard(world, 1, 'Approve');
  await world.assistant.whenIdle();
  assert.equal(standing(world), 'at a wall on page 1: bot-check');

  await world.advanceTo('2026-10-13T08:00:00Z'); // 24 hours after the Approval of v1
  assert.equal(standing(world), '**abandoned** · Closed after 24 hours; nothing was submitted');
  assert.deepEqual(world.browser.openSessions, []);
});
