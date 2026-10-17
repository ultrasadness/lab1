// The bot's configuration, kept in git (config/assistant.json) and changed only through ops/upgrade.
// Tokens never appear here: they are files in the credentials directory systemd hands the bot.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** The model roles this slice brings up. Each maps to `role@provider` names in new-api. */
export type Role = 'miner';
export const ROLES: readonly Role[] = ['miner'];

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
    runWallClockMinutes: number;
  };
  rawInputs: { keepDays: number };
}

/** Reads and checks the config file. Relative paths in it are taken from the file's own folder. */
export function loadConfig(path: string): Config {
  const config = JSON.parse(readFileSync(path, 'utf8')) as Config;
  const base = dirname(resolve(path));
  config.dataDir = resolve(base, config.dataDir);
  config.personalDatabaseDir = resolve(base, config.personalDatabaseDir);
  if (config.pi.cwd) config.pi.cwd = resolve(base, config.pi.cwd);
  const problems = checkConfig(config);
  if (problems.length > 0) throw new Error(`${path} isn't usable:\n- ${problems.join('\n- ')}`);
  return config;
}

export function checkConfig(config: Config): string[] {
  const problems: string[] = [];
  const snowflake = /^\d{17,20}$/;
  if (!snowflake.test(config.discord?.personUserId ?? '')) problems.push("discord.personUserId must be the person's Discord user id");
  if (!snowflake.test(config.discord?.minerDaysForumId ?? '')) problems.push('discord.minerDaysForumId must be the Miner days forum id');
  for (const role of ROLES) {
    if (!config.roles?.[role]?.providers?.length) problems.push(`roles.${role}.providers needs at least one provider`);
  }
  if (!/^\d{2}:\d{2}$/.test(config.miner?.startsAt ?? '')) problems.push('miner.startsAt must look like 01:00');
  if (!(config.miner?.launchesPerRun > 0)) problems.push('miner.launchesPerRun must be above 0');
  if (!(config.pi?.command?.length > 0)) problems.push('pi.command must name the command that starts a run');
  return problems;
}
