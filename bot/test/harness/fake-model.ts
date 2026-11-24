// A fake model provider behind the forwarder, speaking OpenAI Chat Completions with streaming, as new-api does.
// It replays scripted tool calls per run kind and item: for a Miner judging run, one record_judgment call for
// each Launch the run asks about, then a short closing reply; for a Dossier run, one record_dossier call, and one
// more if the bot says the Dossier is too long; for a Walkthrough preparation run, one record_walkthrough call, and
// another if the bot refuses it and the test scripts one; for an amended Walkthrough's run, one record_amendment call,
// and another if the bot refuses it and the test scripts one; for a Correction's sorting run, one record_sort call, and
// another if the bot refuses it and the test scripts one; for a fill run, a snapshot, then the fixed actions the test
// scripts from what that snapshot shows, one a turn or several in one, until one of them is finish; for a mail run, one
// record_mail call, and another if the bot refuses it and the test scripts one. Usage is scripted too.
//
// A test can also have new-api answer a `role@provider` name with a `Fault` in place of a reply, and spend or revoke a
// key, which `GET /api/usage/token/` then tells as new-api does. What new-api does to a provider's failure comes from
// `npm run capture:new-api`, which keeps what a client of a throwaway new-api received in
// `bot/test/fixtures/new-api/answers.json`, its request id left out, as the trial on #46 first saw it. `limit`,
// `out-of-balance`, `bad-request`, `provider-key-refused`, `server-error`, `no-channel`, `cut-reply`, `error-in-stream`
// with code 429, `failing`, a key new-api refuses and `GET /api/usage/token/` are served from there, a stream's parts
// apart, and `captured` answers with any other row, so a changed answer fails the tests of whatever relied on it. The stub in
// front of it answered as `research/model-limits` records CPA, OpenRouter and DeepSeek answering: no real 429 or 402 from
// them has been seen, so `X-RateLimit-Reset`'s unit, milliseconds, is the stub's. `no-channel` was seen live too, on
// 2026-11-06 (#85), in the same shape.
//
// The capture didn't see the rest, which stays hand-written. `user-quota` was seen live on 2026-11-05 (#85), and
// `key-quota` is as the research read it in new-api's source. No real service was seen doing `hang-up`, `ended-early`,
// `odd-body`, `error-in-stream` with another code or with `hangs`, `junkLine`, `hold` or `holdFills`, each there for what
// the forwarder or the bot must do with any answer at all, or none.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import capturedAnswers from '../fixtures/new-api/answers.json' with { type: 'json' };

export interface ScriptedJudgment {
  fit: number;
  notAProduct: boolean;
  reason: string;
  /** The Rules the judgment names; none if left out. */
  rulesApplied?: string[];
}

/** What a client of new-api received, as `npm run capture:new-api` recorded it. */
interface CapturedAnswer {
  status: number;
  headers: Record<string, string>;
  /** A whole answer: the parsed JSON, or the text where it wasn't JSON. */
  body?: unknown;
  /** A stream's parts, in the order new-api sent them. */
  parts?: string[];
}

/** The rows of the capture's chat answers, as the fixture names them. */
type CapturedRow = keyof typeof capturedAnswers.chat;
/** The rows a `Fault` of their own, a refused key or `failing` serves. */
type ServedOtherwise =
  | 'cpa-cooldown'
  | 'openrouter-429'
  | 'openrouter-402'
  | 'upstream-400'
  | 'upstream-401'
  | 'upstream-500'
  | 'upstream-502'
  | 'upstream-503'
  | 'stream-error-event'
  | 'stream-cut'
  | 'no-channel'
  | 'wrong-key'
  | 'spent-key';
/**
 * The rows only `captured` serves. A row the capture adds lands here, and `provider-failover.test.ts` keys a table by
 * these, so its typecheck fails until a test reads the row.
 */
export type OtherRow = Exclude<CapturedRow, ServedOtherwise>;

