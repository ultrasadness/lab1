// ops/alert.ts as assistant-alert@.service runs it (#71): with the check's ping URL in $CREDENTIALS_DIRECTORY/ping,
// pointed at a fake healthchecks.io that fails as often as the test says.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ALERT = join(import.meta.dirname, '..', 'alert.ts');

interface Signal {
  method: string;
  path: string;
  body: string;
}

/** Runs the alert for the bot's check, against a healthchecks.io that answers 500 to its first `failures` signals. */
async function alert(t: TestContext, failures: number): Promise<{ code: number | null; out: string; signals: Signal[] }> {
  const signals: Signal[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    req.on('end', () => {
      signals.push({ method: req.method ?? '', path: req.url ?? '', body });
      res.writeHead(signals.length > failures ? 200 : 500);
      res.end(signals.length > failures ? 'OK' : 'down');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const credentials = mkdtempSync(join(tmpdir(), 'ops-alert-'));
  t.after(() => rmSync(credentials, { recursive: true, force: true }));
  writeFileSync(join(credentials, 'ping'), `http://127.0.0.1:${(server.address() as AddressInfo).port}/hc/bot-uuid\n`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ALERT, 'bot'], { env: { ...process.env, CREDENTIALS_DIRECTORY: credentials }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.once('close', (code) => resolve({ code, out, signals }));
  });
}

test("the alert signals the check as failed, with nothing but the signal", async (t) => {
  const ran = await alert(t, 0);
  assert.equal(ran.code, 0, ran.out);
  assert.deepEqual(ran.signals, [{ method: 'POST', path: '/hc/bot-uuid/fail', body: '' }]);
});

test('a healthchecks.io that fails is tried again, up to three times in all', async (t) => {
  const twice = await alert(t, 2);
  assert.equal(twice.code, 0, twice.out);
  assert.equal(twice.signals.length, 3);
  assert.match(twice.out, /answered 500 for the bot check \(try 2 of 3\)/);

  const always = await alert(t, 3);
  assert.equal(always.code, 1);
  assert.equal(always.signals.length, 3);
  assert.match(always.out, /answered 500 for the bot check \(try 3 of 3\)/);
});
