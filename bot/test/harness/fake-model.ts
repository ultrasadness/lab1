// A fake model provider behind the forwarder, speaking OpenAI Chat Completions with streaming, as new-api does.
// It replays scripted tool calls per run kind and item: for a Miner judging run, one record_judgment call for
// each Launch the run asks about, then a short closing reply; for a Dossier run, one record_dossier call, and one
// more if the bot says the Dossier is too long. Usage is scripted too.
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

/** A Dossier as the model records it through record_dossier. */
export interface ScriptedDossier {
  state: 'open' | 'waitlisted' | 'no-account';
  register: DossierPart;
  whatItIs: DossierPart;
  forYou: DossierPart;
  offers: ScriptedOffer[];
  note: DossierPart | null;
  rulesApplied: string[];
}

export interface DossierPart {
  text: string;
  sources: string[];
}

export interface ScriptedOffer {
  what: string;
  code: string | null;
  card: 'needed' | 'not needed' | 'not stated';
  deadline: string | null;
  cap: string | null;
  condition: string | null;
  sources: string[];
}

/** One conversation the provider saw: a run, with the Launches it was asked to judge or write a Dossier of. */
export interface SeenRun {
  kind: 'miner-judging' | 'dossier' | 'other';
  postIds: string[];
  /** What the run's first request said as the user. */
  prompt: string;
  /** What each record_dossier call got back, in order. */
  dossierReplies: string[];
  /** Whether the model ran away in this run: it recorded nothing and called its tool turn after turn. */
  ranAway: boolean;
  /** The model requests the run made, its first included. */
  requests: number;
}

export class FakeModelProvider {
  readonly requests: ModelRequest[] = [];
  readonly runs: SeenRun[] = [];

  /** The Miner judging runs seen, oldest first. */
  get judgingRuns(): SeenRun[] {
    return this.runs.filter((r) => r.kind === 'miner-judging');
  }

  /** The Dossier runs seen, oldest first. */
  get dossierRuns(): SeenRun[] {
    return this.runs.filter((r) => r.kind === 'dossier');
  }
  /** What the model records for a Launch; `'omit'` leaves it unjudged. */
  judgment: (postId: string) => ScriptedJudgment | 'omit' = (postId) => {
    const scripted = fixtureJudgments[postId];
    if (!scripted) throw new Error(`No scripted judgment for the Launch with Post id ${postId}`);
    return scripted;
  };
  /** Whether the model runs away in a Miner run that starts now, asked once per run. */
  runaway: (run: SeenRun) => boolean = () => false;
  /** What the model records in a Dossier run; `'none'` records nothing. By default, a plain Dossier. */
  dossier: (run: SeenRun) => ScriptedDossier | 'none' = (run) => plainDossier(run.prompt);
  /** What the model records after the bot refused its Dossier for any other reason; `'none'` records nothing more. */
  again: (run: SeenRun, refusal: string) => ScriptedDossier | 'none' = () => 'none';
  /** What the model records once told its Dossier runs `over` characters too long; `'none'` records nothing more. */
  rewrite: (run: SeenRun, over: number, first: ScriptedDossier) => ScriptedDossier | 'none' = (_run, over, first) => shortened(first, over);
  usage: ScriptedUsage = { prompt_tokens: 2400, completion_tokens: 380, cached_tokens: 0 };
  /** The model id the upstream reports in its responses. */
  upstreamModel = 'judge-model-1';
  /** How long a reply stays open after its last event, as when a proxy is slow to end the response. */
  endDelayMs = 0;
  /** While true, the provider takes requests and never answers them. */
  hold = false;
  /** While true, every request is refused with a 503, as when no provider of the role can serve it. */
  failing = false;
  /** The media type a streamed reply is labelled with; media types are case-insensitive. */
  contentType = 'text/event-stream';

