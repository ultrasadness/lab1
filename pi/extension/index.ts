// Our Pi extension. Each Pi run is one kind of work for one model role, set by the bot in the environment:
// - its only model provider is the bot's forwarder, reached with the run's own token (the container holds no key);
// - it offers the model only the record tool of its run kind, and blocks any other tool call;
// - its record tool is schema-checked and writes each record to the bot as it is made.
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { dossierRun } from './dossier.ts';
import { minerJudging, type RunKind } from './miner.ts';

const RUN_KINDS: Record<string, RunKind> = { 'miner-judging': minerJudging, dossier: dossierRun };

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; the bot sets it for every run`);
  return value;
}

export default function assistant(pi: ExtensionAPI): void {
  const botUrl = required('ASSISTANT_BOT_URL');
  const role = required('ASSISTANT_ROLE');
  const kindName = required('ASSISTANT_RUN_KIND');
  const kind = RUN_KINDS[kindName];
  if (!kind) throw new Error(`Unknown run kind ${kindName}`);

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

  const record = async (body: unknown, signal: AbortSignal | undefined): Promise<string> => {
    const response = await fetch(`${botUrl}/records`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${required('ASSISTANT_RUN_TOKEN')}` },
      body: JSON.stringify(body),
      signal,
    });
    const answer = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
    if (!response.ok) throw new Error(answer.error ?? `The Assistant did not keep the record (${response.status})`);
    return answer.message ?? 'Recorded.';
  };

  const tools = kind.tools(record);
  for (const tool of tools) pi.registerTool(tool);
  const allowed = new Set(tools.map((t) => t.name));

  // Pi has no permission system; this is the second layer below `--no-builtin-tools` and `--no-extensions`.
  pi.on('tool_call', (event) =>
    allowed.has(event.toolName) ? undefined : { block: true, reason: `${event.toolName} isn't available in a ${kindName} run` },
  );
  pi.on('before_agent_start', () => ({ systemPrompt: kind.systemPrompt }));
}
