// The fill smoke test, and the browser image's upgrade gate (ADR 0006): a Registration filled and pressed on a local
// test form, as a fill run and plain code drive it, and exactly the approved values reaching the Product's server.
// `npm run smoke` runs it alone.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approved, browser, ok, openSession, received } from './harness.ts';

test('a form filled through the fixed actions and pressed by plain code sends exactly the approved values', async (t) => {
  const password = `Zk3mQ8xL2pV9rT4nW7yB-${Date.now()}`;
  const session = await openSession(t, 'http://acme.test/session/signup');

  // The fill run.
  const { snapshot } = await ok(browser().snapshot(session));
  assert.deepEqual(snapshot.forms[0]?.submits.map((s) => `${s.ref} ${s.label}`), ['b1 Create account']);
  await ok(browser().fill(session, 'f1', 'full-name', 'Sam Example'));
  await ok(browser().fill(session, 'f2', 'email', 'sam+acme@gmail.com'));
  await ok(browser().fillSecret(session, 'f3', 'password', password));
  await ok(browser().choose(session, 'f4', 'choice', 'Developer'));
  await ok(browser().choose(session, 'f5', 'plan', 'Free'));
  await ok(browser().choose(session, 'f7', 'terms', 'ticked'));
  assert.ok(!JSON.stringify((await ok(browser().snapshot(session))).snapshot).includes(password));

  // Plain code.
  await ok(browser().drive(session, 'plain-code'));
  assert.deepEqual(await ok(browser().check(session, approved)), { ok: true, pass: true, failures: [] });
  await ok(browser().screenshot(session, { outline: 'b1' }));
  await ok(browser().press(session, approved));

  const sent = (await received()).filter((r) => r.url === '/api/session/signup' && r.form.some(([, v]) => v === password));
  assert.equal(sent.length, 1);
  const [csrf, ...rest] = sent[0]!.form;
  assert.equal(csrf?.[0], 'csrf');
  assert.deepEqual(rest, [
    ['name', 'Sam Example'],
    ['email', 'sam+acme@gmail.com'],
    ['password', password],
    ['role', 'dev'],
    ['plan', 'free'],
    // Hidden until Team is chosen, and empty.
    ['team', ''],
    ['terms', 'on'],
    ['referral', ''],
  ]);
});
