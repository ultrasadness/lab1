// read(url) through the socket, against real Chromium in the real image, on local test pages.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertIncludes, browser, inBrowserContainer, read, readFailure } from './harness.ts';

test('a signup form reads with its fields, labels, required flags, submit control and terms links', async () => {
  const page = await read('http://acme.test/signup');

  assert.equal(page.finalUrl, 'http://acme.test/signup');
  assert.equal(page.finalHost, 'acme.test');
  assert.equal(page.status, 200);
  assert.equal(page.snapshot.title, 'Sign up · Acme Notes');
  assertIncludes(page.snapshot.text, 'Create your Acme Notes account');

  assert.equal(page.snapshot.forms.length, 1);
  const form = page.snapshot.forms[0]!;
  assert.equal(form.formElement, true);
  assert.equal(form.action, 'http://acme.test/api/signup');
  assert.equal(form.method, 'post');
  assert.deepEqual(form.submits, [{ label: 'Create account', disabled: false }]);

  const terms = [
    { text: 'Terms of Service', href: 'http://acme.test/terms' },
    { text: 'Privacy Policy', href: 'http://acme.test/privacy' },
  ];
  assert.deepEqual(form.fields, [
    { type: 'text', name: 'name', label: 'Full name', required: true, autocomplete: 'name', links: [] },
    { type: 'email', name: 'email', label: 'Work email', required: true, autocomplete: 'email', links: [] },
    { type: 'password', name: 'password', label: 'Password', required: true, autocomplete: 'new-password', links: [] },
    {
      type: 'select',
      name: 'role',
      label: 'Your role',
      required: false,
      autocomplete: null,
      value: 'dev',
      options: [
        { label: 'Choose one', value: '', selected: false },
        { label: 'Developer', value: 'dev', selected: true },
        { label: 'Product manager', value: 'pm', selected: false },
      ],
      links: [],
    },
    {
      type: 'radio',
      name: 'plan',
      label: 'Plan',
      required: false,
      autocomplete: null,
      options: [
        { label: 'Free', value: 'free', selected: true },
        { label: 'Pro', value: 'pro', selected: false },
      ],
      links: [],
    },
    { type: 'text', name: 'company', label: 'Company (optional)', required: false, autocomplete: null, links: [] },
    {
      type: 'checkbox',
      name: 'terms',
      label: 'I agree to the Terms of Service and Privacy Policy',
      required: true,
      autocomplete: null,
      checked: false,
      links: terms,
    },
    // Outside the <form> element, but in the form through its form= attribute.
    { type: 'checkbox', name: 'newsletter', label: 'Send me product news', required: false, autocomplete: null, checked: true, links: [] },
  ]);
  assert.deepEqual(form.links, terms);

  const links = page.snapshot.links.map((l) => `${l.text} → ${l.href}`);
  for (const link of ['Pricing → http://acme.test/pricing', 'Terms of Service → http://acme.test/terms', 'Blog → http://www.acme.test/blog']) {
    assert.ok(links.includes(link), `missing link ${link}`);
  }
  assert.equal(page.paymentFields, false);
  assert.equal(page.botCheck, null);
});

test('a form the page hides behind "Get started" reads as form not seen', async () => {
  const page = await read('http://acme.test/get-started');

  assert.deepEqual(page.snapshot.forms, []);
  assertIncludes(page.snapshot.text, 'Get started');
  assert.ok(!page.snapshot.text.includes('Sign up'));
});

test("a redirect to an auth vendor reports the vendor's host as the final host", async () => {
  const page = await read('http://acme.test/register');

  assert.equal(page.finalHost, 'accounts.authvendor.test');
  assert.equal(page.finalUrl, 'http://accounts.authvendor.test/sign-up?redirect_url=http%3A%2F%2Facme.test%2Fwelcome');
  assert.equal(page.status, 200);
  assert.deepEqual(
    page.snapshot.forms[0]?.fields.map((f) => f.label),
    ['Email address', 'Password'],
  );
});

test('card fields are detected by their autocomplete', async () => {
  assert.equal((await read('http://acme.test/trial')).paymentFields, true);
});