const newApi: { usage: Record<keyof typeof capturedAnswers.usage, CapturedAnswer>; chat: Record<CapturedRow, CapturedAnswer> } = capturedAnswers;
/** The reset time in the stub's OpenRouter 429, which a test's own takes the place of. */
const STUB_RESET = '1893456000000';
/** How far apart a captured stream's parts go out, so that the forwarder reads them as separate writes reach a client. */
const PART_GAP_MS = 50;

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

/** A Walkthrough as the model records it through record_walkthrough. */
export interface ScriptedWalkthrough {
  /** The form it fills, by its number in the prompt, or null when it fills none. */
  form: number | null;
  fields: { field: number; fill: string; value: string | null }[];
  names: { first: string | null; last: string | null };
  button: string | null;
  onSubmit: 'verification-email' | 'waitlist' | 'logged-in';
  walls: string[];
  providers: string[];
  termsBan: string | null;
  authVendor: string | null;
  rulesApplied: string[];
}

/** The values an amended Walkthrough's run proposes, as the model records them through record_amendment (#115). */
export interface ScriptedAmendment {
  fields: { field: number; fill: 'value' | 'choice' | 'empty'; value: string | null }[];
  rulesApplied: string[];
}

/** One fixed action a fill run takes, as the model calls its tool. */
export interface FillStep {
  tool: 'snapshot' | 'fill' | 'fill_secret' | 'choose' | 'open' | 'finish';
  args: Record<string, unknown>;
}

/** One turn of a fill run: one fixed action, or several called together in one reply, as a model may. */
export type FillTurn = FillStep | FillStep[];

/** A Correction's sort as the model records it through record_sort. */
export interface ScriptedSort {
  sort: 'fix-only' | 'interest-scope' | 'rule' | 'declined';
  changes: { section: string; remove: string | null; add: string | null }[];
  rule: { name: string; statement: string; scope: string; amends: boolean } | null;
  hardLimit: string | null;
  rulesApplied: string[];
}

/** A sort with nothing set but its kind and what is given. */
export const sorted = (sort: ScriptedSort['sort'], parts: Partial<Omit<ScriptedSort, 'sort'>> = {}): ScriptedSort => ({
  sort,
  changes: [],
  rule: null,
  hardLimit: null,
  rulesApplied: [],
  ...parts,
});

/** A mail's sort as the model records it through record_mail. */
export interface ScriptedMailSort {
  kind: 'asks-for-reply' | 'needs-the-person' | 'for-the-record';
  gist: string;
  wants: string | null;
  invite: boolean | null;
  rulesApplied: string[];
}

/** A mail sorted into a kind, with a gist and nothing else set but what is given. */
export const mailSorted = (kind: ScriptedMailSort['kind'], parts: Partial<Omit<ScriptedMailSort, 'kind'>> = {}): ScriptedMailSort => ({
  kind,
  gist: 'A mail from the Product',
  wants: kind === 'needs-the-person' ? 'Confirm the account’s settings' : null,
  invite: null,
  rulesApplied: [],
  ...parts,
});

/** One conversation the provider saw: a run, with the Launches it was asked to judge, write a Dossier of, or sort a Correction of. */
export interface SeenRun {
  kind: 'miner-judging' | 'dossier' | 'walkthrough-preparation' | 'amended-walkthrough' | 'correction-sorting' | 'fill' | 'mail' | 'other';
  /** The page a fill run fills. */
  page: number | null;
  /** What each fixed action of a fill run got back, in order, each with the tool called. */
  fillReplies: { tool: string; reply: string }[];
  /** The turns a fill run has still to take, as scripted from its latest snapshot. */
  fillSteps: FillTurn[];
  /** How many snapshots a fill run has been given. */
  snapshots: number;
  postIds: string[];
  /** The root domain of the Product a Walkthrough preparation run prepares for. */
  rootDomain: string | null;
  /** What the run's first request said as the user. */
  prompt: string;
  /** What each record_dossier call got back, in order. */
  dossierReplies: string[];
  /** What each record_walkthrough call got back, in order. */
  walkthroughReplies: string[];
  /** What each record_amendment call got back, in order. */
  amendmentReplies: string[];
  /** What each record_sort call got back, in order. */
  sortReplies: string[];
  /** What each record_mail call got back, in order. */
  mailReplies: string[];
  /** Whether the model ran away in this run: it recorded nothing and called its tool turn after turn. */
  ranAway: boolean;
  /** The model requests the run made, its first included. */
  requests: number;
}

