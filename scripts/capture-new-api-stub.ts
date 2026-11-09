// The stub upstream behind the throwaway new-api of `npm run capture:new-api` (#108): it answers by the model asked for,
// as `research/model-limits` records CPA, OpenRouter and DeepSeek answering. No real 429 or 402 from any of them has been
// seen (the trial on #46), so what the capture shows is only what new-api does to these bodies. It runs in a container on
// the throwaway's private network, and the capture reads `STUB_MODELS` to ask for each one.
import http from 'node:http';

export const STUB_PORT = 8080;

type Respond = (res: http.ServerResponse, model: string) => void;

const json =
  (status: number, body: unknown, headers: Record<string, string> = {}): Respond =>
  (res) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };

/** One server-sent event of a stream's chunks. */
const event = (model: string, fields: Record<string, unknown>) => `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model, ...fields })}\n\n`;

const startStream = (res: http.ServerResponse, model: string) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(event(model, { choices: [{ index: 0, delta: { role: 'assistant', content: 'partial' }, finish_reason: null }] }));
};

const answers: Record<string, Respond> = {
  // CPA's answer while a login cools: sdk/cliproxy/auth/selector.go, per research/model-limits.
  'cpa-cooldown': json(
    429,
    { error: { code: 'model_cooldown', message: 'All credentials for model gpt-6 are cooling down via provider codex', model: 'gpt-6', reset_time: '2h30m0s', reset_seconds: 9000, provider: 'codex' } },
    { 'retry-after': '9000' },
  ),
  // OpenAI's own answer at the limit, if CPA let it through.
  'plus-limit': json(429, { error: { type: 'usage_limit_reached', message: 'The usage limit has been reached', plan_type: 'plus', resets_at: 1893456000, resets_in_seconds: 9000 } }),
  // OpenRouter's platform limit, with its documented body and headers. The reset's unit, milliseconds, is the stub's.
  'openrouter-429': json(
    429,
    {
      error: {
        code: 429,
        message: 'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day',
        metadata: { error_type: 'rate_limit_exceeded', headers: { 'X-RateLimit-Limit': '50', 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '1893456000000' } },
      },
      user_id: 'user_x',
    },
    { 'x-ratelimit-limit': '50', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1893456000000' },
  ),
  'plain-429': json(429, { error: { message: 'Too many requests', type: 'rate_limit_error' } }),
  'retry-after-only': json(429, { error: { message: 'Slow down', type: 'rate_limit_error' } }, { 'retry-after': '120' }),
  // OpenRouter's credits and DeepSeek's balance.
  'openrouter-402': json(402, { error: { code: 402, message: 'Insufficient credits. Add more using https://openrouter.ai/settings/credits', metadata: { limit_source: 'openrouter_credits' } } }),
  'deepseek-402': json(402, { error: { message: 'Insufficient Balance', type: 'unknown_error', param: null, code: 'invalid_request_error' } }),
  'upstream-400': json(400, { error: { message: 'context_length_exceeded: too long', type: 'invalid_request_error', code: 'context_length_exceeded' } }),
  'upstream-401': json(401, { error: { message: 'Invalid API key', type: 'authentication_error' } }),
  'upstream-403': json(403, { error: { message: 'Budget reached', code: 403, metadata: { resets_at: 1893456000 } } }),
  'upstream-500': json(500, { error: { message: 'Internal error', type: 'server_error' } }),
  'upstream-502': (res) => {
    res.writeHead(502, { 'content-type': 'text/html' });
    res.end('<html><body>Bad gateway</body></html>');
  },
  'upstream-503': json(503, { error: { message: 'Overloaded', type: 'server_error' } }),
  // OpenRouter's mid-stream limit: a 200 whose stream carries an error with finish_reason "error".
  'stream-error-event': (res, model) => {
    startStream(res, model);
    res.write(event(model, { error: { code: 429, message: 'Rate limit exceeded' }, choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }] }));
    res.end('data: [DONE]\n\n');
  },
  // A provider that goes away part way through a reply.
  'stream-cut': (res, model) => {
    startStream(res, model);
    setTimeout(() => res.destroy(), 50);
  },
  // A reply served whole, which shows new-api and the stub are set up right.
  ok: (res, model) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(event(model, { choices: [{ index: 0, delta: { role: 'assistant', content: 'hello' }, finish_reason: null }] }));
    res.write(event(model, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
    res.write(event(model, { choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }));
    res.end('data: [DONE]\n\n');
  },
};

/** The models the stub answers, each one a case of the capture. The last is `ok`, which the capture checks last. */
export const STUB_MODELS = Object.keys(answers);

export function stubServer(): http.Server {
  return http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const { model } = JSON.parse(raw || '{}') as { model?: string };
    const answer = model === undefined ? undefined : answers[model];
    if (answer) answer(res, model!);
    else json(404, { error: { message: `The stub has no answer for ${model}` } })(res, '');
  });
}

if (import.meta.main) stubServer().listen(STUB_PORT, '0.0.0.0', () => console.log('listening'));
