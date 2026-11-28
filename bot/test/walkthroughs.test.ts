// Walkthroughs (#53): every Dossier whose Product is open or waitlisted gets a Walkthrough, prepared by a
// registration-role run from a read of the live signup page, the Dossier and the Profile, and put to the person in
// #needs-you for a one-tap Approval that starts the Registration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEEDS_YOU, PERSON, PRODUCTS_FORUM, PROFILE, startWorld, type World } from './harness/world.ts';
import { fixtureDay, websiteOf } from './harness/fake-product-hunt.ts';
import { opensRun, plainWalkthrough, said, sorted, type ScriptedWalkthrough } from './harness/fake-model.ts';
import { ACYCLIC, CODEMIND, serveProduct, type FixtureProduct } from './harness/dossier-fixtures.ts';
import { emailForm, type FakeField, type FakePage } from './harness/fake-browser.ts';
import { EPHEMERAL, ephemeralOf, popupOf, updateOf, type InteractionReply, type SeenMessage } from './harness/fake-discord.ts';
import { approve as approveDay, walkthroughPut as walkthroughOnDay, WITH_PASSWORD } from './harness/walkthrough-day.ts';

const SIGNUP_URL = 'https://app.codemindhq.dev/';

/** Codemind's signup form as a fuller form would be: names, email, password, a promo code and two boxes. */
const FULL_SIGNUP: FakePage = {
  url: SIGNUP_URL,
  title: 'Create your Codemind account',
  text: 'Create your Codemind account · First name · Last name · Email · Password · Promo code · Create account',
  botCheck: 'Turnstile',
  forms: [
    {
      formElement: true,
      action: null,
      method: 'post',
      fields: [
        { type: 'text', name: 'first', label: 'First name', required: true, autocomplete: 'given-name', links: [] },
        { type: 'text', name: 'last', label: 'Last name', required: true, autocomplete: 'family-name', links: [] },
        { type: 'email', name: 'email', label: 'Email', required: true, autocomplete: 'email', links: [] },
        { type: 'password', name: 'password', label: 'Password', required: true, autocomplete: 'new-password', links: [] },
        { type: 'text', name: 'promo', label: 'Promo code', required: false, autocomplete: null, links: [] },
        { type: 'checkbox', name: 'news', label: 'Send me product news', required: false, autocomplete: null, links: [] },
        {
          type: 'checkbox',
          name: 'terms',
          label: 'I agree to the Terms of Service and Privacy Policy',
          required: true,
          autocomplete: null,
          links: [
            { text: 'Terms of Service', href: 'https://codemindhq.dev/terms' },
            { text: 'Privacy Policy', href: 'https://codemindhq.dev/privacy' },
          ],
        },
      ],
      submits: [{ label: 'Create account', disabled: false }],
      links: [],
    },
  ],
};

/** Codemind with the fuller signup form, and an Offer code in its Maker comment that needs no card. */
const FULL_CODEMIND: FixtureProduct = {
  ...CODEMIND,
  signup: FULL_SIGNUP,
  dossier: {
    ...CODEMIND.dossier,
    offers: [
      ...CODEMIND.dossier.offers,
      { what: '50 more builds', code: 'PHBUILD', card: 'not needed', deadline: null, cap: null, condition: null, sources: ['maker-comment'] },
    ],
  },
};

/** What the model records for the fuller form: every field filled from the Profile, the Offer and the Signup identity. */
const FULL_WALKTHROUGH: ScriptedWalkthrough = {
  form: 1,
  fields: [
    { field: 1, fill: 'first-name', value: null },
    { field: 2, fill: 'last-name', value: null },
    { field: 3, fill: 'email', value: null },
    { field: 4, fill: 'password', value: null },
    { field: 5, fill: 'offer-code', value: 'PHBUILD' },
    { field: 6, fill: 'choice', value: 'left unticked' },
    { field: 7, fill: 'choice', value: 'ticked' },
  ],
  names: { first: 'Alex', last: 'Example' },
  button: 'Create account',
  onSubmit: 'verification-email',
  walls: [],
  providers: [],
  termsBan: null,
  authVendor: null,
  rulesApplied: [],
};

/**
 * A day posted at 01:00 PDT, Oct 12 unless another is given, with a Dossier for this Product alone, whose Walkthrough
 * the model records as given.
 */
async function walkthroughPut(
  t: { after(fn: () => Promise<void>): void },
  product: FixtureProduct,
  walkthrough: ScriptedWalkthrough | 'plain',
  options: { profile?: boolean; date?: string } = {},
): Promise<World> {
  const date = options.date ?? '2026-10-12';
  const world = await startWorld({ now: `${date}T07:30:00Z`, ...(options.profile === false ? { profile: false } : {}) }); // 00:30 PDT
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay(date), `${date}T07:01:00Z`);
  world.model.onlyDossiers([product.postId]);
  serveProduct(world, product);
  if (walkthrough !== 'plain') world.model.walkthrough = () => walkthrough;
  await world.advanceTo(`${date}T08:00:00Z`); // 01:00 PDT
  await world.discord.connected();
  return world;
}

/** The person taps a button below a card in #needs-you, by its label. */
function tapCard(world: World, card: SeenMessage, label: string): Promise<InteractionReply> {
  const button = card.buttons.find((b) => b.label === label);
  if (!button) throw new Error(`No ${label} button on the card`);
  return world.discord.tap({ userId: PERSON, customId: button.customId, channelId: NEEDS_YOU, messageId: card.id });
}

/** The person taps Edit beside a field of a card, by the field's label, and sends the pop-up with `value`. */
async function edit(world: World, card: SeenMessage, field: string, value: string): Promise<{ opened: InteractionReply; sent: InteractionReply }> {
  const line = card.lines.find((l) => l.text.startsWith(`**${field}** · `));
  if (!line?.button) throw new Error(`No Edit beside ${field}`);
  const opened = await world.discord.tap({ userId: PERSON, customId: line.button.customId, channelId: NEEDS_YOU, messageId: card.id });
  const popup = popupOf(opened)!;
  const sent = await world.discord.submitPopup({
    userId: PERSON,
    customId: popup.customId,
    channelId: NEEDS_YOU,
    messageId: card.id,
    fields: { [popup.fields[0]!.customId]: value },
  });
  return { opened, sent };
}

/** The card in #needs-you, as the person now sees it. */
const cardIn = (world: World, index = 0) => world.discord.cards(NEEDS_YOU)[index]!;

