// Plain code's actions through the socket: the press and its preconditions, verification by reference, the page
// fingerprint and the masked screenshot, against real Chromium on local test pages.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approved, browser, filledSignup, ok, openSession, received, refused } from './harness.ts';
import { readPng } from './png.ts';

test('press is refused while the page check fails, with the check that failed', async (t) => {
  const password = `Unpressed-${Date.now()}-a1!`;
  const session = await filledSignup(t, '', ['f7'], password);

  const answer = await browser().press(session, approved);
  assert.ok(!answer.ok);
  assert.equal(answer.error.kind, 'check-failed');
  assert.deepEqual(answer.error.check?.failures.map((f) => `${f.rule} ${f.ref}`), ['invalid f7']);
  assert.ok(!(await received()).some((r) => r.form.some(([, v]) => v === password)), 'the form was sent');
});

test("press is refused for a button that isn't visible, enabled, or its form's only submit control", async (t) => {
  // The first two pages change their button once the terms box is ticked, after the snapshot that named it.
  for (const [flags, why] of [
    ['?hide-button', "b1 isn't visible"],
    ['?disable-button', 'b1 is disabled'],
    ['?two-submits', "b1 isn't the only submit control of its form"],
  ] as const) {
    const answer = await browser().press(await filledSignup(t, flags), approved);
    assert.deepEqual(answer.ok ? 'pressed' : [answer.error.kind, answer.error.message], ['not-pressable', why], flags);
  }
});

test('press is refused when a field filled on the page is in another form', async (t) => {
  const session = await filledSignup(t);
  await ok(browser().drive(session, 'fill-run'));
  await ok(browser().fill(session, 'f9', 'email', 'sam+acme@gmail.com'));
  await ok(browser().drive(session, 'plain-code'));

  // The check judges only the signup form, and passes.
  assert.equal((await ok(browser().check(session, approved))).pass, true);
  const answer = await browser().press(session, approved);
  assert.deepEqual(answer.ok ? 'pressed' : [answer.error.kind, answer.error.message], ['not-pressable', "a field filled on this page isn't in the form b1 submits"]);
});

test("press is refused off the Walkthrough's domains, and while something covers the button", async (t) => {
  const vendor = await openSession(t, 'http://acme.test/register', { domains: ['acme.test'], driver: 'plain-code' });
  assert.equal(await refused(browser().press(vendor, { ...approved, signupHost: 'accounts.authvendor.test' })), 'off-domain');

  // A banner no consent rule knows comes up over the page.
  const covered = await filledSignup(t, '?overlay');
  assert.equal((await ok(browser().check(covered, approved))).pass, true);
  assert.equal(await refused(browser().press(covered, approved)), 'blocked');
});

test('a press with the fingerprint of the page the person approved on a Submit tap lets through the values they saw', async (t) => {
  const password = `Approved-${Date.now()}-a1!`;
  // The page presets the role, and the Walkthrough leaves it alone.
  const session = await filledSignup(t, '?preset-role', ['f4'], password);
  assert.deepEqual((await ok(browser().check(session, approved))).failures.map((f) => `${f.rule} ${f.ref}`), ['unapproved-value f4']);
  assert.equal(await refused(browser().press(session, approved)), 'check-failed', 'without the person, a value nobody approved fails');
  const { fingerprint } = await ok(browser().fingerprint(session));

  const { pass, failures } = await ok(browser().check(session, { ...approved, approvedPage: fingerprint }));
  assert.deepEqual({ pass, failures }, { pass: true, failures: [] });
  await ok(browser().press(session, { ...approved, approvedPage: fingerprint }));

  const sent = (await received()).filter((r) => r.form.some(([, v]) => v === password));
  assert.deepEqual(sent.map((r) => r.form.find(([name]) => name === 'role')), [['role', 'dev']]);
});

