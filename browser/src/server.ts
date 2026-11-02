// HTTP over the Unix socket. The bot is the only client, so the server only routes and parses.
import fs from 'node:fs';
import http from 'node:http';
import type { Health, ReadOutcome, RedirectOutcome, RefusalKind, SessionOutcome } from './api.ts';

export interface Handlers {
  health(): Health;
  read(url: unknown): Promise<ReadOutcome>;
  redirect(url: unknown): Promise<RedirectOutcome>;
  /** A Registration's session: its paths, and the answer to a POST on one. */
  sessions: { paths: ReadonlySet<string>; handle(path: string, body: Record<string, unknown> | null): Promise<SessionOutcome> };
}

const REFUSAL_STATUS: Partial<Record<RefusalKind, number>> = {
  'bad-request': 400,
  'unknown-session': 404,
  full: 429,
  'load-failed': 502,
  download: 502,
  timeout: 504,
};

const MAX_BODY = 16 * 1024;

export async function listen(socketPath: string, handlers: Handlers): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return send(res, 200, handlers.health());
      if (req.method === 'POST' && req.url === '/read') {
        const body = await readJson(req);
        const outcome = await handlers.read(body?.url);
        if (outcome.ok) return send(res, 200, outcome.page);
        return send(res, outcome.error.kind === 'bad-url' ? 400 : 502, { error: outcome.error });
      }
      if (req.method === 'POST' && req.url === '/redirect') {
        const body = await readJson(req);
        const outcome = await handlers.redirect(body?.url);
        if (outcome.ok) return send(res, 200, outcome.redirect);
        return send(res, outcome.error.kind === 'bad-url' ? 400 : 502, { error: outcome.error });
      }
      if (req.method === 'POST' && req.url && handlers.sessions.paths.has(req.url)) {
        const outcome = await handlers.sessions.handle(req.url, await readJson(req));
        if (outcome.ok) {
          const { ok: _, ...answer } = outcome;
          return send(res, 200, answer);
        }
        return send(res, REFUSAL_STATUS[outcome.error.kind] ?? 409, { error: outcome.error });
      }
      send(res, 404, { error: { kind: 'not-found', message: `${req.method} ${req.url}` } });
    } catch (e) {
      send(res, 500, { error: { kind: 'internal', message: e instanceof Error ? e.message : String(e) } });
    }
  });
  fs.rmSync(socketPath, { force: true });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  // The socket's directory gives it the bot's group; only that group may connect.
  fs.chmodSync(socketPath, 0o660);
  return server;
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      text += chunk;
      if (text.length > MAX_BODY) req.destroy(new Error('request body too large'));
    });
    req.on('end', () => {
      try {
        const value = text ? JSON.parse(text) : null;
        resolve(value && typeof value === 'object' ? value : null);
      } catch {
        resolve(null);
      }
    });
    req.on('error', reject);
  });
}