test('an Open Product’s Walkthrough goes to #needs-you, consequences first, and its post gets a copy and the Walkthrough tag', async (t) => {
  const world = await walkthroughPut(t, FULL_CODEMIND, FULL_WALKTHROUGH);

  // The Walkthrough is prepared from a read of the live signup page, after the Dossier's own.
  assert.deepEqual(world.browser.reads, [websiteOf(CODEMIND.postId), 'https://codemindhq.dev/pricing/', SIGNUP_URL, SIGNUP_URL]);
  const [run] = world.model.walkthroughRuns;
  assert.equal(run?.rootDomain, 'codemindhq.dev');
  const request = world.model.requests.find((r) => r.tools.includes('record_walkthrough'))!;
  assert.equal(request.model, 'registration@openrouter');
  assert.deepEqual(request.tools, ['record_walkthrough'], 'a Walkthrough preparation run is offered its record tool and nothing else');
  const prompt = said(request, 'user');
  for (const given of [PROFILE.trim(), 'Form 1 field 7 (checkbox, required): I agree to the Terms of Service and Privacy Policy', '50 more builds · code PHBUILD · no card']) {
    assert.ok(prompt.includes(given), `the run is given: ${given}`);
  }
  assert.match(prompt, /^Plain code saw a Turnstile bot check on load and no card fields\.$/m);

  const cards = world.discord.cards(NEEDS_YOU);
  assert.equal(cards.length, 1);
  const [card] = cards;
  assert.deepEqual(card!.mentions, [PERSON], 'the card notifies the person');
  assert.equal(
    card!.text,
    [
      `<@${PERSON}> **Walkthrough v1 · Codemind**`,
      'If you approve, the Assistant creates an account at **Codemind** on **app.codemindhq.dev** as **you+codemind@gmail.com**, and presses **Create account** itself if the filled form matches this Walkthrough. You accept [Terms of Service](https://codemindhq.dev/terms) and [Privacy Policy](https://codemindhq.dev/privacy).',
      '**What happens on submit:** a verification email.',
      '**Signup host:** app.codemindhq.dev',
      '**First name** · Alex',
      '**Last name** · Example',
      '**Email** · you+codemind@gmail.com, or you@gmail.com if the form refuses +',
      '**Password** · new random one, saved to Bitwarden › Registrations › Codemind',
      '**Promo code** · PHBUILD, from the Offer “50 more builds”',
      '**Send me product news** · left unticked',
      '**I agree to the Terms of Service and Privacy Policy** · ticked',
      "**Walls:** expect a bot check (Turnstile); you'll be asked to Take over.",
      '-# Rules applied: none · signup page read 01:00 PT Mon Oct 12',
    ].join('\n'),
  );
  assert.deepEqual(
    card!.lines.map((l) => [l.text.split(' · ')[0], l.button?.label]),
    [
      ['**First name**', 'Edit'],
      ['**Last name**', 'Edit'],
      ['**Promo code**', 'Edit'],
      ['**Send me product news**', 'Edit'],
      ['**I agree to the Terms of Service and Privacy Policy**', 'Edit'],
    ],
    'an Edit beside each field the person may change: never the Signup identity or the password',
  );
  assert.deepEqual(
    card!.buttons.map((b) => [b.label, b.disabled]),
    [
      ['Approve', false],
      ['Correct', false],
      ['Dismiss', false],
    ],
  );

  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.deepEqual(post!.tags, ['Walkthrough']);
  const [dossier, copy, ...rest] = post!.messages;
  assert.deepEqual(rest, []);
  assert.ok(
    dossier!.text
      .split('\n')
      .includes(
        `**Register:** Sign in with an emailed link or Google at app.codemindhq.dev; signing in creates the account. No card.⁴ ⁵ Walkthrough in <#${NEEDS_YOU}>.`,
      ),
    dossier!.text,
  );
  assert.ok(copy!.silent && copy!.mentionsNobody, 'the copy never notifies');
  assert.deepEqual([copy!.buttons, copy!.lines.filter((l) => l.button)], [[], []], 'the copy has no buttons');
  assert.equal(
    copy!.text,
    [`**Walkthrough v1** · put to you in <#${NEEDS_YOU}> 01:00 PT Mon Oct 12`, ...card!.text.split('\n').slice(1)].join('\n'),
  );
  assert.deepEqual(world.discord.refused, []);
});

test('Edit makes a new version of the same card with a fresh Approve, and Approve starts the Registration as queued', async (t) => {
  const world = await walkthroughPut(t, FULL_CODEMIND, FULL_WALKTHROUGH);
  await world.advanceTo('2026-10-12T16:00:00Z'); // 09:00 PDT
  const runs = world.model.runs.length;

  // A field's Edit is a one-field pop-up holding its value.
  const named = await edit(world, cardIn(world), 'First name', 'Sam');
  assert.deepEqual(popupOf(named.opened)?.fields.map((f) => [f.label, f.value, f.multiline]), [['First name', 'Alex', false]]);
  const v2 = updateOf(named.sent)!;
  assert.ok(v2.text.startsWith(`<@${PERSON}> **Walkthrough v2 · Codemind**\n`), v2.text);
  assert.ok(v2.text.split('\n').includes('**First name** · Sam'));
  assert.ok(v2.text.endsWith('-# Rules applied: none · signup page read 01:00 PT Mon Oct 12\n-# v2: you edited First name.'), v2.text);
  assert.deepEqual(v2.buttons.map((b) => [b.label, b.disabled]), [['Approve', false], ['Correct', false], ['Dismiss', false]], 'a fresh Approve');
  await world.assistant.whenIdle();

  // A choice's Edit is a radio group.
  const ticked = await edit(world, cardIn(world), 'Send me product news', 'ticked');
  const radio = popupOf(ticked.opened)!.fields[0]!;
  assert.deepEqual([radio.label, radio.options, radio.value], ['Send me product news', ['ticked', 'left unticked'], 'left unticked']);
  assert.ok(updateOf(ticked.sent)!.text.split('\n').includes('**Send me product news** · ticked'));
  await world.assistant.whenIdle();

  assert.equal(world.discord.cards(NEEDS_YOU).length, 1, 'the same card, edited in place');
  assert.equal(world.model.runs.length, runs, 'an Edit is no Correction: no run prepares or sorts anything');
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.deepEqual(
    post!.messages.slice(1).map((m) => m.text.split('\n')[0]),
    [
      `**Walkthrough v1** · put to you in <#${NEEDS_YOU}> 01:00 PT Mon Oct 12`,
      `**Walkthrough v2** · put to you in <#${NEEDS_YOU}> 09:00 PT Mon Oct 12`,
      `**Walkthrough v3** · put to you in <#${NEEDS_YOU}> 09:00 PT Mon Oct 12`,
    ],
    'the post gets a copy of each version',
  );

  await world.advanceTo('2026-10-12T16:03:00Z'); // 09:03 PDT
  // Every browser session is taken, so the Registration stays as Approve starts it, queued for one (#56).
  world.browser.occupy(5);
  const approved = await tapCard(world, cardIn(world), 'Approve');
  const locking = updateOf(approved)!;
  assert.deepEqual(locking.buttons.map((b) => b.disabled), [true, true, true], 'the tap answers with the buttons off');
  assert.ok(locking.lines.every((l) => l.button?.disabled), 'Edit too');
  await world.assistant.whenIdle();

  assert.equal(cardIn(world).text, `✅ Approved v3 09:03 · **Codemind** · <#${post!.id}>`, 'the card locks and shrinks to one line linking the post');
  assert.deepEqual(cardIn(world).buttons, []);
  const after = world.discord.forumPosts(PRODUCTS_FORUM)[0]!;
  assert.deepEqual(after.tags, ['Registering']);
  const status = after.messages.at(-1)!;
  assert.equal(
    status.text,
    '**Registration** · queued · Walkthrough v3 approved 09:03 PT Mon Oct 12, as you+codemind@gmail.com\n-# Waiting: all 5 browser sessions are in use. It is tried again by itself.',
  );
  assert.ok(status.silent && status.mentionsNobody, 'progress is silent');
  assert.deepEqual(status.buttons.map((b) => b.label), ['Stop', 'Correct']);
  assert.ok(after.messages[0]!.text.includes('No card.⁴ ⁵ Walkthrough v3 approved; registering.'), after.messages[0]!.text);
  assert.equal(
    world.git.file('products/codemindhq.dev/registration.md'),
    [
      '# Codemind · Delegate coding. Get back code that works. · Registration',
      '',
      '<!-- Appended by the bot at milestones from the live store. Edits here are not read back. -->',
      `- 2026-10-12 09:03 PT · Walkthrough v3 approved · Sam Example, you+codemind@gmail.com · password in the Password vault, item ${world.bitwarden.items[0]!.id}`,
      '',
    ].join('\n'),
  );
  assert.equal(world.git.subjects().at(-1), 'Registration file: Codemind (codemindhq.dev), Walkthrough v3 approved');

  // Stop ends a queued Registration before it has a session (#56).
  await world.discord.tap({ userId: PERSON, customId: status.buttons[0]!.customId, channelId: after.id, messageId: status.id });
  await world.assistant.whenIdle();
  assert.ok(world.discord.forumPosts(PRODUCTS_FORUM)[0]!.messages.at(-1)!.text.startsWith('**Registration** · **abandoned** · stopped by you; nothing submitted'));
  assert.deepEqual(world.browser.presses, []);
  assert.deepEqual(world.discord.refused, []);
});

