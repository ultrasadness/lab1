// Filling and pressing a Registration (#56): after Approval, a fill run fills each page through the fixed actions, and
// plain code presses each button once the page passes the check. Each test reads what the browser, the Password vault,
// the model provider, Discord and GitHub saw. `world.stop()` fails any test whose pages received a press that no
// *intended* mark of its own accounts for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEEDS_YOU, PERSON, PRODUCTS_FORUM, type World } from './harness/world.ts';
import { approve, walkthroughPut, WITH_PASSWORD } from './harness/walkthrough-day.ts';
import { whoReceived } from './harness/secrets.ts';
import { until } from './harness/miner-day.ts';
import { finish, plainFill, plainWalkthrough, shownIn, sorted, type FillTurn, type SeenRun } from './harness/fake-model.ts';
import { pressesWithoutMark } from './harness/presses.ts';
import { popupOf, updateOf, type InteractionReply, type SeenMessage } from './harness/fake-discord.ts';
import type { FakePage } from './harness/fake-browser.ts';
import type { FixtureProduct } from './harness/dossier-fixtures.ts';

const SIGNUP_URL = 'https://app.codemindhq.dev/';
const PLUS_ADDRESS = 'you+codemind@gmail.com';
const SIGNUP = WITH_PASSWORD.signup!;
const SUBMITTED = 'submitted 01:00 PT Mon Oct 12';

/** Codemind with its signup page changed, as a test needs it. */
const codemind = (change: Partial<FakePage>): FixtureProduct => ({ ...WITH_PASSWORD, signup: { ...SIGNUP, ...change } });

/** The signup form with another button. */
const withButton = (label: string) => [{ ...SIGNUP.forms![0]!, submits: [{ label, disabled: false }] }];

/** A later page of a signup form: one field nobody approved a value for, left empty, and one button. */
const step = (n: number, button: string, next?: string): FakePage => ({
  url: `${SIGNUP_URL}step-${n}`,
  title: `Step ${n}`,
  text: `Step ${n} of creating your account`,
  forms: [
    {
      formElement: true,
      action: null,
      method: 'post',
      fields: [{ type: 'text', name: `extra${n}`, label: `Anything else ${n}`, required: false, autocomplete: null, links: [] }],
      submits: [{ label: button, disabled: false }],
      links: [],
    },
  ],
  ...(next ? { next } : {}),
});

/** The page a Product shows once the account is made: nothing left to fill. */
const DONE: FakePage = { url: `${SIGNUP_URL}welcome`, title: 'Check your email', text: 'We sent you a link to confirm your address.' };

/** The Registration's status message in the Product's post, as the person now sees it. */
function statusOf(world: World): SeenMessage {
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  return post!.messages.find((m) => m.text.startsWith('**Registration**'))!;
}

/** What the status message says the Registration is doing: what follows `**Registration** · `, up to the Approval. */
const standing = (world: World) => statusOf(world).text.split(' · Walkthrough v')[0]!.replace('**Registration** · ', '');

/** Each thing the status message has said the Registration is doing, in order. */
function statusesShown(world: World): string[] {
  const shown: string[] = [];
  for (const body of world.discord.bodies) {
    const at = body.indexOf('**Registration** · ');
    if (at < 0) continue;
    const what = (JSON.parse(`"${body.slice(at).split('"')[0]!}"`) as string).split(' · Walkthrough v')[0]!.replace('**Registration** · ', '');
    if (shown.at(-1) !== what) shown.push(what);
  }
  return shown;
}

/** The person taps a button on the Registration's status message, by its label. */
function tapStatus(world: World, label: string): Promise<InteractionReply> {
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  const status = statusOf(world);
  const button = status.buttons.find((b) => b.label === label);
  if (!button) throw new Error(`No ${label} on the status message: ${status.buttons.map((b) => b.label).join(', ') || 'no buttons'}`);
  return world.discord.tap({ userId: PERSON, customId: button.customId, channelId: post!.id, messageId: status.id });
}

/** The person taps Correct on the status message and sends the pop-up with what they say it got wrong. */
async function correctStatus(world: World, text: string): Promise<{ opened: InteractionReply; sent: InteractionReply }> {
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  const opened = await tapStatus(world, 'Correct');
  const popup = popupOf(opened)!;
  const sent = await world.discord.submitPopup({ userId: PERSON, customId: popup.customId, channelId: post!.id, messageId: statusOf(world).id, fields: { [popup.fields[0]!.customId]: text } });
  return { opened, sent };
}

/** The person taps a button of a card in #needs-you, by the card's place and the button's label. */
function tapCard(world: World, index: number, label: string): Promise<InteractionReply> {
  const card = world.discord.cards(NEEDS_YOU)[index]!;
  const button = card.buttons.find((b) => b.label === label);
  if (!button) throw new Error(`No ${label} on card ${index}: ${card.text}`);
  return world.discord.tap({ userId: PERSON, customId: button.customId, channelId: NEEDS_YOU, messageId: card.id });
}

const registrationFile = (world: World) => world.git.file('products/codemindhq.dev/registration.md')!;
const logged = (world: World, event: string) => world.logs.filter((l) => l.event === event);
const tags = (world: World) => world.discord.forumPosts(PRODUCTS_FORUM)[0]!.tags;

/**
 * A model that reports what the page refuses, and, told of a refusal, first names the button anyway, which plain code
 * refuses, then fills that field again.
 */
function reporting(refusal: { says: RegExp; reason: string; told: RegExp; again: (snapshot: string) => FillTurn }) {
  return (run: SeenRun, snapshot: string): FillTurn[] => {
    if (refusal.told.test(run.prompt) && run.snapshots === 1) {
      return [finish({ result: 'button', button: shownIn(snapshot).buttons[0]!.ref }), refusal.again(snapshot), { tool: 'snapshot', args: {} }];
    }
    if (refusal.says.test(snapshot)) return [finish({ result: 'stuck', reason: refusal.reason, note: 'the page refuses it' })];
    return plainFill(run.prompt, snapshot);
  };
}

/** The field a snapshot lists of this type, by its ref. */
const refOf = (snapshot: string, type: string) => shownIn(snapshot).fields.find((f) => f.type === type)!.ref;

/** A press as the page received it, without the session and fingerprint it came with. */
const pressed = (world: World) => world.browser.presses.map(({ registration, url, button, values }) => ({ registration, url, button, values }));