  #server: http.Server;
  #keys: Set<string>;
  /** The run now going on; the bot runs one at a time. */
  #current: SeenRun | undefined;
  /** The Dossier the current run recorded first. */
  #firstDossier: ScriptedDossier | undefined;

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
    const startsRun = !body.messages.some((m) => m.role === 'assistant');
    if (startsRun) {
      const judging = tools.includes('record_judgment');
      const dossier = tools.includes('record_dossier');
      const user = body.messages.filter((m) => m.role === 'user').map(text).join('\n');
      const run: SeenRun = {
        kind: judging ? 'miner-judging' : dossier ? 'dossier' : 'other',
        postIds: judging || dossier ? [...new Set([...user.matchAll(/Post id (\d+)/g)].map((m) => m[1]!))] : [],
        prompt: user,
        dossierReplies: [],
        ranAway: false,
        requests: 0,
      };
      this.runs.push(run);
      run.ranAway = judging && this.runaway(run);
      this.#current = run;
    }
    const run = this.#current;
    if (run) run.requests += 1;
    if (this.hold) return;
    if (this.failing) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'No provider of the role is available', type: 'new_api_error' } }));
      return;
    }

    const n = this.requests.length;
    res.writeHead(200, { 'content-type': this.contentType });
    const send = (choices: unknown[], extra: Record<string, unknown> = {}) =>
      res.write(
        `data: ${JSON.stringify({ id: `chatcmpl-${n}`, object: 'chat.completion.chunk', created: 1, model: this.upstreamModel, choices, ...extra })}\n\n`,
      );
    const callTools = (calls: Record<string, unknown>[], name = 'record_judgment') => {
      send([
        {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: calls.map((args, index) => ({
              index,
              id: `call_${n}_${index}`,
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            })),
          },
          finish_reason: null,
        },
      ]);
      send([{ index: 0, delta: {}, finish_reason: 'tool_calls' }]);
    };
    const reply = (content: string) => {
      send([{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }]);
      send([{ index: 0, delta: {}, finish_reason: 'stop' }]);
    };

    if (run?.ranAway) {
      // A judgment for no Launch of the run: the bot refuses it, and the model tries again.
      callTools([{ postId: '0', fit: 5, notAProduct: false, reason: 'still deciding', rulesApplied: [] }]);
    } else if (startsRun && run?.kind === 'miner-judging') {
      const calls = run.postIds.flatMap((postId) => {
        const j = this.judgment(postId);
        if (j === 'omit') return [];
        return [{ postId, ...j, rulesApplied: [] }];
      });
      if (calls.length > 0) callTools(calls);
      else reply('Nothing to record.');
    } else if (run?.kind === 'dossier') {
      const replied = body.messages.at(-1)?.role === 'tool' ? text(body.messages.at(-1)!) : undefined;
      if (replied !== undefined) run.dossierReplies.push(replied);
      const over = replied?.match(/runs ([\d,]+) characters over/)?.[1];
      const refused = replied !== undefined && !/^Recorded/.test(replied);
      const next = startsRun
        ? this.dossier(run)
        : over
          ? this.rewrite(run, Number(over.replace(/,/g, '')), this.#firstDossier!)
          : refused
            ? this.again(run, replied)
            : 'none';
      if (startsRun && next !== 'none') this.#firstDossier = next;
      if (next === 'none') reply(startsRun ? 'Nothing to record.' : 'Recorded.');
      else callTools([next as unknown as Record<string, unknown>], 'record_dossier');
    } else {
      reply('Recorded.');
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

/** The keys a Dossier run's prompt says it may cite. */
export function citable(prompt: string): string[] {
  return prompt.match(/^Cite these sources by key: (.+)\.$/m)?.[1]!.split(', ') ?? [];
}

/** A Dossier that says little, citing only sources the run has. */
function plainDossier(prompt: string): ScriptedDossier {
  const keys = citable(prompt);
  return {
    state: 'open',
    register: { text: 'Sign up with an email address.', sources: [keys.includes('signup-page') ? 'signup-page' : 'landing-page'] },
    whatItIs: { text: 'What its Launch says it is.', sources: ['launch'] },
    forYou: { text: 'Near something you want.', sources: ['interest-scope'] },
    offers: [],
    note: null,
    rulesApplied: [],
  };
}

/** The Dossier with What it is, For you and Note each a third of `over` shorter, as a model asked to shorten might. */
function shortened(d: ScriptedDossier, over: number): ScriptedDossier {
  const cut = (part: DossierPart) => ({ ...part, text: part.text.slice(0, Math.max(1, part.text.length - Math.ceil(over / 3) - 1)) });
  return { ...d, whatItIs: cut(d.whatItIs), forYou: cut(d.forYou), note: d.note && cut(d.note) };
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

/** Whether the request opens a Miner judging run. */
export function opensJudgingRun(request: ModelRequest): boolean {
  return opensRun(request) && request.tools.includes('record_judgment');
}