test('a second Approve does nothing, and a tap on an older version is refused with the current one shown', async (t) => {
  const world = await walkthroughPut(t, FULL_CODEMIND, FULL_WALKTHROUGH);
  await world.advanceTo('2026-10-12T21:00:00Z'); // 14:00 PDT
  const v1 = cardIn(world);
  await edit(world, v1, 'Last name', 'Doe');
  await world.assistant.whenIdle();

  // A device still showing v1 taps its Approve.
  const stale = await tapCard(world, v1, 'Approve');
  const shown = ephemeralOf(stale)!;
  assert.ok((stale.data?.flags ?? 0) & EPHEMERAL, 'only the person sees it');
  assert.ok(shown.text.startsWith('Nothing was done: v1 is out of date. This is v2, the current version.\n'), shown.text);
  assert.ok(shown.text.includes('**Walkthrough v2 · Codemind**') && shown.text.includes('**Last name** · Doe'));
  assert.ok(shown.mentionsNobody);
  await world.assistant.whenIdle();
  assert.ok(cardIn(world).text.includes('**Walkthrough v2 · Codemind**'), 'nothing was approved');
  assert.deepEqual(world.discord.forumPosts(PRODUCTS_FORUM)[0]!.tags, ['Walkthrough']);

  // A double tap: the first approves, the second is told so and does nothing.
  await world.advanceTo('2026-10-12T21:03:00Z'); // 14:03 PDT
  const v2 = cardIn(world);
  const [first, second] = await Promise.all([tapCard(world, v2, 'Approve'), tapCard(world, v2, 'Approve')]);
  const answers = [first, second].map((r) => (r.type === 7 ? 'locked' : r.data?.content));
  assert.deepEqual(answers.sort(), ['Already approved at 14:03.', 'locked']);
  await world.assistant.whenIdle();
  const again = await world.discord.tap({ userId: PERSON, customId: v2.buttons[0]!.customId, channelId: NEEDS_YOU, messageId: v2.id });
  assert.equal(again.data?.content, 'Already approved at 14:03.');
  assert.ok((again.data?.flags ?? 0) & EPHEMERAL);
  const old = await world.discord.tap({ userId: PERSON, customId: v1.buttons[0]!.customId, channelId: NEEDS_YOU, messageId: v1.id });
  assert.equal(old.data?.content, 'v2 was approved at 14:03; nothing on it changes now.');
  await world.assistant.whenIdle();

  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.equal(post!.messages.filter((m) => m.text.startsWith('**Registration**')).length, 1, 'one Registration, one status message');
  assert.equal(cardIn(world).text, `✅ Approved v2 14:03 · **Codemind** · <#${post!.id}>`);
  assert.equal(world.git.file('products/codemindhq.dev/registration.md')!.match(/approved/g)?.length, 1);
  assert.deepEqual(world.discord.refused, []);
});

