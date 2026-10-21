// Seam 1: the Assistant's outside world. Starts the real bot, with real Pi and our extension as local processes,
// against fakes for Discord, Product Hunt and the model provider, on a clock the test moves.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startAssistant, type Assistant, type LogEntry } from '../../src/assistant.ts';
import type { Config } from '../../src/config.ts';
import { FakeClock } from './fake-clock.ts';
import { FakeDiscord } from './fake-discord.ts';
import { FakeGitRemote } from './fake-git-remote.ts';
import { FakeModelProvider } from './fake-model.ts';
import { FakeProductHunt } from './fake-product-hunt.ts';

export const PERSON = '100000000000000001';
export const STRANGER = '100000000000000009';
export const MINER_DAYS_FORUM = '200000000000000001';
export const STATUS = '200000000000000002';
export const NEEDS_YOU = '200000000000000003';
export const TOKENS = {
  discord: 'discord-test-token',
  productHunt: 'product-hunt-test-token',
  minerKey: 'new-api-key-miner-test',
  deployKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nthe Personal database deploy key\n-----END OPENSSH PRIVATE KEY-----\n',
};

/** The Interest scope the Personal database starts with. */
export const INTEREST_SCOPE = readFileSync(new URL('../fixtures/interest-scope.md', import.meta.url), 'utf8');

const root = fileURLToPath(new URL('../../../', import.meta.url));

export interface World {
  clock: FakeClock;
  discord: FakeDiscord;
  productHunt: FakeProductHunt;
  model: FakeModelProvider;
  /** GitHub, holding the person's Personal database repo. */
  git: FakeGitRemote;
  /** Where the bot keeps its live store and raw inputs on the VM. */
  dataDir: string;
  /** Every line the bot logged, across restarts. */
  logs: LogEntry[];
  assistant: Assistant;
  /** Moves the clock, then waits for the background work that starts. */
  advanceTo(when: string): Promise<void>;
  /**
   * Moves the clock to `until` in steps of `everyMinutes`, waiting for the background work after each step, so a
   * repeating timer fires at each of its own times. One `advanceTo` fires an overdue timer only once.
   */
  stepThrough(until: string, everyMinutes: number): Promise<void>;
  /** Stops the bot and starts it again on the same store, as after a restart. */
  restart(): Promise<void>;
  /**
   * Stops the bot, moves the clock to `until` while it is down, and starts it again on the same store, with the
   * config changed by `upgrade` if one is given, as `ops/upgrade` would.
   */
  outage(until: string, upgrade?: (config: Config) => void): Promise<void>;
  stop(): Promise<void>;
}

export async function startWorld(options: {
  now: string;
  /** How the bot starts a run, given the path of `pi/pi-run`; by default, that script alone. */
  piCommand?: (piRun: string) => string[];
}): Promise<World> {
  const dir = mkdtempSync(join(tmpdir(), 'assistant-test-'));
  const credentials = join(dir, 'credentials');
  const personalDatabase = join(dir, 'personal-database');
  const dataDir = join(dir, 'data');
  for (const d of [credentials, dataDir, join(dir, 'pi-agent'), join(dir, 'pi-work'), join(dir, 'home')]) {
    mkdirSync(d, { recursive: true });
  }
  writeFileSync(join(credentials, 'discord-bot-token'), `${TOKENS.discord}\n`);
  writeFileSync(join(credentials, 'producthunt-token'), `${TOKENS.productHunt}\n`);
  writeFileSync(join(credentials, 'newapi-key-miner'), `${TOKENS.minerKey}\n`);
  writeFileSync(join(credentials, 'personal-database-deploy-key'), TOKENS.deployKey, { mode: 0o600 });
  const git = FakeGitRemote.create({
    dir: join(dir, 'github'),
    deployKey: TOKENS.deployKey,
    files: { 'profile/interest-scope.md': INTEREST_SCOPE },
  });
  git.cloneTo(personalDatabase);
  // Pi retries a failed model request itself, after 2, 4 and 8 seconds by default; here after milliseconds.
  writeFileSync(join(dir, 'pi-agent', 'settings.json'), JSON.stringify({ retry: { baseDelayMs: 5 } }));

  const clock = new FakeClock(options.now);
  const discord = await FakeDiscord.start({ token: TOKENS.discord, forums: [MINER_DAYS_FORUM], textChannels: [STATUS], cardChannels: [NEEDS_YOU] });
  const productHunt = await FakeProductHunt.start({ token: TOKENS.productHunt });
  const model = await FakeModelProvider.start({ apiKeys: [TOKENS.minerKey] });

  const config: Config = {
    dataDir,
    personalDatabase: { dir: personalDatabase, ssh: git.ssh, retryMinutes: 30 },
    discord: {
      apiBaseUrl: discord.apiBaseUrl,
      personUserId: PERSON,
      minerDaysForumId: MINER_DAYS_FORUM,
      statusChannelId: STATUS,
      needsYouChannelId: NEEDS_YOU,
    },
    productHunt: { apiUrl: productHunt.apiUrl },
    gateway: { baseUrl: model.baseUrl },
    roles: { miner: { providers: ['openrouter'] } },
    forwarder: { host: '127.0.0.1', port: 0 },
    pi: {
      command: options.piCommand?.(join(root, 'pi/pi-run')) ?? ['sh', join(root, 'pi/pi-run')],
      env: {
        PI_BIN: join(root, 'node_modules/.bin/pi'),
        ASSISTANT_PI_EXTENSION: join(root, 'pi/extension/index.ts'),
        PI_CODING_AGENT_DIR: join(dir, 'pi-agent'),
        HOME: join(dir, 'home'),
      },
      cwd: join(dir, 'pi-work'),
    },
    miner: { startsAt: '01:00', launchesPerRun: 8, lineFloor: 7, catchUpDates: 3, retryMinutes: 30, lateAt: '06:00' },
    runCaps: {
      'miner-judging': { wallClockMinutes: 10, turns: 20, tokens: 200_000 },
      'walkthrough-preparation': { wallClockMinutes: 20, turns: 40, tokens: 1_000_000 },
      fill: { wallClockMinutes: 3, turns: 30, tokens: 300_000 },
      mail: { wallClockMinutes: 5, turns: 10, tokens: 100_000 },
      question: { wallClockMinutes: 10, turns: 40, tokens: 500_000 },
    },
    rawInputs: { keepDays: 90 },
  };

  const logs: LogEntry[] = [];
  const start = () => startAssistant({ config, credentialsDir: credentials, clock, log: (entry) => logs.push(entry) });

  const world: World = {
    clock,
    discord,
    productHunt,
    model,
    git,
    dataDir,
    logs,
    assistant: await start(),
    async advanceTo(when) {
      clock.advanceTo(when);
      await world.assistant.whenIdle();
    },
    async stepThrough(until, everyMinutes) {
      if (!(everyMinutes > 0)) throw new Error(`Can't step through time every ${everyMinutes} minutes`);
      const end = Date.parse(until);
      const step = everyMinutes * 60_000;
      for (let at = clock.now().getTime() + step; at < end; at += step) {
        await world.advanceTo(new Date(at).toISOString());
      }
      await world.advanceTo(until);
    },
    async restart() {
      await world.assistant.stop();
      world.assistant = await start();
      await world.assistant.whenIdle();
    },
    async outage(until, upgrade) {
      await world.assistant.stop();
      clock.advanceTo(until);
      upgrade?.(config);
      world.assistant = await start();
      await world.assistant.whenIdle();
    },
    async stop() {
      await world.assistant.stop();
      await Promise.all([discord.close(), productHunt.close(), model.close()]);
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return world;
}
