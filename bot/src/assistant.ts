// The bot: starts every part of the Assistant this slice brings up and keeps them running. It is the only holder
// of tokens and the only writer of the live store, and every outside call goes through it.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Clock } from './clock.ts';
import { checkConfig, ROLES, type Config, type Role } from './config.ts';
import { Flags } from './discord/components.ts';
import { DiscordGateway, type Interaction } from './discord/gateway.ts';
import { DiscordRest } from './discord/rest.ts';
import { startForwarder } from './forwarder.ts';
import { createLog, errorText, stdoutSink, type Log, type LogEntry, type LogSink } from './log.ts';
import { Miner } from './miner/miner.ts';
import { nextDate, pacificDate, pacificInstant } from './pacific.ts';
import { PiRunner } from './pi-runs.ts';
import { ProductHunt } from './product-hunt.ts';
import { RawInputs } from './raw-inputs.ts';
import { Store } from './store.ts';

export type { LogEntry };

export interface Assistant {
  /** Resolves once no background work is queued or running. */
  whenIdle(): Promise<void>;
  stop(): Promise<void>;
}

/** The token files systemd hands the bot through LoadCredential=, by name (ADR 0009). */
const tokenFile = {
  discord: 'discord-bot-token',
  productHunt: 'producthunt-token',
  roleKey: (role: Role) => `newapi-key-${role}`,
};

export async function startAssistant(options: {
  config: Config;
  /** The folder holding the token files: `$CREDENTIALS_DIRECTORY` under systemd. */
  credentialsDir: string;
  clock: Clock;
  log?: LogSink;
}): Promise<Assistant> {
  const { config, clock } = options;
  const problems = checkConfig(config);
  if (problems.length > 0) throw new Error(`The config isn't usable:\n- ${problems.join('\n- ')}`);
  const log = createLog(options.log ?? stdoutSink, clock);
  const token = (name: string) => {
    try {
      return readFileSync(join(options.credentialsDir, name), 'utf8').trim();
    } catch {
      throw new Error(`The token ${name} is missing; place it with ops/token ${name}`);
    }
  };
  const roleKeys = new Map(ROLES.map((role) => [role, token(tokenFile.roleKey(role))]));
  const discordToken = token(tokenFile.discord);
  const productHuntToken = token(tokenFile.productHunt);

  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const store = Store.open(join(config.dataDir, 'assistant.sqlite'));
  const rawInputs = new RawInputs({ dir: join(config.dataDir, 'raw'), store, clock, keepDays: config.rawInputs.keepDays, log });

  const forwarder = await startForwarder({
    host: config.forwarder.host,
    port: config.forwarder.port,
    gatewayBaseUrl: config.gateway.baseUrl,
    providers: (role) => config.roles[role].providers,
    roleKey: (role) => roleKeys.get(role)!,
    store,
    clock,
    log,
  });
  const pi = new PiRunner({
    command: config.pi.command,
    env: config.pi.env,
    cwd: config.pi.cwd,
    botUrl: config.forwarder.urlForPi ?? forwarder.url,
    forwarder,
    store,
    clock,
    log,
  });

  const discord = new DiscordRest({ apiBaseUrl: config.discord.apiBaseUrl, token: discordToken, log });
  const gateway = new DiscordGateway({
    rest: discord,
    token: discordToken,
    log,
    onInteraction: (interaction) => void answer(interaction, config.discord.personUserId, discord, log),
  });
  gateway.start();

  const productHunt = new ProductHunt({
    apiUrl: config.productHunt.apiUrl,
    token: productHuntToken,
    keepRaw: (body, date) => rawInputs.keep('producthunt', date, body),
    log,
  });
  const miner = new Miner({ config, store, productHunt, pi, discord, clock, log });

  // The background lane runs one job at a time (#11).
  const lane = new Lane(log);
  const mine = (date: string) => lane.add(`miner ${date}`, () => miner.mine(date));
  const daily = () => {
    lane.add('raw-inputs expiry', async () => rawInputs.expire());
    mine(pacificDate(clock.now()));
  };
  const cancelDaily = everyPacificDay(clock, config.miner.startsAt, daily);

  // A date already past its start whose list isn't out picks up where it stopped.
  lane.add('raw-inputs expiry', async () => rawInputs.expire());
  const today = pacificDate(clock.now());
  if (clock.now() >= pacificInstant(today, config.miner.startsAt) && !miner.posted(today)) mine(today);

  log('assistant.started', { forwarder: forwarder.url });
  return {
    whenIdle: () => lane.whenIdle(),
    async stop() {
      cancelDaily();
      lane.close();
      await pi.stop();
      await lane.whenIdle();
      gateway.stop();
      await forwarder.close();
      store.close();
      log('assistant.stopped', {});
    },
  };
}

/** Calls `fn` at `time` Pacific every day: once a day, even when that time happens twice. */
function everyPacificDay(clock: Clock, time: string, fn: () => void): () => void {
  let cancel = () => {};
  const arm = () => {
    const now = clock.now();
    let date = pacificDate(now);
    if (pacificInstant(date, time) <= now) date = nextDate(date);
    cancel = clock.at(pacificInstant(date, time), () => {
      fn();
      arm();
    });
  };
  arm();
  return () => cancel();
}

/** Runs queued jobs one at a time, in the order they came; a job already waiting isn't queued twice. */
class Lane {
  #log: Log;
  #queue: { name: string; job: () => Promise<void> }[] = [];
  #running: Promise<void> | undefined;
  #closed = false;

  constructor(log: Log) {
    this.#log = log;
  }

  add(name: string, job: () => Promise<void>): void {
    if (this.#closed || this.#queue.some((q) => q.name === name)) return;
    this.#queue.push({ name, job });
    this.#running ??= this.#drain();
  }

  async #drain(): Promise<void> {
    for (let next = this.#queue.shift(); next; next = this.#queue.shift()) {
      if (this.#closed) break;
      try {
        await next.job();
      } catch (error) {
        this.#log('lane.job-failed', { job: next.name, error: errorText(error) });
      }
    }
    this.#running = undefined;
  }

  async whenIdle(): Promise<void> {
    while (this.#running) await this.#running;
  }

  close(): void {
    this.#closed = true;
    this.#queue = [];
  }
}

/** Taps and pop-ups. The bot acts only for the person's own Discord user id. */
async function answer(interaction: Interaction, personUserId: string, discord: DiscordRest, log: Log): Promise<void> {
  const userId = interaction.member?.user?.id ?? interaction.user?.id;
  const reply = (content: string) =>
    discord.respond(interaction.id, interaction.token, { type: 4, data: { content, flags: Flags.EPHEMERAL, allowed_mentions: { parse: [] } } });
  try {
    if (userId !== personUserId) {
      log('discord.refused-user', { userId, customId: interaction.data?.custom_id });
      return await reply('This Assistant acts only for its person.');
    }
    if (interaction.data?.custom_id?.startsWith('correct:')) {
      return await reply("Correct isn't wired up yet. It arrives with Corrections to Miner judgments.");
    }
    await reply("That button isn't wired up.");
  } catch (error) {
    log('discord.interaction-failed', { error: errorText(error) });
  }
}