test("a Submit tap's press is refused once the page has changed since its screenshot, and never lets through a required field left empty", async (t) => {
  const password = `Changed-${Date.now()}-a1!`;
  const session = await filledSignup(t, '?preset-role', ['f4'], password);
  const { fingerprint } = await ok(browser().fingerprint(session));
  // The name is filled again with another value after the screenshot.
  await ok(browser().drive(session, 'fill-run'));
  await ok(browser().fill(session, 'f1', 'full-name', 'Sam Other'));
  await ok(browser().drive(session, 'plain-code'));

  assert.equal(await refused(browser().check(session, { ...approved, approvedPage: fingerprint })), 'changed');
  assert.equal(await refused(browser().press(session, { ...approved, approvedPage: fingerprint })), 'changed');

  // The required terms box is left unticked: the person's Submit doesn't let that through.
  const unticked = await filledSignup(t, '?preset-role', ['f4', 'f7'], password);
  const page = (await ok(browser().fingerprint(unticked))).fingerprint;
  const answer = await browser().press(unticked, { ...approved, approvedPage: page });
  assert.deepEqual(answer.ok ? 'pressed' : [answer.error.kind, answer.error.check?.failures.map((f) => `${f.rule} ${f.ref}`)], ['check-failed', ['invalid f7']]);
  assert.equal(await refused(browser().press(unticked, { ...approved, approvedPage: 'not a fingerprint' })), 'bad-request');

  assert.ok(!(await received()).some((r) => r.form.some(([, v]) => v === password)), 'nothing was sent');
});

test("a password a script changes after its fill fails as filled by reference, and a Submit tap's fingerprint never lets it through", async (t) => {
  const password = `Shortened-${Date.now()}-a1!`;
  // The page cuts the password to 8 characters as it is typed: the screenshot masks it, so the person can't see that.
  const session = await filledSignup(t, '?short-password', [], password);
  const check = await ok(browser().check(session, approved));
  assert.deepEqual(check.failures.map((f) => [f.rule, f.ref, f.secret]), [['unapproved-value', 'f3', true]]);
  const { fingerprint } = await ok(browser().fingerprint(session));

  const answer = await browser().press(session, { ...approved, approvedPage: fingerprint });
  assert.deepEqual(answer.ok ? 'pressed' : [answer.error.kind, answer.error.check?.failures.map((f) => `${f.rule} ${f.ref}`)], ['check-failed', ['unapproved-value f3']]);
  assert.ok(!(await received()).some((r) => r.form.some(([, v]) => v === password.slice(0, 8))), 'nothing was sent');
});

test("a page's shape stays the same when its button is disabled or a field filled, where its fingerprint changes", async (t) => {
  const session = await openSession(t, 'http://acme.test/session/signup?disable-button');
  await ok(browser().snapshot(session));
  await ok(browser().drive(session, 'plain-code'));
  const before = await ok(browser().fingerprint(session));
  await ok(browser().drive(session, 'fill-run'));
  await ok(browser().fill(session, 'f1', 'full-name', 'Sam Example'));
  // Ticking the terms disables the button.
  await ok(browser().choose(session, 'f7', 'terms', 'ticked'));
  await ok(browser().drive(session, 'plain-code'));
  const after = await ok(browser().fingerprint(session));
  assert.equal(after.shape, before.shape);
  assert.notEqual(after.fingerprint, before.fingerprint);
});

test('plain code fills an emailed code by reference and presses Verify', async (t) => {
  const code = String(Date.now()).slice(-6);
  const session = await openSession(t, 'http://acme.test/session/verify', { driver: 'plain-code' });
  const { snapshot } = await ok(browser().plainSnapshot(session));
  const [form] = snapshot.forms;
  assert.deepEqual(form?.fields.map((f) => `${f.ref} ${f.label} ${f.autocomplete}`), ['f1 Code from your email one-time-code']);
  assert.deepEqual(form?.submits.map((s) => `${s.ref} ${s.label}`), ['b1 Verify']);

  await ok(browser().fillCode(session, 'f1', code));
  const { pressedAt } = await ok(browser().press(session, { button: 'b1', signupHost: 'acme.test', terms: [], identity: [] }));

  assert.ok(Math.abs(Date.parse(pressedAt) - Date.now()) < 10_000, pressedAt);
  const sent = (await received()).filter((r) => r.url === '/api/session/verify' && r.form.some(([, v]) => v === code));
  assert.deepEqual(sent.map((r) => r.form), [[['code', code]]]);
});

test('plain code opens a verification link by reference, and the session closes', async (t) => {
  const token = `Qm3xZ8pL2vR9tN4kW7yB${Date.now()}`;
  const session = await openSession(t, 'http://acme.test/session/verify', { driver: 'plain-code' });

  await ok(browser().openLink(session, `http://acme.test/session/verified?token=${token}`));

  assert.deepEqual(
    (await received()).filter((r) => r.url.includes(token)).map((r) => `${r.method} ${r.host}${r.url}`),
    [`GET acme.test/session/verified?token=${token}`],
  );
  assert.equal(await refused(browser().fingerprint(session)), 'unknown-session');
});