test('a one-page Registration is filled by one fill run through the fixed actions, pressed once by plain code, and waits for verification', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  await approve(world);
  await world.assistant.whenIdle();

  // Its session opened at the signup URL, on the Walkthrough's domains.
  const [session] = world.browser.sessions;
  assert.equal(world.browser.sessions.length, 1);
  assert.equal(session!.startUrl, SIGNUP_URL);
  assert.deepEqual(session!.domains, ['codemindhq.dev', 'app.codemindhq.dev']);

  // One fill run, which has the fixed actions and nothing else, and sees the Walkthrough by key.
  assert.equal(world.model.fillRuns.length, 1);
  const requests = world.model.requests.filter((r) => r.tools.includes('finish'));
  for (const r of requests) assert.deepEqual([...r.tools].sort(), ['choose', 'fill', 'fill_secret', 'finish', 'open', 'snapshot']);
  const [run] = world.model.fillRuns;
  assert.match(run!.prompt, /^Fill page 1 of the signup form/);
  assert.match(run!.prompt, /^email · fill · you\+codemind@gmail\.com · field: Email$/m);
  assert.match(run!.prompt, /^password · fill_secret, as password · the new password, which you never see · field: Password$/m);
  assert.deepEqual(run!.fillReplies.map((r) => r.tool), ['snapshot', 'fill', 'fill_secret', 'snapshot', 'finish']);
  // A snapshot shows what filled a field, never its value.
  assert.match(run!.fillReplies[3]!.reply, /^f1 · email, required · filled with email · label: Email$/m);
  assert.match(run!.fillReplies[3]!.reply, /^f2 · password, required · filled with \[password\] · label: Password$/m);

  assert.deepEqual(logged(world, 'registration.fill-run').map((l) => [l.finish, l.rulesApplied]), [['button', []]], 'its finish names the Rules it applied');

  // Plain code pressed the button once, and the Product received exactly the approved values.
  const [item] = world.bitwarden.items;
  assert.deepEqual(pressed(world), [
    { registration: session!.registration, url: SIGNUP_URL, button: 'Create account', values: { email: PLUS_ADDRESS, password: item!.login.password, company: '' } },
  ]);
  // The password reached the browser by reference alone: no model request, Discord message or commit holds it.
  assert.deepEqual(whoReceived(world, item!.login.password), []);

  // The Walkthrough said a verification email follows, so the Registration waits for it, its session still open.
  assert.deepEqual(statusesShown(world), ['queued', 'filling page 1', 'checking page 1', 'pressing **Create account**', 'submitted 01:00 PT Mon Oct 12 · awaiting verification']);
  const status = statusOf(world);
  assert.ok(status.silent && status.mentionsNobody);
  assert.deepEqual(status.buttons.map((b) => b.label), ['Correct'], 'Stop is gone after the final press');
  assert.equal(world.browser.openSessions.length, 1);
  assert.deepEqual(world.discord.forumPosts(PRODUCTS_FORUM)[0]!.tags, ['Registering']);
  assert.match(registrationFile(world), /^- 2026-10-12 01:00 PT · submitted: pressed "Create account" on app\.codemindhq\.dev, as you\+codemind@gmail\.com$/m);
});

test('a three-page Registration gets one fill run a page, and Continue and Next lead on to the final press', async (t) => {
  const world = await walkthroughPut(t, codemind({ forms: withButton('Continue'), next: step(2, 'Next').url }), {
    before: (w) => {
      w.browser.page(step(2, 'Next', step(3, 'Create account').url));
      w.browser.page(step(3, 'Create account', DONE.url));
      w.browser.page(DONE);
    },
  });
  await approve(world);
  await world.assistant.whenIdle();

  assert.deepEqual(world.model.fillRuns.map((r) => r.page), [1, 2, 3], 'one fill run per page');
  assert.match(world.model.fillRuns[1]!.prompt, /This is a later page, which the Walkthrough never saw/);
  assert.deepEqual(world.browser.presses.map((p) => p.button), ['Continue', 'Next', 'Create account']);
  assert.deepEqual(world.browser.presses.map((p) => p.url), [SIGNUP_URL, step(2, '').url, step(3, '').url]);
  assert.equal(world.browser.sessions.length, 1, 'in one session');
  assert.deepEqual(statusesShown(world), [
    'queued',
    'filling page 1',
    'checking page 1',
    'pressing **Continue**',
    'filling page 2',
    'checking page 2',
    'pressing **Next**',
    'filling page 3',
    'checking page 3',
    'pressing **Create account**',
    `${SUBMITTED} · awaiting verification`,
  ]);
  // No model read a page after the final press.
  assert.equal(world.model.fillRuns.at(-1)!.fillReplies.at(-1)!.tool, 'finish');
  assert.equal(world.browser.sessionRequests.filter((r) => r.path === '/fill-run/snapshot').length, 4, 'the fill runs took their snapshots, and none after');
});

for (const [onSubmit, outcome, tag] of [
  ['waitlist', 'waitlisted', 'waitlisted'],
  ['logged-in', 'registered', 'registered'],
] as const) {
  test(`a Walkthrough that says "${onSubmit}" on submit ends ${outcome} at the final press, and its session closes`, async (t) => {
    const world = await walkthroughPut(t, WITH_PASSWORD, { change: (w) => ({ ...w, onSubmit }) });
    await approve(world);
    await world.assistant.whenIdle();

    assert.equal(world.browser.presses.length, 1);
    assert.equal(standing(world), `${SUBMITTED} · **${outcome}**`);
    assert.deepEqual(world.browser.openSessions, [], 'the session closes at the outcome');
    assert.deepEqual(tags(world), [tag]);
    assert.match(registrationFile(world), new RegExp(`^- 2026-10-12 01:00 PT · \\*\\*${outcome}\\*\\*$`, 'm'), 'the outcome line, in bold');
    assert.match(registrationFile(world), /^- 2026-10-12 01:00 PT · submitted: pressed "Create account"/m);
    assert.deepEqual(statusOf(world).buttons.map((b) => b.label), ['Correct']);
    });
}

