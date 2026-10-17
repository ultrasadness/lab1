// What tests share: the compose project the harness runs, and the socket and container it starts.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { PageRead, ReadFailureKind } from '../src/api.ts';
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
