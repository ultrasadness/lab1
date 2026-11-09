// `npm run capture:new-api`: keeps the trial on #46 in the repo (#108). It runs a throwaway new-api in front of a stub
// upstream (`capture-new-api-stub.ts`), asks it for each kind of failure, and writes what a client received to
// `bot/test/fixtures/new-api/answers.json`, where `bot/test/harness/fake-model.ts` reads it. A changed answer then shows
// in the fixture's diff, and fails the tests of whatever relied on it.
//
// The throwaway is of the image the running `new-api` container uses, or of the one `--image` names by digest. It sits on
// a private Docker network, is published only on 127.0.0.1 and keeps its data in a tmpfs, and it is removed when the
// script ends, however it ends. A step that fails, or a case that gets no answer, stops the script with `CAPTURE FAILED`,
// naming the step, before anything is written. `--out` writes the fixture elsewhere.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { constants } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { STUB_MODELS, STUB_PORT } from './capture-new-api-stub.ts';

const ROOT = join(import.meta.dirname, '..');
const NEW_API_PORT = 3000;
/** How long a docker command may take: `docker run` may have to pull an image named by digest. */
const DOCKER_MS = 5 * 60_000;
/** How long a docker command under way has to end once a signal has come. `docker run` of a local image takes far less. */
const END_UNDERWAY_MS = 5_000;
/** How long removing one container or the network may take. */
const REMOVE_MS = 60_000;
/** How long the stub and new-api have to start. */
const START_MS = 60_000;
/** How long new-api has to answer one request, body included. */
const ANSWER_MS = 30_000;
const POLL_MS = 250;
/** How much of an answer an error quotes. */
const QUOTED_CHARS = 300;
/** The images that hold node, by preference. The first is on the VM for as long as the bot runs, and the trial on #46 used it. */
const STUB_IMAGES = [/^assistant-pi:local$/, /^node:/];
/** An image by digest: a tag can move, and then the fixture wouldn't say what ran. */
const BY_DIGEST = /^(?:[\w./:-]+@)?sha256:[0-9a-f]{64}$/;
/** The model of a channel whose address on the private network has nothing listening. */
const UNREACHABLE_MODEL = 'unreachable';
/** How new-api signs its own errors, which differs on each request. */
const REQUEST_ID = / \(request id: [^)]*\)/g;

/** An answer as a client received it. */
interface Answer {
  status: number;
  headers: Record<string, string>;
  /** A whole answer: the parsed JSON, or the text where it isn't JSON. */
  body?: unknown;
  /** A stream's parts, in the order new-api sent them. */
  parts?: string[];
}

const name = `capture-new-api-${randomBytes(4).toString('hex')}`;
const [network, stub, newApi] = [name, `${name}-stub`, `${name}-new-api`];
/** The step under way, which a failure names, or null once the fixture is written. */
let step: string | null = 'read the arguments';
/** The docker commands that remove what was made, in the order it was made. Each goes in before what it removes is made. */
const removals: string[][] = [];
/** The docker commands under way. */
const underway = new Set<ChildProcess>();
/** Whether a signal has come. No docker command starts after one, since what it made would outlive the removal. */
let stopping = false;

