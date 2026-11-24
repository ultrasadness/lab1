// Routing a Registration that waits on the person (#59, #10, #12): each wall, stuck fill run and failed page check gets a
// card in #needs-you with its route beside Stop, the walls nothing can get past end it *abandoned* at once, and Hand off
// gives the person a Handoff card whose Done makes it *registered*. Each test reads what Discord, the browser, GitHub
// and the log saw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEEDS_YOU, PERSON, type World } from './harness/world.ts';
import { approve, walkthroughPut, WITH_PASSWORD } from './harness/walkthrough-day.ts';
import { finish } from './harness/fake-model.ts';
import { until } from './harness/miner-day.ts';
import { updateOf } from './harness/fake-discord.ts';
import { logged, registrationFile, standing, statusOf, tags, tapCard, tapStatus } from './harness/registration-views.ts';
import type { FakeField, FakePage } from './harness/fake-browser.ts';
import type { FixtureProduct } from './harness/dossier-fixtures.ts';

const SIGNUP = WITH_PASSWORD.signup!;

/** Codemind with its signup page changed, as a test needs it. */
const codemind = (change: Partial<FakePage>): FixtureProduct => ({ ...WITH_PASSWORD, signup: { ...SIGNUP, ...change } });

/** The presses the Product's pages received, read through a call so that an assertion on them narrows nothing. */
const presses = (world: World) => world.browser.presses;

/** The person's cards in #needs-you after the Walkthrough's own, which is the first. */
const laterCards = (world: World) => world.discord.cards(NEEDS_YOU).slice(1);

/** A Registration whose fill run on page 1 meets this wall, with this note. */
async function atWall(t: { after(fn: () => Promise<void>): void }, finished: Record<string, unknown>, product = WITH_PASSWORD): Promise<World> {
  const world = await walkthroughPut(t, product);
  world.model.fill = () => [finish({ result: 'wall', ...finished })];
  await approve(world);
  await world.assistant.whenIdle();
  return world;
}

test('a bot check gets a card in #needs-you with Hand off beside Stop, and the store logs it beside the wall the read predicted', async (t) => {
  const world = await atWall(t, { wall: 'bot-check', note: 'a Turnstile box sits above the button' }, codemind({ botCheck: 'Turnstile' }));

  const [card, ...more] = laterCards(world);
  assert.equal(more.length, 0);
  assert.deepEqual(card!.mentions, [PERSON], 'it notifies the person');
  assert.match(card!.text, /^<@\d+> \*\*At a wall · Codemind\*\*/);
  assert.match(card!.text, /stopped at a bot check on page 1 of its signup form, and nothing was submitted/);
  assert.match(card!.text, /```\na Turnstile box sits above the button\n```/, "the fill run's note, in a code block");
  assert.deepEqual(card!.buttons.map((b) => b.label), ['Hand off', 'Stop'], 'Take over comes with #60');
  assert.deepEqual(presses(world), []);
  assert.equal(world.browser.openSessions.length, 1, 'its session waits for the person');
  assert.deepEqual(tags(world), ['Needs you']);

  assert.deepEqual(
    logged(world, 'registration.wall-met').map((l) => [l.page, l.wall, l.predicted]),
    [[1, 'bot-check', ['bot-check']]],
  );
});

