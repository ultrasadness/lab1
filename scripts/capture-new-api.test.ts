// The capture of new-api (#108). Each test runs the script as the person would, as its own process, so CI needs no image
// of new-api. A fake `docker` on its PATH logs each call and prints what the real one printed for the same call on
// 2026-11-09, and a local server plays the throwaway new-api. Its setup API is the one the trial on #46 drove, and what
// it answers is made up for each test: only a run on the real image shows what new-api really answers, and that is the
// fixture's diff.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STUB_MODELS, stubServer } from './capture-new-api-stub.ts';

const ROOT = join(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'capture-new-api.ts');
const DIGEST = `sha256:${'a'.repeat(64)}`;
const VERSION = 'v1.2.3-test';
const ACCESS_TOKEN = 'an-access-token';
/** Every row of the trial on #46: the table in its comment 6735051453, and the 400 in comment 6739980915. */
const CHAT_CASES = [
  'cpa-cooldown',
  'plus-limit',
  'openrouter-429',
  'plain-429',
  'retry-after-only',
  'openrouter-402',
  'deepseek-402',
  'upstream-400',
  'upstream-401',
  'upstream-403',
  'upstream-500',
  'upstream-502',
  'upstream-503',
  'stream-error-event',
  'stream-cut',
  'no-channel',
  'unreachable',
  'wrong-key',
  'spent-key',
  'ok',
];
const USAGE_CASES = ['key-with-quota', 'wrong-key', 'spent-key'];

interface Asked {
  method: string;
  path: string;
  key: string | undefined;
  /** The model a chat request names. */
  model: string | undefined;
  /** The name a new token is given. */
  name: string | undefined;
}

/** What the fake new-api answers: a body or a stream's writes, then with `hangUp` a connection cut, and with `hold` no end at all. */
interface Answer {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  writes?: string[];
  hangUp?: boolean;
  hold?: boolean;
}

const success = (data: unknown = null): Answer => ({ body: JSON.stringify({ success: true, message: '', data }) });

/** How new-api answers a chat request for a model no test changes. */
function chatAnswer(model: string): Answer {
  if (model !== 'ok') return { status: 429, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ error: { message: `${model} refused`, code: 429 } }) };
  return {
    headers: { 'content-type': 'text/event-stream' },
    writes: ['data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n'],
  };
}

