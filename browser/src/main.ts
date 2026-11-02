// Starts the browser service: a display, one sandboxed headed Chrome for Testing, and the socket.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import { autoconsentVersion } from './cookie-banners.ts';
import { createReader, VIEWPORT } from './reader.ts';
import { redirectOf } from './redirect.ts';
import { listen } from './server.ts';
import { createSessions } from './sessions.ts';

const SOCKET_PATH = process.env.SOCKET_PATH ?? '/run/browser/browser.sock';
const DISPLAY = ':99';
// The page's size, plus Chrome's tab strip and toolbar.
const WINDOW = { width: VIEWPORT.width, height: VIEWPORT.height + 88 };

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

async function startDisplay() {
  // Xvfb runs as pwuser and can't make this directory itself.
  fs.mkdirSync('/tmp/.X11-unix', { recursive: true, mode: 0o1777 });
  // Its keymap compiler warns about every keysym it lacks; a display that fails shows as an exit or a missing socket.
  const xvfb = spawn('Xvfb', [DISPLAY, '-screen', '0', `${WINDOW.width}x${WINDOW.height}x24`, '-nolisten', 'tcp'], { stdio: 'ignore' });
  xvfb.on('exit', (code) => fail(`Xvfb exited (${code})`));
  const socket = `/tmp/.X11-unix/X${DISPLAY.slice(1)}`;
  for (let i = 0; i < 100 && !fs.existsSync(socket); i++) await new Promise((r) => setTimeout(r, 100));
  if (!fs.existsSync(socket)) fail('Xvfb did not start');
}

async function launchSandboxed(): Promise<Browser> {
  let browser: Browser;
  try {
    browser = await chromium.launch({
      headless: false,
      chromiumSandbox: true,
      env: { ...process.env, DISPLAY },
      args: ['--window-position=0,0', `--window-size=${WINDOW.width},${WINDOW.height}`],
    });
  } catch (e) {
    return fail(`refusing to start without Chromium's sandbox: the browser didn't launch with it (${firstLine(e)})`);
  }
  const page = await browser.newPage();
  await page.goto('chrome://sandbox');
  const sandboxed = (await page.textContent('body'))?.includes('You are adequately sandboxed') ?? false;
  await page.close();
  if (!sandboxed) return fail("refusing to start without Chromium's sandbox: chrome://sandbox says it is not adequate");
  return browser;
}

function firstLine(e: unknown) {
  return (e instanceof Error ? e.message : String(e)).split('\n')[0];
}

function fail(why: string): never {
  console.error(`${new Date().toISOString()} ${why}`);
  process.exit(1);
}

await startDisplay();
const browser = await launchSandboxed();
let stopping = false;
browser.on('disconnected', () => stopping || fail('the browser went away'));
log(`Chrome for Testing ${browser.version()}, headed, sandbox on`);

const reader = createReader(browser);
const sessions = createSessions(browser);
const server = await listen(SOCKET_PATH, {
  health: () => ({ browser: browser.version(), autoconsent: autoconsentVersion }),
  read: reader.read,
  redirect: redirectOf,
  sessions,
});
log(`listening on ${SOCKET_PATH}`);

process.on('SIGTERM', () => {
  stopping = true;
  server.close();
  sessions
    .closeAll()
    .then(() => browser.close())
    .finally(() => process.exit(0));
});
