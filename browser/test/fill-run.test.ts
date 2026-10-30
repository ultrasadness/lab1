// The fixed actions a fill run may use, through the socket, against real Chromium on local test pages.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Field, Snapshot } from '../src/api.ts';
import { assertIncludes, browser, ok, openSession, refused } from './harness.ts';

const fields = (snapshot: Snapshot): Field[] => snapshot.forms.flatMap((f) => f.fields);
const byLabel = (snapshot: Snapshot, label: string) => fields(snapshot).find((f) => f.label === label) ?? assert.fail(`no field ${label}`);

test('a snapshot shows each filled field by the key or reference that filled it', async (t) => {
  const session = await openSession(t, 'http://acme.test/session/signup');
  await ok(browser().snapshot(session));

  await ok(browser().fill(session, 'f1', 'full-name', 'Sam Example'));
  await ok(browser().fill(session, 'f2', 'email', 'sam+acme@gmail.com'));
  await ok(browser().fillSecret(session, 'f3', 'password', 'Zk3mQ8xL2pV9rT4nW7yB-a1!'));
  await ok(browser().choose(session, 'f4', 'choice', 'Developer'));
  await ok(browser().choose(session, 'f5', 'plan', 'Team'));
  await ok(browser().choose(session, 'f7', 'terms', 'ticked'));
  const { snapshot } = await ok(browser().snapshot(session));

  assert.deepEqual(
    fields(snapshot).map((f) => `${f.label}: ${f.filled ?? 'empty'}`),
    [
      'Full name: full-name',
      'Email: email',
      'Password: [password]',
      'Your role: choice',
      'Plan: plan',
      // Choosing Team asked for the team's name.
      'Team name: empty',
      'Email me tips: empty',
      'I agree to the Terms of Service and Privacy Policy: terms',
      'Referral code: empty',
      'Newsletter email: empty',
      'Weekly: empty',
    ],
  );
  for (const value of ['Sam Example', 'sam+acme@gmail.com', 'Zk3mQ8xL2pV9rT4nW7yB']) {
    assert.ok(!JSON.stringify(snapshot.forms).includes(`"${value}`), `${value} shows in the fields`);
  }
});

test('each action takes only the fields it is for', async (t) => {
  const session = await openSession(t, 'http://acme.test/session/signup');
  await ok(browser().snapshot(session));

  assert.equal(await refused(browser().fill(session, 'f3', 'text', 'hunter2')), 'not-allowed');
  assert.equal(await refused(browser().fill(session, 'f4', 'text', 'Developer')), 'not-allowed');
  assert.equal(await refused(browser().fillSecret(session, 'f1', 'password', 'Zk3mQ8xL2pV9rT4nW7yB-a1!')), 'not-allowed');
  assert.equal(await refused(browser().choose(session, 'f1', 'choice', 'Sam')), 'not-allowed');
  assert.equal(await refused(browser().choose(session, 'f4', 'choice', 'Designer')), 'not-allowed');
  assert.equal(await refused(browser().choose(session, 'f5', 'plan', 'Enterprise')), 'not-allowed');
  assert.equal(await refused(browser().choose(session, 'f7', 'terms', 'yes')), 'bad-request');
  assert.equal(await refused(browser().fill(session, 'f99', 'text', 'Sam')), 'stale');
  assert.equal(await refused(browser().open(session, 'f1')), 'stale');
});

test('choose ticks and unticks custom and styled boxes, and picks an option from a custom list', async (t) => {
  const session = await openSession(t, 'http://acme.test/session/custom');
  const before = await ok(browser().snapshot(session));
  assertIncludes(before.snapshot.text, 'News: false. Dark mode: true. Country: none. Digest: false. Beta: false.');
  const ref = (label: string) => byLabel(before.snapshot, label).ref!;

  await ok(browser().choose(session, ref('Send me news'), 'news', 'ticked'));
  await ok(browser().choose(session, ref('Dark mode'), 'dark-mode', 'left unticked'));
  await ok(browser().choose(session, ref('Country'), 'country', 'Portugal'));
  await ok(browser().choose(session, ref('Weekly digest'), 'digest', 'ticked'));
  // A radio with no name is a choice of its own.
  await ok(browser().choose(session, ref('Join the beta'), 'beta', 'ticked'));
  // Already as approved: nothing is clicked.
  await ok(browser().choose(session, ref('Send me news'), 'news', 'ticked'));
  assert.equal(await refused(browser().choose(session, ref('Nickname'), 'nickname', 'Sam')), 'not-allowed');

  const after = await ok(browser().snapshot(session));
  assertIncludes(after.snapshot.text, 'News: true. Dark mode: false. Country: Portugal. Digest: true. Beta: true.');
});

test('every action is refused once the top-level page is off the Walkthrough\'s domains', async (t) => {
  // The signup redirects to an auth vendor the Walkthrough didn't name.
  const session = await openSession(t, 'http://acme.test/register', { domains: ['acme.test'] });

  assert.equal(await refused(browser().snapshot(session)), 'off-domain');
  assert.equal(await refused(browser().fill(session, 'f1', 'email', 'sam+acme@gmail.com')), 'off-domain');
  assert.equal(await refused(browser().fillSecret(session, 'f2', 'password', 'Zk3mQ8xL2pV9rT4nW7yB-a1!')), 'off-domain');
  assert.equal(await refused(browser().choose(session, 'f1', 'choice', 'ticked')), 'off-domain');
  assert.equal(await refused(browser().open(session, 'l1')), 'off-domain');
  await ok(browser().drive(session, 'plain-code'));
  assert.equal(await refused(browser().fillCode(session, 'f1', '482913')), 'off-domain');
});