test('a fingerprint stays the same for the same page, and changes with its URL, its form or a value; its shape changes with the first two alone', async (t) => {
  const session = await openSession(t, 'http://acme.test/session/signup?late-field', { driver: 'plain-code' });
  const fingerprint = async () => (await ok(browser().fingerprint(session))).fingerprint;
  const first = await fingerprint();

  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(await fingerprint(), first);
  // A snapshot rejects cookie banners and gives refs, and changes nothing a fingerprint covers.
  await ok(browser().plainSnapshot(session));
  assert.equal(await fingerprint(), first);
  // Another load of the page has a new hidden token, which no fingerprint covers.
  const other = await openSession(t, 'http://acme.test/session/signup?late-field', { driver: 'plain-code' });
  assert.equal((await ok(browser().fingerprint(other))).fingerprint, first);

  // The page adds a Company field 8 s after it loads.
  let grown = first;
  for (let i = 0; i < 100 && grown === first; i++) {
    await new Promise((r) => setTimeout(r, 100));
    grown = await fingerprint();
  }
  assert.notEqual(grown, first);
  assert.ok((await ok(browser().plainSnapshot(session))).snapshot.forms[0]!.fields.some((f) => f.label === 'Company'));

  const shape = async () => (await ok(browser().fingerprint(session))).shape;
  const grownShape = await shape();
  await ok(browser().drive(session, 'fill-run'));
  await ok(browser().fill(session, 'f1', 'full-name', 'Sam Example'));
  await ok(browser().drive(session, 'plain-code'));
  const named = await fingerprint();
  assert.notEqual(named, grown);
  // Its shape leaves out what the fields hold: the same form on the same URL, whatever is filled (#59).
  assert.match(grownShape, /^[0-9a-f]{64}$/);
  assert.equal(await shape(), grownShape);
  // The same value filled again is the same page.
  await ok(browser().drive(session, 'fill-run'));
  await ok(browser().fill(session, 'f1', 'full-name', 'Sam Example'));
  const plans = (await ok(browser().snapshot(session))).snapshot.links.find((l) => l.text === 'Plans')!.ref!;
  await ok(browser().drive(session, 'plain-code'));
  assert.equal(await fingerprint(), named);

  await ok(browser().drive(session, 'fill-run'));
  await ok(browser().open(session, plans));
  await ok(browser().drive(session, 'plain-code'));
  assert.notEqual(await fingerprint(), named);
  assert.notEqual(await shape(), grownShape, 'another page has another shape');
});

test('a screenshot masks every field filled by reference, and outlines the named button and marks a field', async (t) => {
  const session = await openSession(t, 'http://acme.test/session/shot');
  await ok(browser().snapshot(session));
  await ok(browser().fill(session, 'f1', 'full-name', 'Sam Example'));
  await ok(browser().fillSecret(session, 'f2', 'password', 'Zk3mQ8xL2pV9rT4nW7yB-a1!'));
  await ok(browser().fillSecret(session, 'f3', 'code', '482913'));
  await ok(browser().drive(session, 'plain-code'));

  const plain = readPng(Buffer.from((await ok(browser().screenshot(session))).png, 'base64'));
  const marked = readPng(Buffer.from((await ok(browser().screenshot(session, { outline: 'b1', mark: ['f1'] }))).png, 'base64'));

  // shot.html places each field 300×40 at x 40: the name at y 100, the password at 180, the code at 260, and a
  // 200×40 button at 340. An outline sits 3 to 7 px outside its element.
  const magenta = [255, 0, 255];
  for (const image of [plain, marked]) {
    assert.deepEqual(image.at(190, 200), magenta, 'the password is masked');
    assert.deepEqual(image.at(190, 280), magenta, 'the code is masked');
    assert.notDeepEqual(image.at(190, 120), magenta, 'the name is not');
  }
  const near = (colour: number[], expected: number[]) => colour.every((c, i) => Math.abs(c - expected[i]!) <= 24);
  assert.deepEqual(plain.at(35, 360), [255, 255, 255]);
  assert.ok(near(marked.at(35, 360), [224, 49, 49]), `the button's outline is ${marked.at(35, 360)}`);
  assert.deepEqual(plain.at(35, 120), [255, 255, 255]);
  assert.ok(near(marked.at(35, 120), [240, 140, 0]), `the field's mark is ${marked.at(35, 120)}`);
});

