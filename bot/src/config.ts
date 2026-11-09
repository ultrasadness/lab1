// The bot's configuration, kept in git (config/assistant.json) and changed only through ops/upgrade.
// Tokens never appear here: they are files in the credentials directory systemd hands the bot.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** The model roles brought up so far. Each maps to `role@provider` names in new-api. */
export const ROLES = ['miner', 'registration'] as const;
export type Role = (typeof ROLES)[number];

/** The roles that read mail text (ADR 0010). The mail role itself arrives with #61. */
export const MAIL_CLEARED_ROLES = ['mail'];

/** Every kind of Pi run the Assistant makes. Each one is capped. */
export const RUN_KINDS = ['miner-judging', 'dossier', 'walkthrough-preparation', 'fill', 'mail', 'question', 'correction-sorting'] as const;
export type RunKind = (typeof RUN_KINDS)[number];

/** What one run may use before it is aborted: wall-clock time, turns, and tokens as Pi reports them. */
export interface RunCaps {
  wallClockMinutes: number;
  turns: number;
  tokens: number;
}

/** One of a role's providers: its name in the role's `role@provider` model name, and the model its channel serves. */
export interface Provider {
  name: string;
  model: string;
}

/** What a provider is, whichever roles list it. */
export interface ProviderInfo {
  /** Its name on Discord, such as `ChatGPT Plus`. */
  label: string;
  /** Whether its route is in new-api's `mail` group, the only routes a mail-cleared role may list (ADR 0010). */
  mailGroup: boolean;
}

/** A model's list price, in dollars per 1M tokens: uncached input, cached input, and output. */
export interface ListPrice {
  input: number;
  cached: number;
  output: number;
}

export interface Config {
  /** The live store and the raw inputs kept for 90 days, outside git. */
  dataDir: string;
  personalDatabase: {
    /** The bot's checkout of the person's Personal database repo, cloned from GitHub with its `main` checked out. */
    dir: string;
    /** The ssh command git reaches GitHub through; the bot adds the deploy key to it. */
    ssh: string[];
    /** How long a refused push, or a history that has diverged, waits before the bot tries again. */
    retryMinutes: number;
  };
  discord: {
    apiBaseUrl: string;
    /** The only Discord user the bot acts for. */
    personUserId: string;
    minerDaysForumId: string;
    /** The forum holding one post per Product, its Dossier first; the person makes its tags (#12). */
    productsForumId: string;
    /** The plain text channel for operational lines, every one silent. */
    statusChannelId: string;
    /** The text channel holding everything that waits on the person, each card mentioning them. */
    needsYouChannelId: string;
  };
  productHunt: { apiUrl: string };
  /** The browser service's Unix socket, which only the bot's user can reach (ADR 0006). */
  browser: { socketPath: string };
  /** How the bot runs `bw`, the Bitwarden CLI that `ops/install` pins, once per operation (ADR 0009). */
  bitwarden: {
    command: string[];
    /** How long one `bw` command may take, its own sync with Bitwarden included. */
    timeoutSeconds: number;
  };
  /**
   * Whether Walkthroughs are on (#99). While they are off, no Walkthrough is prepared and `signupMailbox` may be left
   * unset. Turning them on prepares one for each open or waitlisted Product posted while they were off.
   */
  walkthroughs: { on: boolean };
  /**
   * The Signup mailbox's own address (ADR 0003). Each Product's Signup identity is its plus-address, with this one as
   * the fallback for a form that refuses `+`. Needed while Walkthroughs are on, and by the Correction of one still out
   * after they are turned off.
   */
  signupMailbox: string;
  gateway: {
    /** new-api's OpenAI-compatible base URL, reached only by the forwarder. */
    baseUrl: string;
    /** How long a provider that dropped out with no reset time waits before it is tried again. */
    retryMinutes: number;
  };
  /** Each provider any role lists, by the name in its `role@provider` model names. */
  providers: Record<string, ProviderInfo>;
  /** Each role's providers, in priority order: the first that can serve a request serves it. #72 moves this to `ops/pins`. */
  roles: Record<Role, { providers: Provider[] }>;
  /** The list price of each model a role's provider serves, by model, which notional dollars are counted at. */
  prices: Record<string, ListPrice>;
  /**
   * What each role may spend, in notional dollars (ADR 0011): the Miner per Miner date, and registration per Pacific
   * day. Only the Miner's holds runs yet; the registration budget does from #69.
   */
  budgets: Record<Role, number>;
  /** Where the forwarder listens for the Pi container, and the URL Pi uses to reach it. */
  forwarder: { host: string; port: number; urlForPi?: string };
  /** How one Pi run starts: a command the bot spawns, with the run's settings in its environment. */
  pi: { command: string[]; env: Record<string, string>; cwd?: string };
  miner: {
    /** Pacific wall-clock time the Miner starts each day. */
    startsAt: string;
    launchesPerRun: number;
    lineFloor: number;
    /** How many of the latest dates the Miner still works on; older ones are dropped. */
    catchUpDates: number;
    /** How long a date that can't finish waits before the Miner tries again. */
    retryMinutes: number;
    /** Pacific wall-clock time by which a date's list should be out, or #status hears it's late. */
    lateAt: string;
  };
  runCaps: Record<RunKind, RunCaps>;
  /**
   * How many tries at a Launch's Dossier may end without one before the bot stops trying (#100): a run that fails or
   * hits its cap, or a landing page that won't load. Each one not written is tried again at the Miner's next start.
   */
  dossiers: { tries: number };
  /** The Rule budget (ADR 0002): about how many tokens the Rules loaded into one run may take, checked at each Keep. */
  rules: { budgetTokens: number };
  rawInputs: { keepDays: number };
}

