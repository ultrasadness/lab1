// A Registration's session through the socket: opening and closing it, its limits and its drivers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertIncludes, browser, inBrowserContainer, ok, openSession, refused } from './harness.ts';

test("a session's snapshot names each field, button and link by a ref, and shows no field's value", async (t) => {
  const session = await openSession(t, 'http://acme.test/session/signup');

  const { snapshot } = await ok(browser().snapshot(session));

  assert.equal(snapshot.url, 'http://acme.test/session/signup');
  const [signup, newsletter] = snapshot.forms;
  assert.deepEqual(
    signup?.fields.map((f) => `${f.ref} ${f.type} ${f.label}`),
    [
      'f1 text Full name',
      'f2 email Email',
      'f3 password Password',
      'f4 select Your role',
      'f5 radio Plan',
      'f6 checkbox Email me tips',
      'f7 checkbox I agree to the Terms of Service and Privacy Policy',
      // Outside the <form> element, but in the form through its form= attribute.
      'f8 text Referral code',
    ],
  );
  assert.deepEqual(signup?.submits, [{ ref: 'b1', label: 'Create account', disabled: false }]);
  assert.deepEqual(signup?.fields[3]?.options, [
    { label: 'Choose one', value: '' },
    { label: 'Developer', value: 'dev' },
    { label: 'Product manager', value: 'pm' },
  ]);
  assert.deepEqual(
    newsletter?.fields.map((f) => `${f.ref} ${f.label}`),
    ['f9 Newsletter email', 'f10 Weekly'],
  );
  assert.deepEqual(newsletter?.submits.map((s) => s.ref), ['b2']);

  const links = snapshot.links.map((l) => `${l.ref} ${l.text} → ${l.href}`);
  for (const link of ['Pricing → http://acme.test/session/pricing', 'About us → http://elsewhere.test/about', 'Terms of Service → http://acme.test/terms']) {
    assert.ok(links.some((l) => /^l\d+ /.test(l) && l.endsWith(link)), `missing ${link} in ${links.join(', ')}`);
  }

  // The newsletter box is ticked and its address filled by the page, and neither shows.
  for (const field of snapshot.forms.flatMap((f) => f.fields)) {
    assert.ok(!('value' in field) && !('checked' in field) && !('filled' in field), JSON.stringify(field));
  }
  assert.ok(!JSON.stringify(snapshot).includes('news@acme.test'));
});

const signup = 'http://acme.test/session/signup';
const opening = (registration: string) => browser().openSession({ registration, url: signup, domains: ['acme.test'] });

test('at most 5 sessions are open at once, one per Registration, and closing one frees its place', async (t) => {
  const sessions: string[] = [];
  t.after(() => Promise.all(sessions.map((s) => browser().closeSession(s))));
  for (let i = 1; i <= 5; i++) sessions.push((await ok(opening(`limit-${i}`))).session);

  assert.equal(await refused(opening('limit-6')), 'full');
  assert.equal(await refused(opening('limit-2')), 'already-open');

  await ok(browser().closeSession(sessions[1]!));
  assert.equal(await refused(browser().snapshot(sessions[1]!)), 'unknown-session');
  sessions.push((await ok(opening('limit-6'))).session);
});

test('a session nothing is asked of closes after the idle limit, and any request keeps one open', async (t) => {
  const idle = await openSession(t, signup);
  const busy = await openSession(t, signup, { driver: 'plain-code' });

  // compose.test.yaml sets the limit to 15 s; ask of one session every 4 s for 20 s, and of the other nothing.
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 4_000));
    await ok(browser().fingerprint(busy));
  }

  assert.equal(await refused(browser().snapshot(idle)), 'unknown-session');
  await ok(browser().fingerprint(busy));
});

test('each action needs its own driver, and the person driving shuts out the rest', async (t) => {
  const session = await openSession(t, signup, { driver: 'none' });
  const check = { button: 'b1', signupHost: 'acme.test', terms: [], identity: [] };

  assert.equal(await refused(browser().snapshot(session)), 'not-driving');
  assert.equal(await refused(browser().fingerprint(session)), 'not-driving');

  await ok(browser().drive(session, 'fill-run'));
  await ok(browser().snapshot(session));
  assert.equal(await refused(browser().press(session, check)), 'not-driving');
  assert.equal(await refused(browser().screenshot(session)), 'not-driving');

  await ok(browser().drive(session, 'plain-code'));
  await ok(browser().check(session, check));
  assert.equal(await refused(browser().fill(session, 'f1', 'full-name', 'Sam Example')), 'not-driving');

  await ok(browser().drive(session, 'person'));
  assert.equal(await refused(browser().snapshot(session)), 'not-driving');
  assert.equal(await refused(browser().fill(session, 'f1', 'full-name', 'Sam Example')), 'not-driving');
  assert.equal(await refused(browser().check(session, check)), 'not-driving');
  assert.equal(await refused(browser().press(session, check)), 'not-driving');
});

test('each session is a context of its own, and nothing it keeps reaches the disk', async (t) => {
  const marker = `kept-${Date.now()}`;
  const first = await openSession(t, `http://acme.test/session/remember?marker=${marker}`);
  await ok(browser().snapshot(first));
  await ok(browser().open(first, 'l1'));
  assertIncludes((await ok(browser().snapshot(first))).snapshot.text, `Remembered: ${marker}, cookie marker=${marker}`);

  const second = await openSession(t, 'http://acme.test/session/remember');
  assertIncludes((await ok(browser().snapshot(second))).snapshot.text, 'Remembered: nothing, cookie none');

  // The only writable places in the container.
  const { out } = await inBrowserContainer('grep', '-rls', marker, '/tmp', '/home/pwuser');
  assert.equal(out.trim(), '');
});

test('an action on a page that never lets go times out and closes its session, and other sessions go on', async (t) => {
  const session = await openSession(t, 'http://acme.test/hang');
  const start = Date.now();

  assert.equal(await refused(browser().snapshot(session)), 'timeout');
  // compose.test.yaml sets the limit to 20 s.
  assert.ok(Date.now() - start < 25_000, `answered after ${Date.now() - start} ms`);
  assert.equal(await refused(browser().snapshot(session)), 'unknown-session');

  await ok(browser().snapshot(await openSession(t, signup)));
});