test('a Continue that leaves no form to fill was the final press: plain code sees it, and no model reads the page', async (t) => {
  const world = await walkthroughPut(t, codemind({ forms: withButton('Continue'), next: DONE.url }), { before: (w) => w.browser.page(DONE) });
  await approve(world);
  await world.assistant.whenIdle();

  assert.deepEqual(world.browser.presses.map((p) => p.button), ['Continue']);
  assert.equal(world.model.fillRuns.length, 1, 'no fill run reads the page the press led to');
  assert.equal(standing(world), `${SUBMITTED} · awaiting verification`);
  assert.deepEqual(logged(world, 'registration.next-page').map((l) => l.next), ['no-form']);
});

test('a Continue whose next page plain code can\'t read counts as an uncertain press: never registered, and the person is told', async (t) => {
  // The page a Continue leads to is on another host, off the Walkthrough's domains, so the browser service won't read it.
  const HOSTED: FakePage = { url: 'https://accounts.elsewhere.example/welcome', title: 'Welcome', text: 'Your account is ready.' };
  const world = await walkthroughPut(t, codemind({ forms: withButton('Continue'), next: HOSTED.url }), {
    change: (w) => ({ ...w, onSubmit: 'logged-in' }),
    before: (w) => w.browser.page(HOSTED),
  });
  await approve(world);
  await world.assistant.whenIdle();

  assert.deepEqual(world.browser.presses.map((p) => p.button), ['Continue']);
  assert.deepEqual(logged(world, 'registration.next-page').map((l) => l.next), ['unreadable']);
  assert.equal(world.model.fillRuns.length, 1, 'no fill run reads that page');
  // It would be registered, had plain code seen no form: it waits instead, as a press whose outcome isn't known.
  assert.equal(standing(world), `${SUBMITTED} · awaiting verification`);
  assert.match(statusOf(world).text, /It isn't known whether the last press went through: the page "Continue" led to couldn't be read/);
  assert.match(world.discord.cards(NEEDS_YOU).at(-1)!.text, /An uncertain press · Codemind/);
  assert.deepEqual(tags(world), ['Registering']);
});

test('a form still going after 5 pages becomes the too-many-pages wall, and waits with Stop', async (t) => {
  const pages = [2, 3, 4, 5, 6].map((n) => step(n, 'Next', step(n + 1, 'Next').url));
  const world = await walkthroughPut(t, codemind({ forms: withButton('Next'), next: pages[0]!.url }), { before: (w) => pages.forEach((p) => w.browser.page(p)) });
  await approve(world);
  await world.assistant.whenIdle();

  assert.deepEqual(world.model.fillRuns.map((r) => r.page), [1, 2, 3, 4, 5]);
  assert.equal(world.browser.presses.length, 5);
  assert.equal(standing(world), 'at a wall on page 6: too-many-pages');
  assert.deepEqual(tags(world), ['Needs you']);
  assert.deepEqual(statusOf(world).buttons.map((b) => b.label), ['Stop', 'Correct']);
  assert.equal(world.browser.openSessions.length, 1, 'its session stays open for the person');
});

test('a wall the fill run names, and a page that fails the check, each leave the Registration waiting with nothing pressed', async (t) => {
  await t.test('a wall', async (t) => {
    const world = await walkthroughPut(t, WITH_PASSWORD);
    world.model.fill = () => [finish({ result: 'wall', wall: 'bot-check', note: 'a Turnstile box sits above the button `here`' })];
    await approve(world);
    await world.assistant.whenIdle();

    assert.deepEqual(world.browser.presses, []);
    assert.equal(standing(world), 'at a wall on page 1: bot-check');
    assert.match(statusOf(world).text, /```\na Turnstile box sits above the button 'here'\n```/, 'its note reaches Discord in a code block');
    assert.deepEqual(tags(world), ['Needs you']);
    assert.equal(world.model.fillRuns.length, 1);
  });

  await t.test('a failed check', async (t) => {
    // The page presets a field the Walkthrough leaves empty, which nobody approved.
    const preset = SIGNUP.forms![0]!.fields.map((f) => (f.name === 'company' ? { ...f, value: 'Acme Inc' } : f));
    const world = await walkthroughPut(t, codemind({ forms: [{ ...SIGNUP.forms![0]!, fields: preset }] }));
    await approve(world);
    await world.assistant.whenIdle();

    assert.deepEqual(world.browser.presses, []);
    assert.equal(standing(world), 'page 1 failed the page check');
    assert.match(statusOf(world).text, /unapproved-value on “Company”/);
    assert.deepEqual(logged(world, 'registration.press-intended'), [], 'no press was marked');
    assert.equal(world.browser.openSessions.length, 1);

    // Stop ends it there.
    await tapStatus(world, 'Stop');
    await world.assistant.whenIdle();
    assert.equal(standing(world), '**abandoned** · stopped by you; nothing submitted');
    assert.deepEqual(world.browser.openSessions, []);
  });

  await t.test('a press the browser service refuses', async (t) => {
    // The button is disabled, which the page check doesn't judge and the press refuses before any click.
    const world = await walkthroughPut(t, codemind({ forms: [{ ...SIGNUP.forms![0]!, submits: [{ label: 'Create account', disabled: true }] }] }));
    await approve(world);
    await world.assistant.whenIdle();

    assert.deepEqual(world.browser.presses, []);
    assert.equal(logged(world, 'registration.press-intended').length, 1);
    assert.deepEqual(logged(world, 'registration.press-refused').map((l) => l.kind), ['not-pressable'], 'its mark is taken back');
    assert.equal(standing(world), 'page 1 failed the page check');
    assert.match(statusOf(world).text, /not-pressable: b1 is disabled/);
    assert.deepEqual(statusOf(world).buttons.map((b) => b.label), ['Stop', 'Correct']);
  });
});

test('an approved Registration waits queued while all 5 sessions are taken, and opens its own once one is free', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  const release = world.browser.occupy(5);
  await approve(world);
  await world.assistant.whenIdle();

  assert.equal(standing(world), 'queued');
  assert.match(statusOf(world).text, /Waiting: all 5 browser sessions are in use/);
  assert.deepEqual(world.model.fillRuns, []);
  assert.equal(world.browser.openSessions.length, 5);

  release();
  await world.advanceTo('2026-10-12T08:06:00Z'); // 5 minutes on, the lane tries again
  assert.equal(world.browser.presses.length, 1);
  assert.match(standing(world), /awaiting verification$/);
});