test('Correct turns Approve off at once, brings the new version as a new card, and is sorted under the Walkthrough Rules', async (t) => {
  const world = await walkthroughPut(t, FULL_CODEMIND, FULL_WALKTHROUGH);
  const NAMES = { name: 'Names as on forms', statement: 'Fill in the full name the Profile gives for forms, never a nickname.' };
  world.git.commitAsPerson('rules/registration/plain-boxes.md', '# Plain boxes\n\nLeave every box about news unticked.\n', 'Add a Rule');
  world.git.commitAsPerson('rules/miner/waitlists.md', '# Waitlists\n\nJudge a waitlist two Fit lower.\n', 'Add a Rule');
  await world.advanceTo('2026-10-12T16:30:00Z'); // 09:30 PDT
  world.model.walkthrough = (run) =>
    run.prompt.includes('The person corrected Walkthrough v1')
      ? { ...FULL_WALKTHROUGH, names: { first: 'Alex', last: 'Doe' }, rulesApplied: ['Plain boxes'] }
      : FULL_WALKTHROUGH;
  world.model.sort = () => sorted('rule', { rule: { ...NAMES, scope: 'registration', amends: false } });
  const v1 = cardIn(world);

  const opened = await tapCard(world, v1, 'Correct');
  const popup = popupOf(opened)!;
  assert.deepEqual([popup.title, popup.fields.map((f) => f.label)], ['Correct · Walkthrough v1 · Codemind', ['What did it get wrong?']]);
  const sent = await world.discord.submitPopup({
    userId: PERSON,
    customId: popup.customId,
    channelId: NEEDS_YOU,
    messageId: v1.id,
    fields: { [popup.fields[0]!.customId]: 'My last name on forms is Doe.' },
  });
  const turnedOff = updateOf(sent)!;
  assert.deepEqual(turnedOff.buttons.map((b) => [b.label, b.disabled]), [['Approve', true], ['Correct', true], ['Dismiss', true]], 'Approve is off the moment it is sent');
  assert.ok(turnedOff.text.endsWith('-# Preparing it again after your Correction…'), turnedOff.text);
  await world.assistant.whenIdle();

  // A registration-role run prepares it again from the same read, given v1 as it was put to the person and the Correction.
  const [, again] = world.model.walkthroughRuns;
  assert.ok(again!.prompt.includes(`The person corrected Walkthrough v1, as it was put to them:\n<<<\n${v1.text.split('\n').slice(1).join('\n')}\n>>>`), again!.prompt);
  assert.ok(again!.prompt.includes('<<<\nMy last name on forms is Doe.\n>>>'));
  assert.equal(world.browser.reads.length, 4, 'no new read: the same read as v1');

  const [old, v2, proposal] = world.discord.cards(NEEDS_YOU);
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.equal(old!.text, `Replaced by v2 · **Codemind** · <#${post!.id}>`);
  assert.ok(v2!.text.startsWith(`<@${PERSON}> **Walkthrough v2 · Codemind**\n`));
  assert.deepEqual(v2!.mentions, [PERSON], 'the new version arrives as a new card');
  assert.ok(v2!.text.split('\n').includes('**Last name** · Doe'));
  assert.ok(v2!.text.endsWith('-# Rules applied: Plain boxes · signup page read 01:00 PT Mon Oct 12\n-# v2: prepared again after your Correction: “My last name on forms is Doe.”'), v2!.text);
  assert.deepEqual(v2!.buttons.map((b) => b.disabled), [false, false, false]);
  assert.equal(post!.messages.at(-1)!.text.split('\n')[0], `**Walkthrough v2** · put to you in <#${NEEDS_YOU}> 09:30 PT Mon Oct 12`);

  // Sorted as a Miner Correction is (#49), by a registration-role run loading the Walkthrough/Registration Rules.
  const sorting = world.model.requests.find((r) => opensRun(r) && r.tools.includes('record_sort'))!;
  assert.equal(sorting.model, 'registration@openrouter');
  const system = said(sorting, 'system');
  assert.ok(system.includes('Leave every box about news unticked.'), 'the run loads the Walkthrough/Registration Rules');
  assert.ok(!system.includes('Judge a waitlist two Fit lower.'), 'and not the Miner’s');
  const prompt = said(sorting, 'user');
  assert.ok(prompt.includes("The Correction's scope is registration, Walkthrough/Registration"), prompt);
  assert.ok(prompt.includes('<<<\nMy last name on forms is Doe.\n>>>'));
  assert.ok(proposal!.text.includes(`**${NAMES.name}** · Walkthrough/Registration`), proposal!.text);
  assert.ok(proposal!.text.includes('From your Correction on **Codemind Walkthrough** (Mon Oct 12)'), proposal!.text);
  const correctedLine = '- 2026-10-12 09:30 PT · Walkthrough v1 corrected: you wrote "My last name on forms is Doe.", prepared again as v2';
  assert.ok(world.git.file('products/codemindhq.dev/registration.md')!.includes(`${correctedLine}\n`));

  await tapCard(world, proposal!, 'Keep');
  await world.assistant.whenIdle();
  assert.ok(world.git.file('rules/registration/names-as-on-forms.md')!.includes(NAMES.statement));
  assert.ok(
    world.git.file('products/codemindhq.dev/registration.md')!.includes(`${correctedLine}; taught the Rule "${NAMES.name}"\n`),
    world.git.file('products/codemindhq.dev/registration.md'),
  );
  assert.equal(world.git.subjects().at(-1), 'Registration file: Codemind (codemindhq.dev), your Correction of Walkthrough v1 taught a Rule');

  // v1 can't be approved any more: the tap is refused, and v2 shown.
  const stale = await world.discord.tap({ userId: PERSON, customId: v1.buttons[0]!.customId, channelId: NEEDS_YOU, messageId: old!.id });
  assert.ok(ephemeralOf(stale)!.text.startsWith('Nothing was done: v1 is out of date. This is v2, the current version.'));
  assert.deepEqual(world.discord.refused, []);
});

test('Dismiss ends the Walkthrough with no Correction', async (t) => {
  const world = await walkthroughPut(t, FULL_CODEMIND, FULL_WALKTHROUGH);
  const runs = world.model.runs.length;
  const card = cardIn(world);
  const dismissed = await tapCard(world, card, 'Dismiss');
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.equal(updateOf(dismissed)!.text, `Dismissed v1 · **Codemind** · <#${post!.id}>`);
  await world.assistant.whenIdle();

  assert.equal(world.model.runs.length, runs, 'nothing is sorted: Dismiss is no Correction');
  const after = world.discord.forumPosts(PRODUCTS_FORUM)[0]!;
  assert.deepEqual(after.tags, []);
  assert.ok(after.messages[0]!.text.includes('No card.⁴ ⁵ Walkthrough dismissed.'));
  assert.equal(
    world.git.file('products/codemindhq.dev/registration.md'),
    '# Codemind · Delegate coding. Get back code that works. · Registration\n\n<!-- Appended by the bot at milestones from the live store. Edits here are not read back. -->\nNo Registration yet.\n',
  );
  const late = await tapCard(world, card, 'Approve');
  assert.equal(late.data?.content, 'It was dismissed.');
  assert.deepEqual(world.discord.refused, []);
});

test('an unanswered Walkthrough lapses after 14 days, and Prepare again brings a fresh one from a new read', async (t) => {
  const world = await walkthroughPut(t, FULL_CODEMIND, FULL_WALKTHROUGH);
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  await world.advanceTo('2026-10-26T07:59:00Z'); // 00:59 PDT, 14 days less a minute
  assert.deepEqual(cardIn(world).buttons.map((b) => b.label), ['Approve', 'Correct', 'Dismiss'], 'not lapsed yet');

  await world.advanceTo('2026-10-26T08:00:00Z');
  const lapsed = cardIn(world);
  assert.deepEqual(
    lapsed.buttons.map((b) => [b.label, b.disabled]),
    [
      ['Approve', true],
      ['Correct', true],
      ['Dismiss', true],
      ['Prepare again', false],
    ],
  );
  assert.ok(lapsed.lines.every((l) => l.button?.disabled));
  assert.ok(lapsed.text.endsWith('-# Lapsed: unanswered for 14 days.'), lapsed.text);
  assert.deepEqual(world.discord.forumPosts(PRODUCTS_FORUM)[0]!.tags, []);
  assert.ok(world.discord.forumPosts(PRODUCTS_FORUM)[0]!.messages[0]!.text.includes('No card.⁴ ⁵ Walkthrough lapsed, unanswered for 14 days.'));
  assert.equal((await tapCard(world, lapsed, 'Approve')).data?.content, 'It lapsed. Tap Prepare again for a fresh one.');

  await world.advanceTo('2026-10-26T16:00:00Z'); // 09:00 PDT
  const reads = world.browser.reads.length;
  const preparing = updateOf(await tapCard(world, lapsed, 'Prepare again'))!;
  assert.ok(preparing.buttons.every((b) => b.disabled));
  await world.assistant.whenIdle();

  assert.deepEqual(world.browser.reads.slice(reads), [SIGNUP_URL], 'a fresh read of the signup page');
  const [old, fresh] = world.discord.cards(NEEDS_YOU);
  assert.equal(old!.text, `Lapsed v1 · prepared again as v2 · **Codemind** · <#${post!.id}>`);
  assert.ok(fresh!.text.startsWith(`<@${PERSON}> **Walkthrough v2 · Codemind**\n`));
  assert.ok(fresh!.text.endsWith('-# Rules applied: none · signup page read 09:00 PT Mon Oct 26\n-# v2: prepared again from a fresh read, after v1 lapsed.'), fresh!.text);
  assert.deepEqual(world.discord.forumPosts(PRODUCTS_FORUM)[0]!.tags, ['Walkthrough']);
  assert.deepEqual(world.discord.refused, []);
});

