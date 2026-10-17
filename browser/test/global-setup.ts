// Builds the real image and starts it, hardened as in production, beside the local test pages.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserClient } from '../src/client.ts';
import { compose } from './harness.ts';

const socketDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab1-browser-'));
const env = { BROWSER_SOCKET_DIR: socketDir, BROWSER_SOCKET_GID: String(process.getgid!()) };

export async function globalSetup() {
  // As on the VM: the directory belongs to the bot's group, and new files in it inherit that group.
  fs.chmodSync(socketDir, 0o2770);
  const socketPath = path.join(socketDir, 'browser.sock');

  await compose(env, 'build', 'browser');
  await compose(env, 'up', '-d', '--force-recreate', '--remove-orphans');
  const client = new BrowserClient(socketPath);
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      await client.health();
      break;
    } catch {
      if (Date.now() > deadline) {
        console.error(await compose(env, 'logs').catch((e) => String(e)));
        throw new Error('the browser service did not come up');
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  process.env.BROWSER_TEST_SOCKET = socketPath;
  process.env.BROWSER_TEST_CONTAINER = (await compose(env, 'ps', '-q', 'browser')).trim();
}

export async function globalTeardown() {
  if (process.env.KEEP_BROWSER) return;
  await compose(env, 'down', '--volumes', '--remove-orphans');
  fs.rmSync(socketDir, { recursive: true, force: true });
}