test('Stop ends the fill run and leaves the Registration abandoned with nothing pressed, and Start again brings a fresh Walkthrough for the same Registration', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  world.model.holdFills = true;
  await approve(world);
  await until(() => world.model.fillRuns.length === 1);

  const stopped = await tapStatus(world, 'Stop');
  assert.match(updateOf(stopped)!.text, /Stopping…/);
  await world.assistant.whenIdle();

  assert.equal(world.browser.presses.length, 0, 'nothing was pressed');
  assert.equal(standing(world), '**abandoned** · stopped by you; nothing submitted');
  assert.deepEqual(statusOf(world).buttons.map((b) => b.label), ['Start again']);
  assert.deepEqual(world.browser.openSessions, [], 'its session closed');
  assert.deepEqual(tags(world), ['abandoned']);
  assert.match(registrationFile(world), /^- 2026-10-12 01:00 PT · \*\*abandoned\*\*: stopped by you; nothing submitted$/m);
  assert.deepEqual(logged(world, 'run.finished').filter((l) => l.kind === 'fill').map((l) => l.outcome), ['aborted'], 'the fill run was ended');
  assert.equal(world.processesRunning(), 0);
  const statusId = statusOf(world).id;

  // Start again: a fresh read, a fresh Walkthrough, and a fresh Approval, for the same Registration.
  world.model.holdFills = false;
  await world.advanceTo('2026-10-12T09:00:00Z'); // 02:00 PDT
  await tapStatus(world, 'Start again');
  await world.assistant.whenIdle();
  assert.equal(world.model.walkthroughRuns.length, 2);
  const card = world.discord.cards(NEEDS_YOU)[1]!;
  assert.match(card.text, /Walkthrough v2 · Codemind/);
  assert.match(card.text, /v2: prepared from a fresh read, after you tapped Start again on the Registration\./);
  assert.deepEqual(tags(world), ['Walkthrough']);
  assert.match(statusOf(world).text, /A new Walkthrough waits for your Approval/);
  assert.equal(world.browser.presses.length, 0, 'nothing is filled until the new version is approved');

  // The stopped version can't be approved again.
  await tapCard(world, 1, 'Approve');
  await world.assistant.whenIdle();
  assert.equal(statusOf(world).id, statusId, 'the same status message, edited in place');
  assert.equal(world.browser.presses.length, 1);
  assert.equal(world.browser.sessions.length, 2, 'in a fresh session');
  assert.equal(world.bitwarden.items.length, 1, 'with the vault item it had');
  assert.equal(world.browser.presses[0]!.values.password, world.bitwarden.items[0]!.login.password);
  assert.match(standing(world), /awaiting verification$/);
  // The file still says how v1's Approval ended, and each approved line names the item it was approved with.
  const file = registrationFile(world);
  const item = world.bitwarden.items[0]!.id;
  assert.match(file, new RegExp(`^- 2026-10-12 01:00 PT · Walkthrough v1 approved · [^\\n]* · password in the Password vault, item ${item}$`, 'm'));
  assert.match(file, /^- 2026-10-12 01:00 PT · \*\*abandoned\*\*: stopped by you; nothing submitted$/m);
  assert.match(file, new RegExp(`^- 2026-10-12 02:00 PT · Walkthrough v2 approved · [^\\n]* · password in the Password vault, item ${item}$`, 'm'));
  assert.match(file, /^- 2026-10-12 02:00 PT · submitted: pressed "Create account"/m);

  // After the final press Stop is gone, and a tap on an old one is refused.
  const late = await world.discord.tap({ userId: PERSON, customId: statusOf(world).buttons[0]!.customId.replace(/^correct:/, 'stop:'), channelId: world.discord.forumPosts(PRODUCTS_FORUM)[0]!.id, messageId: statusId });
  assert.match(late.data!.content!, /^Too late to stop/);
});

test('a form that refuses the password gets a narrower one in a new vault item, refilled by reference under the same Approval', async (t) => {
  // The form takes letters and digits alone, at most 16 of them, and says so beside the field.
  const narrow = (v: Record<string, string>) => {
    const password = v.password ?? '';
    return password && (/[^A-Za-z0-9]/.test(password) || password.length > 16) ? 'Password must be at most 16 letters and digits.' : null;
  };
  const world = await walkthroughPut(t, codemind({ errors: narrow }));
  world.model.fill = reporting({
    says: /at most 16 letters and digits/,
    reason: 'password-refused',
    told: /The form refused the password before/,
    again: (snapshot) => ({ tool: 'fill_secret', args: { field: refOf(snapshot, 'password'), secret: 'password' } }),
  });
  await approve(world);
  await world.assistant.whenIdle();

  const [first, second, third, ...more] = world.bitwarden.items;
  assert.deepEqual(more, [], 'the Assistant only creates items: each stays, and the next replaces it');
  assert.match(second!.login.password, /^[A-Za-z0-9]{24}$/, 'the first replacement has letters and digits alone');
  assert.match(third!.login.password, /^[A-Za-z0-9]{16}$/, 'the next is 16 of them');
  assert.equal(second!.notes, `Replaces item ${first!.id}: the form refused its password.`);
  assert.equal(third!.notes, `Replaces item ${second!.id}: the form refused its password.`);
  assert.equal(third!.login.username, PLUS_ADDRESS);
  assert.deepEqual(world.bitwarden.calls.map((c) => c.args[0]).filter((c) => ['edit', 'delete'].includes(c!)), []);

  // The page was filled three times, its bound, under the one Approval, and each refill filled the password before a button.
  assert.deepEqual(world.model.fillRuns.map((r) => r.page), [1, 1, 1]);
  for (const run of world.model.fillRuns.slice(1)) {
    assert.match(run.fillReplies[1]!.reply, /The form refused what it held before: fill the password field with fill_secret again first, then name the button\./);
  }
  assert.equal(world.discord.cards(NEEDS_YOU).length, 1, 'under the same Approval');
  assert.deepEqual(world.browser.presses.map((p) => p.values.password), [third!.login.password], 'pressed once, with the item now in use');
  for (const item of [first!, second!, third!]) assert.deepEqual(whoReceived(world, item.login.password), []);
  const file = registrationFile(world);
  assert.match(file, new RegExp(`the form refused its password: item ${second!.id} in the Password vault replaces item ${first!.id}, which stays there for you to delete`));
  assert.match(file, new RegExp(`the form refused its password: item ${third!.id} in the Password vault replaces item ${second!.id}`));
  assert.match(standing(world), /awaiting verification$/);
});

