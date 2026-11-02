// Seam 1: the Assistant's outside world. Starts the real bot in a thread of its own, with real Pi and our extension as
// local processes, against fakes for Discord, Product Hunt, the browser service, the model provider and healthchecks.io,
// on a clock the test moves.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Assistant, LogEntry } from '../../src/assistant.ts';
import type { Config } from '../../src/config.ts';
import type { Migration } from '../../src/store.ts';
import { botProcessesRunning, BotThread } from './bot-thread.ts';
import { FakeBrowser } from './fake-browser.ts';
import { FakeClock } from './fake-clock.ts';
import { FakeDiscord } from './fake-discord.ts';
import { FakeGitRemote } from './fake-git-remote.ts';
import { FakeHealthchecks } from './fake-healthchecks.ts';
import { FakeModelProvider } from './fake-model.ts';
import { FakeProductHunt } from './fake-product-hunt.ts';

export const PERSON = '100000000000000001';
export const STRANGER = '100000000000000009';
export const MINER_DAYS_FORUM = '200000000000000001';
export const STATUS = '200000000000000002';
export const NEEDS_YOU = '200000000000000003';
export const PRODUCTS_FORUM = '200000000000000004';
/** The tags the person set up in the Products forum (#12, #33, #40). */
export const PRODUCT_TAGS = ['Walkthrough', 'Registering', 'Needs you', 'registered', 'waitlisted', 'handed off', 'abandoned', 'no account', 'Skipped'];
export const TOKENS = {
  discord: 'discord-test-token',
  productHunt: 'product-hunt-test-token',
  minerKey: 'new-api-key-miner-test',
  registrationKey: 'new-api-key-registration-test',
  deployKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nthe Personal database deploy key\n-----END OPENSSH PRIVATE KEY-----\n',
};

/** The Signup mailbox's address (ADR 0003). */
export const SIGNUP_MAILBOX = 'you@gmail.com';

/** The Interest scope the Personal database starts with. */
export const INTEREST_SCOPE = readFileSync(new URL('../fixtures/interest-scope.md', import.meta.url), 'utf8');
/** The Profile the Personal database starts with, unless a test starts it without one. */
export const PROFILE = readFileSync(new URL('../fixtures/profile.md', import.meta.url), 'utf8');

const root = fileURLToPath(new URL('../../../', import.meta.url));

/** The worlds now up in this test's process. */
let worldsUp = 0;

export interface World {
  clock: FakeClock;
  discord: FakeDiscord;
  productHunt: FakeProductHunt;
  browser: FakeBrowser;
  model: FakeModelProvider;
  /** GitHub, holding the person's Personal database repo. */
  git: FakeGitRemote;
  healthchecks: FakeHealthchecks;
  /** Where the bot keeps its live store and raw inputs on the VM. */
  dataDir: string;
  /** The bot's checkout of the Personal database. */
  checkout: string;
  /** Every line the bot logged, across restarts. Read it through the world each time, to have the latest. */
  readonly logs: LogEntry[];
  readonly assistant: Assistant;
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
  /**
   * Ends the bot where it stands, with no stop, as a crash does, and each run and git command it started. It never acts
   * again, whatever a fake answers or the clock does. No bot is up until `restart` or `outage` starts a fresh one.
   */
  kill(): Promise<void>;
  /** How many runs and git commands the bot started are still running, with what they started. */
  processesRunning(): number;
  stop(): Promise<void>;
}

