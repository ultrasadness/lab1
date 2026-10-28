// The Docker helper and the bot's side of it, as systemd runs them: systemd-socket-activate starts the helper for each
// connection, with the connection as stdin, as assistant-docker.socket does, and ops/run-pi.ts is started the way the
// bot starts `pi.command`. A fake `docker` on the helper's PATH plays the Pi container: it logs each call, and for
// `exec` runs a fake Pi chosen by the run's role.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OPS = join(import.meta.dirname, '..');
const TOKEN = 'run-token-0123456789abcdefghij';

/**
 * A fake `docker`: `exec` runs a fake Pi chosen by $ASSISTANT_ROLE, and `ps`, `inspect` and `image inspect` answer
 * for two running containers. Every call is logged with its arguments and the names of the ASSISTANT_ variables.
 */
function fakeDocker(dir: string): string {
  const log = join(dir, 'docker.log');
  const script = String.raw`#!/bin/sh
echo "args: $*" >> ${log}
echo "env: $(env | grep '^ASSISTANT_' | sort | tr '\n' ' ')" >> ${log}
case "$1" in
  exec)
    echo $$ > ${join(dir, 'pi.pid')}
    case "$ASSISTANT_ROLE" in
      echo)
        while IFS= read -r line; do printf '{"type":"echo","line":%s}\n' "$line"; done
        echo "eof" >> ${log}
        printf '{"type":"bye"}'
        echo "pi says goodbye" >&2
        exit 0 ;;
      failing) echo "pi broke" >&2; exit 3 ;;
      stubborn) trap '' TERM; while :; do sleep 1; done ;;
    esac ;;
  ps) echo aaa; echo bbb ;;
  inspect) printf '"/assistant-pi"\t"assistant-pi:local"\t"sha256:111"\n"/lab1-browser-1"\t"lab1-browser:local"\t"sha256:222"\n' ;;
  image) printf '"sha256:111"\tnull\n"sha256:222"\t["mcr.microsoft.com/playwright@sha256:333"]\n' ;;
esac
`;
  const path = join(dir, 'docker');
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return log;
}

interface Helper {
  socket: string;
  log: string;
  dir: string;
}

