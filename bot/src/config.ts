// The bot's configuration, kept in git (config/assistant.json) and changed only through ops/upgrade.
// Tokens never appear here: they are files in the credentials directory systemd hands the bot.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** The model roles this slice brings up. Each maps to `role@provider` names in new-api. */
export type Role = 'miner';
export const ROLES: readonly Role[] = ['miner'];

/** Every kind of Pi run the Assistant makes. Each one is capped. */
export const RUN_KINDS = ['miner-judging', 'walkthrough-preparation', 'fill', 'mail', 'question'] as const;
export type RunKind = (typeof RUN_KINDS)[number];

/** What one run may use before it is aborted: wall-clock time, turns, and tokens as Pi reports them. */
export interface RunCaps {
  wallClockMinutes: number;
  turns: number;
  tokens: number;
}

export interface Config {
  /** The live store and the raw inputs kept for 90 days, outside git. */
  dataDir: string;
  /** The bot's checkout of the person's Personal database repo. */
  personalDatabaseDir: string;
  discord: {
    apiBaseUrl: string;
    /** The only Discord user the bot acts for. */
    personUserId: string;
    minerDaysForumId: string;
    /** The plain text channel for operational lines, every one silent. */
    statusChannelId: string;
  };
  productHunt: { apiUrl: string };
  /** new-api's OpenAI-compatible base URL, reached only by the forwarder. */
  gateway: { baseUrl: string };
  /** Each role's providers, in priority order. For now the first one serves every request. */
  roles: Record<Role, { providers: string[] }>;
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
  rawInputs: { keepDays: number };
}

/** Reads the config file. Relative paths in it are taken from the file's own folder. */
export function loadConfig(path: string): Config {
  const config = JSON.parse(readFileSync(path, 'utf8')) as Config;
  const base = dirname(resolve(path));
  config.dataDir = resolve(base, config.dataDir);
  config.personalDatabaseDir = resolve(base, config.personalDatabaseDir);
  if (config.pi.cwd) config.pi.cwd = resolve(base, config.pi.cwd);
  return config;
}

/** What makes a config unusable, if anything. The bot checks before it starts. */
export function checkConfig(config: Config): string[] {
  const problems: string[] = [];
  const snowflake = /^\d{17,20}$/;
  if (!snowflake.test(config.discord?.personUserId ?? '')) problems.push("discord.personUserId must be the person's Discord user id");
  if (!snowflake.test(config.discord?.minerDaysForumId ?? '')) problems.push('discord.minerDaysForumId must be the Miner days forum id');
  if (!snowflake.test(config.discord?.statusChannelId ?? '')) problems.push('discord.statusChannelId must be the #status channel id');
  for (const role of ROLES) {
    if (!config.roles?.[role]?.providers?.length) problems.push(`roles.${role}.providers needs at least one provider`);
  }
  if (!/^\d{2}:\d{2}$/.test(config.miner?.startsAt ?? '')) problems.push('miner.startsAt must look like 01:00');
  if (!(config.miner?.launchesPerRun > 0)) problems.push('miner.launchesPerRun must be above 0');
  if (!(Number.isInteger(config.miner?.catchUpDates) && config.miner.catchUpDates > 0)) problems.push('miner.catchUpDates must be a whole number above 0');
  if (!(config.miner?.retryMinutes > 0)) problems.push('miner.retryMinutes must be above 0');
  if (!/^\d{2}:\d{2}$/.test(config.miner?.lateAt ?? '')) problems.push('miner.lateAt must look like 06:00');
  if (!(config.pi?.command?.length > 0)) problems.push('pi.command must name the command that starts a run');
  for (const kind of RUN_KINDS) {
    const caps = config.runCaps?.[kind];
    for (const cap of ['wallClockMinutes', 'turns', 'tokens'] as const) {
      if (!(Number(caps?.[cap]) > 0)) problems.push(`runCaps.${kind}.${cap} must be above 0`);
    }
  }
  return problems;
}
