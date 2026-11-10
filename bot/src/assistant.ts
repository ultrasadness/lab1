// The bot: starts every part of the Assistant this slice brings up and keeps them running. It is the only holder
// of tokens and the only writer of the live store, and every outside call goes through it.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserService } from './browser.ts';
import { inMinutes, type Clock } from './clock.ts';
import { checkConfig, ROLES, type Config, type Role } from './config.ts';
import { Flags, text, type MessagePayload, type Popup } from './discord/components.ts';
import { DiscordGateway, popupField, type Interaction } from './discord/gateway.ts';
import { DiscordRest } from './discord/rest.ts';
import { Dossiers } from './dossier/dossiers.ts';
import { startForwarder } from './forwarder.ts';
import { HealthPing, PING_MINUTES } from './health-ping.ts';
import { createLog, errorText, stdoutSink, type Log, type LogEntry, type LogSink } from './log.ts';
import { CORRECTION_FIELD, Corrections } from './miner/corrections.ts';
import { Miner } from './miner/miner.ts';
import { NeedsYou } from './needs-you.ts';
import { nextDate, pacificDate, pacificInstant } from './pacific.ts';
import { PersonalDatabase } from './personal-database.ts';
import { Status } from './status.ts';
import { PiRunner } from './pi-runs.ts';
import { Providers } from './providers.ts';
import { ProductHunt } from './product-hunt.ts';
import { RawInputs } from './raw-inputs.ts';
import { Registrations } from './registration/registrations.ts';
import { Proposals } from './rules/proposals.ts';
import { loadRules } from './rules/rules.ts';
import { correctionOf } from './rules/sorting.ts';
import { SecretGuard, secretNotice } from './secret-guard.ts';
import { Store, type Migration } from './store.ts';
import { apiKeyOf, PasswordVault } from './password-vault.ts';
import { Walkthroughs } from './walkthrough/walkthroughs.ts';

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
  deployKey: 'personal-database-deploy-key',
  healthPing: 'healthchecks-ping-bot',
  bitwardenApiKey: 'bitwarden-api-key',
  bitwardenMasterPassword: 'bitwarden-master-password',
};

