// The bot's side of the socket, against the service's own server with a read that fails the way a bug would.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { BrowserClient } from '../src/client.ts';
import { listen } from '../src/server.ts';

test("the service failing is an error, not a page that can't be read", async () => {
  const socketPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lab1-browser-client-')), 'browser.sock');
  const server = await listen(socketPath, {
    health: () => ({ browser: 'none', autoconsent: 'none' }),
    read: async () => {
      throw new Error('the browser went away');
    },
  });
  try {
    await assert.rejects(new BrowserClient(socketPath).read('http://acme.test/signup'), /HTTP 500: the browser went away/);
  } finally {
    server.close();
    fs.rmSync(path.dirname(socketPath), { recursive: true, force: true });
  }
});
