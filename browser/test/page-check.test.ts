// The page check through the socket: each failure it catches, and what it ignores, on local test pages.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PageCheck } from '../src/api.ts';
import { approved, browser, filledSignup, ok, openSession } from './harness.ts';

const failures = (check: PageCheck) => check.failures.map((f) => [f.rule, f.field, f.ref, ...(f.validity ? [f.validity] : [])].filter((x) => x !== null).join(' '));

test("a page filled as approved passes, whatever its hidden input and other forms hold, and the check judges the named button's form", async (t) => {
  // The hidden input holds a fresh token, and the newsletter form below holds an address and a ticked box the page set.
  const session = await filledSignup(t);

  assert.deepEqual(await ok(browser().check(session, approved)), { ok: true, pass: true, failures: [] });
  assert.deepEqual(failures(await ok(browser().check(session, { ...approved, button: 'b2' }))), [
    'unapproved-value Newsletter email f9',
    'unapproved-box Weekly f10',
  ]);
});

test('a dropdown the page preset fails', async (t) => {
  const session = await filledSignup(t, '?preset-role', ['f4']);

  assert.deepEqual(failures(await ok(browser().check(session, approved))), ['unapproved-value Your role f4']);
});

test('a value a page script changed fails', async (t) => {
  const session = await filledSignup(t, '?uppercase-name');

  assert.deepEqual(failures(await ok(browser().check(session, approved))), ['unapproved-value Full name f1']);
});

test('a box the page ticked fails, until the fill run unticks it', async (t) => {
  const session = await filledSignup(t, '?preticked');
  assert.deepEqual(failures(await ok(browser().check(session, approved))), ['unapproved-box Email me tips f6']);

  await ok(browser().drive(session, 'fill-run'));
  await ok(browser().choose(session, 'f6', 'tips', 'left unticked'));
  await ok(browser().drive(session, 'plain-code'));
  assert.equal((await ok(browser().check(session, approved))).pass, true);
});

test("a required field left empty fails the browser's validity check", async (t) => {
  const session = await filledSignup(t, '', ['f3']);

  assert.deepEqual(failures(await ok(browser().check(session, approved))), ['invalid Password f3 valueMissing']);
});

test('a required terms box the page ticked passes with the approved terms, and fails with others', async (t) => {
  const session = await filledSignup(t, '?preticked-terms', ['f7']);
  assert.equal((await ok(browser().check(session, approved))).pass, true);

  const otherTerms = { ...approved, terms: ['http://acme.test/terms-2025', 'http://acme.test/privacy'] };
  assert.deepEqual(failures(await ok(browser().check(session, otherTerms))), ['other-terms I agree to the Terms of Service and Privacy Policy f7']);
});

test('a box ticked with approval fails too when its links are not the approved terms', async (t) => {
  const session = await filledSignup(t);

  assert.deepEqual(failures(await ok(browser().check(session, { ...approved, terms: ['http://acme.test/terms'] }))), [
    'other-terms I agree to the Terms of Service and Privacy Policy f7',
  ]);
});

test('a page on another host than the approved signup host fails', async (t) => {
  const session = await openSession(t, 'http://acme.test/register', { domains: ['acme.test', 'authvendor.test'] });
  await ok(browser().snapshot(session));
  await ok(browser().fill(session, 'f1', 'email', 'sam+acme@gmail.com'));
  await ok(browser().fillSecret(session, 'f2', 'password', 'Zk3mQ8xL2pV9rT4nW7yB-a1!'));
  await ok(browser().drive(session, 'plain-code'));

  const check = await ok(browser().check(session, approved));
  assert.deepEqual(failures(check), ['off-host']);
  // The failure names the page's host, which an amended Walkthrough puts to the person (#115).
  assert.equal(check.failures[0]!.host, 'accounts.authvendor.test');
  assert.equal((await ok(browser().check(session, { ...approved, signupHost: 'accounts.authvendor.test' }))).pass, true);
});

test('a field outside the form that form= ties to it is judged, and one outside it is not', async (t) => {
  // The referral code sits after the form's end, tied to it by form=; the newsletter form's fields are tied to none.
  const session = await filledSignup(t, '?referral');

  assert.deepEqual(failures(await ok(browser().check(session, approved))), ['unapproved-value Referral code f8']);
});

test('a field filled with one Signup identity address may hold the other', async (t) => {
  // The page strips the plus-address tag the Walkthrough approved.
  const session = await filledSignup(t, '?strip-plus');

  assert.equal((await ok(browser().check(session, approved))).pass, true);
  assert.deepEqual(failures(await ok(browser().check(session, { ...approved, identity: [] }))), ['unapproved-value Email f2']);
});

test("custom controls are judged by what they show: a box the page set fails, and so does a list a script changed", async (t) => {
  const check = { button: 'b1', signupHost: 'acme.test', terms: [], identity: [] };
  const custom = async (flags: string, leaveDarkMode: boolean) => {
    const session = await openSession(t, `http://acme.test/session/custom${flags}`);
    const { snapshot } = await ok(browser().snapshot(session));
    const ref = (label: string) => snapshot.forms[0]!.fields.find((f) => f.label === label)!.ref!;
    await ok(browser().choose(session, ref('Send me news'), 'news', 'ticked'));
    if (!leaveDarkMode) await ok(browser().choose(session, ref('Dark mode'), 'dark-mode', 'left unticked'));
    await ok(browser().choose(session, ref('Country'), 'country', 'Portugal'));
    await ok(browser().drive(session, 'plain-code'));
    return failures(await ok(browser().check(session, check)));
  };

  assert.deepEqual(await custom('', false), []);
  // The page shows Dark mode on, and the Walkthrough never approved it.
  assert.deepEqual(await custom('', true), ['unapproved-box Dark mode f2']);
  // Portugal becomes "Portugal (mainland)" half a second after it is chosen, which the check waits to see.
  assert.deepEqual(await custom('?switch-country', false), ['unapproved-value Country f3']);
});