test('a form that refuses + gets the plain address, in a vault item of its own', async (t) => {
  const noPlus = (v: Record<string, string>) => ((v.email ?? '').includes('+') ? 'Enter a valid email address.' : null);
  const world = await walkthroughPut(t, codemind({ errors: noPlus }));
  world.model.fill = reporting({
    says: /Enter a valid email address/,
    reason: 'plus-refused',
    told: /The form refused the \+ in the address before/,
    again: (snapshot) => ({ tool: 'fill', args: { field: refOf(snapshot, 'email'), key: 'email' } }),
  });
  await approve(world);
  await world.assistant.whenIdle();

  const [first, second] = world.bitwarden.items;
  assert.equal(world.bitwarden.items.length, 2);
  assert.equal(second!.login.username, 'you@gmail.com', "the new item's username is the plain address");
  assert.equal(second!.notes, `Replaces item ${first!.id}: the form refused the + in its address.`);
  // The page holds the password the first fill run filled, so the new item keeps it: the account's password is its.
  assert.equal(second!.login.password, first!.login.password);
  assert.deepEqual(world.browser.presses.map((p) => [p.values.email, p.values.password]), [['you@gmail.com', second!.login.password]]);
  assert.match(world.model.fillRuns[1]!.fillReplies[1]!.reply, /fill the email field with its key again first/);
  assert.match(statusOf(world).text, /, as you@gmail\.com/);
  assert.match(registrationFile(world), /submitted: pressed "Create account" on app\.codemindhq\.dev, as you@gmail\.com$/m);
  assert.equal(world.discord.cards(NEEDS_YOU).length, 1, 'under the same Approval');
});

test('a fill run acts only by approved keys: an unknown key, a code and an unknown button are refused, and it holds no Secret', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  world.model.fill = (run, snapshot) =>
    run.snapshots === 1
      ? [
          { tool: 'fill', args: { field: 'f3', key: 'company' } },
          { tool: 'fill', args: { field: 'f2', key: 'email' } },
          { tool: 'fill_secret', args: { field: 'f3', secret: 'code' } },
          finish({ result: 'button', button: 'b9' }),
          finish({ result: 'button', button: 'b1', rulesApplied: ['Always tick the newsletter'] }),
          { tool: 'snapshot', args: {} },
        ]
      : plainFill(run.prompt, snapshot);
  await approve(world);
  await world.assistant.whenIdle();

  const [run] = world.model.fillRuns;
  const replies = run!.fillReplies.map((r) => r.reply);
  assert.match(replies[1]!, /No key "company" is approved\. The keys are: email, password\./);
  assert.match(replies[2]!, /not-allowed: a password field takes only fillSecret/);
  assert.match(replies[3]!, /No code is known for this page/);
  assert.match(replies[4]!, /names a button ref of the latest snapshot: b1/);
  assert.match(replies[5]!, /rulesApplied names "Always tick the newsletter", which isn't one of this run's Rules\. This run has no Rules/);
  // It went on to fill the page as approved, and the Product received only approved values.
  assert.deepEqual(world.browser.presses.map((p) => p.values), [{ email: PLUS_ADDRESS, password: world.bitwarden.items[0]!.login.password, company: '' }]);
  assert.deepEqual(whoReceived(world, world.bitwarden.items[0]!.login.password), []);
  assert.deepEqual(world.discord.refused, []);
});

test('a press the bot was killed during counts as pressed after a restart: never pressed again, and the person is told', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  world.browser.holdPresses = true;
  await approve(world);
  await until(() => world.browser.presses.length === 1);
  assert.equal(logged(world, 'registration.pressed').length, 0, 'the press is intended, and not done');

  await world.kill();
  world.browser.holdPresses = false;
  await world.restart();

  assert.equal(world.browser.presses.length, 1, 'the page received one press, before and after');
  assert.equal(world.model.fillRuns.length, 1, 'and no model reads the page again');
  assert.equal(standing(world), `${SUBMITTED} · awaiting verification`);
  assert.match(statusOf(world).text, /It isn't known whether the last press went through/);
  const notice = world.discord.cards(NEEDS_YOU).at(-1)!;
  assert.match(notice.text, /An uncertain press · Codemind/);
  assert.match(notice.text, /It counts as pressed, so it is never pressed again/);
  assert.deepEqual(notice.mentions, [PERSON]);
  assert.match(registrationFile(world), /it isn't known whether the press went through/);

  // Another restart tells nobody twice, and presses nothing.
  await world.restart();
  assert.equal(world.discord.cards(NEEDS_YOU).filter((c) => /An uncertain press/.test(c.text)).length, 1);
  assert.equal(world.browser.presses.length, 1);
});

test('a press whose click may not have gone through counts as done: the Registration waits for verification, and the person is told', async (t) => {
  // The page's button label holds a Markdown link, which the notice must show as text, never as a link.
  const world = await walkthroughPut(t, codemind({ forms: withButton('Create account [Confirm](mailto:help@attacker.example)') }));
  world.browser.uncertainPress = 'the click may not have gone through: Timeout 5000ms exceeded';
  await approve(world);
  await world.assistant.whenIdle();

  assert.equal(world.browser.presses.length, 1);
  assert.equal(standing(world), `${SUBMITTED} · awaiting verification`);
  const notice = world.discord.cards(NEEDS_YOU).at(-1)!.text;
  assert.match(notice, /An uncertain press · Codemind/);
  assert.match(notice, /\*\*Create account \\\[Confirm\\\]\(mailto:help@attacker\.example\)\*\*/);
  assert.doesNotMatch(notice, /[^\\]\[Confirm\]\(/);
});

test('a fill run that died with the bot is run again on the same page, under the same Approval', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  world.model.holdFills = true;
  await approve(world);
  await until(() => world.model.fillRuns.length === 1);

  await world.kill();
  assert.equal(world.processesRunning(), 0);
  world.model.holdFills = false;
  await world.restart();

  assert.deepEqual(world.model.fillRuns.map((r) => r.page), [1, 1], 'a new fill run for the same page');
  assert.equal(world.discord.cards(NEEDS_YOU).length, 1, 'with no new Approval');
  assert.equal(world.browser.sessions.length, 1, 'in the session it had');
  assert.equal(world.browser.presses.length, 1);
  assert.match(standing(world), /awaiting verification$/);
});

test('Correct before the final press stops the Registration, and its new version needs a fresh Approval in a fresh session', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  world.model.holdFills = true;
  await approve(world);
  await until(() => world.model.fillRuns.length === 1);

  const { opened, sent } = await correctStatus(world, 'Put Example Ltd as the company.');
  assert.deepEqual(popupOf(opened)!.texts, ['This stops the Registration: nothing is submitted, and the new version needs your Approval.']);
  assert.match(updateOf(sent)!.text, /Stopping…/);
  world.model.holdFills = false;
  world.model.walkthrough = (run) => ({ ...plainWalkthrough(run.prompt), fields: [...plainWalkthrough(run.prompt).fields.filter((f) => f.field !== 3), { field: 3, fill: 'value', value: 'Example Ltd' }] });
  await world.assistant.whenIdle();

  assert.equal(world.browser.presses.length, 0, 'nothing was pressed');
  assert.equal(standing(world), '**abandoned** · stopped by your Correction; nothing submitted');
  assert.deepEqual(world.browser.openSessions, []);
  const card = world.discord.cards(NEEDS_YOU)[1]!;
  assert.match(card.text, /Walkthrough v2 · Codemind/);
  assert.match(card.text, /prepared again after your Correction: “Put Example Ltd as the company\.”/);
  assert.match(world.discord.cards(NEEDS_YOU)[0]!.text, /^Replaced by v2/);
  assert.equal(world.model.sortingRuns.length, 1, 'the Correction is sorted like any other');

  await tapCard(world, 1, 'Approve');
  await world.assistant.whenIdle();
  assert.equal(world.browser.sessions.length, 2, 'a fresh session');
  assert.deepEqual(world.browser.presses.map((p) => p.values.company), ['Example Ltd']);
  assert.match(registrationFile(world), /Walkthrough v1 corrected: you wrote "Put Example Ltd as the company\.", prepared again as v2/);
});

