// Our Pi extension. Each Pi run is one kind of work for one model role, set by the bot in the environment:
// - its only model provider is the bot's forwarder, reached with the run's own token (the container holds no key);
// - it loads the run's Rules from the bot before the run starts and puts them all into the system prompt, so no Rule
//   waits on the model choosing to read it (ADR 0002); a run whose Rules can't be loaded doesn't start;
// - it offers the model only the tools of its run kind, and blocks any other tool call: a record tool, or for a fill
//   run the fixed actions (ADR 0006), which the bot carries out on the browser service;
// - each tool is schema-checked, and writes its record to the bot, or asks the bot for its action, as it is called.
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { dossierRun } from './dossier.ts';
import { fillRun } from './fill.ts';
import { mailRun } from './mail.ts';
import { minerJudging, type RunKind } from './miner.ts';
import { correctionSorting } from './sorting.ts';
import { walkthroughPreparation } from './walkthrough.ts';

const RUN_KINDS: Record<string, RunKind> = {
  'miner-judging': minerJudging,
  dossier: dossierRun,
  'walkthrough-preparation': walkthroughPreparation,
  'correction-sorting': correctionSorting,
  fill: fillRun,
  mail: mailRun,
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; the bot sets it for every run`);
  return value;
}

/** How long the bot may take to hand over the run's Rules. */
const RULES_TIMEOUT_MS = 30_000;

export default async function assistant(pi: ExtensionAPI): Promise<void> {
  const botUrl = required('ASSISTANT_BOT_URL');
  const role = required('ASSISTANT_ROLE');
  const kindName = required('ASSISTANT_RUN_KIND');
  const kind = RUN_KINDS[kindName];
  if (!kind) throw new Error(`Unknown run kind ${kindName}`);
  const authorization = `Bearer ${required('ASSISTANT_RUN_TOKEN')}`;

  // Loaded before anything is registered, so a run without its Rules has no model to call. Never in before_agent_start:
  // Pi logs an error thrown there and runs on with its default system prompt.
  const rules = await fetch(`${botUrl}/rules`, { headers: { authorization }, signal: AbortSignal.timeout(RULES_TIMEOUT_MS) });
  const loaded = (await rules.json().catch(() => ({}))) as { prompt?: unknown };
  if (!rules.ok || typeof loaded.prompt !== 'string') throw new Error(`The Assistant did not hand over this run's Rules (${rules.status})`);
  const systemPrompt = `${kind.systemPrompt}\n\n${loaded.prompt}`;

  pi.registerProvider('assistant', {
    name: 'The Assistant forwarder',
    baseUrl: `${botUrl}/v1`,
    apiKey: '$ASSISTANT_RUN_TOKEN',
    api: 'openai-completions',
    models: [
      {
        id: role,
        name: `The ${role} role`,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 16_000,
      },
    ],
  });

  const toBot = (path: string, done: string) => async (body: unknown, signal: AbortSignal | undefined): Promise<string> => {
    const response = await fetch(`${botUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization },
      body: JSON.stringify(body),
      signal,
    });
    const answer = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
    if (!response.ok) throw new Error(answer.error ?? `The Assistant refused it (${response.status})`);
    return answer.message ?? done;
  };

  const tools = kind.tools(toBot('/records', 'Recorded.'), toBot('/actions', 'Done.'));
  for (const tool of tools) pi.registerTool(tool);
  const allowed = new Set(tools.map((t) => t.name));

  // Pi has no permission system; this is the second layer below `--no-builtin-tools` and `--no-extensions`.
  pi.on('tool_call', (event) =>
    allowed.has(event.toolName) ? undefined : { block: true, reason: `${event.toolName} isn't available in a ${kindName} run` },
  );
  pi.on('before_agent_start', () => ({ systemPrompt }));
}