test('a signup page whose form the read can’t see gets a Walkthrough of the standard keys alone', async (t) => {
  const world = await walkthroughPut(
    t,
    ACYCLIC,
    { ...plainWalkthrough(''), form: null, walls: ['oauth-only'], providers: ['Google', 'GitHub'] },
    { date: '2026-10-14' },
  );
  assert.match(said(world.model.requests.find((r) => r.tools.includes('record_walkthrough'))!, 'user'), /^Forms: none seen\.$/m);
  const card = cardIn(world);
  assert.equal(
    card.text,
    [
      `<@${PERSON}> **Walkthrough v1 · Acyclic**`,
      "If you approve, the Assistant creates an account at **Acyclic** on **acyclic.dev** as **you+acyclic@gmail.com**, and presses the form's button itself if the filled form matches this Walkthrough. You accept the terms its form shows, which the read found no link to.",
      '**What happens on submit:** a verification email.',
      '**Signup host:** acyclic.dev',
      '**First name** · Alex',
      '**Last name** · Example',
      '**Email** · you+acyclic@gmail.com, or you@gmail.com if the form refuses +',
      '**Password** · new random one, saved to Bitwarden › Registrations › Acyclic',
      'Form not seen: carries only the standard keys.',
      "**Walls:** sign-in only through Google or GitHub; you'll be asked to Hand off, signing in with the Signup mailbox's own Google account.",
      '-# Rules applied: none · signup page read 01:00 PT Wed Oct 14',
    ].join('\n'),
  );
  assert.deepEqual(card.lines.map((l) => l.text.split(' · ')[0]), ['**First name**', '**Last name**']);
  assert.deepEqual(world.discord.refused, []);
});

test('with no Profile in the Personal database, the names are left empty and the card says where to add them', async (t) => {
  const world = await walkthroughPut(t, FULL_CODEMIND, { ...FULL_WALKTHROUGH, names: { first: null, last: null } }, { profile: false });
  assert.match(said(world.model.requests.find((r) => r.tools.includes('record_walkthrough'))!, 'user'), /^Profile: none\. There is no profile\/profile\.md, so no names are known\.$/m);
  const text = cardIn(world).text.split('\n');
  assert.deepEqual(
    text.filter((l) => l.startsWith('**First name**') || l.startsWith('**Last name**')),
    ['**First name** · left empty, as your Profile gives no name (`profile/profile.md`)', '**Last name** · left empty, as your Profile gives no name (`profile/profile.md`)'],
  );
});

test('a wall nothing can get past means no Walkthrough, and the Dossier says why', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  const [GUILDS, DROPSTONE, CUBE] = ['1274741', '1277000', '1276516'];
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([GUILDS, DROPSTONE, CUBE, CODEMIND.postId]);
  serveProduct(world, CODEMIND);
  // guilds.run's signup page asks for a card, which plain code sees itself.
  world.browser.page({ url: `https://app.p${GUILDS}.example/signup`, title: 'Start your trial', text: 'Card number', forms: [emailForm('Start trial')], paymentFields: true });
  const walls: Record<string, Pick<ScriptedWalkthrough, 'walls' | 'providers'>> = {
    [`p${DROPSTONE}.example`]: { walls: ['free-email'], providers: [] },
    [`p${CUBE}.example`]: { walls: ['oauth-only'], providers: ['GitHub'] },
    'codemindhq.dev': { walls: ['invite-only'], providers: [] },
  };
  world.model.walkthrough = (run) => ({ ...plainWalkthrough(run.prompt), ...walls[run.rootDomain!]! });
  await world.advanceTo('2026-10-12T08:00:00Z');

  assert.deepEqual(
    world.model.walkthroughRuns.map((r) => r.rootDomain).sort(),
    ['codemindhq.dev', `p${CUBE}.example`, `p${DROPSTONE}.example`],
    'no run for card fields, which plain code saw',
  );
  assert.deepEqual(world.discord.cards(NEEDS_YOU), [], 'no Walkthrough is offered');
  const why: Record<string, string> = {
    [`p${GUILDS}.example`]: 'its signup page asks for card details',
    [`p${DROPSTONE}.example`]: 'its signup form refuses gmail.com addresses',
    [`p${CUBE}.example`]: 'it signs in only through GitHub, whose mail would land outside the Signup mailbox',
    'codemindhq.dev': 'signing up needs an invite code, and none is known',
  };
  const posts = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.equal(posts.length, 4);
  for (const [root, reason] of Object.entries(why)) {
    const post = posts.find((p) => p.messages[0]!.text.includes(root === 'codemindhq.dev' ? 'codemindhq.dev' : root.split('.')[0]!))!;
    const register = post.messages[0]!.text.split('\n').find((l) => l.startsWith('**Register:**'))!;
    assert.ok(register.endsWith(` No Walkthrough: ${reason}.`), register);
    assert.deepEqual(post.tags, []);
    assert.equal(post.messages.length, 1, 'no copy, as there is no Walkthrough');
    assert.ok(world.git.file(`products/${root}/registration.md`)!.endsWith(`\nNo Registration: no Walkthrough, since ${reason}.\n`), root);
  }
  assert.deepEqual(world.discord.refused, []);
});

test('a Product whose terms ban bot-made accounts gets a Walkthrough that says Handoff, and Approval starts it handed off', async (t) => {
  const BAN = 'You may not create an account by automated means or with a bot.';
  const world = await walkthroughPut(t, FULL_CODEMIND, { ...FULL_WALKTHROUGH, termsBan: BAN });
  const card = cardIn(world);
  const [consequences, what] = card.text.split('\n').slice(1, 3);
  assert.equal(
    consequences,
    'If you approve, the Assistant saves a new random password to Bitwarden › Registrations › **Codemind**, and hands the Registration to you: you create the account at **Codemind** on **app.codemindhq.dev** as **you+codemind@gmail.com** yourself, with the values below. You accept [Terms of Service](https://codemindhq.dev/terms) and [Privacy Policy](https://codemindhq.dev/privacy).',
  );
  assert.equal(what, `**What happens:** a Handoff, since its terms ban accounts made by a bot: “${BAN}”`);

  await world.advanceTo('2026-10-12T16:03:00Z'); // 09:03 PDT
  await tapCard(world, card, 'Approve');
  await world.assistant.whenIdle();
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.deepEqual(post!.tags, ['handed off']);
  const status = post!.messages.at(-1)!;
  assert.equal(
    status.text,
    `**Registration** · handed off · Walkthrough v1 approved 09:03 PT Mon Oct 12. Its terms ban accounts made by a bot, so you finish it on your own device, as you+codemind@gmail.com. A Handoff card in <#${NEEDS_YOU}> gives you the steps.`,
  );
  assert.deepEqual(status.buttons, [], 'nothing to stop: the Assistant presses nothing');
  // A Handoff card gives the person the steps, the values and the password through AutoFill (#59).
  const handoff = world.discord.cards(NEEDS_YOU).at(-1)!;
  assert.match(handoff.text, /^<@\d+> \*\*Hand off · Codemind\*\*\nIts terms ban accounts made by a bot, so you sign up on your own device\.\n1\. Open https:\/\/app\.codemindhq\.dev\/\.\n2\. Fill in the values you approved/);
  assert.ok(handoff.text.includes(`- Password: let AutoFill fill it from Bitwarden › Registrations › Codemind (item ${world.bitwarden.items[0]!.id})`), handoff.text);
  assert.ok(handoff.text.includes('Accept Terms of Service (https://codemindhq.dev/terms) and Privacy Policy (https://codemindhq.dev/privacy).'), handoff.text);
  assert.deepEqual(handoff.buttons.map((b) => b.label), ['Done']);
  assert.ok(post!.messages[0]!.text.includes('Walkthrough v1 approved; handed off to you.'));
  assert.ok(
    world.git
      .file('products/codemindhq.dev/registration.md')!
      .includes(`- 2026-10-12 09:03 PT · Walkthrough v1 approved · Alex Example, you+codemind@gmail.com · password in the Password vault, item ${world.bitwarden.items[0]!.id} · handed off: its terms ban accounts made by a bot\n`),
  );
  assert.deepEqual(world.discord.refused, []);
});