test('Correct after the final press fixes only the record: nothing is prepared or pressed again', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  await approve(world);
  await world.assistant.whenIdle();
  world.model.sort = () => sorted('fix-only');

  const { opened } = await correctStatus(world, 'The company should have been Example Ltd.');
  assert.deepEqual(popupOf(opened)!.texts, ['The form is already submitted, so this fixes only the record.']);
  await world.assistant.whenIdle();

  assert.equal(world.model.walkthroughRuns.length, 1, 'no run prepares a new version');
  assert.equal(world.discord.cards(NEEDS_YOU).length, 1);
  assert.equal(world.browser.presses.length, 1);
  assert.match(standing(world), /awaiting verification$/);
  assert.match(registrationFile(world), /Walkthrough v1 corrected: you wrote "The company should have been Example Ltd\.", which fixes only the record: the form was already submitted; your Correction of Walkthrough v1 is fix only|which fixes only the record: the form was already submitted/);
  assert.equal(world.model.sortingRuns.length, 1);
  assert.match(world.model.sortingRuns[0]!.prompt, /Nothing was prepared again: the form was already submitted/);
});

test('while Bitwarden gives no password to fill, the fill is held and no run starts; it goes on once Bitwarden answers', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  // The bot's account may create items and not see passwords: `bw` answers each one as null.
  world.bitwarden.hidesPasswords = true;
  await approve(world);
  await world.assistant.whenIdle();

  assert.deepEqual(world.model.fillRuns, [], 'no fill run starts');
  assert.deepEqual(world.browser.sessionRequests.filter((r) => r.path.startsWith('/fill-run/')), [], 'and nothing is filled');
  assert.match(statusOf(world).text, /Waiting: Bitwarden is unavailable/);
  assert.match(String(logged(world, 'password-vault.unavailable').at(-1)!.why), /answers the item's password as null/);

  world.bitwarden.hidesPasswords = false;
  await world.advanceTo('2026-10-12T08:06:00Z');
  assert.equal(world.browser.presses.length, 1);
  assert.equal(world.browser.presses[0]!.values.password, world.bitwarden.items[0]!.login.password);
  assert.equal(world.bitwarden.items.length, 1);
});

test('Stop on an Approval held on Bitwarden abandons it before it starts, with Start again', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  world.bitwarden.down = true;
  await approve(world);
  await world.assistant.whenIdle();
  assert.match(world.discord.cards(NEEDS_YOU)[0]!.text, /Waiting for Bitwarden/);

  const stopped = await tapCard(world, 0, 'Stop');
  await world.assistant.whenIdle();
  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  assert.equal(updateOf(stopped)!.text, `Stopped v1 before it started · **Codemind** · <#${post!.id}>`);
  assert.equal(world.discord.cards(NEEDS_YOU)[0]!.text, `Stopped v1 before it started · **Codemind** · <#${post!.id}>`);
  assert.equal(standing(world), '**abandoned** · stopped by you; nothing submitted');
  assert.deepEqual(statusOf(world).buttons.map((b) => b.label), ['Start again']);
  assert.deepEqual(tags(world), ['abandoned']);

  // Bitwarden coming back starts nothing.
  world.bitwarden.down = false;
  await world.advanceTo('2026-10-12T08:20:00Z');
  assert.deepEqual(world.browser.sessions, []);
  assert.equal(standing(world), '**abandoned** · stopped by you; nothing submitted');
});

test('Stop between the page check and the press stops it: the store write that marks the press checks the stop mark', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  // The page check has passed, and plain code waits on the page's fingerprint, its last step before the press.
  const release = world.browser.pause('/plain-code/fingerprint');
  // Stop's own close of the session fails, so the session stays open, and only the stop mark keeps the press from it.
  world.browser.failCloses = true;
  await approve(world);
  await until(() => world.browser.requestsTo('/plain-code/fingerprint') === 1);
  await tapStatus(world, 'Stop');
  await until(() => logged(world, 'registration.abandoned').length === 1);
  assert.equal(world.browser.openSessions.length, 1, 'its session is still open');

  release();
  await world.assistant.whenIdle();
  assert.deepEqual(world.browser.presses, [], 'nothing was pressed');
  assert.deepEqual(logged(world, 'registration.press-intended'), [], 'no press was marked');
  assert.equal(standing(world), '**abandoned** · stopped by you; nothing submitted');

  // The session that didn't close is closed a few minutes on.
  world.browser.failCloses = false;
  await world.advanceTo('2026-10-12T08:06:00Z');
  assert.deepEqual(world.browser.openSessions, []);
});