test('open loads a link on the Walkthrough\'s domains, and refuses one that leads off them', async (t) => {
  const session = await openSession(t, 'http://acme.test/session/signup');
  const { snapshot } = await ok(browser().snapshot(session));
  const link = (text: string) => snapshot.links.find((l) => l.text === text)?.ref ?? assert.fail(`no link ${text}`);

  assert.equal(await refused(browser().open(session, link('About us'))), 'off-domain');
  assert.equal((await ok(browser().snapshot(session))).snapshot.url, 'http://acme.test/session/signup');

  await ok(browser().open(session, link('Plans')));
  assert.equal((await ok(browser().snapshot(session))).snapshot.url, 'http://acme.test/session/signup#plans');

  // A click on Pricing would run its script, which goes elsewhere.
  await ok(browser().open(session, link('Pricing')));
  assert.equal((await ok(browser().snapshot(session))).snapshot.url, 'http://acme.test/session/pricing');
});

test('every Secret filled into the session is removed from each later snapshot by its exact value', async (t) => {
  const password = 'Sunflower Meadow+1987!';
  const code = '482913';
  const session = await openSession(t, 'http://acme.test/session/echo');
  await ok(browser().snapshot(session));
  await ok(browser().fill(session, 'f1', 'full-name', 'Sam Example'));
  await ok(browser().fillSecret(session, 'f2', 'password', password));
  await ok(browser().fillSecret(session, 'f3', 'code', code));

  const filled = await ok(browser().snapshot(session));
  const everything = JSON.stringify(filled.snapshot);
  // A GET form's query writes a space as +.
  const formEncoded = new URLSearchParams({ p: password }).toString().slice(2);
  assert.equal(formEncoded, 'Sunflower+Meadow%2B1987%21');
  for (const part of [password, encodeURIComponent(password), formEncoded, code, 'Meadow']) assert.ok(!everything.includes(part), `${part} is in the snapshot`);
  assert.equal(
    filled.snapshot.links.find((l) => l.text === 'Check again as a form would')?.href,
    'http://acme.test/session/echo?name=Sam+Example&password=[password]&code=[code]',
  );
  assertIncludes(filled.snapshot.text, 'You typed name=Sam Example, password=[password], code=[code]');
  assertIncludes(filled.snapshot.title, 'password=[password] code=[code]');
  assert.deepEqual(
    fields(filled.snapshot).map((f) => f.filled),
    ['full-name', '[password]', '[code]'],
  );

  // The page the link leads to carries both in its URL and its text, and a code plain code fills is removed too.
  const again = filled.snapshot.links.find((l) => l.text === 'Check again')!;
  assert.equal(again.href, 'http://acme.test/session/echo?name=Sam%20Example&password=[password]&code=[code]');
  await ok(browser().open(session, again.ref!));
  const reached = await ok(browser().snapshot(session));
  assert.equal(reached.snapshot.url, 'http://acme.test/session/echo?name=Sam%20Example&password=[password]&code=[code]');
  assertIncludes(reached.snapshot.text, 'You sent name=Sam Example&password=[password]&code=[code]');
  for (const part of [password, encodeURIComponent(password), code]) assert.ok(!JSON.stringify(reached.snapshot).includes(part), `${part} is in the snapshot`);

  const second = '771204';
  await ok(browser().drive(session, 'plain-code'));
  await ok(browser().fillCode(session, 'f3', second));
  await ok(browser().drive(session, 'fill-run'));
  const next = await ok(browser().snapshot(session));
  assert.ok(!JSON.stringify(next.snapshot).includes(second), `${second} is in the snapshot`);
  assertIncludes(next.snapshot.text, 'You typed name=, password=, code=[code]');
  assert.equal(byLabel(next.snapshot, 'Code from your email').filled, '[code]');
});

test('cookie banners are rejected before every snapshot, on each page the session reaches', async (t) => {
  const session = await openSession(t, 'http://acme.test/session/remember');
  const first = await ok(browser().snapshot(session));
  assert.equal(first.cookieBanner, null);

  await ok(browser().open(session, first.snapshot.links.find((l) => l.text === 'Our cookies')!.ref!));
  const second = await ok(browser().snapshot(session));
  assert.deepEqual(second.cookieBanner, { manager: 'Complianz banner', rejected: true });
  assertIncludes(second.snapshot.text, 'Cookie choice: denied');
});

test('card fields are refused whatever is asked, and fields in a payment provider\'s frame are never offered', async (t) => {
  const session = await openSession(t, 'http://acme.test/session/card');
  const { snapshot, paymentFields } = await ok(browser().snapshot(session));

  assert.equal(paymentFields, true);
  assert.deepEqual(
    fields(snapshot).map((f) => `${f.ref} ${f.label}`),
    ['f1 Full name', 'f2 Card number', 'f3 Expiry month'],
  );
  assert.equal(await refused(browser().fill(session, 'f2', 'text', '4242424242424242')), 'payment-field');
  assert.equal(await refused(browser().fillSecret(session, 'f2', 'code', '4242424242424242')), 'payment-field');
  assert.equal(await refused(browser().choose(session, 'f3', 'choice', '01')), 'payment-field');
  await ok(browser().drive(session, 'plain-code'));
  assert.equal(await refused(browser().fillCode(session, 'f2', '4242424242424242')), 'payment-field');
});