test("card fields are detected inside a payment provider's frame", async () => {
  assert.equal((await read('http://acme.test/checkout')).paymentFields, true);
});

test("a payment provider's own page with no card fields has no payment fields", async () => {
  assert.equal((await read('http://checkoutshopper-live.adyen.com/newsletter')).paymentFields, false);
});

test('random-looking strings are removed from the snapshot, and ordinary text stays', async () => {
  const page = await read('http://acme.test/your-key?ref=Zk3mQ8xL2pV9rT4nW7yB');

  const everything = JSON.stringify(page.snapshot);
  for (const token of [
    '4eC39HqLyjWDarjtT1zdp7dc',
    'x7Gk2pQ9rT4vL8mN3bZ6',
    '3f9a1c7e5b2d4f6a8c0e1b3d5f7a9c2e',
    '550e8400-e29b-41d4-a716-446655440000',
    'eyJhbGciOiJIUzI1NiJ9',
    'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
    'dozjgNryP4J3jVmNHl0w5N',
    'XgL0n3I9PlFUP0THsR8U',
    'Qm3xZ8pL2vR9tN4kW7yB',
    'Zk3mQ8xL2pV9rT4nW7yB',
    'wJalrXUtnFEMI',
    'K7MDENG',
    'bPxRfiCYEXAMPLEKEY',
    'Xk9',
    'Fg5Hj0',
    'aB3dE9fG2hJ1',
  ]) {
    assert.ok(!everything.includes(token), `${token} is still in the snapshot`);
  }
  assertIncludes(page.snapshot.text, 'Your API key: sk_live_[random]');
  assertIncludes(page.snapshot.text, 'Invite token [random] expires soon.');
  assertIncludes(page.snapshot.text, 'Secret access key: [random]');
  assertIncludes(page.snapshot.text, 'Signing secret [random] for webhooks.');
  assertIncludes(page.snapshot.text, 'Temp password: [random]');
  assert.ok(page.snapshot.links.some((l) => l.text === 'Accept your invite' && l.href === 'http://acme.test/invite?token=[random]'));
  assert.equal(page.snapshot.url, 'http://acme.test/your-key?ref=[random]');
  // Plain code gets the URL exact, to open it again.
  assert.equal(page.finalUrl, 'http://acme.test/your-key?ref=Zk3mQ8xL2pV9rT4nW7yB');

  assertIncludes(
    page.snapshot.text,
    'Acme Notes is the 2026 note-taking app for internationalization teams. Write to signup+acme@gmail.com, read http://acme.test/blog/how-we-built-acme-notes-2026 or call +1 415 555 0100. Plans start at $12.99/month. Version v1.64.0, released 2026-10-17, order 20261017000123. Supercalifragilisticexpialidocious, state-of-the-art, GPT-4o-mini and iPhone15ProMax. Support is open 24/7 for Sales/Marketing/Engineering teams and/or Input/Output/Storage admins on a MacBookPro16 or Windows11Pro.',
  );
});

test('a cookie banner autoconsent knows is rejected before the snapshot', async () => {
  const page = await read('http://acme.test/consent-known');

  assert.deepEqual(page.cookieBanner, { manager: 'Complianz banner', rejected: true });
  assertIncludes(page.snapshot.text, 'Cookie choice: denied');
  assert.ok(!page.snapshot.text.includes('We use cookies to improve your experience.'));
});

test('a banner that reloads the page once the choice is saved reads as the page it reloads to', async () => {
  const page = await read('http://acme.test/consent-reload');

  assert.deepEqual(page.cookieBanner, { manager: 'Complianz banner', rejected: true });
  assertIncludes(page.snapshot.text, 'Cookie choice: denied');
  assert.ok(!page.snapshot.text.includes('We use cookies to improve your experience.'));
});