function docker(...dockerArgs: string[]): Promise<string> {
  if (stopping) return Promise.reject(new Error('a signal came'));
  return new Promise((resolve, reject) => {
    // In a process group of its own, so that a Ctrl-C reaches only this script, which then lets the command end. Cut off,
    // `docker run` can leave a container it has asked for, which appears only after the removal has looked for it.
    const child = spawn('docker', dockerArgs, { timeout: DOCKER_MS, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    underway.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const failed = (reason: string) => reject(new Error(`docker ${dockerArgs[0]} failed: ${reason}`));
    child.on('error', (error) => {
      underway.delete(child);
      failed(error.message);
    });
    child.on('close', (code, signal) => {
      underway.delete(child);
      if (code === 0) resolve(stdout.trim());
      else failed(stderr.trim() || `it ended with ${code ?? signal}`);
    });
  });
}

const pause = () => new Promise((resolve) => setTimeout(resolve, POLL_MS));

async function startContainer(container: string, ...dockerArgs: string[]): Promise<void> {
  removals.push(['rm', '-f', container]);
  await docker('run', '-d', '--name', container, '--network', network, ...dockerArgs);
}

async function startStub(): Promise<void> {
  step = "pick the stub's image";
  const images = (await docker('images', '--format', '{{.Repository}}:{{.Tag}}')).split('\n');
  const image = STUB_IMAGES.map((wanted) => images.find((i) => wanted.test(i))).find((i) => i !== undefined);
  if (!image) throw new Error('no local image holds node: pull one with docker pull node:24-bookworm-slim');
  step = 'start the stub';
  const script = join(import.meta.dirname, 'capture-new-api-stub.ts');
  await startContainer(stub, '--pull=never', '--network-alias', 'stub', '--entrypoint', 'node', '-v', `${script}:/stub.mts:ro`, image, '/stub.mts');
  const end = Date.now() + START_MS;
  while (!(await docker('logs', stub)).includes('listening')) {
    if (Date.now() > end) throw new Error(`the stub didn't start within ${START_MS / 1000} seconds`);
    await pause();
  }
}

/** Starts the throwaway and waits for it. Resolves to its address on 127.0.0.1, its version, and its image's digest. */
async function startNewApi(image: string): Promise<{ address: string; version: string; digest: string }> {
  step = 'start new-api';
  await startContainer(newApi, '-p', `127.0.0.1::${NEW_API_PORT}`, '--tmpfs', '/data', image);
  const digest = await docker('inspect', newApi, '--format', '{{.Image}}');
  const address = `http://${(await docker('port', newApi, String(NEW_API_PORT))).split('\n')[0]}`;
  step = 'wait for new-api';
  const end = Date.now() + START_MS;
  let answer: Response | undefined;
  while (!answer) {
    try {
      answer = await fetch(`${address}/api/status`, { signal: AbortSignal.timeout(ANSWER_MS) });
    } catch (error) {
      if (Date.now() > end) throw new Error(`new-api didn't answer within ${START_MS / 1000} seconds: ${why(error)}`);
      await pause();
    }
  }
  step = "read new-api's version";
  const text = await answer.text();
  const version = (parsed(text) as { data?: { version?: unknown } } | null)?.data?.version;
  if (typeof version !== 'string') throw new Error(`/api/status answered ${answer.status}, with no version: ${text.slice(0, QUOTED_CHARS)}`);
  return { address, version, digest };
}

/** Sets new-api up through its API, and asks it each case. */
async function setUpAndAskEachCase(address: string): Promise<{ usage: Record<string, Answer>; chat: Record<string, Answer> }> {
  let bearer = '';
  let user = '';
  /** One call of its admin API, which is a step of its own. Anything short of `success: true` fails it. */
  const admin = async <Data>(method: string, path: string, body?: unknown): Promise<{ data?: Data | null }> => {
    step = `${method} ${path}`;
    const response = await fetch(`${address}${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}`, 'New-Api-User': user },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(ANSWER_MS),
    });
    const text = await response.text();
    const reply = parsed(text) as { success?: unknown; data?: Data | null } | null;
    if (reply?.success !== true) throw new Error(`it answered ${response.status}: ${text.slice(0, QUOTED_CHARS)}`);
    return reply;
  };

  const password = randomBytes(16).toString('hex');
  await admin('POST', '/api/setup', { username: 'captureadmin', password, confirmPassword: password, SelfUseModeEnabled: true, DemoSiteEnabled: false });
  const { data: login } = await admin<{ access_token?: unknown; user?: { id?: unknown } }>('POST', '/api/user/login', { username: 'captureadmin', password });
  if (typeof login?.access_token !== 'string' || login.user?.id === undefined) throw new Error('its answer holds no access_token and user id');
  bearer = login.access_token;
  user = String(login.user.id);

  const channel = (channelName: string, baseUrl: string, models: string[]) =>
    admin('POST', '/api/channel/', { mode: 'single', channel: { name: channelName, type: 1, key: 'stub-key', base_url: baseUrl, models: models.join(','), group: 'default', groups: ['default'], status: 1, auto_ban: 0 } });
  await channel('stub', `http://stub:${STUB_PORT}`, STUB_MODELS);
  await channel('nothing-listening', 'http://stub:1', [UNREACHABLE_MODEL]);
  await admin('PUT', '/api/option/', { key: 'ModelRatio', value: JSON.stringify(Object.fromEntries([...STUB_MODELS, UNREACHABLE_MODEL].map((model) => [model, 0.001]))) });

  const makeKey = async (tokenName: string, quota: number): Promise<string> => {
    await admin('POST', '/api/token/', { name: tokenName, expired_time: -1, unlimited_quota: false, remain_quota: quota, group: '', model_limits_enabled: false, model_limits: '' });
    const { data: listed } = await admin<{ items?: { id: number; name: string }[] }>('GET', '/api/token/?p=0&size=100');
    const token = listed?.items?.find((t) => t.name === tokenName);
    if (!token) throw new Error(`its list of tokens doesn't hold ${tokenName}`);
    const { data: held } = await admin<{ key?: unknown }>('POST', `/api/token/${token.id}/key`);
    if (typeof held?.key !== 'string') throw new Error(`it gives no key for ${tokenName}`);
    return `sk-${held.key.replace(/^sk-/, '')}`;
  };
  const askingKey = await makeKey('asking', 500_000_000);
  const keyWithQuota = await makeKey('with-quota', 500_000);
  const spentKey = await makeKey('spent', 0);
  const wrongKey = 'sk-wrong';

  const ask = async (caseName: string, path: string, init: RequestInit): Promise<Answer> => {
    step = caseName;
    return answerOf(await fetch(`${address}${path}`, { ...init, signal: AbortSignal.timeout(ANSWER_MS) }));
  };
  const usageOf = (caseName: string, key: string) => ask(`usage of ${caseName}`, '/api/usage/token/', { headers: { authorization: `Bearer ${key}` } });
  // The bot's requests are all streamed, with usage asked for (settled on #108).
  const chatFor = (caseName: string, key: string, model: string) =>
    ask(`chat for ${caseName}`, '/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true, stream_options: { include_usage: true }, messages: [{ role: 'user', content: 'hi' }] }),
    });

  // Usage tells what has been spent, by the key and by the user holding it, so it is read before any chat has spent.
  const usage = {
    'key-with-quota': await usageOf('key-with-quota', keyWithQuota),
    'wrong-key': await usageOf('wrong-key', wrongKey),
    'spent-key': await usageOf('spent-key', spentKey),
  };
  const chat: Record<string, Answer> = {};
  for (const model of STUB_MODELS.filter((m) => m !== 'ok')) chat[model] = await chatFor(model, askingKey, model);
  chat['no-channel'] = await chatFor('no-channel', askingKey, 'no-such-model');
  chat[UNREACHABLE_MODEL] = await chatFor(UNREACHABLE_MODEL, askingKey, UNREACHABLE_MODEL);
  chat['wrong-key'] = await chatFor('wrong-key', wrongKey, 'ok');
  chat['spent-key'] = await chatFor('spent-key', spentKey, 'ok');
  // Last, so it shows the stub and the channel still served after every case: answers from a new-api set up wrong, or a
  // stub that died part way, would all be answers.
  chat.ok = await chatFor('ok', askingKey, 'ok');
  step = 'check that a reply is served';
  if (chat.ok.status !== 200 || !chat.ok.parts?.some((part) => part.includes('hello'))) {
    throw new Error(`new-api answered a request the stub would serve with: ${JSON.stringify(chat.ok).slice(0, QUOTED_CHARS)}`);
  }
  return { usage, chat };
}