test('a phone check, a blocked site, a Google-only sign-in and a stuck fill run each get Hand off beside Stop', async (t) => {
  for (const [name, finished, says] of [
    ['a phone check', { wall: 'phone' }, /stopped at a phone check on page 1/],
    ['a blocked site', { wall: 'blocked', note: 'Access denied' }, /stopped at a site that refuses the Assistant's browser on page 1/],
    ['a stuck fill run', { result: 'stuck', reason: 'no-button' }, /^<@\d+> \*\*Stuck · Codemind\*\*[\s\S]*the page shows no button to press/],
  ] as const) {
    await t.test(name, async (t) => {
      const world = await atWall(t, finished);
      const [card] = laterCards(world);
      assert.match(card!.text, says);
      assert.deepEqual(card!.buttons.map((b) => b.label), ['Hand off', 'Stop']);
      assert.deepEqual(presses(world), []);
    });
  }

  await t.test('a Google-only sign-in, named first without its providers, then with a link for one', async (t) => {
    const world = await walkthroughPut(t, WITH_PASSWORD);
    // The run names the wall without its providers, which is turned back, then with a link, which is too, then names
    // them as the page words them.
    world.model.fill = (run) =>
      run.snapshots === 1
        ? [finish({ result: 'wall', wall: 'oauth-only' }), { tool: 'snapshot', args: {} }]
        : run.snapshots === 2
          ? [finish({ result: 'wall', wall: 'oauth-only', providers: ['https://evil.example/login'] }), { tool: 'snapshot', args: {} }]
          : [finish({ result: 'wall', wall: 'oauth-only', providers: ['Continue with Google', 'GitHub'] })];
    await approve(world);
    await world.assistant.whenIdle();

    const replies = world.model.fillRuns[0]!.fillReplies.filter((r) => r.tool === 'finish').map((r) => r.reply);
    assert.match(replies[0]!, /An oauth-only wall needs providers/);
    assert.match(replies[1]!, /An oauth-only wall needs providers: the name of each sign-in the page offers, in words/);
    assert.doesNotMatch(world.discord.bodies.join('\n'), /evil\.example/, 'no link a run named reaches Discord');
    const [card] = laterCards(world);
    assert.match(card!.text, /sign up on your own device with Google, choosing the Signup mailbox's own Google account, you@gmail\.com/);
    assert.deepEqual(card!.buttons.map((b) => b.label), ['Hand off', 'Stop']);
    assert.equal(standing(world), 'at a wall on page 1: oauth-only');
  });
});

test('card fields, a form refusing gmail.com, an invite code nobody has, and a sign-in only through other providers each end it abandoned at once', async (t) => {
  for (const [finished, why] of [
    [{ wall: 'card' }, 'at a wall: card fields, which are never filled'],
    [{ wall: 'free-email' }, 'at a wall: its form refuses gmail.com addresses'],
    [{ wall: 'invite-only' }, 'at a wall: signing up needs an invite code, and none is known'],
    [{ wall: 'oauth-only', providers: ['GitHub', 'Apple'] }, 'at a wall: it signs in only through GitHub or Apple, whose mail would land outside the Signup mailbox'],
  ] as const) {
    await t.test(finished.wall, async (t) => {
      const world = await atWall(t, finished);

      assert.equal(standing(world), `**abandoned** · ${why}`);
      assert.deepEqual(statusOf(world).buttons.map((b) => b.label), ['Start again']);
      assert.deepEqual(laterCards(world), [], 'no card: nothing waits on the person');
      assert.deepEqual(world.browser.openSessions, [], 'its session closed');
      assert.deepEqual(tags(world), ['abandoned']);
      assert.match(registrationFile(world), new RegExp(`· \\*\\*abandoned\\*\\*: ${why.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
      assert.deepEqual(logged(world, 'registration.wall-met').map((l) => l.wall), [finished.wall], 'the store logs it all the same');
    });
  }
});

test('Hand off hands it to the person: its session closes, a Handoff card gives the steps, the values and the password through AutoFill, and Done makes it registered', async (t) => {
  const world = await atWall(t, { wall: 'bot-check' });
  const reply = await tapCard(world, 1, 'Hand off');
  await world.assistant.whenIdle();

  assert.match(updateOf(reply)!.text, /^✓ Codemind · handed off to you · <#\d+>$/, 'the wall card shrinks to one line');
  assert.equal(standing(world), '**handed off** to you, at a bot check on page 1');
  assert.deepEqual(statusOf(world).buttons, []);
  assert.deepEqual(tags(world), ['handed off']);
  assert.deepEqual(world.browser.openSessions, []);
  assert.match(registrationFile(world), /^- 2026-10-12 01:00 PT · \*\*handed off\*\* by you, at a bot check on page 1$/m);

  const handoff = world.discord.cards(NEEDS_YOU).at(-1)!;
  const [item] = world.bitwarden.items;
  assert.deepEqual(handoff.mentions, [PERSON]);
  assert.equal(
    handoff.text,
    [
      `<@${PERSON}> **Hand off · Codemind**`,
      'You handed it off at a bot check on page 1. Nothing was submitted.',
      '1. Open https://app.codemindhq.dev/.',
      '2. Fill in the values you approved, and leave every other field empty:',
      '- Email: `you+codemind@gmail.com`',
      `- Password: let AutoFill fill it from Bitwarden › Registrations › Codemind (item ${item!.id})`,
      '3. Press **Create account**.',
      "4. If Codemind sends a verification mail, open it in the Signup mailbox's Gmail and tap its link or enter its code.",
      '5. Tap **Done** here once the account exists.',
      `-# See <#${world.discord.forumPosts('200000000000000004')[0]!.id}>.`,
    ].join('\n'),
  );
  assert.deepEqual(handoff.buttons.map((b) => b.label), ['Done']);

  const done = await tapCard(world, -1, 'Done');
  await world.assistant.whenIdle();
  assert.match(updateOf(done)!.text, /^✓ Codemind · done: registered · <#\d+>$/);
  assert.equal(standing(world), '**registered** · finished by you');
  assert.deepEqual(tags(world), ['registered']);
  assert.match(registrationFile(world), /^- 2026-10-12 01:00 PT · \*\*registered\*\*: you finished it on your own device$/m);
  assert.deepEqual(presses(world), [], 'nothing was ever pressed');
});

test('a required field nobody approved beside a password the page changed, and a press refused for a disabled button, each get Hand off beside Stop, and Stop on the card ends it', async (t) => {
  await t.test('a required field nobody approved beside a password the page changed', async (t) => {
    // The page asks for a company the Walkthrough leaves empty, now required, and cuts the password it was given: only
    // the person can answer the password, so the page gets Hand off, not an amended Walkthrough (#115).
    const required = SIGNUP.forms![0]!.fields.map((f) => (f.name === 'company' ? { ...f, required: true } : f));
    const world = await walkthroughPut(t, codemind({ forms: [{ ...SIGNUP.forms![0]!, fields: required }], rewrites: { password: (value) => value.slice(0, 8) } }));
    await approve(world);
    await world.assistant.whenIdle();

    const [card] = laterCards(world);
    assert.match(card!.text, /^<@\d+> \*\*A page check failed · Codemind\*\*\nPage 1 doesn't match the Walkthrough, so the Assistant didn't press its button: unapproved-value on “Password”; invalid \(valueMissing\) on “Company”\. Nothing was submitted\./);
    assert.deepEqual(card!.buttons.map((b) => b.label), ['Hand off', 'Stop']);
    assert.deepEqual(world.model.amendmentRuns, []);

    const reply = await tapCard(world, 1, 'Stop');
    await world.assistant.whenIdle();
    assert.match(updateOf(reply)!.text, /^✓ Codemind · stopped by you; nothing submitted · <#\d+>$/);
    assert.equal(standing(world), '**abandoned** · stopped by you; nothing submitted');
    assert.deepEqual(world.browser.openSessions, []);
    assert.deepEqual(presses(world), []);
    assert.equal(world.discord.cards(NEEDS_YOU).length, 2, 'no card comes after it');
  });

  await t.test('a press refused for a disabled button', async (t) => {
    const world = await walkthroughPut(t, codemind({ forms: [{ ...SIGNUP.forms![0]!, submits: [{ label: 'Create account', disabled: true }] }] }));
    await approve(world);
    await world.assistant.whenIdle();

    const [card] = laterCards(world);
    // The browser service refused the press itself: a stuck card, since the page may match the Walkthrough.
    assert.match(card!.text, /^<@\d+> \*\*Stuck · Codemind\*\*\nThe Assistant couldn't press \*\*Create account\*\* on page 1: not-pressable: b1 is disabled\. Nothing was submitted\./);
    assert.deepEqual(card!.buttons.map((b) => b.label), ['Hand off', 'Stop']);

    // Stop on the status message ends it just the same, and the card shrinks to say so.
    await tapStatus(world, 'Stop');
    await world.assistant.whenIdle();
    assert.match(world.discord.cards(NEEDS_YOU)[1]!.text, /^✓ Codemind · abandoned: stopped by you; nothing submitted · <#\d+>$/);
  });
});

/** Codemind's signup page with its Company field preset by the page, which nobody approved. */
const presetCompany = (company: string): FakePage => ({
  ...SIGNUP,
  forms: [{ ...SIGNUP.forms![0]!, fields: SIGNUP.forms![0]!.fields.map((f) => (f.name === 'company' ? { ...f, value: company } : f)) }],
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('a value the page preset goes to a Submit tap: a screenshot with the button outlined and the field marked, and Submit presses that page', async (t) => {
  const world = await walkthroughPut(t, codemind(presetCompany('Acme Inc')));
  await approve(world);
  await world.assistant.whenIdle();

  const [card, ...more] = laterCards(world);
  assert.equal(more.length, 0);
  assert.deepEqual(card!.mentions, [PERSON]);
  assert.match(card!.text, /^<@\d+> \*\*Submit\? · Codemind\*\*\nPage 1 holds what the Walkthrough didn't approve: unapproved-value on “Company”\. Nothing was submitted yet\./);
  assert.deepEqual(card!.buttons.map((b) => b.label), ['Submit', 'Hand off', 'Stop']);
  assert.equal(card!.images.length, 1, 'it shows the screenshot');
  assert.ok(card!.images[0]!.bytes.subarray(0, 8).equals(PNG_SIGNATURE));
  // The fill run's snapshot named Email f1, Password f2, Company f3 and Create account b1.
  assert.deepEqual(world.browser.screenshots.map((s) => [s.outline, s.mark]), [['b1', ['f3']]]);
  assert.equal(standing(world), 'page 1 failed the page check');
  assert.deepEqual(presses(world), []);

  const reply = await tapCard(world, 1, 'Submit');
  await world.assistant.whenIdle();

  assert.match(updateOf(reply)!.text, /^✓ Codemind · Submit tapped 01:00 PT Mon Oct 12 · <#\d+>$/);
  const [item] = world.bitwarden.items;
  assert.deepEqual(
    world.browser.presses.map((p) => [p.button, p.values]),
    [['Create account', { email: 'you+codemind@gmail.com', password: item!.login.password, company: 'Acme Inc' }]],
    'the Product received the value the person saw',
  );
  assert.equal(logged(world, 'registration.press-intended').length, 1, 'under an intended mark of its own');
  assert.match(standing(world), /awaiting verification$/);
  assert.equal(world.discord.cards(NEEDS_YOU).length, 2, 'no other card');
});

test('a Submit tap on a page that has changed since its screenshot presses nothing, and a new screenshot comes whose own Submit presses', async (t) => {
  const world = await walkthroughPut(t, codemind(presetCompany('Acme Inc')));
  await approve(world);
  await world.assistant.whenIdle();
  // The page's script changes the company after the screenshot.
  world.browser.page(presetCompany('Acme Corp'));

  await tapCard(world, 1, 'Submit');
  await world.assistant.whenIdle();

  assert.deepEqual(presses(world), []);
  assert.equal(logged(world, 'registration.page-changed').length, 1);
  const [first, second, ...more] = laterCards(world);
  assert.equal(more.length, 0);
  assert.match(first!.text, /^✓ Codemind · Submit tapped/);
  assert.match(second!.text, /^<@\d+> \*\*Submit\? · Codemind\*\*/);
  assert.match(second!.text, /It changed after you last saw it, so the Assistant pressed nothing, and shows it to you again\./);
  assert.equal(world.browser.screenshots.length, 2, 'a new screenshot');
  assert.notEqual(first!.id, second!.id);

  await tapCard(world, 2, 'Submit');
  await world.assistant.whenIdle();
  assert.deepEqual(world.browser.presses.map((p) => p.values.company), ['Acme Corp']);
  assert.match(standing(world), /awaiting verification$/);
});

test('a Registration with nothing final pressed 24 hours after its Approval closes abandoned, its session and its card closed, with Start again', async (t) => {
  await t.test('at a wall', async (t) => {
    const world = await atWall(t, { wall: 'bot-check' });
    assert.match(laterCards(world)[0]!.text, /Left alone, it closes 01:00 PT Tue Oct 13, 24 hours after its Approval, with nothing submitted\./);

    await world.advanceTo('2026-10-13T07:59:00Z');
    assert.equal(standing(world), 'at a wall on page 1: bot-check');
    await world.advanceTo('2026-10-13T08:00:00Z'); // 24 hours after the Approval at 01:00 PDT

    assert.equal(standing(world), '**abandoned** · Closed after 24 hours; nothing was submitted');
    assert.deepEqual(statusOf(world).buttons.map((b) => b.label), ['Start again']);
    assert.deepEqual(world.browser.openSessions, []);
    assert.match(laterCards(world)[0]!.text, /^✓ Codemind · abandoned: Closed after 24 hours; nothing was submitted · <#\d+>$/);
    assert.match(registrationFile(world), /^- 2026-10-13 01:00 PT · \*\*abandoned\*\*: Closed after 24 hours; nothing was submitted$/m);
    assert.deepEqual(presses(world), []);
  });

  await t.test('queued for a session the whole time', async (t) => {
    const world = await walkthroughPut(t, WITH_PASSWORD);
    world.browser.occupy(5);
    await approve(world);
    await world.assistant.whenIdle();
    assert.equal(standing(world), 'queued');

    await world.advanceTo('2026-10-13T08:00:00Z');
    assert.equal(standing(world), '**abandoned** · Closed after 24 hours; nothing was submitted');
    assert.deepEqual(world.model.fillRuns, []);
  });

  await t.test('held on Bitwarden the whole time', async (t) => {
    const world = await walkthroughPut(t, WITH_PASSWORD);
    world.bitwarden.down = true;
    await approve(world);
    await world.assistant.whenIdle();
    assert.match(world.discord.cards(NEEDS_YOU)[0]!.text, /Waiting for Bitwarden/);

    await world.advanceTo('2026-10-13T08:00:00Z');
    assert.match(world.discord.cards(NEEDS_YOU)[0]!.text, /^Closed v1 after 24 hours before it started · \*\*Codemind\*\* · <#\d+>$/);
    assert.equal(standing(world), '**abandoned** · Closed after 24 hours; nothing was submitted');
    assert.deepEqual(statusOf(world).buttons.map((b) => b.label), ['Start again']);
  });
});

test('a final press whose form still shows 10 seconds on gets a notice with Hand off, and nothing changes by itself', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  await approve(world);
  await world.assistant.whenIdle();
  assert.equal(presses(world).length, 1);
  assert.equal(laterCards(world).length, 0);

  await world.advanceTo('2026-10-12T08:00:10Z'); // 10 seconds after the press, the same form shows on the same URL
  const [notice, ...more] = laterCards(world);
  assert.equal(more.length, 0);
  assert.deepEqual(notice!.mentions, [PERSON]);
  assert.match(notice!.text, /^<@\d+> \*\*Still showing\? · Codemind\*\*\nThe form is still showing after \*\*Create account\*\* was pressed; it may have been rejected\./);
  assert.deepEqual(notice!.buttons.map((b) => b.label), ['Hand off'], 'Take over comes with #60');
  assert.match(standing(world), /awaiting verification$/, 'its state is unchanged');
  assert.equal(world.browser.openSessions.length, 1);

  await tapCard(world, 1, 'Hand off');
  await world.assistant.whenIdle();
  assert.equal(standing(world), 'submitted 01:00 PT Mon Oct 12 · **handed off** to you, at the form still showing 10 seconds after “Create account” was pressed');
  assert.deepEqual(world.browser.openSessions, []);
  const handoff = laterCards(world).at(-1)!;
  assert.match(handoff.text, /^<@\d+> \*\*Hand off · Codemind\*\*\nYou handed it off after the form still showing 10 seconds after “Create account” was pressed\. The form was submitted, and may have been rejected\.\n1\. Open https:\/\/app\.codemindhq\.dev\/ and log in as `you\+codemind@gmail\.com`/);
  assert.equal(presses(world).length, 1, 'nothing is pressed again');
});

test('a final press that leads on to another page gets no notice 10 seconds on', async (t) => {
  const done: FakePage = { url: 'https://app.codemindhq.dev/check-your-email', title: 'Check your email', text: 'We sent you a link.' };
  const world = await walkthroughPut(t, codemind({ next: done.url }), { before: (w) => w.browser.page(done) });
  await approve(world);
  await world.assistant.whenIdle();

  await world.advanceTo('2026-10-12T08:00:30Z');
  assert.deepEqual(laterCards(world), []);
  assert.deepEqual(logged(world, 'registration.still-showing').map((l) => l.still), [false]);
});

test("each rule a later page fails goes to its route: a box ticked by the page to a Submit tap, other terms and another host to an amended Walkthrough (#115)", async (t) => {
  /** Page 2 of the form, which the Walkthrough never saw, with one field as the test sets it. */
  const page2 = (url: string, field: FakeField): FakePage => ({
    url,
    title: 'Step 2',
    text: 'Step 2 of creating your account',
    forms: [{ formElement: true, action: null, method: 'post', fields: [field], submits: [{ label: 'Create account', disabled: false }], links: [] }],
  });
  const box = (label: string, links: { text: string; href: string }[]): FakeField => ({ type: 'checkbox', name: 'box', label, required: false, autocomplete: null, links, checked: true });
  for (const [rule, page, heading, buttons] of [
    ['unapproved-box', page2('https://app.codemindhq.dev/step-2', box('Send me product news', [])), 'Submit? · Codemind', ['Submit', 'Hand off', 'Stop']],
    ['other-terms', page2('https://app.codemindhq.dev/step-2', box('I accept the Data Terms', [{ text: 'Data Terms', href: 'https://codemindhq.dev/data-terms' }])), 'Amended Walkthrough v2 · Codemind', ['Approve', 'Stop']],
    ['off-host', page2('https://codemindhq.dev/step-2', { type: 'text', name: 'team', label: 'Team', required: false, autocomplete: null, links: [] }), 'Amended Walkthrough v2 · Codemind', ['Approve', 'Stop']],
  ] as const) {
    await t.test(rule, async (t) => {
      const world = await walkthroughPut(t, codemind({ forms: [{ ...SIGNUP.forms![0]!, submits: [{ label: 'Continue', disabled: false }] }], next: page.url }), {
        before: (w) => w.browser.page(page),
      });
      await approve(world);
      await world.assistant.whenIdle();

      assert.deepEqual(presses(world).map((p) => p.button), ['Continue'], "page 2's button isn't pressed");
      assert.match(statusOf(world).text, new RegExp(`${rule}`));
      const [card] = laterCards(world);
      assert.ok(card!.text.startsWith(`<@${PERSON}> **${heading}**`), card!.text);
      assert.deepEqual(card!.buttons.map((b) => b.label), buttons);
    });
  }
});

test('a Submit tap whose screenshot is too large to post, or can’t be taken, gets Hand off beside Stop alone', async (t) => {
  for (const [name, before, why] of [
    ['too large', (w: World) => (w.browser.screenshotPng = Buffer.alloc(9 * 1024 * 1024)), /^its screenshot is 9437184 bytes$/],
    ["can't be taken", (w: World) => w.browser.timeOut('/plain-code/screenshot'), /^timeout$/],
  ] as const) {
    await t.test(name, async (t) => {
      const world = await walkthroughPut(t, codemind(presetCompany('Acme Inc')), { before });
      await approve(world);
      await world.assistant.whenIdle();

      const [card] = laterCards(world);
      assert.match(card!.text, /^<@\d+> \*\*A page check failed · Codemind\*\*\nPage 1 doesn't match the Walkthrough/);
      assert.deepEqual(card!.buttons.map((b) => b.label), ['Hand off', 'Stop']);
      assert.deepEqual(card!.images, []);
      assert.deepEqual(logged(world, 'registration.submit-tap-unshown').map((l) => String(l.why)).filter((w) => why.test(w)).length, 1);
    });
  }
});

test('a card Discord refuses is sent again 5 minutes on, and one whose answer never came is known by the tap on it', async (t) => {
  await t.test('refused', async (t) => {
    const world = await walkthroughPut(t, WITH_PASSWORD, { before: (w) => (w.model.fill = () => [finish({ result: 'wall', wall: 'phone' })]) });
    world.discord.refuseNextMessage(NEEDS_YOU);
    await approve(world);
    await world.assistant.whenIdle();
    assert.deepEqual(laterCards(world), []);
    assert.equal(logged(world, 'registration.card-unposted').length, 1);

    await world.advanceTo('2026-10-12T08:05:00Z');
    assert.deepEqual(laterCards(world).map((c) => c.buttons.map((b) => b.label)), [['Hand off', 'Stop']]);
  });

  await t.test('answer lost', async (t) => {
    const world = await walkthroughPut(t, WITH_PASSWORD, { before: (w) => (w.model.fill = () => [finish({ result: 'wall', wall: 'phone' })]) });
    world.discord.loseReply('message', 1, NEEDS_YOU);
    await approve(world);
    await world.assistant.whenIdle();
    assert.equal(laterCards(world).length, 1, 'Discord took it, though the bot never heard');

    await world.advanceTo('2026-10-12T08:05:00Z');
    assert.equal(laterCards(world).length, 1, 'an uncertain send counts as sent');
    const reply = await tapCard(world, 1, 'Hand off');
    await world.assistant.whenIdle();
    assert.match(updateOf(reply)!.text, /^✓ Codemind · handed off to you/);
    assert.match(laterCards(world).at(-1)!.text, /^<@\d+> \*\*Hand off · Codemind\*\*/);
  });
});

test('a press the bot stopped during, started again a day after its Approval, counts as pressed, and the 24-hour close never abandons it', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  world.browser.holdPresses = true;
  await approve(world);
  await until(() => world.browser.presses.length === 1);
  await world.kill();
  world.browser.holdPresses = false;

  await world.outage('2026-10-13T09:00:00Z'); // 25 hours after the Approval, with the press still intended
  // The press counts as pressed, and with no verification mail 24 hours after it, the Registration is handed off (#58).
  assert.equal(standing(world), 'submitted 02:00 PT Tue Oct 13 · **handed off** · no verification mail yet');
  assert.match(statusOf(world).text, /It isn't known whether the last press went through/);
  assert.equal(presses(world).length, 1);
  assert.deepEqual(logged(world, 'registration.stopped'), []);
});

test('a final press the bot stopped after is read once it starts again, past its 10 seconds', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  await approve(world);
  await world.assistant.whenIdle();
  assert.match(standing(world), /awaiting verification$/);

  await world.outage('2026-10-12T08:01:00Z');
  await until(() => laterCards(world).length === 1);
  assert.match(laterCards(world)[0]!.text, /^<@\d+> \*\*Still showing\? · Codemind\*\*/);
  assert.deepEqual(logged(world, 'registration.still-showing').map((l) => l.still), [true]);
});

test('a page that changes between its check and its Submit tap’s screenshot is checked again, and only the page the check failed is shown', async (t) => {
  const world = await walkthroughPut(t, codemind(presetCompany('Acme Inc')));
  // The page's script changes the company while the screenshot is taken.
  const release = world.browser.pause('/plain-code/screenshot');
  await approve(world);
  await until(() => world.browser.requestsTo('/plain-code/screenshot') === 1);
  world.browser.page(presetCompany('Acme Corp'));
  release();
  await world.assistant.whenIdle();

  assert.equal(logged(world, 'registration.page-changed').length, 1);
  const [card, ...more] = laterCards(world);
  assert.equal(more.length, 0, 'no card went out for the page before');
  assert.match(card!.text, /^<@\d+> \*\*Submit\? · Codemind\*\*/);
  await tapCard(world, 1, 'Submit');
  await world.assistant.whenIdle();
  assert.deepEqual(presses(world).map((p) => p.values.company), ['Acme Corp']);
});

test('a page that never holds still is checked again twice, then gets Hand off beside Stop with no screenshot', async (t) => {
  const world = await walkthroughPut(t, codemind({ ...presetCompany('Acme Inc'), restless: true }));
  await approve(world);
  await world.assistant.whenIdle();

  assert.equal(logged(world, 'registration.page-changed').length, 2);
  const [card, ...more] = laterCards(world);
  assert.equal(more.length, 0);
  assert.match(card!.text, /^<@\d+> \*\*A page check failed · Codemind\*\*/);
  assert.deepEqual(card!.buttons.map((b) => b.label), ['Hand off', 'Stop']);
  assert.deepEqual(logged(world, 'registration.submit-tap-unshown').map((l) => l.why), ["the page didn't hold still"]);
  assert.deepEqual(presses(world), []);
});

test('a Submit on a page that changed since its screenshot, and now passes, presses nothing: the page goes to the person again', async (t) => {
  const world = await walkthroughPut(t, codemind(presetCompany('Acme Inc')));
  await approve(world);
  await world.assistant.whenIdle();
  // The page's script clears the company it had set.
  world.browser.page(presetCompany(''));

  await tapCard(world, 1, 'Submit');
  await world.assistant.whenIdle();
  assert.deepEqual(presses(world), []);
  assert.equal(standing(world), 'page 1 changed since you saw it');
  const card = laterCards(world).at(-1)!;
  assert.match(card.text, /^<@\d+> \*\*Submit\? · Codemind\*\*\nPage 1 now matches the Walkthrough\. Nothing was submitted yet\.\nIt changed after you last saw it/);

  await tapCard(world, -1, 'Submit');
  await world.assistant.whenIdle();
  assert.deepEqual(presses(world).map((p) => p.values.company), ['']);
  assert.match(registrationFile(world), /^- 2026-10-12 01:00 PT · Submit tapped: you approved a page as its screenshot showed it \(fingerprint [0-9a-f]{12}\)$/m);
});

test('a page that changes while its Submit is being pressed is refused by the browser service, and goes to the person again', async (t) => {
  const world = await walkthroughPut(t, codemind(presetCompany('Acme Inc')));
  await approve(world);
  await world.assistant.whenIdle();
  const release = world.browser.pause('/plain-code/press');
  await tapCard(world, 1, 'Submit');
  await until(() => world.browser.requestsTo('/plain-code/press') === 1);
  world.browser.page(presetCompany('Acme Corp'));
  release();
  await world.assistant.whenIdle();

  assert.deepEqual(presses(world), []);
  assert.deepEqual(logged(world, 'registration.press-refused').map((l) => l.kind), ['changed']);
  assert.match(laterCards(world).at(-1)!.text, /^<@\d+> \*\*Submit\? · Codemind\*\*/);
});

test('a password the page changed after its fill gets Hand off beside Stop, never a Submit tap, since the screenshot masks it', async (t) => {
  const world = await walkthroughPut(t, codemind({ rewrites: { password: (value) => value.slice(0, 8) } }));
  await approve(world);
  await world.assistant.whenIdle();

  const [card] = laterCards(world);
  assert.match(card!.text, /^<@\d+> \*\*A page check failed · Codemind\*\*\nPage 1 doesn't match the Walkthrough, so the Assistant didn't press its button: unapproved-value on “Password”/);
  assert.deepEqual(card!.buttons.map((b) => b.label), ['Hand off', 'Stop']);
  assert.deepEqual(world.browser.screenshots, []);
});

test("a page plain code can't read 10 seconds after the final press gets no notice, and says so", async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  await approve(world);
  await world.assistant.whenIdle();
  world.browser.timeOut('/plain-code/fingerprint');

  await world.advanceTo('2026-10-12T08:00:10Z');
  assert.deepEqual(laterCards(world), []);
  assert.equal(logged(world, 'registration.still-unread').length, 1);
  assert.deepEqual(logged(world, 'registration.still-showing'), []);
});

test('a Handoff card names a terms link too long for Discord without its address, and fits', async (t) => {
  const long = `https://codemindhq.dev/terms?${'x'.repeat(4800)}`;
  const terms = SIGNUP.forms![0]!.fields.concat([{ type: 'checkbox', name: 'terms', label: 'I agree to the Terms', required: true, autocomplete: null, links: [{ text: 'Terms of Service', href: long }] }]);
  const world = await atWall(t, { wall: 'bot-check' }, codemind({ forms: [{ ...SIGNUP.forms![0]!, fields: terms }] }));
  await tapCard(world, 1, 'Hand off');
  await world.assistant.whenIdle();

  const handoff = laterCards(world).at(-1)!;
  assert.match(handoff.text, /^<@\d+> \*\*Hand off · Codemind\*\*/);
  assert.ok(handoff.text.includes('Accept Terms of Service. Press **Create account**.'), handoff.text);
  assert.deepEqual(world.discord.refused, []);
});

test('a press under way when its 24 hours end, and refused after, closes the Registration once it waits', async (t) => {
  // The button is disabled, which the press refuses before any click.
  const world = await walkthroughPut(t, codemind({ forms: [{ ...SIGNUP.forms![0]!, submits: [{ label: 'Create account', disabled: true }] }] }));
  const release = world.browser.pause('/plain-code/press');
  await approve(world);
  await until(() => world.browser.requestsTo('/plain-code/press') === 1);
  // The 24 hours end while the press waits on the browser service.
  world.clock.advanceTo('2026-10-13T08:00:00Z');
  release();
  await world.assistant.whenIdle();

  assert.deepEqual(logged(world, 'registration.press-refused').map((l) => l.kind), ['not-pressable']);
  assert.equal(standing(world), '**abandoned** · Closed after 24 hours; nothing was submitted');
  assert.deepEqual(presses(world), []);
});

test('a Handoff card of a Walkthrough with every field, long labels and long links goes out compact, its values whole', async (t) => {
  // Each link fits a full card's 300 characters, and all of them with fifteen values don't fit Discord's 4,000.
  const long = (n: number) => `https://app.codemindhq.dev/${String(n)}/${'s'.repeat(268)}`;
  const label = (n: number) => `Question ${String(n).padStart(2, '0')} ${'q'.repeat(48)}`;
  const value = (n: number) => (n === 3 ? 'Acme `Labs`' : `${String(n).padStart(2, '0')}-${'v'.repeat(77)}`);
  const fields = Array.from({ length: 15 }, (_, i): FakeField => ({ type: 'text', name: `q${i + 1}`, label: label(i + 1), required: false, autocomplete: null, links: [] }));
  const terms = [1, 2, 3].map((n) => ({ text: `Terms ${n}`, href: long(100 + n) }));
  // A button label as long as a Walkthrough takes one, 100 characters.
  const button = `Create my account ${'a'.repeat(82)}`;
  const page: FakePage = { ...SIGNUP, url: long(1), forms: [{ ...SIGNUP.forms![0]!, fields, links: terms, submits: [{ label: button, disabled: false }] }] };
  const world = await walkthroughPut(t, codemind(page), {
    before: (w) => w.browser.redirect(SIGNUP.url, page.url),
    change: (w) => ({ ...w, fields: fields.map((_, i) => ({ field: i + 1, fill: 'value', value: value(i + 1) })) }),
  });
  world.model.fill = () => [finish({ result: 'wall', wall: 'bot-check' })];
  await approve(world);
  await world.assistant.whenIdle();
  await tapCard(world, 1, 'Hand off');
  await world.assistant.whenIdle();

  const handoff = laterCards(world).at(-1)!;
  assert.match(handoff.text, /^<@\d+> \*\*Hand off · Codemind\*\*/);
  assert.ok(handoff.textLength <= 4000, `${handoff.textLength} characters`);
  assert.match(handoff.text, /^1\. Open the signup page on app\.codemindhq\.dev\.$/m, 'its links are named alone');
  assert.ok(handoff.text.includes(`- ${label(4).slice(0, 29)}…: `), 'its labels are cut shorter');
  assert.ok(handoff.text.includes('Accept Terms 1 and Terms 2 and Terms 3.'), handoff.text);
  for (const n of [4, 15]) assert.ok(handoff.text.includes(`: \`${value(n)}\``), `value ${n} whole`);
  assert.ok(handoff.text.includes(': Acme \\`Labs\\`'), 'a backtick escaped, never changed');
  assert.deepEqual(world.discord.refused, []);
});