export async function startWorld(options: {
  now: string;
  /** How the bot starts a run, given the path of `pi/pi-run`; by default, that script alone. */
  piCommand?: (piRun: string) => string[];
  /** Changes the config the bot first starts with. */
  configure?: (config: Config) => void;
  /** Whether the Personal database starts with the person's Profile, `profile/profile.md`; it does unless this is false. */
  profile?: boolean;
  /**
   * Where the bot keeps its live store and raw inputs: a folder of the test's own, which outlives the world as the
   * store outlives the bot on the VM. By default, one inside the world's own folder.
   */
  dataDir?: string;
  /** The store's migrations, in place of its own, to try how the bot runs them. */
  migrations?: Migration[];
}): Promise<World> {
  const dir = mkdtempSync(join(tmpdir(), 'assistant-test-'));
  const credentials = join(dir, 'credentials');
  const personalDatabase = join(dir, 'personal-database');
  const dataDir = options.dataDir ?? join(dir, 'data');
  for (const d of [credentials, dataDir, join(dir, 'pi-agent'), join(dir, 'pi-work'), join(dir, 'home')]) {
    mkdirSync(d, { recursive: true });
  }
  writeFileSync(join(credentials, 'discord-bot-token'), `${TOKENS.discord}\n`);
  writeFileSync(join(credentials, 'producthunt-token'), `${TOKENS.productHunt}\n`);
  writeFileSync(join(credentials, 'newapi-key-miner'), `${TOKENS.minerKey}\n`);
  writeFileSync(join(credentials, 'newapi-key-registration'), `${TOKENS.registrationKey}\n`);
  writeFileSync(join(credentials, 'personal-database-deploy-key'), TOKENS.deployKey, { mode: 0o600 });
  const git = FakeGitRemote.create({
    dir: join(dir, 'github'),
    deployKey: TOKENS.deployKey,
    files: { 'profile/interest-scope.md': INTEREST_SCOPE, ...(options.profile === false ? {} : { 'profile/profile.md': PROFILE }) },
  });
  git.cloneTo(personalDatabase);
  // Pi retries a failed model request itself, after 2, 4 and 8 seconds by default; here after milliseconds.
  writeFileSync(join(dir, 'pi-agent', 'settings.json'), JSON.stringify({ retry: { baseDelayMs: 5 } }));

  const clock = new FakeClock(options.now);
  const discord = await FakeDiscord.start({
    token: TOKENS.discord,
    forums: { [MINER_DAYS_FORUM]: [], [PRODUCTS_FORUM]: PRODUCT_TAGS },
    textChannels: [STATUS],
    cardChannels: [NEEDS_YOU],
  });
  const productHunt = await FakeProductHunt.start({ token: TOKENS.productHunt });
  const browser = await FakeBrowser.start(join(dir, 'browser.sock'));
  const model = await FakeModelProvider.start({ apiKeys: [TOKENS.minerKey, TOKENS.registrationKey] });
  const healthchecks = await FakeHealthchecks.start(clock);
  writeFileSync(join(credentials, 'healthchecks-ping-bot'), `${healthchecks.pingUrl('bot')}\n`);

  const config: Config = {
    dataDir,
    personalDatabase: { dir: personalDatabase, ssh: git.ssh, retryMinutes: 30 },
    discord: {
      apiBaseUrl: discord.apiBaseUrl,
      personUserId: PERSON,
      minerDaysForumId: MINER_DAYS_FORUM,
      productsForumId: PRODUCTS_FORUM,
      statusChannelId: STATUS,
      needsYouChannelId: NEEDS_YOU,
    },
    productHunt: { apiUrl: productHunt.apiUrl },
    browser: { socketPath: browser.socketPath },
    walkthroughs: { on: true },
    signupMailbox: SIGNUP_MAILBOX,
    gateway: { baseUrl: model.baseUrl },
    roles: {
      miner: { providers: [{ name: 'openrouter', model: 'judge-model-1' }] },
      registration: { providers: [{ name: 'openrouter', model: 'judge-model-1' }] },
    },
    prices: { 'judge-model-1': { input: 2, cached: 0.2, output: 10 } },
    budgets: { miner: 6, registration: 20 },
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
      dossier: { wallClockMinutes: 10, turns: 10, tokens: 300_000 },
      'walkthrough-preparation': { wallClockMinutes: 20, turns: 40, tokens: 1_000_000 },
      fill: { wallClockMinutes: 3, turns: 30, tokens: 300_000 },
      mail: { wallClockMinutes: 5, turns: 10, tokens: 100_000 },
      question: { wallClockMinutes: 10, turns: 40, tokens: 500_000 },
      'correction-sorting': { wallClockMinutes: 5, turns: 6, tokens: 100_000 },
    },
    rules: { budgetTokens: 4000 },
    dossiers: { tries: 3 },
    rawInputs: { keepDays: 90 },
  };

  options.configure?.(config);

  const logs: LogEntry[] = [];
  const start = async () => {
    const started = await BotThread.start({
      config,
      credentialsDir: credentials,
      now: clock.now().toISOString(),
      migrations: options.migrations,
      logTo: logs,
    });
    clock.onMove = (when) => started.moveClock(when);
    return started;
  };
  const close = async () => {
    await Promise.all([discord.close(), productHunt.close(), browser.close(), model.close(), healthchecks.close()]);
    rmSync(dir, { recursive: true, force: true });
  };
  let bot: BotThread;
  try {
    bot = await start();
  } catch (error) {
    await close();
    throw error;
  }

  worldsUp += 1;
  const world: World = {
    clock,
    discord,
    productHunt,
    browser,
    model,
    git,
    healthchecks,
    dataDir,
    checkout: personalDatabase,
    get logs() {
      bot.takeLogs();
      return logs;
    },
    get assistant() {
      return bot;
    },
    async advanceTo(when) {
      clock.advanceTo(when);
      await bot.whenIdle();
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
      await bot.stop();
      bot = await start();
      await bot.whenIdle();
    },
    async outage(until, upgrade) {
      await bot.stop();
      clock.advanceTo(until);
      upgrade?.(config);
      bot = await start();
      await bot.whenIdle();
    },
    async kill() {
      // A kill ends every process the test's process has started as a bot would, so a second world's would go with it.
      if (worldsUp > 1) throw new Error(`Can't kill a bot with ${worldsUp} worlds up in one test's process`);
      await bot.kill();
    },
    processesRunning: botProcessesRunning,
    async stop() {
      await bot.stop();
      worldsUp -= 1;
      await close();
    },
  };
  return world;
}