/**
 * What a client received, less what changes between runs: new-api's request id, and every header but the content type
 * and any that could tell a reset time, as the trial on #46 looked for. A stream's network chunks fall differently from
 * run to run, so a part is one server-sent event. A reply that breaks off rejects here, and an empty one throws: each
 * counts as no answer.
 */
async function answerOf(response: Response): Promise<Answer> {
  const text = (await response.text()).replace(REQUEST_ID, '');
  if (!text.trim()) throw new Error(`it answered ${response.status} with nothing in it`);
  const headers = Object.fromEntries([...response.headers].filter(([header]) => /^content-type$|retry|rate|reset/.test(header)));
  if (/^text\/event-stream\b/i.test(response.headers.get('content-type') ?? '')) {
    return { status: response.status, headers, parts: text.split(/(?<=\n\n|\r\n\r\n)/) };
  }
  return { status: response.status, headers, body: parsed(text) ?? text };
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Why a request failed: fetch says only "fetch failed", and its cause says why. */
function why(error: unknown): string {
  return ((error as Error).cause as Error | undefined)?.message ?? (error as Error).message;
}

function reportFailure(reason: string): void {
  console.error(`CAPTURE FAILED at ${step}: ${reason.replace(/\.$/, '')}. The fixture was left as it was.`);
  process.exitCode = 1;
}

/** Removes what was made, last made first, and says what it couldn't. It blocks, so a signal's handler can use it too. */
function removeThrowaway(): void {
  for (const removal of removals.splice(0).reverse()) {
    const { status, stderr } = spawnSync('docker', removal, { timeout: REMOVE_MS, encoding: 'utf8' });
    // A network whose creation failed is no failure of this.
    if (status === 0 || /not found/.test(stderr)) continue;
    console.error(`capture:new-api: couldn't remove part of the throwaway, so remove it by hand: docker ${removal.join(' ')}`);
    process.exitCode = 1;
  }
}

/** Lets the docker commands under way end, so that none makes anything after the removal. One that won't, as a pull may not, is killed. */
async function endDockerCommands(): Promise<void> {
  const end = Date.now() + END_UNDERWAY_MS;
  while (underway.size > 0 && Date.now() < end) await pause();
  for (const child of underway) child.kill('SIGKILL');
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    if (step) reportFailure(`stopped by ${signal}`);
    void endDockerCommands().then(() => {
      removeThrowaway();
      process.exit(128 + constants.signals[signal]);
    });
  });
}

try {
  const { values: args } = parseArgs({ options: { image: { type: 'string' }, out: { type: 'string' } } });
  if (args.image !== undefined && !BY_DIGEST.test(args.image)) throw new Error(`--image takes an image by its whole digest, as calciumion/new-api@sha256:…, not ${args.image}`);
  step = 'find the image';
  const image = args.image ?? (await docker('inspect', 'new-api', '--format', '{{.Image}}'));
  step = 'create the network';
  removals.push(['network', 'rm', network]);
  await docker('network', 'create', network);
  await startStub();
  const { address, version, digest } = await startNewApi(image);
  const answers = await setUpAndAskEachCase(address);
  step = 'write the fixture';
  const fixture = { image: { version, digest }, capturedOn: new Date().toISOString().slice(0, 10), ...answers };
  const out = args.out ?? join(ROOT, 'bot', 'test', 'fixtures', 'new-api', 'answers.json');
  writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`);
  step = null;
  console.log(`Wrote what new-api ${version} answered to ${out}`);
} catch (error) {
  // Once a signal has come, the signal is what failed the step, and its handler has said so.
  if (!stopping) reportFailure(why(error));
} finally {
  removeThrowaway();
}
