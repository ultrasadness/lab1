// ops/bitwarden/trial under a throwaway OPS_ROOT, against the fake `bw` the bot's tests use (#54's retro). This shows
// what the trial says and when it fails. Only a run on the real account says what the real `bw` does.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeBitwarden } from '../../bot/test/harness/fake-bitwarden.ts';

const TRIAL = join(import.meta.dirname, '..', 'bitwarden', 'trial');
const ACCOUNT = { clientId: 'user.0b1c2d3e-0000-4000-8000-000000000001', clientSecret: 'the-api-secret', masterPassword: 'the-master-password' };

interface Machine {
  bitwarden: FakeBitwarden;
  /** The folder the trial makes its data folder in. */
  temp: string;
  trial(): { code: number | null; out: string };
}

/** A throwaway VM. `first` is shell that runs before each `bw` command reaches the fake, given how to run the fake. */
function machine(t: TestContext, first: (fake: string) => string = () => ''): Machine {
  const root = mkdtempSync(join(tmpdir(), 'ops-bw-trial-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bitwarden = new FakeBitwarden(join(root, 'fake-bitwarden'), ACCOUNT);
  const bin = join(root, 'opt/assistant/bw/node_modules/.bin');
  mkdirSync(bin, { recursive: true });
  const [node, script, folder] = bitwarden.command as [string, string, string];
  const fake = `"${node}" "${script}" "${folder}" "$@"`;
  writeFileSync(join(bin, 'bw'), `#!/bin/sh\n${first(fake)}\nexec ${fake}\n`);
  chmodSync(join(bin, 'bw'), 0o755);
  const credentials = join(root, 'etc/assistant/credentials');
  mkdirSync(credentials, { recursive: true });
  writeFileSync(join(credentials, 'bitwarden-api-key'), JSON.stringify({ client_id: ACCOUNT.clientId, client_secret: ACCOUNT.clientSecret }));
  writeFileSync(join(credentials, 'bitwarden-master-password'), ACCOUNT.masterPassword);
  const temp = join(root, 'tmp');
  mkdirSync(temp);
  return {
    bitwarden,
    temp,
    trial: () => {
      const ran = spawnSync(TRIAL, [], { env: { ...process.env, OPS_ROOT: root, TMPDIR: temp }, encoding: 'utf8', timeout: 60_000 });
      return { code: ran.status, out: `${ran.stdout}${ran.stderr}` };
    },
  };
}

test('on an account that can do what the bot needs, the trial passes, says what is left to delete, and shows no value', (t) => {
  const vm = machine(t);
  const first = vm.trial();
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /--- create item, on stdin\n[^]*"password": "string"/);
  assert.match(first.out, /a session key of 88 characters/);
  assert.match(first.out, /Now delete the item named "lab1 bw trial" from the Registrations collection in Bitwarden: the bot has no way to\.$/m);
  assert.deepEqual(readdirSync(vm.temp), [], 'no data folder is left');

  const [item] = vm.bitwarden.items;
  assert.equal(item!.name, 'lab1 bw trial');
  const values = [ACCOUNT.clientId, ACCOUNT.clientSecret, ACCOUNT.masterPassword, item!.login.password, ...vm.bitwarden.sessionKeys, ...vm.bitwarden.loginKeys];
  for (const value of values) assert.ok(!first.out.includes(value), `a value showed:\n${first.out}`);

  const second = vm.trial();
  assert.equal(second.code, 0, second.out);
  assert.match(second.out, /Now delete the 2 items named "lab1 bw trial"/);
});

test('an account on *Can edit, except passwords* fails the trial, which ops/token has no way to see', (t) => {
  const vm = machine(t);
  vm.bitwarden.hidesPasswords = true;
  const ran = vm.trial();
  assert.equal(ran.code, 1, ran.out);
  assert.match(ran.out, /TRIAL FAILED: bw answers the password as null: is this account on \*Can edit, except passwords\*\?/);
  assert.match(ran.out, /Now delete the item named "lab1 bw trial"/, 'what the failed trial left is still named');
});

test('a password read back that is not the one it was given fails the trial', (t) => {
  const vm = machine(t, (fake) => `case "$1 $2" in "list items") ${fake} | sed 's/"password":"[^"]*"/"password":"another"/'; exit 0 ;; esac`);
  const ran = vm.trial();
  assert.equal(ran.code, 1, ran.out);
  assert.match(ran.out, /TRIAL FAILED: bw answers the new item with another password than it was given/);
});

test('an account that sees another collection fails the trial before it creates anything', (t) => {
  const vm = machine(t);
  vm.bitwarden.addCollection('Everything');
  const ran = vm.trial();
  assert.equal(ran.code, 1, ran.out);
  assert.match(ran.out, /TRIAL FAILED: the bot's account sees 2 collections, and should see only Registrations/);
  assert.deepEqual(vm.bitwarden.items, []);
  assert.doesNotMatch(ran.out, /Now delete/);
});

test('a new item bw can\'t find again, or a bw that fails, fails the trial', (t) => {
  const vm = machine(t, () => `case "$1 $2" in "list items") printf '[]'; exit 0 ;; esac`);
  const lost = vm.trial();
  assert.equal(lost.code, 1, lost.out);
  assert.match(lost.out, /TRIAL FAILED: the new item found by name, username and website: 0/);
  assert.match(lost.out, /Now delete the item named "lab1 bw trial"/);

  const down = machine(t);
  down.bitwarden.down = true;
  const ran = down.trial();
  assert.equal(ran.code, 1, ran.out);
  assert.doesNotMatch(ran.out, /Now delete/);
  assert.deepEqual(readdirSync(down.temp), [], 'no data folder is left');
});