test('a banner on a page the cookie step is redirected to is rejected too', async () => {
  const start = Date.now();
  const page = await read('http://acme.test/consent-redirect');

  // Not held up by the script on the page it left.
  assert.ok(Date.now() - start < 10_000, `answered after ${Date.now() - start} ms`);
  assert.equal(page.finalUrl, 'http://acme.test/consent-known-slow');
  assert.deepEqual(page.cookieBanner, { manager: 'Complianz banner', rejected: true });
  assertIncludes(page.snapshot.text, 'Cookie choice: denied');
});

test('a banner autoconsent does not know stays in place, and the read still returns', async () => {
  const page = await read('http://acme.test/consent-unknown');

  assert.equal(page.cookieBanner, null);
  assertIncludes(page.snapshot.text, 'No cookie choice yet');
  assertIncludes(page.snapshot.text, 'This site uses cookies for analytics.');
});

test('an interstitial on load reads as a bot check', async () => {
  const page = await read('http://acme.test/protected');

  assert.equal(page.status, 403);
  assert.equal(page.botCheck, 'Cloudflare challenge');
});

test('a bot check on the form is reported', async () => {
  const page = await read('http://acme.test/signup-turnstile');

  assert.equal(page.botCheck, 'Turnstile');
  assert.deepEqual(
    page.snapshot.forms[0]?.fields.map((f) => f.label),
    ['Email'],
  );
});

test('permission requests are denied without asking', async () => {
  const page = await read('http://acme.test/permissions');

  assertIncludes(page.snapshot.text, 'notifications: denied');
  assertIncludes(page.snapshot.text, 'geolocation: denied');
});

test('a download is refused, and nothing reaches the disk', async () => {
  assert.equal(await readFailure('http://acme.test/export.csv'), 'download');

  // The only writable places in the container: no saved file and no cached copy holds the download.
  const { out } = await inBrowserContainer('grep', '-rls', 'sam@example.test', '/tmp', '/home/pwuser');
  assert.equal(out.trim(), '');
});

test('only http and https URLs with no username or password are read', async () => {
  for (const url of ['file:///etc/passwd', 'chrome://settings', 'javascript:alert(1)', 'http://sam:secret@acme.test/signup', 'not a url']) {
    assert.equal(await readFailure(url), 'bad-url', url);
  }
});

test('a page that never lets go times out at the read limit, and reads go on', async () => {
  const start = Date.now();
  assert.equal(await readFailure('http://acme.test/hang'), 'timeout');
  // compose.test.yaml sets the limit to 20 s.
  assert.ok(Date.now() - start < 25_000, `answered after ${Date.now() - start} ms`);

  assert.equal((await browser().read('http://acme.test/signup')).ok, true);
});

test('a HEAD says where a redirect points, and follows nothing', async () => {
  const pointing = await browser().redirect('http://acme.test/register');
  assert.deepEqual(pointing, {
    ok: true,
    redirect: { status: 302, location: 'http://accounts.authvendor.test/sign-up?redirect_url=http%3A%2F%2Facme.test%2Fwelcome' },
  });

  const plain = await browser().redirect('http://acme.test/signup');
  assert.deepEqual(plain, { ok: true, redirect: { status: 200, location: null } });
});

test("a HEAD that can't be sent is a failure, and an address that isn't plain http or https is refused", async () => {
  const unreachable = await browser().redirect('http://no-such-host.test/');
  assert.equal(unreachable.ok, false);
  assert.equal(!unreachable.ok && unreachable.error.kind, 'load-failed');

  const refused = await browser().redirect('file:///etc/passwd');
  assert.equal(!refused.ok && refused.error.kind, 'bad-url');
});

test("a HEAD's relative Location comes back absolute, and one that isn't plain http or https comes back as none", async () => {
  assert.deepEqual(await browser().redirect('http://acme.test/redirect-relative'), { ok: true, redirect: { status: 302, location: 'http://acme.test/signup' } });
  assert.deepEqual(await browser().redirect('http://acme.test/redirect-file'), { ok: true, redirect: { status: 302, location: null } });
});

test('a HEAD with no answer ends at its limit', async () => {
  const silent = await browser().redirect('http://acme.test/no-answer');
  assert.equal(!silent.ok && silent.error.kind, 'timeout');
});