test('a Stop that meets a Continue which turns out final comes too late: the form is submitted, the person is told, and Correct fixes only the record', async (t) => {
  const world = await walkthroughPut(t, codemind({ forms: withButton('Continue'), next: DONE.url }), { before: (w) => w.browser.page(DONE) });
  // Plain code reads the page the Continue led to, and is held there while the person taps Stop.
  const release = world.browser.pause('/plain-code/snapshot');
  await approve(world);
  await until(() => world.browser.requestsTo('/plain-code/snapshot') === 1);
  assert.match(updateOf(await tapStatus(world, 'Stop'))!.text, /Stopping…/);
  release();
  await world.assistant.whenIdle();

  assert.equal(world.browser.presses.length, 1);
  assert.equal(standing(world), `${SUBMITTED} · awaiting verification`);
  assert.match(statusOf(world).text, /Your Stop came as the final button was being pressed, so the form was submitted, and nothing can be unsent\./);
  assert.deepEqual(statusOf(world).buttons.map((b) => b.label), ['Correct']);
  const { opened } = await correctStatus(world, 'It should not have been submitted.');
  assert.deepEqual(popupOf(opened)!.texts, ['The form is already submitted, so this fixes only the record.']);
  await world.assistant.whenIdle();
  assert.equal(world.model.walkthroughRuns.length, 1, 'nothing is prepared again');
});

test('a session lost before any press opens again at page 1; one lost after a press waits on the person', async (t) => {
  await t.test('before any press', async (t) => {
    const world = await walkthroughPut(t, WITH_PASSWORD);
    // The browser service restarts while the first fill run fills the page.
    world.model.fill = (run, snapshot) => {
      if (world.model.fillRuns.length === 1 && run.snapshots === 1) world.browser.loseSessions();
      return plainFill(run.prompt, snapshot);
    };
    await approve(world);
    await world.assistant.whenIdle();

    assert.equal(world.browser.sessions.length, 2, 'a new session');
    assert.deepEqual(world.model.fillRuns.map((r) => r.page), [1, 1], 'filled again from page 1');
    assert.equal(world.browser.presses.length, 1);
    assert.equal(logged(world, 'registration.session-lost').length, 1);
    assert.match(standing(world), /awaiting verification$/);
  });

  await t.test('after a press', async (t) => {
    const world = await walkthroughPut(t, codemind({ forms: withButton('Continue'), next: step(2, 'Create account').url }), {
      before: (w) => w.browser.page(step(2, 'Create account', DONE.url)),
    });
    // The browser service restarts while page 2 is filled, after page 1's Continue was pressed.
    world.model.fill = (run, snapshot) => {
      if (run.page === 2 && run.snapshots === 1) world.browser.loseSessions();
      return plainFill(run.prompt, snapshot);
    };
    await approve(world);
    await world.assistant.whenIdle();

    assert.equal(world.browser.sessions.length, 1, 'no new session, which would press Continue again');
    assert.deepEqual(world.browser.presses.map((p) => p.button), ['Continue']);
    assert.equal(standing(world), 'stuck on page 2: session-lost');
    assert.deepEqual(statusOf(world).buttons.map((b) => b.label), ['Stop', 'Correct']);
    assert.deepEqual(tags(world), ['Needs you']);
  });
});

test('a page whose fill runs end with no finish gets 3 of them, then waits on the person', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  world.model.fill = () => [];
  await approve(world);
  await world.assistant.whenIdle();

  assert.deepEqual(world.model.fillRuns.map((r) => r.page), [1, 1, 1]);
  assert.equal(standing(world), 'stuck on page 1: fill-runs-spent');
  assert.deepEqual(world.browser.presses, []);
});

test('a session an outcome leaves open, because its close failed, is closed a few minutes on', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD, { change: (w) => ({ ...w, onSubmit: 'logged-in' }) });
  world.browser.failCloses = true;
  await approve(world);
  await world.assistant.whenIdle();
  assert.equal(standing(world), `${SUBMITTED} · **registered**`);
  assert.equal(world.browser.openSessions.length, 1);
  assert.equal(logged(world, 'registration.session-unclosed').length, 1);

  world.browser.failCloses = false;
  await world.advanceTo('2026-10-12T08:06:00Z');
  assert.deepEqual(world.browser.openSessions, []);
});

test('a fill run whose model calls a page\'s actions in one turn has them carried out in order', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  world.model.fill = (run, snapshot) =>
    run.snapshots === 1
      ? [
          [
            { tool: 'fill', args: { field: refOf(snapshot, 'email'), key: 'email' } },
            { tool: 'fill_secret', args: { field: refOf(snapshot, 'password'), secret: 'password' } },
            finish({ result: 'button', button: shownIn(snapshot).buttons[0]!.ref }),
          ],
        ]
      : [];
  await approve(world);
  await world.assistant.whenIdle();

  assert.deepEqual(world.model.fillRuns[0]!.fillReplies.map((r) => r.tool), ['snapshot', 'fill', 'fill_secret', 'finish']);
  assert.deepEqual(world.browser.presses.map((p) => p.values), [{ email: PLUS_ADDRESS, password: world.bitwarden.items[0]!.login.password, company: '' }]);
});

test('Correct on an Approval held on Bitwarden stops it, and its new version needs a fresh Approval', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  world.bitwarden.down = true;
  await approve(world);
  await world.assistant.whenIdle();
  const held = world.discord.cards(NEEDS_YOU)[0]!;
  assert.deepEqual(
    held.buttons.map((b) => [b.label, b.disabled]),
    [
      ['Approve', true],
      ['Correct', false],
      ['Dismiss', true],
      ['Stop', false],
    ],
  );

  const opened = await tapCard(world, 0, 'Correct');
  const popup = popupOf(opened)!;
  assert.deepEqual(popup.texts, ['This stops the Registration: nothing is submitted, and the new version needs your Approval.']);
  world.model.walkthrough = (run) => ({ ...plainWalkthrough(run.prompt), fields: [...plainWalkthrough(run.prompt).fields.filter((f) => f.field !== 3), { field: 3, fill: 'value', value: 'Example Ltd' }] });
  await world.discord.submitPopup({ userId: PERSON, customId: popup.customId, channelId: NEEDS_YOU, messageId: held.id, fields: { [popup.fields[0]!.customId]: 'Put Example Ltd as the company.' } });
  await world.assistant.whenIdle();

  assert.equal(standing(world), '**abandoned** · stopped by your Correction; nothing submitted');
  assert.match(world.discord.cards(NEEDS_YOU)[1]!.text, /Walkthrough v2 · Codemind/);
  world.bitwarden.down = false;
  await tapCard(world, 1, 'Approve');
  await world.assistant.whenIdle();
  assert.deepEqual(world.browser.presses.map((p) => p.values.company), ['Example Ltd']);
  assert.equal(world.bitwarden.items.length, 1);
});