/** Starts the helper behind a socket, one helper per connection, as systemd does. */
async function startHelper(t: TestContext): Promise<Helper> {
  const dir = mkdtempSync(join(tmpdir(), 'docker-helper-'));
  const log = fakeDocker(dir);
  const socket = join(dir, 'helper.sock');
  const activator = spawn(
    'systemd-socket-activate',
    ['--inetd', '--accept', '--listen', socket, `--setenv=PATH=${dir}:/usr/bin:/bin`, process.execPath, join(OPS, 'docker-helper.ts')],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  t.after(() => {
    activator.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  });
  await until(() => existsSync(socket), 'the helper socket to appear');
  return { socket, log, dir };
}

/** Waits for a condition, checking every 50 ms, for at most `ms`. */
async function until(condition: () => boolean, what: string, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

interface Client {
  child: ChildProcess;
  stdout(): string;
  stderr(): string;
  exited: Promise<number | null>;
}

/** Starts ops/run-pi.ts as the bot starts a run, with the run's settings in its environment. */
function runPi(helper: Helper, role: string): Client {
  const child = spawn(process.execPath, [join(OPS, 'run-pi.ts')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH,
      ASSISTANT_DOCKER_SOCKET: helper.socket,
      ASSISTANT_ROLE: role,
      ASSISTANT_RUN_KIND: 'miner-judging',
      ASSISTANT_RUN_TOKEN: TOKEN,
      ASSISTANT_BOT_URL: 'http://172.17.0.1:8787',
    },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
  const exited = new Promise<number | null>((resolve) => child.once('close', (code) => resolve(code)));
  return { child, stdout: () => stdout, stderr: () => stderr, exited };
}

/** Sends one raw first line to the helper and reads everything it answers. */
function ask(helper: Helper, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(helper.socket);
    let answer = '';
    const timer = setTimeout(() => reject(new Error('the helper did not answer')), 15_000);
    socket.on('data', (chunk: Buffer) => (answer += chunk.toString('utf8')));
    socket.once('error', reject);
    socket.once('close', () => {
      clearTimeout(timer);
      resolve(answer);
    });
    socket.write(line);
  });
}

const lastLine = (text: string) => JSON.parse(text.trim().split('\n').at(-1)!) as Record<string, unknown>;

test('a run relays Pi both ways, and exits with its code and the end of its stderr', async (t) => {
  const helper = await startHelper(t);
  const pi = runPi(helper, 'echo');
  pi.child.stdin!.write('{"id":"prompt","type":"prompt"}\n');
  await until(() => pi.stdout().includes('"echo"'), "Pi's answer");
  pi.child.stdin!.end();
  assert.equal(await pi.exited, 0);
  assert.equal(pi.stdout(), '{"type":"echo","line":{"id":"prompt","type":"prompt"}}\n{"type":"bye"}\n');
  assert.equal(pi.stderr(), 'pi says goodbye\n');

  const log = readFileSync(helper.log, 'utf8');
  assert.match(log, /^args: exec -i -e ASSISTANT_ROLE -e ASSISTANT_RUN_KIND -e ASSISTANT_RUN_TOKEN -e ASSISTANT_BOT_URL assistant-pi pi-run$/m);
  assert.match(log, new RegExp(`ASSISTANT_RUN_TOKEN=${TOKEN}`), 'the token reaches the container through the environment');
  assert.ok(!/^args: .*run-token/m.test(log), 'the token is on no command line');
  assert.match(log, /^eof$/m, 'the end of the bot\'s input reached Pi');
});

test("a run that fails exits with Pi's code, and says why", async (t) => {
  const helper = await startHelper(t);
  const pi = runPi(helper, 'failing');
  pi.child.stdin!.end();
  assert.equal(await pi.exited, 3);
  assert.equal(pi.stderr(), 'pi broke\n');
});

test('stopping a run ends Pi, and a Pi that keeps running is killed after its grace', async (t) => {
  const helper = await startHelper(t);
  const pi = runPi(helper, 'stubborn');
  await until(() => existsSync(join(helper.dir, 'pi.pid')), 'Pi to start');
  const pid = Number(readFileSync(join(helper.dir, 'pi.pid'), 'utf8'));
  pi.child.kill('SIGTERM');
  assert.equal(await pi.exited, 143);
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  assert.ok(alive(), 'Pi ignores the end of its input at first');
  await until(() => !alive(), 'the helper to kill Pi', 20_000);
});

test('the helper reports the running image digests', async (t) => {
  const helper = await startHelper(t);
  const answer = await ask(helper, '{"command":"digests"}\n');
  const lines = answer.trim().split('\n').map((line) => JSON.parse(line) as unknown);
  assert.deepEqual(lines, [
    { container: 'assistant-pi', image: 'assistant-pi:local', imageId: 'sha256:111', repoDigests: [] },
    { container: 'lab1-browser-1', image: 'lab1-browser:local', imageId: 'sha256:222', repoDigests: ['mcr.microsoft.com/playwright@sha256:333'] },
    { 'assistant-docker': 'exit', code: 0, stderr: '' },
  ]);
});

test('the helper refuses any other command, or a run with an odd value, and runs no docker command', async (t) => {
  const helper = await startHelper(t);
  const refusals = [
    '{"command":"exec","args":["rm","-rf","/"]}\n',
    '{"command":"digests","all":true}\n',
    `{"command":"run","role":"miner; rm -rf /","kind":"miner-judging","token":"${TOKEN}","botUrl":"http://172.17.0.1:8787"}\n`,
    `{"command":"run","role":"miner","kind":"miner-judging","token":"${TOKEN}","botUrl":"http://evil.example:80"}\n`,
    `{"command":"run","role":"miner","kind":"miner-judging","token":"${TOKEN}","botUrl":"http://172.17.0.1:8787","image":"other"}\n`,
    'not json\n',
  ];
  for (const line of refusals) {
    const exit = lastLine(await ask(helper, line));
    assert.equal(exit.code, 2, line);
    assert.match(String(exit.stderr), /refused/, line);
  }
  assert.ok(!existsSync(helper.log), 'no docker command ran');
});

test('the helper refuses a first line past its size limit, or one that never comes', async (t) => {
  const helper = await startHelper(t);
  const long = lastLine(await ask(helper, 'x'.repeat(70 * 1024)));
  assert.equal(long.code, 2);
  assert.match(String(long.stderr), /the request is too long/);
  const started = Date.now();
  const silent = lastLine(await ask(helper, ''));
  assert.equal(silent.code, 2);
  assert.match(String(silent.stderr), /no request came within 10 seconds/);
  assert.ok(Date.now() - started >= 9_000, 'the helper waited for the request');
  assert.ok(!existsSync(helper.log), 'no docker command ran');
});
