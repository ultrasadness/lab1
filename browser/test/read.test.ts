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
  ]) {
    assert.ok(!everything.includes(token), `${token} is still in the snapshot`);
  }
  assertIncludes(page.snapshot.text, 'Your API key: sk_live_[random]');
  assertIncludes(page.snapshot.text, 'Invite token [random] expires soon.');
  assert.ok(page.snapshot.links.some((l) => l.text === 'Accept your invite' && l.href === 'http://acme.test/invite?token=[random]'));
  assert.equal(page.snapshot.url, 'http://acme.test/your-key?ref=[random]');
  // Plain code gets the URL exact, to open it again.
  assert.equal(page.finalUrl, 'http://acme.test/your-key?ref=Zk3mQ8xL2pV9rT4nW7yB');

  assertIncludes(
    page.snapshot.text,
    'Acme Notes is the 2026 note-taking app for internationalization teams. Write to signup+acme@gmail.com, read http://acme.test/blog/how-we-built-acme-notes-2026 or call +1 415 555 0100. Plans start at $12.99/month. Version v1.64.0, released 2026-10-17, order 20261017000123. Supercalifragilisticexpialidocious, state-of-the-art, GPT-4o-mini and iPhone15ProMax.',
  );
});

test('a cookie banner autoconsent knows is rejected before the snapshot', async () => {
  const page = await read('http://acme.test/consent-known');

  assert.deepEqual(page.cookieBanner, { manager: 'Complianz banner', rejected: true });
  assertIncludes(page.snapshot.text, 'Cookie choice: denied');
  assert.ok(!page.snapshot.text.includes('We use cookies to improve your experience.'));
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

test('a page that never lets go times out, and reads go on', async () => {
  assert.equal(await readFailure('http://acme.test/hang'), 'timeout');

  assert.equal((await browser().read('http://acme.test/signup')).ok, true);
});