test('a form too long for an Edit beside every field gives the later ones none, and carries at most 15 fields', async (t) => {
  const question = (n: number): FakeField => ({ type: 'text', name: `q${n}`, label: `Question ${n}`, required: false, autocomplete: null, links: [] });
  const long: FakePage = {
    ...FULL_SIGNUP,
    botCheck: null,
    forms: [{ ...FULL_SIGNUP.forms![0]!, fields: [FULL_SIGNUP.forms![0]!.fields[2]!, FULL_SIGNUP.forms![0]!.fields[3]!, ...Array.from({ length: 16 }, (_, i) => question(i + 1))] }],
  };
  const world = await walkthroughPut(t, { ...FULL_CODEMIND, signup: long }, {
    ...FULL_WALKTHROUGH,
    fields: [
      { field: 1, fill: 'email', value: null },
      { field: 2, fill: 'password', value: null },
      ...Array.from({ length: 13 }, (_, i) => ({ field: i + 3, fill: 'value', value: `Answer ${i + 1}` })),
    ],
  });
  const prompt = said(world.model.requests.find((r) => r.tools.includes('record_walkthrough'))!, 'user');
  assert.ok(prompt.includes('Form 1: 3 more fields after these, left empty.'), 'the run is offered the first 15 fields alone');

  const card = cardIn(world);
  assert.ok(card.componentCount <= 40, `${card.componentCount} components`);
  const edits = card.lines.filter((l) => l.button?.label === 'Edit').map((l) => l.text.split(' · ')[0]);
  // 9 sections of 3 components each, beside the card's own 11: the container, its 6 texts, and a row of 3 buttons.
  assert.deepEqual(edits, Array.from({ length: 9 }, (_, i) => `**Question ${i + 1}**`), 'an Edit beside as many fields as Discord can hold');
  const text = card.text.split('\n');
  for (const n of [10, 11, 12, 13]) assert.ok(text.includes(`**Question ${n}** · Answer ${n}`), `Question ${n} is still shown, with no Edit`);
  assert.ok(!text.some((l) => l.startsWith('**Question 14**')), 'fields past the 15th are left out');
  assert.ok(card.text.endsWith('-# The form has 3 more fields after these, left empty.\n-# Correct to change a field with no Edit beside it.'), card.text);
  const copy = world.discord.forumPosts(PRODUCTS_FORUM)[0]!.messages[1]!;
  assert.ok(copy.text.endsWith('-# The form has 3 more fields after these, left empty.'), 'the copy has no Edit to speak of');
  assert.deepEqual(world.discord.refused, []);
});

test('a Correction its run can’t apply opens the card again saying why, and one that finds a wall withdraws the Walkthrough', async (t) => {
  const world = await walkthroughPut(t, FULL_CODEMIND, FULL_WALKTHROUGH);
  const correctWith = async (what: string) => {
    const card = cardIn(world, world.discord.cards(NEEDS_YOU).length - 1);
    const popup = popupOf(await tapCard(world, card, 'Correct'))!;
    await world.discord.submitPopup({ userId: PERSON, customId: popup.customId, channelId: NEEDS_YOU, messageId: card.id, fields: { what } });
    await world.assistant.whenIdle();
  };
  await world.advanceTo('2026-10-12T16:30:00Z'); // 09:30 PDT
  const sorts = world.model.sortingRuns.length;

  world.model.walkthrough = (run) => (run.prompt.includes('The person corrected') ? 'none' : FULL_WALKTHROUGH);
  await correctWith('Use my work name.');
  const reopened = cardIn(world);
  assert.equal(world.discord.cards(NEEDS_YOU).length, 1);
  assert.ok(reopened.text.endsWith("-# Your Correction couldn't be applied: its run recorded no Walkthrough. Correct again, or approve it as it stands."), reopened.text);
  assert.deepEqual(reopened.buttons.map((b) => b.disabled), [false, false, false]);
  assert.equal(world.model.sortingRuns.length, sorts, 'nothing redone, so nothing to sort');
  assert.ok(
    world.git
      .file('products/codemindhq.dev/registration.md')!
      .includes('- 2026-10-12 09:30 PT · Walkthrough v1 corrected: you wrote "Use my work name.", which couldn\'t be applied: its run recorded no Walkthrough\n'),
  );

  world.model.walkthrough = (run) => (run.prompt.includes('The person corrected') ? { ...FULL_WALKTHROUGH, walls: ['free-email'] } : FULL_WALKTHROUGH);
  await correctWith('It takes work email only.');
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.equal(cardIn(world).text, `No Walkthrough after your Correction of v1: its signup form refuses gmail.com addresses · **Codemind** · <#${post!.id}>`);
  assert.ok(post!.messages[0]!.text.includes('No Walkthrough: its signup form refuses gmail.com addresses.'));
  assert.deepEqual(post!.tags, []);
  assert.equal(world.model.sortingRuns.length, sorts + 1, 'the Correction is sorted');
  assert.ok(said(world.model.requests.filter((r) => opensRun(r) && r.tools.includes('record_sort')).at(-1)!, 'user').includes('<<<\nNo Walkthrough: its signup form refuses gmail.com addresses.\n>>>'));
  const file = world.git.file('products/codemindhq.dev/registration.md')!;
  assert.ok(file.includes('\nNo Registration: no Walkthrough, since its signup form refuses gmail.com addresses.\n'), file);
  assert.ok(file.includes('you wrote "It takes work email only.", so no Walkthrough is offered: its signup form refuses gmail.com addresses; fix only\n'), file);
  assert.deepEqual(world.discord.refused, []);
});