test('a screenshot masks a field the page moved a password into, and the check flags that field as holding a Secret', async (t) => {
  const password = 'Zk3mQ8xL2pV9rT4nW7yB-a1!';
  const session = await openSession(t, 'http://acme.test/session/shot?swap-password');
  await ok(browser().snapshot(session));
  await ok(browser().fillSecret(session, 'f2', 'password', password));
  // The page swaps the password field for a plain one holding the same value.
  for (let i = 0; i < 50; i++) {
    const { snapshot } = await ok(browser().snapshot(session));
    if (snapshot.forms[0]!.fields.some((f) => f.label === 'Password' && f.type === 'text')) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await ok(browser().drive(session, 'plain-code'));

  const shot = readPng(Buffer.from((await ok(browser().screenshot(session))).png, 'base64'));
  assert.deepEqual(shot.at(190, 200), [255, 0, 255], 'the plain field holding the password is masked');
  const check = await ok(browser().check(session, { button: 'b1', signupHost: 'acme.test', terms: [], identity: [] }));
  assert.deepEqual(check.failures.filter((f) => f.field === 'Password').map((f) => [f.rule, f.secret]), [['unapproved-value', true]]);
});

test('a ref from before a navigation is stale, and plain code takes a snapshot of its own to go on', async (t) => {
  const session = await openSession(t, 'http://acme.test/session/signup');
  const { snapshot } = await ok(browser().snapshot(session));
  await ok(browser().open(session, snapshot.links.find((l) => l.text === 'Pricing')!.ref!));
  await ok(browser().drive(session, 'plain-code'));

  assert.equal(await refused(browser().check(session, approved)), 'stale');
  assert.equal(await refused(browser().screenshot(session, { outline: 'b1' })), 'stale');
});

test("a press counts only the filled fields still shown, as when an earlier step of the same document has hidden", async (t) => {
  const password = `Steps-${Date.now()}-a1!`;
  const session = await openSession(t, 'http://accounts.authvendor.test/session/steps', { domains: ['acme.test', 'authvendor.test'] });
  const vendor = { button: 'b1', signupHost: 'accounts.authvendor.test', terms: [], identity: approved.identity };
  await ok(browser().snapshot(session));
  await ok(browser().fill(session, 'f1', 'email', 'sam+acme@gmail.com'));
  await ok(browser().drive(session, 'plain-code'));
  await ok(browser().press(session, vendor));

  // Continue hid the email step and showed the details step, in the same document.
  await ok(browser().drive(session, 'fill-run'));
  const { snapshot } = await ok(browser().snapshot(session));
  assert.deepEqual(snapshot.forms.map((f) => f.fields.map((field) => field.label)), [['Full name', 'Password']]);
  await ok(browser().fill(session, 'f1', 'full-name', 'Sam Example'));
  await ok(browser().fillSecret(session, 'f2', 'password', password));
  await ok(browser().drive(session, 'plain-code'));
  await ok(browser().press(session, vendor));

  const sent = (await received()).filter((r) => r.url === '/api/session/steps' && r.form.some(([, v]) => v === password));
  assert.deepEqual(sent.map((r) => r.form), [[['name', 'Sam Example'], ['password', password]]]);
});

test('a form that shows only its button can be pressed under the check', async (t) => {
  const session = await openSession(t, 'http://acme.test/session/review', { driver: 'plain-code' });
  const { snapshot } = await ok(browser().plainSnapshot(session));
  assert.deepEqual(snapshot.forms.map((f) => [f.fields.length, f.submits.map((s) => `${s.ref} ${s.label}`)]), [[0, ['b1 Join waitlist']]]);
  const before = (await received()).length;

  await ok(browser().press(session, { button: 'b1', signupHost: 'acme.test', terms: [], identity: [] }));

  const sent = (await received()).slice(before).filter((r) => r.url === '/api/session/review');
  assert.deepEqual(sent.map((r) => r.form), [[['email', 'sam+acme@gmail.com'], ['step', 'review']]]);
});

test('a string that is no well-formed text is refused before it reaches the page', async (t) => {
  const session = await openSession(t, 'http://acme.test/session/verify', { driver: 'plain-code' });
  await ok(browser().plainSnapshot(session));

  assert.equal(await refused(browser().fillCode(session, 'f1', '48\ud80029')), 'bad-request');
  await ok(browser().plainSnapshot(session));
});
