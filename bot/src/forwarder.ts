// The forwarder (ADR 0009, ADR 0011): the Pi container's only endpoint. Each Pi run reaches it with a run token
// of its own, never a real key. For a model request the forwarder puts in the run's role key, sends it to the first of
// the role's `role@provider` names on new-api that can serve it, moving on past any that answers it can't, and counts
// the exact tokens of the reply, in notional dollars at the list price of the model that provider serves. Our Pi
// extension asks here for the run's Rules as the run starts, and the run's record tool also writes through here, so a
// record reaches the bot while the run goes on.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import type { Clock } from './clock.ts';
import type { ListPrice, Role } from './config.ts';
import { errorText, type Log } from './log.ts';
import { faultInStream, faultOf, type DropOut, type Providers } from './providers.ts';
import type { SecretGuard } from './secret-guard.ts';
import type { Store, Tokens } from './store.ts';

export type RecordResult = { ok: true; message: string } | { ok: false; error: string };

export interface RunRegistration {
  runId: string;
  role: Role;
  /** The run's Rules section, as our extension asks for it at the run's start, and the commit they were read at. */
  rules(): { commit: string; prompt: string };
  /** Takes one record the run's tool wrote, and says whether it was kept. */
  onRecord(record: unknown): RecordResult;
}

/** One of a role's providers, with the list price of the model it serves. */
export interface PricedProvider {
  name: string;
  price: ListPrice;
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
/** How long new-api may take to say what a key has left. */
const USAGE_TIMEOUT_MS = 10_000;
/** How long a reply that failed part way may take to end, with the usage that says what it spent. */
const REST_OF_FAILED_REPLY_MS = 5_000;

export async function startForwarder(options: {
  host: string;
  port: number;
  gatewayBaseUrl: string;
  /** The role's providers, in priority order. */
  providers(role: Role): PricedProvider[];
  /** Which of them can serve a request now, and what became of the last one asked. */
  failover: Pick<Providers, 'usable' | 'dueToBeTried' | 'noProviderLeft' | 'dropOut' | 'served'>;
  roleKey(role: Role): string;
  secrets: SecretGuard;
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

    if (req.method === 'GET' && req.url === '/rules') return json(res, 200, run.rules());

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
    const request = JSON.parse(raw) as Record<string, unknown>;
    // The last door (ADR 0009). Pi doesn't retry a 403, and this names no value, so its run fails and says why.
    if (options.secrets.refuse(request, 'a model request').length > 0) {
      return json(res, 403, { error: { message: 'The bot refused this request: it holds the exact value of a Secret.' } });
    }
    // Exact counting needs the usage chunk at the end of every stream.
    if (request.stream) request.stream_options = { ...(request.stream_options as object), include_usage: true };

    const abort = new AbortController();
    res.on('close', () => abort.abort());
    // One due to be tried again goes first, in its place among any others due, and the rest by the role's order.
    const [due, rest] = partition(options.providers(run.role), (provider) => options.failover.dueToBeTried(run.role, provider.name));
    for (const provider of [...due, ...rest]) {
      if (!options.failover.usable(run.role, provider.name)) continue;
      if ((await ask(run, provider, request, abort, res)) === 'answered') return;
    }
    const why = options.failover.noProviderLeft(run.role) ?? `${run.role} has no provider left`;
    options.log('forwarder.no-provider', { runId: run.runId, role: run.role, why });
    json(res, 503, { error: { message: why } });
  }

  /** Asks one provider. It either answers the run, or drops out, which leaves the request for the next one. */
  async function ask(
    run: RunRegistration,
    provider: PricedProvider,
    request: Record<string, unknown>,
    abort: AbortController,
    res: http.ServerResponse,
  ): Promise<'answered' | 'next'> {
    const dropOut = (what: DropOut): 'next' => {
      options.failover.dropOut(run.role, provider.name, what);
      return 'next';
    };
    let upstream: Response;
    try {
      upstream = await fetch(`${gateway}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${options.roleKey(run.role)}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...request, model: `${run.role}@${provider.name}` }),
        signal: abort.signal,
      });
    } catch (error) {
      record(run, provider, null, 0, null);
      // Pi went away, which says nothing of the provider.
      if (abort.signal.aborted) throw error;
      return dropOut({ kind: 'failing', detail: 'the gateway gave no answer' });
    }
    if (!upstream.ok) {
      const body = await upstream.text().catch(() => '');
      if (abort.signal.aborted) throw new Error('Pi went away during a provider’s refusal');
      record(run, provider, null, upstream.status, null);
      const fault = faultOf(upstream.status, body, options.clock.now());
      if (fault.kind === 'request') return passOn(upstream, body, res);
      if (fault.kind !== 'unauthorized') return dropOut(fault);
      const quota = await quotaOf(run.role);
      if (quota === 'spent') return dropOut({ kind: 'quota', everyRole: false });
      if (quota === 'left') return dropOut({ kind: 'failing', detail: 'its own key refused, 401' });
      if (quota === 'refused') return dropOut({ kind: 'key' });
      // Nothing says why, so this goes back to the run as it came.
      options.log('forwarder.key-unread', { runId: run.runId, role: run.role });
      return passOn(upstream, body, res);
    }

    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
    // Media types are case-insensitive.
    const usage = new UsageReader(/^text\/event-stream\b/i.test(upstream.headers.get('content-type') ?? ''));
    let recorded = false;
    // Recorded before Pi has the reply's last event, so the tool calls in it are made under this request. A reply
    // cut off part way is recorded too, with whatever usage it reached.
    const recordOnce = () => {
      if (recorded) return;
      recorded = true;
      record(run, provider, usage.model, upstream.status, usage.tokens);
    };
    let back = false;
    const servedOnce = () => {
      if (back) return;
      back = true;
      options.failover.served(run.role, provider.name);
    };
    let restOfFailedReply: NodeJS.Timeout | undefined;
    try {
      if (upstream.body) {
        const decoder = new TextDecoder();
        for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
          usage.push(decoder.decode(chunk, { stream: true }));
          // A reply that failed part way never ends for Pi as a reply: it is cut off below, which Pi retries. What is
          // left of it still holds the usage that says what it spent, so it is read, for a while, and goes no further.
          if (usage.failedPartWay) {
            restOfFailedReply ??= setTimeout(() => abort.abort(), REST_OF_FAILED_REPLY_MS);
            if (usage.done) break;
            continue;
          }
          if (usage.done) {
            recordOnce();
            servedOnce();
          }
          res.write(chunk);
        }
      }
    } catch (error) {
      // Pi closes its side once the last event is in, which ends the read from the provider: the reply is whole. A
      // reply that failed part way is over however its read ends.
      if (!usage.done && !usage.failedPartWay) {
        if (!abort.signal.aborted) dropOut({ kind: 'failing', detail: 'its reply was cut off' });
        throw error;
      }
    } finally {
      clearTimeout(restOfFailedReply);
      usage.end();
      recordOnce();
    }
    if (upstream.ok && !usage.tokens) options.log('forwarder.usage-missing', { runId: run.runId, provider: provider.name });
    if (usage.failedPartWay) {
      dropOut(usage.error ? faultInStream(usage.error, options.clock.now()) : { kind: 'failing', detail: 'its reply was cut off' });
      res.destroy();
      return 'answered';
    }
    servedOnce();
    res.end();
    return 'answered';
  }

  /**
   * What a role's key has left, as new-api tells it (the trial on #46): a key it doesn't know is `refused`, and one it
   * knows gives a count, which a spent one's is too. Any other answer says nothing, including no answer in time. ADR 0011
   * gives every role key a quota, so no unlimited key's count needs reading.
   */
  async function quotaOf(role: Role): Promise<'spent' | 'left' | 'refused' | 'unread'> {
    try {
      const answer = await fetch(new URL('/api/usage/token/', gateway), {
        headers: { authorization: `Bearer ${options.roleKey(role)}` },
        signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
      });
      if (answer.status === 401) return 'refused';
      if (!answer.ok) return 'unread';
      const { data } = (await answer.json()) as { data?: { total_available?: unknown } | null };
      if (typeof data?.total_available !== 'number') return 'unread';
      return data.total_available > 0 ? 'left' : 'spent';
    } catch {
      return 'unread';
    }
  }

  function record(run: RunRegistration, provider: PricedProvider, model: string | null, status: number, tokens: Tokens | null): void {
    options.store.recordModelRequest({
      runId: run.runId,
      role: run.role,
      provider: provider.name,
      model,
      status,
      tokens,
      dollars: tokens ? notionalDollars(tokens, provider.price) : 0,
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

/** The items a test holds true of, then the others, each in their order. */
function partition<T>(items: T[], test: (item: T) => boolean): [T[], T[]] {
  return [items.filter(test), items.filter((item) => !test(item))];
}

/** Gives the run new-api's answer as it came. */
function passOn(upstream: Response, body: string, res: http.ServerResponse): 'answered' {
  res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
  res.end(body);
  return 'answered';
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

/** A count from a reply's usage; anything that isn't a count counts as none. */
const tokenCount = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

/** A reply's exact tokens at a list price per 1M. The cached tokens are part of the input, priced at their own rate. */
function notionalDollars(tokens: Tokens, price: ListPrice): number {
  const cached = Math.min(tokens.cached, tokens.input);
  return ((tokens.input - cached) * price.input + cached * price.cached + tokens.output * price.output) / 1_000_000;
}

/** Reads the usage and model out of an OpenAI-style reply, streamed as server-sent events or sent whole. */
class UsageReader {
  tokens: Tokens | null = null;
  model: string | null = null;
  /** Whether the stream's last event, `[DONE]`, has arrived. */
  done = false;
  /** The error a streamed reply carried part way, as OpenRouter's mid-stream limit does. */
  error: unknown = null;
  /** Whether a choice said how it finished, with anything but an error. */
  #finished = false;
  #failedInStream = false;
  #ended = false;
  #streamed: boolean;
  #buffer = '';

  /** `streamed` says whether the reply comes as server-sent events; otherwise it is one JSON body. */
  constructor(streamed: boolean) {
    this.#streamed = streamed;
  }

  /**
   * Whether the reply failed part way: it carried an error, or it reached its end without saying how it finished. new-api
   * closes a stream its provider cut with usage and `[DONE]`, so that end looks like any other (the trial on #46), and Pi
   * fails a stream with no `finish_reason`, so no reply that ends so was ever usable.
   */
  get failedPartWay(): boolean {
    return this.#failedInStream || (this.#streamed && (this.done || this.#ended) && !this.#finished);
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
    this.#ended = true;
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
      model?: unknown;
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | null;
      error?: unknown;
      choices?: ({ finish_reason?: string | null } | null)[] | null;
    } | null;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    if (typeof parsed.model === 'string' && parsed.model) this.model = parsed.model;
    if (this.#streamed) {
      const reasons = Array.isArray(parsed.choices) ? parsed.choices.map((choice) => choice?.finish_reason) : [];
      if (parsed.error || reasons.includes('error')) {
        this.#failedInStream = true;
        this.error = parsed.error ?? this.error;
      } else if (reasons.some(Boolean)) {
        this.#finished = true;
      }
    }
    if (parsed.usage) {
      this.tokens = {
        input: tokenCount(parsed.usage.prompt_tokens),
        cached: tokenCount(parsed.usage.prompt_tokens_details?.cached_tokens),
        output: tokenCount(parsed.usage.completion_tokens),
      };
    }
  }
}