test('an Approval whose work Discord cut short is kept, and finished at the next start', async (t) => {
  const world = await walkthroughPut(t, FULL_CODEMIND, FULL_WALKTHROUGH);
  await world.advanceTo('2026-10-12T16:03:00Z'); // 09:03 PDT
  world.discord.uneditable.add(NEEDS_YOU);
  const answered = await tapCard(world, cardIn(world), 'Approve');
  assert.equal(answered.type, 7, 'the tap is answered: the Approval is kept before the answer goes out');
  await world.assistant.whenIdle();
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.equal(post!.messages.length, 2, 'no status message yet');
  assert.ok(cardIn(world).text.endsWith('-# Approving…'), 'the card is left as the answer drew it');
  assert.deepEqual(post!.tags, ['Walkthrough']);

  world.discord.uneditable.delete(NEEDS_YOU);
  await world.restart();
  assert.equal(cardIn(world).text, `✅ Approved v1 09:03 · **Codemind** · <#${post!.id}>`);
  const after = world.discord.forumPosts(PRODUCTS_FORUM)[0]!;
  assert.deepEqual(after.tags, ['Registering']);
  assert.equal(after.messages.filter((m) => m.text.startsWith('**Registration** · ')).length, 1, 'one status message');
  assert.ok(world.git.file('products/codemindhq.dev/registration.md')!.includes(`- 2026-10-12 09:03 PT · Walkthrough v1 approved · Alex Example, you+codemind@gmail.com · password in the Password vault, item ${world.bitwarden.items[0]!.id}\n`));
  assert.equal(world.model.walkthroughRuns.length, 1, 'nothing is prepared again');
  assert.deepEqual(world.discord.refused, []);
});

/** A signup form of 13 questions with long labels, a long button and three long terms links: as long as a card gets. */
const LONG_BUTTON = 'Create my account and accept everything this long button label says right here';
function longSignup(): FakePage {
  const label = (n: number) => `Please tell us your answer to question ${n} of our long onboarding survey`;
  const terms = (n: number) => ({ text: `The ${['Terms of Service', 'Privacy Policy', 'Acceptable Use Policy'][n - 1]} that come with this account`, href: `https://codemindhq.dev/legal/${'a'.repeat(160)}/${n}` });
  const form = FULL_SIGNUP.forms![0]!;
  return {
    ...FULL_SIGNUP,
    forms: [
      {
        ...form,
        fields: [
          form.fields[2]!,
          form.fields[3]!,
          ...Array.from({ length: 13 }, (_, i): FakeField => ({ type: 'text', name: `q${i}`, label: label(i + 1), required: false, autocomplete: null, links: [] })),
        ],
        submits: [{ label: LONG_BUTTON, disabled: false }],
        links: [terms(1), terms(2), terms(3)],
      },
    ],
  };
}

/** The long form's Walkthrough, each question answered with `value`, and every other part as long as it may be. */
const longWalkthrough = (value: (n: number) => string): ScriptedWalkthrough => ({
  ...FULL_WALKTHROUGH,
  fields: [
    { field: 1, fill: 'email', value: null },
    { field: 2, fill: 'password', value: null },
    ...Array.from({ length: 13 }, (_, i) => ({ field: i + 3, fill: 'value', value: value(i + 1) })),
  ],
  button: LONG_BUTTON,
  walls: ['phone', 'oauth-only'],
  providers: ['Google', 'GitHub', 'Microsoft', 'Apple', 'GitLab', 'Bitbucket'],
  termsBan: 'Accounts must be created by a person and never by a bot or any other automated means, '.repeat(3).trim().slice(0, 300),
  authVendor: 'A Hosted Authentication Vendor Co.',
});

test('a Walkthrough whose card would run past 4,000 characters cuts the page’s field labels, and never a value', async (t) => {
  const value = (n: number) => `Answer ${n} `.padEnd(80, 'x');
  const world = await walkthroughPut(t, { ...FULL_CODEMIND, signup: longSignup() }, longWalkthrough(value));

  const card = cardIn(world);
  assert.ok(card.textLength <= 4000, `${card.textLength} characters`);
  const lines = card.text.split('\n');
  for (let n = 1; n <= 13; n++) {
    assert.ok(lines.includes(`**Please tell us your ans…** · ${value(n)}`), `Question ${n}'s label is cut, and its value whole`);
  }
  assert.ok(card.lines.some((l) => l.button?.label === 'Edit'), 'Edit is still offered');
  const copy = world.discord.forumPosts(PRODUCTS_FORUM)[0]!.messages[1]!;
  assert.ok(copy.textLength <= 4000 && copy.text.includes(`· ${value(13)}`));
  assert.deepEqual(world.discord.refused, []);
});

test('a Walkthrough too long for one card even with its labels cut is turned back to its run, which records a shorter one', async (t) => {
  // Values of Markdown characters, which escaping doubles, as a page might steer a model to write.
  const marks = (n: number) => `${n}`.padEnd(80, '*');
  const short = (n: number) => `Answer ${n}`;
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId]);
  serveProduct(world, { ...FULL_CODEMIND, signup: longSignup() });
  world.model.walkthrough = () => longWalkthrough(marks);
  world.model.walkthroughAgain = () => longWalkthrough(short);
  await world.advanceTo('2026-10-12T08:00:00Z');

  const [run] = world.model.walkthroughRuns;
  assert.equal(run!.walkthroughReplies[0], 'That Walkthrough is too long to show on one Discord card. Record it with shorter values.');
  const [card] = world.discord.cards(NEEDS_YOU);
  assert.ok(card!.text.split('\n').some((l) => l.endsWith('…** · Answer 13')), card!.text);
  assert.ok(card!.textLength <= 4000);
  assert.deepEqual(world.discord.refused, []);
});

test('plain code turns back a Walkthrough that fills the email field with another address, or leaves an Offer’s code out', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId]);
  serveProduct(world, FULL_CODEMIND);
  const fields = FULL_WALKTHROUGH.fields.map((f) =>
    f.field === 3 ? { ...f, fill: 'value', value: 'alex@example.com' } : f.field === 5 ? { ...f, value: null } : f,
  );
  world.model.walkthrough = () => ({ ...FULL_WALKTHROUGH, fields });
  world.model.walkthroughAgain = () => FULL_WALKTHROUGH;
  await world.advanceTo('2026-10-12T08:00:00Z');

  assert.equal(
    world.model.walkthroughRuns[0]!.walkthroughReplies[0],
    [
      'Field 3 is an email field: fill it with email, or leave it empty.',
      'Field 3: an email address goes into a form only as the Signup identity, with fill email.',
      'Field 5: a code field gets the code of an Offer that needs no card: one of PHBUILD.',
    ].join(' '),
  );
  const text = cardIn(world).text.split('\n');
  assert.ok(text.includes('**Email** · you+codemind@gmail.com, or you@gmail.com if the form refuses +'));
  assert.ok(text.includes('**Promo code** · PHBUILD, from the Offer “50 more builds”'));
});