export async function startAssistant(options: {
  config: Config;
  /** The folder holding the token files: `$CREDENTIALS_DIRECTORY` under systemd. */
  credentialsDir: string;
  clock: Clock;
  log?: LogSink;
  /** The live store's migrations; its own unless a test gives others, to try how they run. */
  migrations?: Migration[];
}): Promise<Assistant> {
  const { config, clock } = options;
  const problems = checkConfig(config);
  if (problems.length > 0) throw new Error(`The config isn't usable:\n- ${problems.join('\n- ')}`);
  const log = createLog(options.log ?? stdoutSink, clock);
  const tokenPath = (name: string) => {
    const path = join(options.credentialsDir, name);
    if (!existsSync(path)) throw new Error(`The token ${name} is missing; place it with ops/token ${name}`);
    return path;
  };
  // The last door (ADR 0009) holds each token from the moment the bot reads it.
  const secrets = new SecretGuard({
    log,
    post: async (secret, door) => {
      const { heading, body } = secretNotice(secret, door);
      await needsYou.post(heading, [text(body)]);
    },
    plainWork: (work) => plainWork(work),
  });
  const replaceToken = (name: string) => ({ name, replace: `Replace it on the VM: \`sudo ops/token ${name}\`.` });
  const token = (name: string) => {
    const value = readFileSync(tokenPath(name), 'utf8').trim();
    secrets.hold(value, replaceToken(name));
    return value;
  };
  const roleKeys = new Map(ROLES.map((role) => [role, token(tokenFile.roleKey(role))]));
  const discordToken = token(tokenFile.discord);
  const productHuntToken = token(tokenFile.productHunt);
  // ssh reads the deploy key from its file itself, so the bot reads it only to hold it.
  token(tokenFile.deployKey);
  const deployKey = tokenPath(tokenFile.deployKey);
  const healthPingUrl = token(tokenFile.healthPing);
  const bitwardenApiKey = apiKeyOf(token(tokenFile.bitwardenApiKey));
  if (bitwardenApiKey) secrets.hold(bitwardenApiKey.clientSecret, replaceToken(tokenFile.bitwardenApiKey));
  const bitwardenMasterPassword = token(tokenFile.bitwardenMasterPassword);

  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const store = Store.open(join(config.dataDir, 'assistant.sqlite'), options.migrations);
  const rawInputs = new RawInputs({ dir: join(config.dataDir, 'raw'), store, clock, keepDays: config.rawInputs.keepDays, log });

  const discord = new DiscordRest({ apiBaseUrl: config.discord.apiBaseUrl, token: discordToken, log, secrets });
  const gateway = new DiscordGateway({
    rest: discord,
    token: discordToken,
    log,
    onInteraction: (interaction) => {
      plainWork(answer(interaction, { personUserId: config.discord.personUserId, discord, log, retry, corrections, correct, proposals, walkthroughs, registrations }));
    },
  });
  // Plain-code work under way, which never queues in the lane: taps and pop-ups being answered, which may queue work or
  // do it, such as a Keep, and the late line's checks.
  const working = new Set<Promise<void>>();
  const plainWork = (work: Promise<void>) => {
    working.add(work);
    void work.finally(() => working.delete(work));
  };

  const productHunt = new ProductHunt({
    apiUrl: config.productHunt.apiUrl,
    token: productHuntToken,
    keepRaw: (body, date) => rawInputs.keep('producthunt', date, body),
    log,
  });
  const status = new Status({ discord, channelId: config.discord.statusChannelId, log });
  const needsYou = new NeedsYou({ discord, channelId: config.discord.needsYouChannelId, personUserId: config.discord.personUserId, log });
  const providers = new Providers({ config, store, status, needsYou, clock, log, plainWork });
  const forwarder = await startForwarder({
    host: config.forwarder.host,
    port: config.forwarder.port,
    gatewayBaseUrl: config.gateway.baseUrl,
    providers: (role) => config.roles[role].providers.map(({ name, model }) => ({ name, price: config.prices[model]! })),
    failover: providers,
    roleKey: (role) => roleKeys.get(role)!,
    secrets,
    store,
    clock,
    log,
  });
  const personalDatabase = new PersonalDatabase({
    dir: config.personalDatabase.dir,
    ssh: config.personalDatabase.ssh,
    deployKey,
    retryMinutes: config.personalDatabase.retryMinutes,
    store,
    needsYou,
    secrets,
    clock,
    log,
  });
  const pi = new PiRunner({
    command: config.pi.command,
    env: config.pi.env,
    cwd: config.pi.cwd,
    botUrl: config.forwarder.urlForPi ?? forwarder.url,
    caps: config.runCaps,
    rules: (scopes) => loadRules(personalDatabase, scopes),
    forwarder,
    providers,
    store,
    clock,
    log,
  });
  const browser = new BrowserService({ socketPath: config.browser.socketPath });
  const bitwardenDir = join(config.dataDir, 'bitwarden');
  mkdirSync(bitwardenDir, { recursive: true, mode: 0o700 });
  const passwordVault = new PasswordVault({ command: config.bitwarden.command, timeoutSeconds: config.bitwarden.timeoutSeconds, dataDir: bitwardenDir, apiKey: bitwardenApiKey, masterPassword: bitwardenMasterPassword, secrets, log });
  // The background lane runs one job at a time (#11): fill runs, then Corrections, then Walkthrough preparation, then
  // the Miner (#40 §8).
  const lane = new Lane(log);
  const dossiers = new Dossiers({
    config,
    store,
    browser,
    pi,
    discord,
    personalDatabase,
    rawInputs,
    status,
    walkthroughsDue: () => prepareWalkthroughs(),
    clock,
    log,
  });
  const providerLabel = (provider: string) => providers.label(provider);
  const miner = new Miner({ config, store, productHunt, pi, discord, status, personalDatabase, dossiers, providerLabel, clock, log });
  const proposals = new Proposals({
    store,
    personalDatabase,
    needsYou,
    budgetTokens: config.rules.budgetTokens,
    showDecision: (key) => {
      const { kind, id } = correctionOf(key)!;
      return kind === 'walkthrough' ? walkthroughs.showDecision(id) : corrections.showDecision(id);
    },
    clock,
    log,
  });
  const corrections = new Corrections({
    store,
    pi,
    discord,
    personalDatabase,
    dossiers,
    proposals,
    providerLabel,
    clock,
    log,
  });
  const walkthroughs = new Walkthroughs({
    config,
    store,
    browser,
    pi,
    discord,
    needsYou,
    dossiers,
    personalDatabase,
    proposals,
    rawInputs,
    passwordVault,
    walkthroughsDue: () => prepareWalkthroughs(),
    correctionsDue: () => correctWalkthroughs(),
    registrationsDue: () => fill(),
    registrationChanged: (productId) => registrations.changed(productId),
    plainWork: (work) => plainWork(work().catch((error: unknown) => log('walkthrough.work-failed', { error: errorText(error) }))),
    clock,
    log,
  });

  const registrations = new Registrations({
    config,
    store,
    browser,
    pi,
    discord,
    needsYou,
    dossiers,
    personalDatabase,
    passwordVault,
    fillsDue: () => fill(),
    correctionsDue: () => correctWalkthroughs(),
    walkthroughsDue: () => prepareWalkthroughs(),
    showApproval: (productId) => walkthroughs.showApproval(productId),
    stoppedCard: (productId) => walkthroughs.stoppedCard(productId),
    plainWork: (work) => plainWork(work().catch((error: unknown) => log('registration.work-failed', { error: errorText(error) }))),
    clock,
    log,
  });
  // Registrations are filled at each Approval, when a session closes, at every start, and every few minutes while one
  // can't go on, such as while all 5 sessions are taken or Bitwarden is unavailable. That try starts no run a provider
  // would serve unless it can go on, and each page's fill runs are counted in the store.
  let cancelFillRetry = () => {};
  const fill = () =>
    lane.add('registrations', 'fill', async () => {
      cancelFillRetry();
      let left = true;
      try {
        left = await registrations.work();
      } finally {
        if (left && !stopped) cancelFillRetry = inMinutes(clock, FILL_RETRY_MINUTES, fill);
      }
    });

  const retry = (id: number) => {
    const tapped = miner.tapRetry(id);
    if ('work' in tapped) lane.add(`miner retry ${id}`, 'miner', tapped.work);
    return tapped;
  };
  // Every Correction whose work isn't done, at each Correction sent, at every start, and every 30 minutes while one
  // is left.
  let cancelCorrectionsRetry = () => {};
  const correct = () =>
    lane.add('corrections', 'correction', async () => {
      cancelCorrectionsRetry();
      let left = true;
      try {
        left = await corrections.work();
      } finally {
        if (left && !stopped) cancelCorrectionsRetry = inMinutes(clock, config.miner.retryMinutes, correct);
        // A Dossier a Correction asked for goes to the Miner's queue, whose passes it needs while it waits for a provider.
        if (!stopped && miner.dossiersWaiting()) passIn30Minutes();
      }
    });
  gateway.start();
  let stopped = false;
  // Walkthroughs are prepared once a Product's post is up, at every start, when the person taps Prepare again, and
  // every 30 minutes while one can't be, such as when its signup page won't load; while they are switched off, never
  // (#99), so the start after they are turned on prepares each one due. Their Corrections go with the Miner's.
  let cancelWalkthroughsRetry = () => {};
  const prepareWalkthroughs = () => {
    if (!config.walkthroughs.on) return;
    lane.add('walkthroughs', 'walkthrough-preparation', async () => {
      cancelWalkthroughsRetry();
      let left = true;
      try {
        left = await walkthroughs.prepareDue();
      } finally {
        if (left && !stopped) cancelWalkthroughsRetry = inMinutes(clock, config.miner.retryMinutes, prepareWalkthroughs);
      }
    });
  };
  let cancelWalkthroughCorrectionsRetry = () => {};
  const correctWalkthroughs = () =>
    lane.add('walkthrough corrections', 'correction', async () => {
      cancelWalkthroughCorrectionsRetry();
      let left = true;
      try {
        left = await walkthroughs.workCorrections();
      } finally {
        if (left && !stopped) cancelWalkthroughCorrectionsRetry = inMinutes(clock, config.miner.retryMinutes, correctWalkthroughs);
      }
    });
  // The Miner catches up at its daily start, at every start of the bot (a start missed while it was down runs
  // now), and every 30 minutes while a date in its window can't finish, or a Dossier it tried again isn't posted or
  // shown in its list yet. Each Dossier not written is tried again at the first pass after each daily start.
  let cancelRetry = () => {};
  const passIn30Minutes = () => {
    cancelRetry();
    cancelRetry = inMinutes(clock, config.miner.retryMinutes, catchUp);
  };
  const catchUp = () =>
    lane.add('miner', 'miner', async () => {
      cancelRetry();
      let unfinished = true;
      try {
        unfinished = await miner.catchUp();
      } finally {
        if (unfinished && !stopped) passIn30Minutes();
      }
    });
  const daily = () => {
    lane.add('raw-inputs expiry', 'miner', async () => rawInputs.expire());
    catchUp();
  };
  const cancelDaily = everyPacificDay(clock, config.miner.startsAt, daily);
  // The late line is plain code, so it never waits behind a run in the lane.
  const cancelLate = everyPacificDay(clock, config.miner.lateAt, () => {
    plainWork(miner.noteLate().catch((error: unknown) => log('miner.late-check-failed', { error: errorText(error) })));
  });
  // The healthchecks.io ping, every 5 minutes while the bot is logged in to Discord and its store takes a write.
  const healthPing = new HealthPing({ url: healthPingUrl, loggedIn: () => gateway.loggedIn, store, clock, log });
  let cancelPing = () => {};
  const armPing = () => {
    cancelPing = inMinutes(clock, PING_MINUTES, () => {
      plainWork(healthPing.ping());
      armPing();
    });
  };
  armPing();
  const whenIdle = async () => {
    for (;;) {
      await lane.whenIdle();
      await personalDatabase.whenIdle();
      if (working.size === 0) return;
      await Promise.all([...working]);
    }
  };

  lane.add('raw-inputs expiry', 'miner', async () => rawInputs.expire());
  catchUp();
  correct();
  correctWalkthroughs();
  prepareWalkthroughs();
  // A line about a provider a stop left unsaid is said now.
  providers.resume();
  // A Keep tapped before a stop, or a decision not yet shown, is done now; so is an Approval, Edit, dismissal or lapse.
  plainWork(proposals.resume());
  plainWork(walkthroughs.resume());
  // A press left intended counts as pressed, a Stop not yet acted on is, and the lane takes up each Registration under way.
  plainWork(registrations.resume());
  // Commits a refused push left in the checkout, and files queued before a stop, don't wait for the Miner's next run.
  void personalDatabase.sync();

  log('assistant.started', { forwarder: forwarder.url });
  let stopping: Promise<void> | undefined;
  return {
    whenIdle,
    stop() {
      // A second stop, such as a second signal, waits for the first.
      stopping ??= (async () => {
        stopped = true;
        cancelDaily();
        cancelLate();
        cancelPing();
        cancelRetry();
        cancelCorrectionsRetry();
        cancelWalkthroughsRetry();
        cancelWalkthroughCorrectionsRetry();
        cancelFillRetry();
        registrations.stop();
        walkthroughs.stop();
        passwordVault.stop();
        personalDatabase.stop();
        lane.close();
        await pi.stop();
        await whenIdle();
        gateway.stop();
        await forwarder.close();
        store.close();
        log('assistant.stopped', {});
      })();
      return stopping;
    },
  };
}

