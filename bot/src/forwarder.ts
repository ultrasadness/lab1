// The forwarder (ADR 0009, ADR 0011): the Pi container's only endpoint. Each Pi run reaches it with a run token
// of its own, never a real key. For a model request the forwarder puts in the run's role key, sends it to the
// role's `role@provider` name on new-api, and counts the exact tokens of the reply. The run's record tool also
// writes through here, so a record reaches the bot while the run goes on.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import type { Clock } from './clock.ts';
import type { Role } from './config.ts';
import { errorText, type Log } from './log.ts';
import type { Store, Tokens } from './store.ts';

export type RecordResult = { ok: true; message: string } | { ok: false; error: string };

export interface RunRegistration {
  runId: string;
  role: Role;
  /** Takes one record the run's tool wrote, and says whether it was kept. */
  onRecord(record: unknown): RecordResult;
}

export interface Forwarder {
  /** The forwarder's own address, as the bot listens on it. */
  url: string;
  /** Gives a run its token, valid until it is unregistered. */
  register(run: RunRegistration): string;
  unregister(token: string): void;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 16 * 1024 * 1024;

export async function startForwarder(options: {
  host: string;
  port: number;
  gatewayBaseUrl: string;
  /** The role's providers, in priority order. */
  providers(role: Role): string[];
  roleKey(role: Role): string;
  store: Store;
  clock: Clock;
  log: Log;
}): Promise<Forwarder> {
  const runs = new Map<string, RunRegistration>();
  const gateway = options.gatewayBaseUrl.replace(/\/$/, '');

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      options.log('forwarder.failed', { error: errorText(error) });
      // A reply already under way can only be cut off.
      if (res.headersSent) return res.destroy();
      json(res, 502, { error: { message: 'The forwarder could not complete the request' } });
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const run = token ? runs.get(token) : undefined;
    if (!run) return json(res, 401, { error: { message: 'Unknown run' } });
    const body = await readBody(req);

    if (req.method === 'POST' && req.url === '/records') {
      let record: unknown;
      try {
        record = JSON.parse(body);
      } catch {
        return json(res, 400, { error: 'The record is not JSON' });
      }
      const result = run.onRecord(record);
      return result.ok ? json(res, 200, { message: result.message }) : json(res, 422, { error: result.error });
    }

    if (req.method === 'POST' && req.url === '/v1/chat/completions') return forward(run, body, res);

    json(res, 404, { error: { message: 'Not found' } });
  }

  async function forward(run: RunRegistration, raw: string, res: http.ServerResponse): Promise<void> {
    const provider = options.providers(run.role)[0]!;
    const request = JSON.parse(raw) as Record<string, unknown>;
    request.model = `${run.role}@${provider}`;
    // Exact counting needs the usage chunk at the end of every stream.
    if (request.stream) request.stream_options = { ...(request.stream_options as object), include_usage: true };

    const abort = new AbortController();
    res.on('close', () => abort.abort());
    let upstream: Response;
    try {
      upstream = await fetch(`${gateway}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${options.roleKey(run.role)}`, 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: abort.signal,
      });
    } catch (error) {
      record(run, provider, null, 0, null);
      throw error;
    }

    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
    const usage = new UsageReader(Boolean(upstream.headers.get('content-type')?.startsWith('text/event-stream')));
    let recorded = false;
    // Recorded before Pi has the reply's last event, so the tool calls in it are made under this request. A reply
    // cut off part way is recorded too, with whatever usage it reached.
    const recordOnce = () => {
      if (recorded) return;
      recorded = true;
      record(run, provider, usage.model, upstream.status, usage.tokens);
    };
    try {
      if (upstream.body) {
        const decoder = new TextDecoder();
        for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
          usage.push(decoder.decode(chunk, { stream: true }));
          if (usage.done) recordOnce();
          res.write(chunk);
        }
      }
    } catch (error) {
      // Pi closes its side once the last event is in, which ends the read from the provider: the reply is whole.
      if (!usage.done) throw error;
    } finally {
      usage.end();
      recordOnce();
    }
    if (upstream.ok && !usage.tokens) options.log('forwarder.usage-missing', { runId: run.runId, provider });
    res.end();
  }

  function record(run: RunRegistration, provider: string, model: string | null, status: number, tokens: Tokens | null): void {
    options.store.recordModelRequest({
      runId: run.runId,
      role: run.role,
      provider,
      model,
      status,
      tokens,
      at: options.clock.now().toISOString(),
    });
  }

  await new Promise<void>((resolve) => server.listen(options.port, options.host, resolve));
  const address = server.address() as AddressInfo;

  return {
    url: `http://${options.host}:${address.port}`,
    register(run) {
      const token = randomBytes(24).toString('base64url');
      runs.set(token, run);
      return token;
    },
    unregister(token) {
      runs.delete(token);
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Reads the usage and model out of an OpenAI-style reply, streamed as server-sent events or sent whole. */
class UsageReader {
  tokens: Tokens | null = null;
  model: string | null = null;
  /** Whether the stream's last event, `[DONE]`, has arrived. */
  done = false;
  #streamed: boolean;
  #buffer = '';

  /** `streamed` says whether the reply comes as server-sent events; otherwise it is one JSON body. */
  constructor(streamed: boolean) {
    this.#streamed = streamed;
  }

  push(text: string): void {
    this.#buffer += text;
    if (!this.#streamed) return;
    let newline: number;
    while ((newline = this.#buffer.indexOf('\n')) >= 0) {
      this.#line(this.#buffer.slice(0, newline).trim());
      this.#buffer = this.#buffer.slice(newline + 1);
    }
  }

  end(): void {
    const rest = this.#buffer.trim();
    this.#buffer = '';
    if (this.#streamed) this.#line(rest);
    else this.#read(rest);
  }

  #line(line: string): void {
    if (line.startsWith('data:')) this.#read(line.slice(5).trim());
  }

  #read(data: string): void {
    if (data === '[DONE]') this.done = true;
    if (!data || data === '[DONE]') return;
    let parsed: {
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | null;
    };
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (parsed.model) this.model = parsed.model;
    if (parsed.usage) {
      this.tokens = {
        input: parsed.usage.prompt_tokens ?? 0,
        cached: parsed.usage.prompt_tokens_details?.cached_tokens ?? 0,
        output: parsed.usage.completion_tokens ?? 0,
      };
    }
  }
}