test('the card names an auth vendor’s or another domain’s host, shows a preset choice, and gives each Product a tag of its own', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  const GUILDS = '1274741';
  // guilds.run launches under a name Codemind has, so their plus-address tags would clash.
  const day = fixtureDay('2026-10-12');
  day.find((p) => p.id === GUILDS)!.name = 'Codemind';
  world.productHunt.addFeatured(day, '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId, GUILDS]);
  serveProduct(world, CODEMIND);
  const VENDOR = 'https://accounts.authvendor.example/sign-up';
  const longTerms = `https://legal.authvendor.example/${'t'.repeat(200)}`;
  world.browser.redirect(SIGNUP_URL, VENDOR);
  world.browser.page({
    url: VENDOR,
    title: 'Sign up · Codemind',
    text: 'Secured by Clerk',
    forms: [
      {
        ...emailForm('Continue'),
        fields: [
          { type: 'email', name: 'email', label: 'Email', required: true, autocomplete: 'email', links: [] },
          { type: 'text', name: 'promo', label: 'Promo code', required: false, autocomplete: null, links: [] },
          {
            type: 'select',
            name: 'country',
            label: 'Country',
            required: true,
            autocomplete: 'country',
            links: [],
            options: [
              { label: 'United States', value: 'us', selected: true },
              { label: 'Canada', value: 'ca', selected: false },
            ],
          },
          { type: 'checkbox', name: 'tos', label: 'I accept the Terms of Service', required: true, autocomplete: null, links: [{ text: 'Terms of Service', href: longTerms }] },
        ],
      },
    ],
  });
  world.browser.redirect(`https://app.p${GUILDS}.example/signup`, 'https://signup.otherhost.example/');
  world.browser.page({ url: 'https://signup.otherhost.example/', title: 'Sign up', text: 'Create your account', forms: [emailForm()] });
  world.model.walkthrough = (run) =>
    run.rootDomain === 'codemindhq.dev'
      ? {
          ...plainWalkthrough(run.prompt),
          fields: [
            { field: 1, fill: 'email', value: null },
            { field: 2, fill: 'offer-code', value: null },
            { field: 3, fill: 'empty', value: null },
            { field: 4, fill: 'choice', value: 'ticked' },
          ],
          authVendor: 'Clerk',
        }
      : plainWalkthrough(run.prompt);
  await world.advanceTo('2026-10-12T08:00:00Z');

  const cards = world.discord.cards(NEEDS_YOU);
  const vendor = cards.find((c) => c.text.includes('authvendor'))!.text.split('\n');
  assert.ok(vendor.includes('**Signup host:** accounts.authvendor.example (Clerk, Codemind\'s sign-in provider)'), vendor.join('\n'));
  assert.ok(vendor.includes('**Promo code** · left empty'), 'a code field with no Offer is left empty');
  assert.ok(vendor.includes('**Country** · United States'), 'the choice the page set is shown');
  assert.ok(vendor[1]!.endsWith('You accept Terms of Service (its link too long to show).'), vendor[1]);
  const other = cards.find((c) => c.text.includes('otherhost'))!.text.split('\n');
  assert.ok(other.includes("**Signup host:** signup.otherhost.example (not Codemind's own domain)"), other.join('\n'));
  assert.deepEqual(
    cards.map((c) => c.text.match(/as \*\*(you\+\w+@gmail\.com)\*\*/)?.[1]).sort(),
    ['you+codemind2@gmail.com', 'you+codemind@gmail.com'],
    'each Product its own plus-address',
  );
  assert.deepEqual(world.discord.refused, []);
});

test('a Walkthrough whose signup page won’t load is prepared once it does, 30 minutes on', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  const GUILDS = '1274741'; // guilds.run, on a plain `.example` site whose Dossier cites what loaded
  const signup = `https://app.p${GUILDS}.example/signup`;
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([GUILDS]);
  world.browser.fail(signup, { kind: 'timeout', message: 'Timeout 60000ms exceeded' });
  await world.advanceTo('2026-10-12T08:00:00Z');

  assert.deepEqual(world.discord.cards(NEEDS_YOU), []);
  assert.equal(world.model.walkthroughRuns.length, 0);
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.deepEqual(post!.tags, []);
  assert.ok(!post!.messages[0]!.text.includes('Walkthrough'), 'Register says nothing of a Walkthrough yet');

  world.browser.fail(signup, undefined);
  await world.advanceTo('2026-10-12T08:29:00Z');
  assert.deepEqual(world.discord.cards(NEEDS_YOU), [], 'not before its retry');
  await world.advanceTo('2026-10-12T08:30:00Z');
  assert.ok(cardIn(world).text.startsWith(`<@${PERSON}> **Walkthrough v1 · guilds.run**\n`));
  assert.ok(cardIn(world).text.endsWith('-# Rules applied: none · signup page read 01:30 PT Mon Oct 12'));
  assert.deepEqual(world.discord.forumPosts(PRODUCTS_FORUM)[0]!.tags, ['Walkthrough']);
});

test('a card Discord took while the bot never heard back is known by the tap on it, and shrinks once approved', async (t) => {
  const world = await startWorld({ now: '2026-10-12T07:30:00Z' });
  t.after(() => world.stop());
  world.productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');
  world.model.onlyDossiers([CODEMIND.postId]);
  serveProduct(world, FULL_CODEMIND);
  world.model.walkthrough = () => FULL_WALKTHROUGH;
  world.discord.loseReply('message', 1, NEEDS_YOU);
  await world.advanceTo('2026-10-12T08:00:00Z');
  await world.discord.connected();
  assert.equal(world.discord.cards(NEEDS_YOU).length, 1, 'the card is up');

  // Its send counts as sent, so the next pass shows the rest and posts no second card.
  await world.advanceTo('2026-10-12T08:30:00Z');
  assert.equal(world.discord.cards(NEEDS_YOU).length, 1);
  assert.deepEqual(world.discord.forumPosts(PRODUCTS_FORUM)[0]!.tags, ['Walkthrough']);

  await world.advanceTo('2026-10-12T16:03:00Z'); // 09:03 PDT
  await tapCard(world, cardIn(world), 'Approve');
  await world.assistant.whenIdle();
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.equal(cardIn(world).text, `✅ Approved v1 09:03 · **Codemind** · <#${post!.id}>`);
  assert.deepEqual(world.discord.refused, []);
});

test('a switch on the signup form is a box, as the page check judges one: left unticked unless the run ticks it, with an Edit of the two, and the fill run sets it', async (t) => {
  // A news switch the page turned on, which the Walkthrough leaves off (browser/test/page-check.test.ts judges a switch as a box).
  const news: FakeField = { type: 'switch', name: 'news', label: 'Send me product news', required: false, autocomplete: null, links: [], checked: true };
  const signup = WITH_PASSWORD.signup!;
  const world = await walkthroughOnDay(t, { ...WITH_PASSWORD, signup: { ...signup, forms: [{ ...signup.forms![0]!, fields: [...signup.forms![0]!.fields, news] }] } });

  assert.match(world.model.walkthroughRuns[0]!.prompt, /^Form 1 field 4 \(switch, a box\): Send me product news$/m, 'the run is told it is a box');
  const card = cardIn(world);
  const line = card.lines.find((l) => l.text.startsWith('**Send me product news** · '));
  assert.equal(line?.text, '**Send me product news** · left unticked');
  assert.equal(line?.button?.label, 'Edit');
  const opened = await world.discord.tap({ userId: PERSON, customId: line!.button!.customId, channelId: NEEDS_YOU, messageId: card.id });
  assert.deepEqual(popupOf(opened)?.fields[0]?.options, ['ticked', 'left unticked'], 'a radio group of the two');

  await approveDay(world);
  await world.assistant.whenIdle();
  assert.deepEqual(world.browser.presses.map((p) => [p.button, p.values.news]), [['Create account', 'left unticked']]);
});