/** How long a Registration that can't go on for now waits before the lane tries it again. */
const FILL_RETRY_MINUTES = 5;

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

/**
 * The background lane's order (#40 §8): a waiting job of an earlier kind runs before one of a later kind. The raw
 * inputs' expiry goes with the Miner, at whose daily start it is queued.
 */
const LANE_ORDER = ['fill', 'correction', 'mail', 'walkthrough-preparation', 'miner'] as const;
type LaneKind = (typeof LANE_ORDER)[number];

/**
 * Runs queued jobs one at a time: the first waiting of the earliest kind in the lane's order, so jobs of one kind run
 * in the order they came. A job already waiting isn't queued twice.
 */
class Lane {
  #log: Log;
  #queue: { name: string; kind: LaneKind; job: () => Promise<void> }[] = [];
  #running: Promise<void> | undefined;
  #closed = false;

  constructor(log: Log) {
    this.#log = log;
  }

  add(name: string, kind: LaneKind, job: () => Promise<void>): void {
    if (this.#closed || this.#queue.some((q) => q.name === name)) return;
    this.#queue.push({ name, kind, job });
    this.#running ??= this.#drain();
  }

  /** Takes the job to run next off the queue. */
  #next(): { name: string; job: () => Promise<void> } | undefined {
    for (const kind of LANE_ORDER) {
      const i = this.#queue.findIndex((q) => q.kind === kind);
      if (i >= 0) return this.#queue.splice(i, 1)[0];
    }
    return undefined;
  }

