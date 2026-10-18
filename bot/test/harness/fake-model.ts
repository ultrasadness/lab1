// A fake model provider behind the forwarder, speaking OpenAI Chat Completions with streaming, as new-api does.
// It replays scripted tool calls per run kind and item: for a Miner judging run, one record_judgment call for
// each Launch the run asks about, then a short closing reply. Usage is scripted too.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';

export interface ScriptedJudgment {
  fit: number;
  notAProduct: boolean;
  reason: string;
}

/** The stand-in judgments of every fixture Launch, from the #9 prototype. */
export const fixtureJudgments: Record<string, ScriptedJudgment> = JSON.parse(
  readFileSync(new URL('../fixtures/judgments.json', import.meta.url), 'utf8'),
);

export interface ScriptedUsage {
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
}

interface ChatMessage {
  role: string;
  content?: string | { type: string; text?: string }[] | null;
}

export interface ModelRequest {
  authorization: string | undefined;
  model: string;
  messages: ChatMessage[];
  tools: string[];
  /** The whole request body as sent. */
  raw: string;
}

/** One conversation the provider saw: a run, with the Launches it was asked to judge. */
export interface SeenRun {
  kind: 'miner-judging' | 'other';
  postIds: string[];
}

export class FakeModelProvider {
  readonly requests: ModelRequest[] = [];
  readonly runs: SeenRun[] = [];
  /** What the model records for a Launch; `'omit'` leaves it unjudged. */
  judgment: (postId: string) => ScriptedJudgment | 'omit' = (postId) => {
    const scripted = fixtureJudgments[postId];
    if (!scripted) throw new Error(`No scripted judgment for the Launch with Post id ${postId}`);
    return scripted;
  };
  usage: ScriptedUsage = { prompt_tokens: 2400, completion_tokens: 380, cached_tokens: 0 };
  /** The model id the upstream reports in its responses. */
  upstreamModel = 'judge-model-1';
  /** How long a reply stays open after its last event, as when a proxy is slow to end the response. */
  endDelayMs = 0;
  /** While true, the provider takes requests and never answers them. */
  hold = false;

  #server: http.Server;
  #keys: Set<string>;

  private constructor(keys: string[]) {
    this.#keys = new Set(keys);
    this.#server = http.createServer((req, res) => void this.#handle(req, res));
  }

  static async start(options: { apiKeys: string[] }): Promise<FakeModelProvider> {
    const provider = new FakeModelProvider(options.apiKeys);
    await new Promise<void>((resolve) => provider.#server.listen(0, '127.0.0.1', resolve));
    return provider;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}/v1`;
  }

  async close(): Promise<void> {
    this.#server.closeAllConnections();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  async #handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (!token || !this.#keys.has(token)) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid token', type: 'new_api_error' } }));
      return;
    }
    const body = JSON.parse(raw) as {
      model: string;
      messages: ChatMessage[];
      tools?: { function: { name: string } }[];
    };
    const tools = (body.tools ?? []).map((t) => t.function.name);
    this.requests.push({ authorization: req.headers.authorization, model: body.model, messages: body.messages, tools, raw });
    if (this.hold) return;

    const n = this.requests.length;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (choices: unknown[], extra: Record<string, unknown> = {}) =>
      res.write(
        `data: ${JSON.stringify({ id: `chatcmpl-${n}`, object: 'chat.completion.chunk', created: 1, model: this.upstreamModel, choices, ...extra })}\n\n`,
      );

    const startsRun = !body.messages.some((m) => m.role === 'assistant');
    if (startsRun && tools.includes('record_judgment')) {
      const user = body.messages.filter((m) => m.role === 'user').map(text).join('\n');
      const postIds = [...new Set([...user.matchAll(/Post id (\d+)/g)].map((m) => m[1]!))];
      this.runs.push({ kind: 'miner-judging', postIds });
      const calls = postIds.flatMap((postId) => {
        const j = this.judgment(postId);
        if (j === 'omit') return [];
        return [{ postId, ...j, rulesApplied: [] }];
      });
      if (calls.length > 0) {
        send([
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: calls.map((args, index) => ({
                index,
                id: `call_${n}_${index}`,
                type: 'function',
                function: { name: 'record_judgment', arguments: JSON.stringify(args) },
              })),
            },
            finish_reason: null,
          },
        ]);
        send([{ index: 0, delta: {}, finish_reason: 'tool_calls' }]);
      } else {
        send([{ index: 0, delta: { role: 'assistant', content: 'Nothing to record.' }, finish_reason: null }]);
        send([{ index: 0, delta: {}, finish_reason: 'stop' }]);
      }
    } else {
      if (startsRun) this.runs.push({ kind: 'other', postIds: [] });
      send([{ index: 0, delta: { role: 'assistant', content: 'Recorded.' }, finish_reason: null }]);
      send([{ index: 0, delta: {}, finish_reason: 'stop' }]);
    }
    const u = this.usage;
    send([], {
      usage: {
        prompt_tokens: u.prompt_tokens,
        completion_tokens: u.completion_tokens,
        total_tokens: u.prompt_tokens + u.completion_tokens,
        prompt_tokens_details: { cached_tokens: u.cached_tokens },
      },
    });
    res.write('data: [DONE]\n\n');
    if (this.endDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.endDelayMs));
    res.end();
  }
}

function text(message: ChatMessage): string {
  if (typeof message.content === 'string') return message.content;
  return (message.content ?? []).map((part) => part.text ?? '').join('');
}

/** What the request says in the given roles, joined. */
export function said(request: ModelRequest, ...roles: string[]): string {
  return request.messages
    .filter((m) => roles.includes(m.role))
    .map(text)
    .join('\n');
}

/** Whether the request opens its run's conversation, before any reply. */
export function opensRun(request: ModelRequest): boolean {
  return !request.messages.some((m) => m.role === 'assistant');
}