test('a Walkthrough that Start again brought, left to lapse, is prepared again by Prepare again', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  world.model.holdFills = true;
  await approve(world);
  await until(() => world.model.fillRuns.length === 1);
  await tapStatus(world, 'Stop');
  world.model.holdFills = false;
  await world.assistant.whenIdle();
  await tapStatus(world, 'Start again');
  await world.assistant.whenIdle();
  assert.equal(world.model.walkthroughRuns.length, 2);

  await world.advanceTo('2026-10-26T08:00:00Z'); // 14 days on, v2 lapses
  assert.match(world.discord.cards(NEEDS_YOU)[1]!.text, /Lapsed: unanswered for 14 days\./);
  assert.deepEqual(statusOf(world).buttons.map((b) => b.label), ['Start again'], 'with no Walkthrough waiting, Start again is back');
  await tapCard(world, 1, 'Prepare again');
  await world.assistant.whenIdle();

  assert.equal(world.model.walkthroughRuns.length, 3);
  const fresh = world.discord.cards(NEEDS_YOU)[2]!;
  assert.match(fresh.text, /Walkthrough v3 · Codemind/);
  assert.match(fresh.text, /v3: prepared again from a fresh read, after v2 lapsed\./);
  assert.match(statusOf(world).text, /A new Walkthrough waits for your Approval/);
});

test('a press is matched to an intended mark of its own: a mark pressed twice fails, whatever else is marked', () => {
  const at = '2026-10-12T08:00:00.000Z';
  const intended = (press: number, session: string, fingerprint: string) => ({ at, event: 'registration.press-intended', press, session, fingerprint });
  const logs = [intended(1, 's1', 'aaaa'), intended(2, 's2', 'bbbb'), { at, event: 'registration.press-refused', press: 2 }, intended(2, 's2', 'cccc')];
  const press = (session: string, fingerprint: string) => ({ session, fingerprint, button: 'Create account' });
  assert.deepEqual(pressesWithoutMark(logs, [press('s1', 'aaaa'), press('s2', 'cccc')]), []);
  assert.deepEqual(pressesWithoutMark(logs, [press('s1', 'aaaa'), press('s1', 'aaaa')]), ['a press of "Create account" in session s1 with no intended mark of its own']);
  assert.deepEqual(pressesWithoutMark(logs, [press('s2', 'bbbb')]), ['a press of "Create account" in session s2 with no intended mark of its own'], 'a mark taken back presses nothing');
});

test('a page check past the browser service\'s 60-second limit loses its session, and before any press a new one opens at page 1', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  world.browser.timeOut('/plain-code/check');
  await approve(world);
  await world.assistant.whenIdle();

  assert.equal(world.browser.sessions.length, 2, 'a new session');
  assert.deepEqual(world.model.fillRuns.map((r) => r.page), [1, 1]);
  assert.equal(world.browser.presses.length, 1);
  assert.match(standing(world), /awaiting verification$/);
});

test('a session its earlier Approval left open, because its close failed, is closed before Start again\'s Approval opens a new one', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  world.model.holdFills = true;
  await approve(world);
  await until(() => world.model.fillRuns.length === 1);
  world.browser.failCloses = true;
  await tapStatus(world, 'Stop');
  world.model.holdFills = false;
  await world.assistant.whenIdle();
  const [first] = world.browser.sessions;
  assert.equal(first!.open, true, "Stop's close failed");

  // Its close is tried again every 5 minutes meanwhile, and keeps failing.
  await world.advanceTo('2026-10-12T08:30:00Z');
  assert.equal(first!.open, true);
  await tapStatus(world, 'Start again');
  await world.assistant.whenIdle();
  await tapCard(world, 1, 'Approve');
  await world.assistant.whenIdle();
  assert.equal(world.browser.sessions.length, 1, 'no new session while the earlier one is open');
  assert.match(statusOf(world).text, /Waiting: its earlier session didn't close/);

  world.browser.failCloses = false;
  await world.advanceTo('2026-10-12T08:36:00Z');
  assert.equal(first!.open, false);
  assert.deepEqual(world.browser.openSessions.map((x) => x.id), [world.browser.sessions[1]!.id]);
  assert.equal(world.browser.presses.length, 1);
  assert.match(standing(world), /awaiting verification$/);
});

test('a Correct pop-up opened on an earlier Approval is refused, and the Approval now leaves it untouched', async (t) => {
  const world = await walkthroughPut(t, WITH_PASSWORD);
  world.model.holdFills = true;
  await approve(world);
  await until(() => world.model.fillRuns.length === 1);
  // The person opens Correct on v1, and leaves the pop-up open.
  const old = popupOf(await tapStatus(world, 'Correct'))!;
  await tapStatus(world, 'Stop');
  world.model.holdFills = false;
  await world.assistant.whenIdle();
  await world.advanceTo('2026-10-12T09:00:00Z'); // 02:00 PDT
  await tapStatus(world, 'Start again');
  await world.assistant.whenIdle();
  world.model.holdFills = true;
  await tapCard(world, 1, 'Approve');
  await until(() => world.model.fillRuns.length === 2);

  const [post] = world.discord.forumPosts(PRODUCTS_FORUM);
  const sent = await world.discord.submitPopup({ userId: PERSON, customId: old.customId, channelId: post!.id, messageId: statusOf(world).id, fields: { [old.fields[0]!.customId]: 'Put Example Ltd as the company.' } });
  assert.equal(sent.data?.content, 'Nothing was done: that was shown for Walkthrough v1, and v2 is the one approved now. Use the status message as it stands.');
  assert.equal(standing(world), 'filling page 1', 'v2 goes on');
  assert.deepEqual(statusOf(world).buttons.map((b) => b.label), ['Stop', 'Correct']);
  assert.equal(logged(world, 'registration.corrected').length, 0);
});