/** What new-api answers for a `role@provider` name, in place of a reply. */
export type Fault =
  /** With `resetsAt`, OpenRouter's 429, whose `error.metadata` new-api keeps. Without, CPA's: new-api drops its `Retry-After` and `reset_seconds`. */
  | { answer: 'limit'; resetsAt?: Date | string }
  /** OpenRouter's 402. */
  | { answer: 'out-of-balance' }
  /** The request's own fault, such as a prompt too long for the model. */
  | { answer: 'bad-request' }
  /** A 401 from the provider, its own key refused: the role's key is fine. */
  | { answer: 'provider-key-refused' }
  | { answer: 'server-error'; status: 500 | 502 | 503 }
  /** new-api's 503 when no channel serves the name. */
  | { answer: 'no-channel' }
  /** new-api's 403 once the user holding the keys falls short, which it answers before any channel. */
  | { answer: 'user-quota' }
  /** new-api's 403 once the key's quota doesn't cover the request, which the research read in its source. */
  | { answer: 'key-quota' }
  /** new-api is gone: the connection ends with no answer. */
  | { answer: 'hang-up' }
  /** The reply stops part way: new-api closes the stream with usage and `[DONE]`, and no `finish_reason`. */
  | { answer: 'cut-reply' }
  /**
   * A provider's mid-stream limit: new-api relays its `finish_reason: "error"` chunk, then usage and `[DONE]`, a moment
   * apart, as separate writes reach a client. With `hangs`, nothing follows the error and the connection stays open.
   */
  | { answer: 'error-in-stream'; code: number | string; hangs?: boolean }
  /** A refusal with any body at all. */
  | { answer: 'odd-body'; status: number; body: string }
  /** A stream that simply ends part way, with no `[DONE]`. The trial never saw new-api do this, and nothing rules it out. */
  | { answer: 'ended-early' }
  /** Another row of the capture of new-api, as it stands, so that a test reads each one. */
  | { answer: 'captured'; row: OtherRow };

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

  /** The Walkthrough preparation runs seen, oldest first. */
  get walkthroughRuns(): SeenRun[] {
    return this.runs.filter((r) => r.kind === 'walkthrough-preparation');
  }

  /** The amended Walkthroughs' runs seen, oldest first. */
  get amendmentRuns(): SeenRun[] {
    return this.runs.filter((r) => r.kind === 'amended-walkthrough');
  }

  /** The Corrections' sorting runs seen, oldest first. */
  get sortingRuns(): SeenRun[] {
    return this.runs.filter((r) => r.kind === 'correction-sorting');
  }

  /** The fill runs seen, oldest first. */
  get fillRuns(): SeenRun[] {
    return this.runs.filter((r) => r.kind === 'fill');
  }

  /** The mail runs seen, oldest first. */
  get mailRuns(): SeenRun[] {
    return this.runs.filter((r) => r.kind === 'mail');
  }
  /**
   * What the model does in a fill run once it has a snapshot: its turns, in order, each one fixed action or several. An
   * empty list ends the run with no finish. By default, each key of the Walkthrough goes into the field with its label,
   * one a turn, then a second snapshot, then finish with the form's first button.
   */
  fill: (run: SeenRun, snapshot: string) => FillTurn[] = (run, snapshot) => plainFill(run.prompt, snapshot);
  /** While true, the provider takes the first request of each fill run and never answers it. */
  holdFills = false;
  /** What the model records for a Launch; `'omit'` leaves it unjudged. */
  judgment: (postId: string) => ScriptedJudgment | 'omit' = (postId) => {
    const scripted = fixtureJudgments[postId];
    if (!scripted) throw new Error(`No scripted judgment for the Launch with Post id ${postId}`);
    return scripted;
  };
  /** Whether the model runs away in a Miner run that starts now, asked once per run. */
  runaway: (run: SeenRun) => boolean = () => false;

  /**
   * Judges every Launch but these at most 6, below the floor of the Day's line, so only these can get a Dossier. Each
   * Dossier is one more run in the day's pass, so a test that isn't about Dossiers keeps its day to the few it needs.
   */
  onlyDossiers(postIds: readonly string[]): void {
    const judged = this.judgment;
    this.judgment = (postId) => {
      const j = judged(postId);
      return j === 'omit' || postIds.includes(postId) ? j : { ...j, fit: Math.min(j.fit, 6) };
    };
  }
  /** What the model records in a Dossier run; `'none'` records nothing. By default, a plain Dossier. */
  dossier: (run: SeenRun) => ScriptedDossier | 'none' = (run) => plainDossier(run.prompt);
  /** What the model records after the bot refused its Dossier for any other reason; `'none'` records nothing more. */
  again: (run: SeenRun, refusal: string) => ScriptedDossier | 'none' = () => 'none';
  /** What the model records once told its Dossier runs `over` characters too long; `'none'` records nothing more. */
  rewrite: (run: SeenRun, over: number, first: ScriptedDossier) => ScriptedDossier | 'none' = (_run, over, first) => shortened(first, over);
  /**
   * What the model records in a Walkthrough preparation run; `'none'` records nothing. By default, the first form's
   * email and password fields filled, any box left unticked, and the Profile's names.
   */
  walkthrough: (run: SeenRun) => ScriptedWalkthrough | 'none' = (run) => plainWalkthrough(run.prompt);
  /** What the model records after the bot refused its Walkthrough; `'none'` records nothing more. */
  walkthroughAgain: (run: SeenRun, refusal: string) => ScriptedWalkthrough | 'none' = () => 'none';
  /** What the model records in an amended Walkthrough's run; `'none'` records nothing. By default, no value for any field. */
  amendment: (run: SeenRun) => ScriptedAmendment | 'none' = () => ({ fields: [], rulesApplied: [] });
  /** What the model records after the bot refused its values; `'none'` records nothing more. */
  amendmentAgain: (run: SeenRun, refusal: string) => ScriptedAmendment | 'none' = () => 'none';
  /** What the model records in a Correction's sorting run; `'none'` records nothing. By default, fix only. */
  sort: (run: SeenRun) => ScriptedSort | 'none' = () => sorted('fix-only');
  /** What the model records after the bot refused its sort; `'none'` records nothing more. */
  sortAgain: (run: SeenRun, refusal: string) => ScriptedSort | 'none' = () => 'none';
  /** What the model records in a mail run; `'none'` records nothing. By default, for the record. */
  mail: (run: SeenRun) => ScriptedMailSort | 'none' = () => mailSorted('for-the-record');
  /** What the model records after the bot refused its mail's sort; `'none'` records nothing more. */
  mailAgain: (run: SeenRun, refusal: string) => ScriptedMailSort | 'none' = () => 'none';
  usage: ScriptedUsage = { prompt_tokens: 2400, completion_tokens: 380, cached_tokens: 0 };
  /** The model id the upstream reports in its responses. */
  upstreamModel = 'judge-model-1';
  /** How long a reply stays open after its last event, as when a proxy is slow to end the response. */
  endDelayMs = 0;
  /** While true, the provider takes requests and never answers them. */
  hold = false;
  /** While true, every request gets the capture's `upstream-503`, new-api's answer to a provider that is overloaded. */
  failing = false;
  /** The media type a streamed reply is labelled with; media types are case-insensitive. */
  contentType = 'text/event-stream';
  /** How new-api answers each request in place of a reply, if it does. It counts as no turn of any run. */
  fault: (request: ModelRequest) => Fault | undefined = () => undefined;
  /** The model each provider reports in its replies, by the provider's name; `upstreamModel` for any other. */
  upstreamModels: Record<string, string> = {};
  /** What `GET /api/usage/token/` answers a key it knows, in place of its usage, as an answer the bot can't read. */
  usageBody: string | null = null;
  /** A line every reply opens with, for a value the forwarder must read past. No provider has been seen to send one. */
  junkLine: string | null = null;
  /** Keys whose quota has run out: a request gets new-api's 401, and their usage still reads, showing none left. */
  readonly spentKeys = new Set<string>();

  #server: http.Server;
  /** The keys new-api knows. */
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

  /** Takes a key away, as a deleted token: new-api answers it 401 everywhere, its usage included. */
  revokeKey(key: string): void {
    this.#keys.delete(key);
  }

  /** Gives a key back, as a person replacing a dead token would leave the bot with one that works. */
  restoreKey(key: string): void {
    this.#keys.add(key);
  }

  async close(): Promise<void> {
    this.#server.closeAllConnections();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  async #handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    const known = token !== undefined && this.#keys.has(token);
    if (req.method === 'GET' && req.url === '/api/usage/token/') {
      if (!known) return sendCaptured(res, newApi.usage['wrong-key']);
      if (this.usageBody !== null) {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(this.usageBody);
        return;
      }
      return sendCaptured(res, newApi.usage[this.spentKeys.has(token) ? 'spent-key' : 'key-with-quota']);
    }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    if (!known || this.spentKeys.has(token)) return sendCaptured(res, newApi.chat[known ? 'spent-key' : 'wrong-key']);
    const body = JSON.parse(raw) as {
      model: string;
      messages: ChatMessage[];
      tools?: { function: { name: string } }[];
    };
    const tools = (body.tools ?? []).map((t) => t.function.name);
    const request: ModelRequest = { authorization: req.headers.authorization, model: body.model, messages: body.messages, tools, raw };
    this.requests.push(request);
    const fault = this.fault(request);
    if (fault && this.#answerWith(fault, body.model, res)) return;
    const startsRun = !body.messages.some((m) => m.role === 'assistant');
    if (startsRun) {
      const judging = tools.includes('record_judgment');
      const dossier = tools.includes('record_dossier');
      const walkthrough = tools.includes('record_walkthrough');
      const amended = tools.includes('record_amendment');
      const sorting = tools.includes('record_sort');
      const fill = tools.includes('finish');
      const mail = tools.includes('record_mail');
      const user = body.messages.filter((m) => m.role === 'user').map(text).join('\n');
      const run: SeenRun = {
        kind: judging
          ? 'miner-judging'
          : dossier
            ? 'dossier'
            : walkthrough
              ? 'walkthrough-preparation'
              : amended
                ? 'amended-walkthrough'
                : sorting
                  ? 'correction-sorting'
                  : fill
                    ? 'fill'
                    : mail
                      ? 'mail'
                      : 'other',
        page: fill ? Number(user.match(/^Fill page (\d+)/m)?.[1] ?? 0) : null,
        fillReplies: [],
        fillSteps: [],
        snapshots: 0,
        postIds: judging || dossier || sorting ? [...new Set([...user.matchAll(/Post id (\d+)/g)].map((m) => m[1]!))] : [],
        rootDomain: user.match(/^Root domain: (\S+)$/m)?.[1] ?? null,
        prompt: user,
        dossierReplies: [],
        walkthroughReplies: [],
        amendmentReplies: [],
        sortReplies: [],
        mailReplies: [],
        ranAway: false,
        requests: 0,
      };
      this.runs.push(run);
      run.ranAway = judging && this.runaway(run);
      this.#current = run;
    }
    const run = this.#current;
    if (run) run.requests += 1;
    if (this.hold || (this.holdFills && startsRun && run?.kind === 'fill')) return;
    if (this.failing) return sendCaptured(res, newApi.chat['upstream-503']);

    const n = this.requests.length;
    res.writeHead(200, { 'content-type': this.contentType });
    if (this.junkLine) res.write(`${this.junkLine}\n\n`);
    const model = this.upstreamModels[body.model.split('@')[1] ?? ''] ?? this.upstreamModel;
    const send = (choices: unknown[], extra: Record<string, unknown> = {}) =>
      res.write(`data: ${JSON.stringify({ id: `chatcmpl-${n}`, object: 'chat.completion.chunk', created: 1, model, choices, ...extra })}\n\n`);
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
    /** Calls several tools in one reply, each by its own name. */
    const callNamed = (calls: { name: string; args: Record<string, unknown> }[]) => {
      send([
        {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: calls.map((call, index) => ({ index, id: `call_${n}_${index}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })),
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
        return [{ postId, fit: j.fit, notAProduct: j.notAProduct, reason: j.reason, rulesApplied: j.rulesApplied ?? [] }];
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
    } else if (run?.kind === 'walkthrough-preparation') {
      const replied = body.messages.at(-1)?.role === 'tool' ? text(body.messages.at(-1)!) : undefined;
      if (replied !== undefined) run.walkthroughReplies.push(replied);
      const next = startsRun
        ? this.walkthrough(run)
        : replied !== undefined && !/^Recorded/.test(replied)
          ? this.walkthroughAgain(run, replied)
          : 'none';
      if (next === 'none') reply(startsRun ? 'Nothing to record.' : 'Recorded.');
      else callTools([next as unknown as Record<string, unknown>], 'record_walkthrough');
    } else if (run?.kind === 'amended-walkthrough') {
      const replied = body.messages.at(-1)?.role === 'tool' ? text(body.messages.at(-1)!) : undefined;
      if (replied !== undefined) run.amendmentReplies.push(replied);
      const next = startsRun ? this.amendment(run) : replied !== undefined && !/^Recorded/.test(replied) ? this.amendmentAgain(run, replied) : 'none';
      if (next === 'none') reply(startsRun ? 'Nothing to record.' : 'Recorded.');
      else callTools([next as unknown as Record<string, unknown>], 'record_amendment');
    } else if (run?.kind === 'fill') {
      // What each tool call of the last turn got back, in the order the turn made them.
      const replies = toolReplies(body.messages);
      run.fillReplies.push(...replies);
      const last = replies.at(-1);
      const shown = last?.tool === 'snapshot' ? last.reply : undefined;
      if (shown !== undefined && run.fillSteps.length === 0) {
        run.snapshots += 1;
        run.fillSteps = [...this.fill(run, shown)];
      }
      const finished = run.fillReplies.some((r) => r.tool === 'finish' && /^Finished/.test(r.reply));
      const turn = startsRun ? { tool: 'snapshot' as const, args: {} } : finished ? undefined : run.fillSteps.shift();
      if (turn) callNamed((Array.isArray(turn) ? turn : [turn]).map((s) => ({ name: s.tool, args: s.args })));
      else reply('Done.');
    } else if (run?.kind === 'correction-sorting') {
      const replied = body.messages.at(-1)?.role === 'tool' ? text(body.messages.at(-1)!) : undefined;
      if (replied !== undefined) run.sortReplies.push(replied);
      const next = startsRun ? this.sort(run) : replied !== undefined && !/^Recorded/.test(replied) ? this.sortAgain(run, replied) : 'none';
      if (next === 'none') reply(startsRun ? 'Nothing to record.' : 'Recorded.');
      else callTools([next as unknown as Record<string, unknown>], 'record_sort');
    } else if (run?.kind === 'mail') {
      const replied = body.messages.at(-1)?.role === 'tool' ? text(body.messages.at(-1)!) : undefined;
      if (replied !== undefined) run.mailReplies.push(replied);
      const next = startsRun ? this.mail(run) : replied !== undefined && !/^Recorded/.test(replied) ? this.mailAgain(run, replied) : 'none';
      if (next === 'none') reply(startsRun ? 'Nothing to record.' : 'Recorded.');
      else callTools([next as unknown as Record<string, unknown>], 'record_mail');
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

  /** Answers with the fault, from the capture of new-api where it saw one. Returns whether the request is answered. */
  #answerWith(fault: Fault, model: string, res: http.ServerResponse): boolean {
    const usage = { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11, prompt_tokens_details: { cached_tokens: 0 } };
    const chunk = (fields: Record<string, unknown>) => `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model, ...fields })}\n\n`;
    const partial = chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: 'partial' }, finish_reason: null }] });
    const closing = `${chunk({ choices: [], usage })}data: [DONE]\n\n`;
    switch (fault.answer) {
      case 'limit': {
        if (fault.resetsAt === undefined) {
          sendCaptured(res, newApi.chat['cpa-cooldown']);
          return true;
        }
        const reset = fault.resetsAt instanceof Date ? String(fault.resetsAt.getTime()) : fault.resetsAt;
        sendCaptured(res, newApi.chat['openrouter-429'], (body) => body.replaceAll(STUB_RESET, reset));
        return true;
      }
      case 'out-of-balance':
        sendCaptured(res, newApi.chat['openrouter-402']);
        return true;
      case 'bad-request':
        sendCaptured(res, newApi.chat['upstream-400']);
        return true;
      case 'provider-key-refused':
        sendCaptured(res, newApi.chat['upstream-401']);
        return true;
      case 'server-error':
        sendCaptured(res, newApi.chat[`upstream-${fault.status}`]);
        return true;
      case 'no-channel':
        sendCaptured(res, newApi.chat['no-channel']);
        return true;
      case 'user-quota':
        json(res, 403, { error: { message: '用户额度不足, 剩余额度: ＄-0.127512', type: 'new_api_error', param: '', code: 'insufficient_user_quota' } });
        return true;
      case 'key-quota':
        json(res, 403, { error: { message: 'token quota is not enough, token remain quota: 0, need quota: 1000', type: 'new_api_error', param: '', code: 'pre_consume_token_quota_failed' } });
        return true;
      case 'captured':
        sendCaptured(res, newApi.chat[fault.row]);
        return true;
      case 'hang-up':
        res.destroy();
        return true;
      case 'cut-reply':
        sendCaptured(res, newApi.chat['stream-cut']);
        return true;
      case 'error-in-stream':
        if (fault.code === 429 && !fault.hangs) {
          sendCaptured(res, newApi.chat['stream-error-event']);
          return true;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`${partial}${chunk({ error: { code: fault.code, message: 'Rate limit exceeded' }, choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }] })}`);
        if (!fault.hangs) setTimeout(() => res.end(closing), 50);
        return true;
      case 'odd-body':
        res.writeHead(fault.status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(fault.body);
        return true;
      case 'ended-early':
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(partial);
        return true;
    }
  }
}

/** Sends what new-api was seen to send, with `change` made to a whole body. */
function sendCaptured(res: http.ServerResponse, answer: CapturedAnswer, change: (body: string) => string = (body) => body): void {
  res.writeHead(answer.status, answer.headers);
  if (answer.parts) sendApart(res, answer.parts);
  else res.end(change(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body)));
}

/** Writes a stream's parts a moment apart: the forwarder reads chunks as they come (`CODING_STANDARDS.md`, "A fake … is anchored to the real one"). */
function sendApart(res: http.ServerResponse, [part, ...rest]: string[]): void {
  if (rest.length === 0) {
    res.end(part);
    return;
  }
  res.write(part);
  setTimeout(() => sendApart(res, rest), PART_GAP_MS);
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
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

/**
 * A Walkthrough of the first form a Walkthrough preparation run's prompt lists: its email and password fields filled,
 * each box left unticked, every other field empty, and its first button. The names are the Profile's, when the run
 * was given one.
 */
export function plainWalkthrough(prompt: string): ScriptedWalkthrough {
  const form = prompt.match(/^Form 1\b.*$/m);
  const fields = [...prompt.matchAll(/^Form 1 field (\d+) \(([^,;)]+)/gm)].map((m) => {
    const [field, type] = [Number(m[1]), m[2]!];
    if (type === 'email' || type === 'password') return { field, fill: type, value: null };
    if (type === 'checkbox') return { field, fill: 'choice', value: 'left unticked' };
    return { field, fill: 'empty', value: null };
  });
  const profile = !/^Profile: none/m.test(prompt);
  return {
    form: form ? 1 : null,
    fields,
    names: profile ? { first: 'Alex', last: 'Example' } : { first: null, last: null },
    button: prompt.match(/^Form 1 · buttons? ([^/\n]+?)(?: \/ .*)?$/m)?.[1] ?? null,
    onSubmit: 'verification-email',
    walls: [],
    providers: [],
    termsBan: null,
    authVendor: null,
    rulesApplied: [],
  };
}

/** The keys a fill run's prompt lists, each with the action that takes it and the label of its field. */
export function fillKeysIn(prompt: string): { key: string; action: string; label: string }[] {
  return [...prompt.matchAll(/^(\S+) · (fill|choose|fill_secret)\b.* · field: (.+)$/gm)].map((m) => ({ key: m[1]!, action: m[2]!, label: m[3]! }));
}

/** The fields, buttons and links a fill run's snapshot lists, by ref. */
export function shownIn(snapshot: string): { fields: { ref: string; type: string; filled: string | null; label: string }[]; buttons: { ref: string; label: string }[] } {
  const fields = [...snapshot.matchAll(/^(f\d+) · ([a-z-]+)(?:, required)? · (?:filled with (\S+)|not filled).*? · label: (.+?)(?: · links .*)?$/gm)].map((m) => ({
    ref: m[1]!,
    type: m[2]!,
    filled: m[3] ?? null,
    label: m[4]!,
  }));
  const buttons = [...snapshot.matchAll(/^(b\d+) · button(?:, disabled)? · label: (.+)$/gm)].map((m) => ({ ref: m[1]!, label: m[2]! }));
  return { fields, buttons };
}

/**
 * What a model that follows its Walkthrough does with a snapshot: each key goes into the field with its label that
 * isn't filled yet, then one more snapshot; once nothing is left to fill, finish with the form's first button.
 */
export function plainFill(prompt: string, snapshot: string): FillTurn[] {
  const { fields, buttons } = shownIn(snapshot);
  const steps = fillKeysIn(prompt).flatMap((k): FillStep[] => {
    const field = fields.find((f) => f.label === k.label && !f.filled);
    if (!field) return [];
    if (k.action === 'fill_secret') return [{ tool: 'fill_secret', args: { field: field.ref, secret: 'password' } }];
    return [{ tool: k.action as 'fill' | 'choose', args: { field: field.ref, key: k.key } }];
  });
  if (steps.length > 0) return [...steps, { tool: 'snapshot', args: {} }];
  return [finish(buttons[0] ? { result: 'button', button: buttons[0].ref } : { result: 'stuck', reason: 'no-button' })];
}

/** A finish, naming no Rule unless the test says. */
export const finish = (args: Record<string, unknown>): FillStep => ({ tool: 'finish', args: { rulesApplied: [], ...args } });

/** The Dossier with What it is, For you and Note each a third of `over` shorter, as a model asked to shorten might. */
function shortened(d: ScriptedDossier, over: number): ScriptedDossier {
  const cut = (part: DossierPart) => ({ ...part, text: part.text.slice(0, Math.max(1, part.text.length - Math.ceil(over / 3) - 1)) });
  return { ...d, whatItIs: cut(d.whatItIs), forYou: cut(d.forYou), note: d.note && cut(d.note) };
}

/** What each tool call of the request's last turn got back, with the tool's name, in the order the turn made them. */
function toolReplies(messages: ChatMessage[]): { tool: string; reply: string }[] {
  const trailing: ChatMessage[] = [];
  for (let i = messages.length - 1; i >= 0 && messages[i]!.role === 'tool'; i--) trailing.unshift(messages[i]!);
  if (trailing.length === 0) return [];
  const asked = messages[messages.length - 1 - trailing.length] as ChatMessage & { tool_calls?: { id: string; function: { name: string } }[] };
  const names = new Map((asked.tool_calls ?? []).map((c) => [c.id, c.function.name]));
  return trailing.map((m) => ({ tool: names.get((m as ChatMessage & { tool_call_id?: string }).tool_call_id ?? '') ?? '', reply: text(m) }));
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
