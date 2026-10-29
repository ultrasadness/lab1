// The browser service's container, as ADR 0006 hardens it, observed from the host.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { browser, containerId, inBrowserContainer, run, socketPath } from './harness.ts';

test('PATH and the running browser service use the patched Node binary', async () => {
  const { code, out } = await inBrowserContainer('sh', '-c',
    'command -v node; node --version; /usr/bin/node --version; readlink -f /usr/local/bin/node');
  assert.equal(code, 0, out);
  assert.deepEqual(out.trim().split('\n'), ['/usr/local/bin/node', 'v24.22.1', 'v24.22.1', '/usr/bin/node']);

  const processes = await inBrowserContainer('ps', '-eo', 'pid,args');
  assert.equal(processes.code, 0, processes.out);
  const service = processes.out.split('\n').find((line) => /^\s*\d+\s+node src\/main\.ts\s*$/.test(line));
  assert.ok(service, `no browser service process in:\n${processes.out}`);
  const pid = service.trim().split(/\s+/)[0];
  const executable = await inBrowserContainer('readlink', `/proc/${pid}/exe`);
  assert.equal(executable.code, 0, executable.out);
  assert.equal(executable.out.trim(), '/usr/bin/node');
});

test('Chrome for Testing runs headed under Xvfb, with its sandbox', async () => {
  const { out } = await inBrowserContainer('ps', '-eo', 'user:16,args');
  const chrome = out.split('\n').filter((line) => /\/chrome-linux[^ ]*\/chrome /.test(line));

  assert.match(out, /^pwuser\s+Xvfb :99/m);
  assert.ok(chrome.length > 0, `no Chrome process in:\n${out}`);
  for (const line of chrome) {
    assert.match(line, /^pwuser\s/);
    assert.ok(!line.includes('--headless'), line);
    assert.ok(!line.includes('--no-sandbox'), line);
  }
  assert.match((await browser().health()).browser, /^\d+\.\d+\.\d+\.\d+$/);
});

test('the container is hardened as ADR 0006 lists', async () => {
  const { out } = await run('docker', ['inspect', containerId()]);
  const [{ Config, HostConfig }] = JSON.parse(out);

  assert.equal(Config.User, 'pwuser');
  assert.deepEqual(HostConfig.CapDrop, ['ALL']);
  assert.deepEqual(
    HostConfig.CapAdd.map((c: string) => c.replace(/^CAP_/, '')),
    ['SYS_CHROOT'],
  );
  assert.ok(HostConfig.SecurityOpt.includes('no-new-privileges:true'));
  assert.ok(HostConfig.SecurityOpt.some((o: string) => o.startsWith('seccomp=') && o.includes('"defaultAction":"SCMP_ACT_ERRNO"')));
  assert.equal(HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(Object.keys(HostConfig.Tmpfs).sort(), ['/home/pwuser', '/tmp', '/var/lib/xkb']);
  assert.notEqual(HostConfig.IpcMode, 'host');
  assert.equal(HostConfig.ShmSize, 1024 ** 3);
  assert.equal((await inBrowserContainer('stat', '-c', '%U', '/home/pwuser')).out.trim(), 'pwuser');
});

test('nothing listens on TCP, so nothing on a network reaches the service', async () => {
  const { out } = await inBrowserContainer('cat', '/proc/net/tcp', '/proc/net/tcp6');
  // The fourth column is the socket's state; 0A is LISTEN. Docker's own DNS resolver listens on 127.0.0.11
  // in every container on a user-defined network; anything else, even on loopback, pages could reach.
  const listening = out
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols[3] === '0A' && !cols[1]?.startsWith('0B00007F:'));

  assert.deepEqual(listening, []);
});

test("only the bot's group can use the socket", () => {
  const stat = fs.statSync(socketPath());

  assert.ok(stat.isSocket());
  assert.equal(stat.mode & 0o777, 0o660);
  assert.equal(stat.gid, process.getgid!());
});

test('the service runs the autoconsent version pinned in its package config', async () => {
  const pinned = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).dependencies['@duckduckgo/autoconsent'];

  assert.match(pinned, /^\d+\.\d+\.\d+$/);
  assert.equal((await browser().health()).autoconsent, pinned);
});

test("the service refuses to start without Chromium's sandbox", async () => {
  // compose.yaml's hardening but for Playwright's seccomp profile: Docker's default profile leaves Chromium no sandbox.
  const { code, out } = await run('timeout', [
    '120',
    'docker', 'run', '--rm', '--user', 'pwuser', '--cap-drop', 'ALL', '--cap-add', 'SYS_CHROOT',
    '--security-opt', 'no-new-privileges', '--read-only', '--tmpfs', '/tmp',
    '--tmpfs', '/home/pwuser:uid=1001,gid=1001', '--tmpfs', '/var/lib/xkb', '--shm-size', '1g',
    '-e', 'SOCKET_PATH=/tmp/browser.sock', 'lab1-browser:test',
  ]);

  assert.notEqual(code, 0);
  assert.notEqual(code, 124, 'it exits by itself rather than running on');
  assert.ok(out.includes("refusing to start without Chromium's sandbox"), out);
});