/** Reads the config file. Relative paths in it are taken from the file's own folder. */
export function loadConfig(path: string): Config {
  const config = JSON.parse(readFileSync(path, 'utf8')) as Config;
  const base = dirname(resolve(path));
  config.dataDir = resolve(base, config.dataDir);
  config.personalDatabase.dir = resolve(base, config.personalDatabase.dir);
  if (config.pi.cwd) config.pi.cwd = resolve(base, config.pi.cwd);
  return config;
}

/** What makes a config unusable, if anything. The bot checks before it starts. */
export function checkConfig(config: Config): string[] {
  const problems: string[] = [];
  const snowflake = /^\d{17,20}$/;
  if (!snowflake.test(config.discord?.personUserId ?? '')) problems.push("discord.personUserId must be the person's Discord user id");
  if (!snowflake.test(config.discord?.minerDaysForumId ?? '')) problems.push('discord.minerDaysForumId must be the Miner days forum id');
  if (!snowflake.test(config.discord?.productsForumId ?? '')) problems.push('discord.productsForumId must be the Products forum id');
  if (!snowflake.test(config.discord?.statusChannelId ?? '')) problems.push('discord.statusChannelId must be the #status channel id');
  if (!snowflake.test(config.discord?.needsYouChannelId ?? '')) problems.push('discord.needsYouChannelId must be the #needs-you channel id');
  for (const role of ROLES) {
    const providers = config.roles?.[role]?.providers ?? [];
    if (providers.length === 0) problems.push(`roles.${role}.providers needs at least one provider`);
    for (const { name, model } of providers) {
      if (!config.prices?.[model]) problems.push(`roles.${role}: ${name} serves ${model}, which has no price in prices`);
    }
    if (!(config.budgets?.[role] > 0)) problems.push(`budgets.${role} must be above 0`);
  }
  // Every role in the file, the ones not brought up yet among them, since a mail-cleared role's mistake is what this stops.
  for (const [role, { providers }] of Object.entries<{ providers: Provider[] }>(config.roles ?? {})) {
    for (const { name } of providers ?? []) {
      const provider = config.providers?.[name];
      if (!provider?.label) problems.push(`roles.${role}: ${name} needs its label in providers`);
      else if (MAIL_CLEARED_ROLES.includes(role) && provider.mailGroup !== true) {
        problems.push(`roles.${role}: ${name} isn't in the mail group, and a mail-cleared role may list only routes that are (ADR 0010)`);
      }
    }
  }
  if (!(config.gateway?.retryMinutes > 0)) problems.push('gateway.retryMinutes must be above 0');
  for (const [model, price] of Object.entries(config.prices ?? {})) {
    for (const part of ['input', 'cached', 'output'] as const) {
      if (!(Number(price?.[part]) >= 0)) problems.push(`prices.${model}.${part} must be 0 or above, in dollars per 1M tokens`);
    }
  }
  if (!/^\d{2}:\d{2}$/.test(config.miner?.startsAt ?? '')) problems.push('miner.startsAt must look like 01:00');
  if (!(config.miner?.launchesPerRun > 0)) problems.push('miner.launchesPerRun must be above 0');
  if (!(Number.isInteger(config.miner?.catchUpDates) && config.miner.catchUpDates > 0)) problems.push('miner.catchUpDates must be a whole number above 0');
  if (!(config.miner?.retryMinutes > 0)) problems.push('miner.retryMinutes must be above 0');
  if (!/^\d{2}:\d{2}$/.test(config.miner?.lateAt ?? '')) problems.push('miner.lateAt must look like 06:00');
  if (!config.browser?.socketPath?.startsWith('/')) problems.push("browser.socketPath must be the browser service's socket, as an absolute path");
  if (!(config.bitwarden?.command?.length > 0)) problems.push('bitwarden.command must name the command that runs bw');
  if (!(config.bitwarden?.timeoutSeconds > 0)) problems.push('bitwarden.timeoutSeconds must be above 0');
  if (typeof config.walkthroughs?.on !== 'boolean') problems.push('walkthroughs.on must be true or false');
  if (config.walkthroughs?.on && !/^[^\s@+]+@[^\s@]+\.[^\s@]+$/.test(config.signupMailbox ?? '')) {
    problems.push("signupMailbox must be the Signup mailbox's address, with no +, while Walkthroughs are on");
  }
  if (!(config.personalDatabase?.ssh?.length > 0)) problems.push('personalDatabase.ssh must name the ssh command');
  if (!(config.personalDatabase?.retryMinutes > 0)) problems.push('personalDatabase.retryMinutes must be above 0');
  if (!(config.pi?.command?.length > 0)) problems.push('pi.command must name the command that starts a run');
  if (!(config.rules?.budgetTokens > 0)) problems.push('rules.budgetTokens must be above 0');
  if (!(Number.isInteger(config.dossiers?.tries) && config.dossiers.tries > 0)) problems.push('dossiers.tries must be a whole number above 0');
  for (const kind of RUN_KINDS) {
    const caps = config.runCaps?.[kind];
    for (const cap of ['wallClockMinutes', 'turns', 'tokens'] as const) {
      if (!(Number(caps?.[cap]) > 0)) problems.push(`runCaps.${kind}.${cap} must be above 0`);
    }
  }
  return problems;
}