  async #drain(): Promise<void> {
    for (let next = this.#next(); next; next = this.#next()) {
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
async function answer(
  interaction: Interaction,
  options: {
    personUserId: string;
    discord: DiscordRest;
    log: Log;
    /** Retry on a Miner notice: what the notice becomes, or why the tap is refused. */
    retry(id: number): { update: MessagePayload } | { refused: string };
    corrections: Corrections;
    /** Queues the work of the Corrections sent. */
    correct(): void;
    /** Keep, Edit and Discard on the cards of proposals that Corrections' sorts made. */
    proposals: Proposals;
    /** Approve, Edit, Correct, Dismiss and Prepare again on Walkthroughs' cards. */
    walkthroughs: Walkthroughs;
    /** Stop, Correct and Start again on Registrations' status messages. */
    registrations: Registrations;
  },
): Promise<void> {
  const { personUserId, discord, log } = options;
  const userId = interaction.member?.user?.id ?? interaction.user?.id;
  const reply = (content: string) =>
    discord.respond(interaction.id, interaction.token, { type: 4, data: { content, flags: Flags.EPHEMERAL, allowed_mentions: { parse: [] } } });
  try {
    if (userId !== personUserId) {
      log('discord.refused-user', { userId, customId: interaction.data?.custom_id });
      return await reply('This Assistant acts only for its person.');
    }
    const customId = interaction.data?.custom_id ?? '';
    const correct = customId.match(/^correct:launch:(\d+)$/);
    if (correct && interaction.type === 3) {
      const opened = options.corrections.popup(correct[1]!);
      if ('refused' in opened) return await reply(opened.refused);
      return await discord.respond(interaction.id, interaction.token, { type: 9, data: { ...opened.popup } satisfies Popup });
    }
    if (correct && interaction.type === 5) {
      const sent = options.corrections.submit(correct[1]!, popupField(interaction, CORRECTION_FIELD.customId) ?? '', interaction.message?.id);
      if ('refused' in sent) return await reply(sent.refused);
      try {
        // The line's message shows it re-judging at once; anything else waits for the Correction's work.
        return await discord.respond(interaction.id, interaction.token, sent.update ? { type: 7, data: { ...sent.update } } : { type: 6 });
      } finally {
        // Queued once the answer is out, so the work's own edits of the day post come after it.
        options.correct();
      }
    }
    const proposal =
      interaction.type === 3
        ? options.proposals.tap(customId, interaction.message?.id)
        : interaction.type === 5
          ? options.proposals.submitEdit(customId, (field) => popupField(interaction, field))
          : undefined;
    if (proposal) {
      if ('refused' in proposal) return await reply(proposal.refused);
      if ('popup' in proposal) return await discord.respond(interaction.id, interaction.token, { type: 9, data: { ...proposal.popup } });
      try {
        return await discord.respond(interaction.id, interaction.token, { type: 7, data: { ...proposal.update } });
      } finally {
        // Done once the answer is out, so the work's own edits of the card come after it, and done even if Discord
        // didn't take the answer, since the tap is kept already.
        await proposal.work?.();
      }
    }
    const walkthrough =
      interaction.type === 3
        ? (options.registrations.tap(customId, { messageId: interaction.message?.id }) ??
          options.walkthroughs.tap(customId, { userId: userId!, interactionId: interaction.id, messageId: interaction.message?.id }))
        : interaction.type === 5
          ? (options.registrations.submit(customId, (field) => popupField(interaction, field)) ??
            options.walkthroughs.submit(customId, (field) => popupField(interaction, field), interaction.message?.id))
          : undefined;
    if (walkthrough) {
      if ('refused' in walkthrough) return await reply(walkthrough.refused);
      if ('stale' in walkthrough) return await discord.respond(interaction.id, interaction.token, { type: 4, data: { ...walkthrough.stale } });
      if ('popup' in walkthrough) return await discord.respond(interaction.id, interaction.token, { type: 9, data: { ...walkthrough.popup } });
      try {
        return await discord.respond(interaction.id, interaction.token, { type: 7, data: { ...walkthrough.update } });
      } finally {
        // Done once the answer is out, so the work's own edits come after it, and done even if Discord didn't take
        // the answer, since the tap is kept already.
        await walkthrough.work?.();
      }
    }
    if (customId.startsWith('correct:dossier:') || customId.startsWith('add-offer:dossier:')) {
      return await reply("Correct and Add Offer aren't wired up yet. They arrive with Corrections to Dossiers.");
    }
    const retry = interaction.data?.custom_id?.match(/^retry:miner:(\d+)$/);
    if (retry) {
      const tapped = options.retry(Number(retry[1]));
      if ('refused' in tapped) return await reply(tapped.refused);
      return await discord.respond(interaction.id, interaction.token, { type: 7, data: { ...tapped.update } });
    }
    await reply("That button isn't wired up.");
  } catch (error) {
    log('discord.interaction-failed', { error: errorText(error) });
  }
}
