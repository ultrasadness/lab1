// What tests share: the compose project the harness runs, and the socket and container it starts.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { CheckRequest, Driver, PageRead, ReadFailureKind, RefusalKind, SessionOutcome } from '../src/api.ts';
import { BrowserClient } from '../src/client.ts';

const PROJECT = 'lab1-browser-test';
const BROWSER_DIR = fileURLToPath(new URL('..', import.meta.url));

export function run(cmd: string, args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: BROWSER_DIR, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      resolve({ code, out: `${stdout}${stderr}` });
    });
  });
}

export async function compose(env: Record<string, string>, ...args: string[]): Promise<string> {
  const { code, out } = await run('docker', ['compose', '-p', PROJECT, '-f', 'compose.yaml', '-f', 'test/compose.test.yaml', ...args], env);
  if (code !== 0) throw new Error(`docker compose ${args.join(' ')} failed:\n${out}`);
  return out;
}

// The global setup hands these over in the environment.
const fromSetup = (name: string) => process.env[name] ?? assert.fail(`${name} is unset: run the tests through npm test`);
export const socketPath = () => fromSetup('BROWSER_TEST_SOCKET');
export const containerId = () => fromSetup('BROWSER_TEST_CONTAINER');
const pagesId = () => fromSetup('BROWSER_TEST_PAGES');

export function browser(): BrowserClient {
  return new BrowserClient(socketPath());
}

/** Runs a command inside the browser service's container. */
export function inBrowserContainer(...cmd: string[]) {
  return run('docker', ['exec', containerId(), ...cmd]);
}

export async function read(url: string): Promise<PageRead> {
  const outcome = await browser().read(url);
  if (!outcome.ok) assert.fail(`read failed: ${outcome.error.kind}: ${outcome.error.message}`);
  return outcome.page;
}

export async function readFailure(url: string): Promise<ReadFailureKind | 'none'> {
  const outcome = await browser().read(url);
  return outcome.ok ? 'none' : outcome.error.kind;
}

export function assertIncludes(text: string, part: string) {
  assert.ok(text.includes(part), `expected the text to include ${JSON.stringify(part)}:\n${text}`);
}

let opened = 0;

/** Opens a session at a local test page for the length of the test, driven by a fill run unless it says otherwise. */
export async function openSession(t: TestContext, url: string, options: { domains?: string[]; driver?: Driver } = {}): Promise<string> {
  const { session } = await ok(browser().openSession({ registration: `test-${process.pid}-${++opened}`, url, domains: options.domains ?? ['acme.test'] }));
  t.after(() => browser().closeSession(session));
  if ((options.driver ?? 'fill-run') !== 'none') await ok(browser().drive(session, options.driver ?? 'fill-run'));
  return session;
}

/** What the Walkthrough of the session signup page approved. */
export const approved: CheckRequest = {
  button: 'b1',
  signupHost: 'acme.test',
  terms: ['http://acme.test/terms', 'http://acme.test/privacy'],
  identity: ['sam+acme@gmail.com', 'sam@gmail.com'],
};

/** Fills the signup page as a Walkthrough approved it, leaving out the fields named, and hands it to plain code. */
export async function filledSignup(t: TestContext, flags = '', leaveOut: string[] = [], password = 'Zk3mQ8xL2pV9rT4nW7yB-a1!') {
  const session = await openSession(t, `http://acme.test/session/signup${flags}`);
  await ok(browser().snapshot(session));
  const steps: [string, () => Promise<unknown>][] = [
    ['f1', () => ok(browser().fill(session, 'f1', 'full-name', 'Sam Example'))],
    ['f2', () => ok(browser().fill(session, 'f2', 'email', 'sam+acme@gmail.com'))],
    ['f3', () => ok(browser().fillSecret(session, 'f3', 'password', password))],
    ['f4', () => ok(browser().choose(session, 'f4', 'choice', 'Developer'))],
    ['f5', () => ok(browser().choose(session, 'f5', 'plan', 'Free'))],
    ['f7', () => ok(browser().choose(session, 'f7', 'terms', 'ticked'))],
  ];
  for (const [ref, step] of steps) if (!leaveOut.includes(ref)) await step();
  await ok(browser().drive(session, 'plain-code'));
  return session;
}

/** What an action answered, failing the test when the session refused it. */
export async function ok<T extends object>(outcome: Promise<SessionOutcome<T>>): Promise<T> {
  const answer = await outcome;
  if (!answer.ok) assert.fail(`refused: ${answer.error.kind}: ${answer.error.message}`);
  return answer;
}

/** Why the session refused an action, or 'none' when it didn't. */
export async function refused(outcome: Promise<SessionOutcome>): Promise<RefusalKind | 'none'> {
  const answer = await outcome;
  return answer.ok ? 'none' : answer.error.kind;
}

export interface Received {
  host: string;
  method: string;
  url: string;
  /** A posted form's fields, in order. */
  form: [string, string][];
}

/** What the local Product's server has received so far: each form posted and each verification link opened. */
export async function received(): Promise<Received[]> {
  const { code, out } = await run('docker', ['logs', pagesId()]);
  assert.equal(code, 0, out);
  return out
    .split('\n')
    .filter((line) => line.startsWith('received '))
    .map((line) => {
      const { body, ...rest } = JSON.parse(line.slice('received '.length));
      return { ...rest, form: [...new URLSearchParams(body)] };
    });
}