/** Answers as new-api does, once `change` has had its say. An admin call with no access token is refused. */
async function serveNewApi(t: TestContext, change: (asked: Asked) => Answer | undefined = () => undefined): Promise<{ port: number; asked: Asked[] }> {
  const asked: Asked[] = [];
  const tokens: string[] = [];
  const answerTo = (a: Asked, admin: boolean): Answer => {
    const changed = change(a);
    if (changed) return changed;
    if (a.path === '/api/status') return success({ version: VERSION });
    if (a.path === '/api/usage/token/') return { body: JSON.stringify({ code: true, data: { total_available: 1 } }) };
    if (a.path === '/v1/chat/completions') return chatAnswer(a.model ?? '');
    if (a.path === '/api/setup') return success();
    if (a.path === '/api/user/login') return success({ access_token: ACCESS_TOKEN, user: { id: 1 } });
    if (!admin) return { status: 401, body: JSON.stringify({ success: false, message: 'AUTH_UNAUTHORIZED' }) };
    if (a.method === 'GET' && a.path.startsWith('/api/token/')) return success({ items: tokens.map((name, i) => ({ id: i + 1, name })) });
    if (a.method === 'POST' && a.path === '/api/token/') {
      tokens.push(a.name ?? '');
      return success();
    }
    const key = a.path.match(/^\/api\/token\/(\d+)\/key$/)?.[1];
    if (key) return success({ key: `key${key}` });
    return success();
  };
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const fields = (raw ? JSON.parse(raw) : {}) as { model?: string; name?: string };
    const a: Asked = { method: req.method ?? '', path: req.url ?? '', key: req.headers.authorization?.replace(/^Bearer /, ''), model: fields.model, name: fields.name };
    asked.push(a);
    const answer = answerTo(a, req.headers.authorization === `Bearer ${ACCESS_TOKEN}` && req.headers['new-api-user'] === '1');
    if (answer.hold) return;
    if (answer.hangUp && !answer.writes) return void res.destroy();
    res.writeHead(answer.status ?? 200, answer.headers ?? { 'content-type': 'application/json; charset=utf-8' });
    for (const write of answer.writes ?? []) {
      res.write(write);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    if (answer.hangUp) return void res.destroy();
    res.end(answer.body ?? '');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { port: (server.address() as AddressInfo).port, asked };
}

interface Capture {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Where the script was told to write the fixture. */
  out: string;
  /** Each call the fake `docker` got. */
  docker: string[];
}

/** A fixture written by an earlier capture, which a failed one leaves as it was. */
const EARLIER = '{"earlier":true}\n';

/** A call of the fake `docker` matching `pattern`, during which the script is stopped by running `stop`. It then ends or hangs. */
interface StopDuring {
  pattern: string;
  stop: string;
  then: 'ends' | 'hangs';
}

/**
 * A fake `docker` that refuses a call matching the shell pattern `refuse`, and otherwise answers for `port`, with
 * `images` the only ones local. `docker rm -f` of no such container exits 0, and `docker network rm` of no such network
 * exits 1 saying not found, as the real one did on 2026-11-09. What a call under `during` makes shows in the log as
 * `made by <command>`, or its process id as `pid <id>` where it hangs.
 */
function fakeDocker(dir: string, port: number, refuse: string, images: string[], during: StopDuring | undefined): string {
  const log = join(dir, 'docker.log');
  writeFileSync(log, '');
  const network = join(dir, 'network-made');
  const script = String.raw`#!/bin/sh
echo "$*" >> ${log}
refuse='${refuse}'
case "$*" in
  $refuse) echo "the fake docker refuses" >&2; exit 1 ;;
esac
during='${during?.pattern ?? ''}'
case "$*" in
  $during)
    ${during?.stop ?? ':'}
    ${during?.then === 'hangs' ? `echo "pid $$" >> ${log}; exec sleep 60` : `sleep 0.3; echo "made by $1" >> ${log}; exit 0`} ;;
esac
case "$1 $2" in
  'network create') : > ${network}; echo a-network-id; exit 0 ;;
  'network rm')
    if [ -e ${network} ]; then echo "$3"; exit 0; fi
    echo "Error response from daemon: network $3 not found" >&2
    exit 1 ;;
esac
case "$1" in
  inspect) echo ${DIGEST} ;;
  images) printf '%s\n' ${images.join(' ')} ;;
  run) echo a-container-id ;;
  logs) echo listening ;;
  port) echo 127.0.0.1:${port} ;;
esac
`;
  const path = join(dir, 'docker');
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return log;
}

/** Runs the script as the person would, writing into a throwaway folder, over an earlier capture when `earlier` says so. */
async function capture(
  t: TestContext,
  port: number,
  options: { args?: string[]; earlier?: boolean; refuse?: string; images?: string[]; during?: StopDuring; started?: (child: ChildProcess) => void } = {},
): Promise<Capture> {
  const dir = mkdtempSync(join(tmpdir(), 'capture-new-api-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = fakeDocker(dir, port, options.refuse ?? '', options.images ?? ['lab1-browser:local', 'node:24-bookworm-slim', 'assistant-pi:local'], options.during);
  const out = join(dir, 'answers.json');
  if (options.earlier) writeFileSync(out, EARLIER);
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
  return new Promise((resolve) => {
    // In a process group of its own, as a command in a terminal is, so that a Ctrl-C goes to its group and not to this one.
    const child = spawn(process.execPath, [SCRIPT, '--out', out, ...(options.args ?? [])], { env, timeout: 30_000, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolve({ code, stdout, stderr, out, docker: readFileSync(log, 'utf8').split('\n').filter(Boolean) }));
    options.started?.(child);
  });
}

interface Fixture {
  image: { version: string; digest: string };
  capturedOn: string;
  usage: Record<string, { status: number; headers: Record<string, string>; body: unknown }>;
  chat: Record<string, { status: number; headers: Record<string, string>; body?: unknown; parts?: string[] }>;
}

const written = (run: Capture) => JSON.parse(readFileSync(run.out, 'utf8')) as Fixture;

test('a capture writes what a client received for each case, with the image’s version and digest and the date', async (t) => {
  const { port, asked } = await serveNewApi(t);
  const run = await capture(t, port);
  assert.equal(run.code, 0, run.stderr);

  const fixture = written(run);
  assert.deepEqual(fixture.image, { version: VERSION, digest: DIGEST });
  assert.equal(fixture.capturedOn, new Date().toISOString().slice(0, 10));
  assert.deepEqual(Object.keys(fixture.usage), USAGE_CASES);
  assert.deepEqual(Object.keys(fixture.chat), CHAT_CASES);
  assert.deepEqual(fixture.chat['plain-429'], { status: 429, headers: { 'content-type': 'application/json; charset=utf-8' }, body: { error: { message: 'plain-429 refused', code: 429 } } });

  // Usage is read before any chat has spent, on keys that have asked nothing, since it holds what has been spent.
  const firstChat = asked.findIndex((a) => a.path === '/v1/chat/completions');
  assert.ok(asked.findLastIndex((a) => a.path === '/api/usage/token/') < firstChat);
  const usageKeys = asked.filter((a) => a.path === '/api/usage/token/').map((a) => a.key);
  const chatKeys = new Set(asked.filter((a) => a.path === '/v1/chat/completions' && a.model !== 'ok').map((a) => a.key));
  assert.equal(usageKeys.length, 3);
  assert.ok(!chatKeys.has(usageKeys[0]), 'the key with quota asks no chat');
});

test('what changes between runs is left out: new-api’s request id and the headers nothing reads', async (t) => {
  const { port } = await serveNewApi(t, ({ path, model }) => {
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      date: 'Mon, 09 Nov 2026 14:31:49 GMT',
      'x-new-api-version': VERSION,
      'x-oneapi-request-id': '202611091431495840290968268d9d6GwHIFya2',
      'retry-after': '120',
      'x-ratelimit-reset': '1893456000000',
    };
    if (path === '/api/usage/token/') return { headers, body: '{"success":false,"message":"Invalid token"}' };
    if (model === 'no-such-model') return { status: 503, headers, body: '{"error":{"code":"model_not_found","message":"No available channel for model no-such-model under group default (distributor) (request id: 202611091431497147578138268d9d63hT6Kuqr)"}}' };
    if (model === 'stream-cut') return { headers: { 'content-type': 'text/event-stream' }, writes: ['data: {"error":{"message":"cut (request id: 2026110914AbC)"}}\n\n'] };
    return undefined;
  });
  const run = await capture(t, port);
  assert.equal(run.code, 0, run.stderr);

  const fixture = written(run);
  const noChannel = fixture.chat['no-channel']!;
  assert.deepEqual(noChannel.body, { error: { code: 'model_not_found', message: 'No available channel for model no-such-model under group default (distributor)' } });
  assert.deepEqual(noChannel.headers, { 'content-type': 'application/json; charset=utf-8', 'retry-after': '120', 'x-ratelimit-reset': '1893456000000' }, 'a header that tells a reset time would show');
  assert.deepEqual(fixture.chat['stream-cut']!.parts, ['data: {"error":{"message":"cut"}}\n\n']);
  assert.doesNotMatch(readFileSync(run.out, 'utf8'), /request id|2026110914|GMT/i);
});

test('an answer that isn’t JSON is written as the text it was', async (t) => {
  const { port } = await serveNewApi(t, ({ model }) => (model === 'upstream-502' ? { status: 502, headers: { 'content-type': 'text/html' }, body: '<html><body>Bad gateway</body></html>' } : undefined));
  const run = await capture(t, port);
  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(written(run).chat['upstream-502'], { status: 502, headers: { 'content-type': 'text/html' }, body: '<html><body>Bad gateway</body></html>' });
});

test('a stream whose events end in CRLF is recorded apart too', async (t) => {
  const events = ['data: {"choices":[{"delta":{"content":"partial"}}]}\r\n\r\n', 'data: {"choices":[],"usage":{"prompt_tokens":9}}\r\n\r\n', 'data: [DONE]\r\n\r\n'];
  const { port } = await serveNewApi(t, ({ model }) => (model === 'stream-cut' ? { headers: { 'content-type': 'text/event-stream' }, writes: [events.join('')] } : undefined));
  const run = await capture(t, port);
  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(written(run).chat['stream-cut']!.parts, events);
});

test('a stream’s parts are recorded apart, in order, however they fell into the network’s chunks', async (t) => {
  const one = 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n';
  const two = 'data: {"choices":[],"usage":{"prompt_tokens":9}}\n\n';
  const done = 'data: [DONE]\n\n';
  const { port } = await serveNewApi(t, ({ model }) => {
    const headers = { 'content-type': 'text/event-stream' };
    if (model === 'stream-cut') return { headers, writes: [`${one}${two}${done}`] };
    if (model === 'stream-error-event') return { headers, writes: [one.slice(0, 10), one.slice(10), two, done] };
    return undefined;
  });
  const run = await capture(t, port);
  assert.equal(run.code, 0, run.stderr);

  const { chat } = written(run);
  for (const model of ['stream-cut', 'stream-error-event']) {
    assert.deepEqual(chat[model], { status: 200, headers: { 'content-type': 'text/event-stream' }, parts: [one, two, done] }, model);
  }
});

/** That what the run made is gone: each container, then the network, last of all. */
function assertRemoved(run: Capture, what?: string): void {
  const containers = run.docker.filter((call) => call.startsWith('run ')).map((call) => call.match(/--name (\S+)/)![1]!);
  for (const container of containers) assert.ok(run.docker.includes(`rm -f ${container}`), `${what}: ${container} in ${run.docker.join('; ')}`);
  const network = run.docker.find((call) => call.startsWith('network create '))?.split(' ')[2];
  if (network) assert.equal(run.docker.at(-1), `network rm ${network}`, what);
}

/** That the run stopped with `CAPTURE FAILED`, naming `step`, left the earlier fixture as it was and removed what it made. */
function assertStopped(run: Capture, step: string, what?: string): void {
  assert.notEqual(run.code, 0, what);
  assert.ok(run.stderr.includes(`CAPTURE FAILED at ${step}: `), `${what} should name ${step}: ${run.stderr}`);
  assert.ok(run.stderr.includes('The fixture was left as it was.'), what);
  assert.equal(readFileSync(run.out, 'utf8'), EARLIER, what);
  assertRemoved(run, what);
}

test('the throwaway sits on a private network, is published only on 127.0.0.1, keeps its data in a tmpfs, and is gone at the end', async (t) => {
  const { port } = await serveNewApi(t);
  const run = await capture(t, port);
  assert.equal(run.code, 0, run.stderr);

  const network = run.docker.find((call) => call.startsWith('network create '))!.split(' ')[2]!;
  const runs = run.docker.filter((call) => call.startsWith('run '));
  assert.equal(runs.length, 2, run.docker.join('; '));
  for (const call of runs) assert.ok(call.includes(`--network ${network} `), call);
  assert.equal(runs.filter((call) => / -p |--publish/.test(call)).length, 1, 'only new-api is published');
  const newApi = runs.find((call) => call.includes(DIGEST))!;
  assert.match(newApi, / -p 127\.0\.0\.1::3000 /);
  assert.match(newApi, / --tmpfs \/data /);
  const stub = runs.find((call) => !call.includes(DIGEST))!;
  assert.match(stub, / --pull=never /, 'nothing is pulled for the stub');
  assert.match(stub, / assistant-pi:local \/stub\.mts$/);
  assertRemoved(run);
});

test('with neither of the images it prefers, the stub runs on another image with node, and with none it stops', async (t) => {
  const { port } = await serveNewApi(t);
  const run = await capture(t, port, { images: ['lab1-browser:local', 'node:24-bookworm-slim'] });
  assert.equal(run.code, 0, run.stderr);
  assert.ok(run.docker.some((call) => call.startsWith('run ') && call.endsWith(' node:24-bookworm-slim /stub.mts')), run.docker.join('; '));

  assertStopped(await capture(t, port, { earlier: true, images: ['lab1-browser:local'] }), "pick the stub's image");
});

test('a setup step that fails stops the capture, names the step, leaves the fixture and removes the throwaway', async (t) => {
  const steps: [string, (a: Asked) => boolean][] = [
    ['POST /api/setup', (a) => a.path === '/api/setup'],
    ['POST /api/user/login', (a) => a.path === '/api/user/login'],
    ['POST /api/channel/', (a) => a.path === '/api/channel/'],
    ['PUT /api/option/', (a) => a.path === '/api/option/'],
    ['POST /api/token/', (a) => a.method === 'POST' && a.path === '/api/token/'],
    ['GET /api/token/?p=0&size=100', (a) => a.method === 'GET' && a.path.startsWith('/api/token/')],
    ['POST /api/token/1/key', (a) => a.path === '/api/token/1/key'],
  ];
  for (const [step, isIt] of steps) {
    for (const [how, answer] of [
      ['refuses', { body: '{"success":false,"message":"changed"}' }],
      ['hangs up', { hangUp: true }],
    ] as [string, Answer][]) {
      const { port } = await serveNewApi(t, (a) => (isIt(a) ? answer : undefined));
      assertStopped(await capture(t, port, { earlier: true }), step, `${step} ${how}`);
    }
  }

  const page = await serveNewApi(t, (a) => (a.path === '/api/setup' ? { status: 404, body: '<html>Not found</html>' } : undefined));
  const run = await capture(t, page.port, { earlier: true });
  assertStopped(run, 'POST /api/setup');
  assert.match(run.stderr, /it answered 404: <html>Not found<\/html>/);
});

test('a setup answer that doesn’t hold what the next step needs stops the capture at that step', async (t) => {
  const answers: [string, (a: Asked) => boolean, Answer][] = [
    ['POST /api/user/login', (a) => a.path === '/api/user/login', success({ user: { id: 1 } })],
    ['POST /api/user/login', (a) => a.path === '/api/user/login', success({ access_token: ACCESS_TOKEN })],
    ['GET /api/token/?p=0&size=100', (a) => a.method === 'GET' && a.path.startsWith('/api/token/'), success({ items: [] })],
    ['GET /api/token/?p=0&size=100', (a) => a.method === 'GET' && a.path.startsWith('/api/token/'), success([])],
    ['POST /api/token/1/key', (a) => a.path === '/api/token/1/key', success({})],
  ];
  for (const [step, isIt, answer] of answers) {
    const { port } = await serveNewApi(t, (a) => (isIt(a) ? answer : undefined));
    assertStopped(await capture(t, port, { earlier: true }), step, `${step}: ${answer.body}`);
  }
});

test('a docker command that fails stops the capture, names the step, and says what docker said', async (t) => {
  const { port } = await serveNewApi(t);
  for (const [step, refuse] of [
    ['find the image', 'inspect new-api *'],
    ["pick the stub's image", 'images *'],
    ['create the network', 'network create *'],
    ['start the stub', 'run *--entrypoint*'],
    ['start the stub', 'logs *'],
    ['start new-api', 'run *--tmpfs*'],
    ['start new-api', 'inspect capture-new-api-*'],
    ['start new-api', 'port *'],
  ] as const) {
    const run = await capture(t, port, { earlier: true, refuse });
    assertStopped(run, step, refuse);
    assert.match(run.stderr, /the fake docker refuses/, refuse);
    assert.doesNotMatch(run.stderr, /remove it by hand/, `${refuse}: what was never made needs no removing`);
  }
});

test('a new-api that gives no version stops the capture', async (t) => {
  const { port } = await serveNewApi(t, (a) => (a.path === '/api/status' ? success({}) : undefined));
  assertStopped(await capture(t, port, { earlier: true }), "read new-api's version");
});

test('a case that gets no answer stops the capture, however little it got', async (t) => {
  const stream = { 'content-type': 'text/event-stream' };
  const cases: [string, (a: Asked) => boolean, Answer][] = [
    ['chat for plain-429', (a) => a.model === 'plain-429', { hangUp: true }],
    ['chat for no-channel', (a) => a.model === 'no-such-model', { hangUp: true }],
    ['chat for wrong-key', (a) => a.path === '/v1/chat/completions' && a.key === 'sk-wrong', { hangUp: true }],
    ['usage of wrong-key', (a) => a.path === '/api/usage/token/' && a.key === 'sk-wrong', { hangUp: true }],
    ['chat for stream-cut', (a) => a.model === 'stream-cut', { headers: stream, writes: ['data: {"choices":[]}\n\n'], hangUp: true }],
    // A clean answer with nothing in it is no answer either (settled on #108).
    ['chat for plain-429', (a) => a.model === 'plain-429', { body: '' }],
    ['chat for plain-429', (a) => a.model === 'plain-429', { body: ' \n' }],
    ['usage of spent-key', (a) => a.path === '/api/usage/token/' && a.key === 'sk-key3', { body: '' }],
    ['chat for stream-cut', (a) => a.model === 'stream-cut', { headers: stream, writes: [] }],
  ];
  for (const [step, isIt, answer] of cases) {
    const { port } = await serveNewApi(t, (a) => (isIt(a) ? answer : undefined));
    assertStopped(await capture(t, port, { earlier: true }), step);
  }
});

test('a new-api that answers each case but serves no reply writes no fixture, since its setup must have gone wrong', async (t) => {
  const answers: Answer[] = [
    { status: 503, body: '{"error":{"code":"model_not_found"}}' },
    { headers: { 'content-type': 'text/event-stream' }, writes: ['data: [DONE]\n\n'] },
  ];
  for (const answer of answers) {
    const { port } = await serveNewApi(t, (a) => (a.model === 'ok' && a.key !== 'sk-wrong' ? answer : undefined));
    assertStopped(await capture(t, port, { earlier: true }), 'check that a reply is served');
  }
});

test('an image named by digest runs in place of the running one', async (t) => {
  const { port } = await serveNewApi(t);
  const named = `calciumion/new-api@sha256:${'b'.repeat(64)}`;
  const run = await capture(t, port, { args: ['--image', named] });
  assert.equal(run.code, 0, run.stderr);
  assert.ok(run.docker.some((call) => call.startsWith('run ') && call.endsWith(` ${named}`)), run.docker.join('; '));
  assert.ok(!run.docker.some((call) => call.startsWith('inspect new-api')), 'the running container isn’t asked');
  assert.equal(written(run).image.digest, DIGEST, 'the digest is the one the throwaway reports');

  const bare = await capture(t, port, { args: ['--image', `sha256:${'b'.repeat(64)}`] });
  assert.equal(bare.code, 0, bare.stderr);
});

test('an image named by anything but a digest, or an argument it doesn’t know, stops before docker is asked anything', async (t) => {
  const { port } = await serveNewApi(t);
  for (const args of [['--image', 'calciumion/new-api:latest'], ['--image', 'latest'], ['--image', 'sha256:abf1f675'], ['--bogus']]) {
    const run = await capture(t, port, { args, earlier: true });
    assertStopped(run, 'read the arguments', args.join(' '));
    assert.deepEqual(run.docker, [], args.join(' '));
  }
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  test(`stopped by ${signal}, it removes the throwaway and leaves the fixture`, async (t) => {
    let child: ChildProcess;
    const { port } = await serveNewApi(t, (a) => {
      if (a.path !== '/api/setup') return undefined;
      child.kill(signal);
      return { hold: true };
    });
    const run = await capture(t, port, { earlier: true, started: (started) => (child = started) });
    assertStopped(run, 'POST /api/setup');
    assert.ok(run.stderr.includes(`stopped by ${signal}`), run.stderr);
  });
}

for (const [how, stop] of [
  ['SIGTERM to the script', 'kill -TERM $PPID'],
  // As a terminal sends it, to the script's whole process group.
  ['a Ctrl-C', 'kill -INT -$(ps -o pgid= -p $PPID | tr -d " ")'],
] as const) {
  test(`stopped by ${how} while docker makes a container, it lets docker finish, starts nothing more, and removes what docker made`, async (t) => {
    const { port } = await serveNewApi(t);
    const run = await capture(t, port, { earlier: true, during: { pattern: 'run *--tmpfs*', stop, then: 'ends' } });
    assertStopped(run, 'start new-api');
    const made = run.docker.indexOf('made by run');
    assert.ok(made >= 0, `docker was cut off: ${run.docker.join('; ')}`);
    const removals = run.docker.slice(made + 1);
    assert.equal(removals.length, 3, `only the removals follow: ${removals.join('; ')}`);
    assert.ok(removals.every((call) => call.startsWith('rm -f ') || call.startsWith('network rm ')), removals.join('; '));
    assert.equal(run.stderr.match(/CAPTURE FAILED/g)?.length, 1, run.stderr);
  });
}

test('a docker command that won’t end once a signal has come is killed, and what was made is still removed', async (t) => {
  const { port } = await serveNewApi(t);
  const run = await capture(t, port, { earlier: true, during: { pattern: 'run *--tmpfs*', stop: 'kill -TERM $PPID', then: 'hangs' } });
  assertStopped(run, 'start new-api');
  const pid = Number(run.docker.find((call) => call.startsWith('pid '))!.split(' ')[1]);
  const end = Date.now() + 5_000;
  while (running(pid) && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(running(pid), false, 'the command is gone');
});

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('what it can’t remove it names, and the run fails, though the fixture was written', async (t) => {
  const { port } = await serveNewApi(t);
  const run = await capture(t, port, { refuse: 'rm -f *' });
  assert.notEqual(run.code, 0);
  assert.match(run.stderr, /remove it by hand: docker rm -f capture-new-api-\w+-new-api/);
  assert.match(run.stderr, /remove it by hand: docker rm -f capture-new-api-\w+-stub/);
  assert.equal(written(run).image.version, VERSION);
});

test('the committed fixture holds every case, says what it ran on, and holds no request id', () => {
  const text = readFileSync(join(ROOT, 'bot', 'test', 'fixtures', 'new-api', 'answers.json'), 'utf8');
  const fixture = JSON.parse(text) as Fixture;
  assert.deepEqual(Object.keys(fixture.usage), USAGE_CASES);
  assert.deepEqual(Object.keys(fixture.chat), CHAT_CASES);
  assert.match(fixture.image.version, /^v\d/);
  assert.match(fixture.image.digest, /^sha256:[0-9a-f]{64}$/);
  assert.match(fixture.capturedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.doesNotMatch(text, /request id/i);
});

test('the stub answers each model it lists as the research records it, and refuses any other', async (t) => {
  const server = stubServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const ask = (model: string) =>
    fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/chat/completions`, { method: 'POST', body: JSON.stringify({ model }), signal: AbortSignal.timeout(5_000) });

  const statuses: Record<string, number> = {
    'cpa-cooldown': 429,
    'plus-limit': 429,
    'openrouter-429': 429,
    'plain-429': 429,
    'retry-after-only': 429,
    'openrouter-402': 402,
    'deepseek-402': 402,
    'upstream-400': 400,
    'upstream-401': 401,
    'upstream-403': 403,
    'upstream-500': 500,
    'upstream-502': 502,
    'upstream-503': 503,
    'stream-error-event': 200,
    'stream-cut': 200,
    ok: 200,
  };
  assert.deepEqual(STUB_MODELS, Object.keys(statuses));
  for (const [model, status] of Object.entries(statuses)) assert.equal((await ask(model)).status, status, model);

  assert.equal((await ask('retry-after-only')).headers.get('retry-after'), '120');
  assert.equal((await ask('no-such-model')).status, 404);
  assert.match(await (await ask('stream-error-event')).text(), /"finish_reason":"error".*\n\ndata: \[DONE\]\n\n$/s);
  assert.match(await (await ask('ok')).text(), /"usage":.*\n\ndata: \[DONE\]\n\n$/s);
  await assert.rejects((await ask('stream-cut')).text(), 'the stream breaks off, with no end');
});
