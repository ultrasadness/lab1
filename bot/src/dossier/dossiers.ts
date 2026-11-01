// Dossiers (#47): for each of a date's Launches at or above its line, plain code reads the Product's pages, a
// registration-role run writes the Dossier, and the bot posts it silently as the first message of the Product's one
// post in the Products forum, and queues its folder for the Personal database.
// A Product is keyed by the root domain its landing page is on, so a Launch of a Product that already has a Dossier is
// filed under it and gets no second post; adding it to that Dossier is #66's. Each step is kept in the store as it
// happens, so a pass that stops picks up where it left off: a Dossier already written isn't written again, and a post
// marked as started is looked for on Discord before it is created again. A try that writes no Dossier, as its landing
// page won't load or its run fails or hits its cap, is counted in the store (#100), and the Dossier waits for the
// Miner's next start, when the queue's pass tries it again; the date's list doesn't wait on it. A Launch gets at most
// `dossiers.tries` such tries, whichever path asks for them, and #status names the one at the limit. A run the
// Assistant stops itself, or one a crash cuts short, doesn't count (settled by the person on #100).
// A Correction that puts a Dossier's Launch below its day's line withdraws it (#48): the post stays as the record,
// closed and tagged *Skipped*, its first message replaced. One that puts it back above the line reopens the post with
// its Dossier.
// Once an open or waitlisted Product's post is up, its Walkthrough is due (#53). The post's tags, and what the
// Dossier's Register line says of the Walkthrough, follow where the Product stands.
import type { BrowserService, PageRead } from '../browser.ts';
import type { Clock } from '../clock.ts';
import type { Config } from '../config.ts';
import { asEdit, type MessagePayload } from '../discord/components.ts';
import { refused, type DiscordRest } from '../discord/rest.ts';
import { errorText, type Log } from '../log.ts';
import { launchUrl } from '../miner/day-post.ts';
import { dayLabel } from '../pacific.ts';
import type { PersonalDatabase } from '../personal-database.ts';
import { capText, type PiRunner } from '../pi-runs.ts';
import type { RawInputs } from '../raw-inputs.ts';
import { onRootDomain, rootDomain } from '../root-domain.ts';
import type { Status } from '../status.ts';
import type { DossierTries, Launch, ModelRequest, Product, Store } from '../store.ts';
import { standingOf } from '../walkthrough/standing.ts';
import { dossierCard, overBy, postTitle } from './card.ts';
import { readDossier, SOURCE_KEYS, type Dossier, type DossierRecord, type SourceKey } from './dossier.ts';
import { dossierPath, newProductFiles } from './files.ts';
import { citedUrl, pricingLink, signupLink } from './pages.ts';
import { dossierPrompt, type PageInput, type Read } from './prompt.ts';

/** A Launch at or above its date's line. */
export interface DossierLaunchInput {
  launch: Launch;
  date: string;
  fit: number;
  featuredCount: number;
}

/**
 * Whether each Dossier is posted or, if it couldn't be written, kept for a later try; or the Assistant stopped the
 * work; or why one or more is neither yet, such as a post Discord didn't take.
 */
export type Written = 'done' | 'stopped' | { problem: string };

/**
 * Where one Launch's Dossier stands once asked for: posted, kept for a later try, stopped with the Assistant, or why it
 * is neither yet.
 */
type Outcome = 'posted' | 'kept' | 'stopped' | { problem: string };

/** How one try at a Dossier ended: with the Product it is filed under, without a Dossier and why, or stopped. */
type Tried = { product: Product } | { unwritten: string } | 'stopped';

/** The landing page read, and the root domain it is on. */
type Landing = Read & { rootDomain: string };

export class Dossiers {
  #config: Config;
  #store: Store;
  #browser: BrowserService;
  #pi: PiRunner;
  #discord: DiscordRest;
  #personalDatabase: PersonalDatabase;
  #rawInputs: RawInputs;
  #status: Status;
  #walkthroughsDue: () => void;
  #clock: Clock;
  #log: Log;

  constructor(options: {
    config: Config;
    store: Store;
    browser: BrowserService;
    pi: PiRunner;
    discord: DiscordRest;
    personalDatabase: PersonalDatabase;
    rawInputs: RawInputs;
    status: Status;
    /** Queues the preparation of each Walkthrough now due. */
    walkthroughsDue(): void;
    clock: Clock;
    log: Log;
  }) {
    this.#config = options.config;
    this.#store = options.store;
    this.#browser = options.browser;
    this.#pi = options.pi;
    this.#discord = options.discord;
    this.#personalDatabase = options.personalDatabase;
    this.#rawInputs = options.rawInputs;
    this.#status = options.status;
    this.#walkthroughsDue = options.walkthroughsDue;
    this.#clock = options.clock;
    this.#log = options.log;
  }

  /**
   * Writes and posts the Dossier of each Launch that has none yet, in the order given. One that can't be written is
   * kept for a later try, and doesn't stop the rest; the outcome says why each one neither posted nor kept is so.
   * A Dossier kept for a later try is tried only by the queue's pass (`queued`), and none at the limit at all.
   */
  async writeFor(launches: DossierLaunchInput[], { queued = false } = {}): Promise<Written> {
    const problems: string[] = [];
    // Read once for the pass, as GitHub has it, so an edit the person made there counts from the next pass.
    let interestScope: Promise<string> | undefined;
    const readInterestScope = () =>
      (interestScope ??= this.#personalDatabase.sync().then(() => this.#personalDatabase.read('profile/interest-scope.md')));
    for (const input of launches) {
      let outcome: Outcome;
      try {
        outcome = await this.#write(input, readInterestScope, queued);
      } catch (error) {
        outcome = { problem: `the Assistant hit an error (${errorText(error)})` };
      }
      if (outcome === 'stopped') return 'stopped';
      if (typeof outcome !== 'string') {
        this.#log('dossier.unsettled', { postId: input.launch.postId, problem: outcome.problem });
        problems.push(`the Dossier for ${input.launch.name.trim()} couldn't be written: ${outcome.problem}`);
      }
    }
    await this.#noteStopped();
    return problems.length > 0 ? { problem: problems.join('; ') } : 'done';
  }

  /**
   * The Launches whose Dossier was kept for a later try and waits for the queue's pass: those under the limit not tried
   * since `since`, the Miner's latest start, and those a later try wrote whose post isn't up yet.
   */
  queued(since: Date): string[] {
    const due = this.#store.unwrittenDossiers().filter((t) => !this.#atLimit(t) && t.unwrittenAt < since.toISOString());
    return [...due.map((t) => t.postId), ...this.#store.unpostedTriedDossiers()];
  }

  /** Whether a Launch's Dossier has had every try the limit allows. */
  #atLimit(tries: DossierTries | undefined): boolean {
    return tries !== undefined && tries.tries >= this.#config.dossiers.tries;
  }

  async #write(input: DossierLaunchInput, interestScope: () => Promise<string>, queued: boolean): Promise<Outcome> {
    const { launch } = input;
    let product = this.#store.productOfLaunch(launch.postId);
    if (!product) {
      const tries = this.#store.dossierTries(launch.postId);
      // One at the limit is tried no more, and one kept for a later try waits for the queue's pass.
      if (this.#atLimit(tries) || (tries && !queued)) return 'kept';
      const tried = await this.#try(input, interestScope);
      if (tried === 'stopped') return tried;
      if ('unwritten' in tried) return this.#unwritten(launch, tried.unwritten);
      product = tried.product;
    }
    if (product.withdrawnAt) return this.#putBack(product);
    await this.#ensurePost(product);
    this.#walkthroughsDue();
    return 'posted';
  }

  /**
   * One try at the Dossier of a Launch filed under no Product: its landing page read, then, unless that page is on a
   * Product's root domain already, its run.
   */
  async #try(input: DossierLaunchInput, interestScope: () => Promise<string>): Promise<Tried> {
    const { launch } = input;
    const landing = await this.#readLanding(launch);
    if ('problem' in landing) return { unwritten: landing.problem };
    const known = this.#store.productByDomain(landing.rootDomain);
    if (!known) return this.#writeNew(input, landing, await interestScope());
    this.#store.saveProductLaunch(launch.postId, known.id, this.#clock.now().toISOString());
    this.#log('dossier.re-launch', { postId: launch.postId, rootDomain: known.rootDomain, productId: known.id });
    return { product: known };
  }

  /** Counts a try that ended without the Launch's Dossier, and keeps why, for a later try. */
  #unwritten(launch: Launch, why: string): 'kept' {
    this.#store.saveDossierUnwritten(launch.postId, why, this.#clock.now().toISOString());
    this.#log('dossier.unwritten', { postId: launch.postId, tries: this.#store.dossierTries(launch.postId)!.tries, why });
    return 'kept';
  }

  /** Tells #status, once, of each Dossier at the limit, which won't be tried again. */
  async #noteStopped(): Promise<void> {
    for (const tries of this.#store.unwrittenDossiers().filter((t) => this.#atLimit(t) && !t.stopNotedAt)) {
      const launch = this.#store.launch(tries.postId)!;
      const line = stoppedLine(launch.name.trim(), launch.date, tries);
      // Marked before it is said; an uncertain send counts as said (ADR 0007).
      this.#store.saveDossierStopNoted(tries.postId, this.#clock.now().toISOString());
      try {
        await this.#status.say(line);
        this.#log('dossier.stopped', { postId: tries.postId, tries: tries.tries, why: tries.why });
      } catch (error) {
        if (refused(error)) this.#store.saveDossierStopNoted(tries.postId, null);
        this.#log('dossier.status-failed', { postId: tries.postId, error: errorText(error) });
      }
    }
  }

  /**
   * Closes the post of the Product a Launch is filed under, if it has one still open, as a Correction put the Launch
   * below its day's line: the first message becomes the one given, and the post is tagged *Skipped*. While the
   * forum's tags can't be read, the post is left as it is, to be withdrawn at a later try.
   */
  async withdraw(postId: string, first: (product: Product) => MessagePayload): Promise<'done' | { problem: string }> {
    const product = this.#store.productOfLaunch(postId);
    if (!product?.threadId || product.withdrawnAt) return 'done';
    const { dossier } = this.#store.latestDossier(product.id)!;
    const tags = await this.#tagIds({ ...product, withdrawnAt: this.#clock.now().toISOString() });
    if (!tags) return { problem: `the Dossier for ${dossier.name} can't be withdrawn while the Products forum's tags can't be read` };
    // An archived post can't be edited, so it is opened first, and closed once its first message is replaced.
    await this.#discord.editThread(product.threadId, { archived: false });
    await this.#discord.editMessage(product.threadId, product.threadId, asEdit(first(product)));
    await this.#discord.editThread(product.threadId, { applied_tags: tags, archived: true });
    this.#store.saveProductWithdrawn(product.id, this.#clock.now().toISOString());
    this.#log('dossier.withdrawn', { postId, productId: product.id, threadId: product.threadId });
    return 'done';
  }

  /**
   * Reopens a withdrawn Product's post with its latest Dossier, as a Correction put its Launch back above the line.
   * While the forum's tags can't be read, the post is left as it is, to be put back at a later try.
   */
  async #putBack(product: Product): Promise<'posted' | { problem: string }> {
    const threadId = product.threadId!;
    const back = { ...product, withdrawnAt: null };
    const tags = await this.#tagIds(back);
    // writeFor names the Dossier this is about.
    if (!tags) return { problem: "its post can't be reopened while the Products forum's tags can't be read" };
    await this.#discord.editThread(threadId, { archived: false });
    await this.#discord.editMessage(threadId, threadId, asEdit(await this.#card(back)));
    await this.#discord.editThread(threadId, { applied_tags: tags });
    this.#store.saveProductWithdrawn(product.id, null);
    this.#log('dossier.put-back', { productId: product.id, threadId });
    this.#walkthroughsDue();
    return 'posted';
  }

  /**
   * Shows where a posted Product now stands: its Dossier's Register line and its post's tags, as the store has them.
   * While the forum's tags can't be read, the tags are left as they are. A withdrawn Dossier's post is left as it is.
   */
  async restand(productId: number): Promise<void> {
    const product = this.#store.product(productId)!;
    // A withdrawn Dossier's post shows its withdrawal until a Correction puts it back.
    if (product.withdrawnAt) return;
    const threadId = product.threadId!;
    const tags = await this.#tagIds(product);
    // An archived post can't be edited, so it is opened first.
    await this.#discord.editThread(threadId, { archived: false, ...(tags ? { applied_tags: tags } : {}) });
    await this.#discord.editMessage(threadId, threadId, asEdit(await this.#card(product)));
  }

  /** The Dossier's card as it now reads, its Register line saying where the Walkthrough stands. */
  async #card(product: Product): Promise<MessagePayload> {
    const { dossier } = this.#store.latestDossier(product.id)!;
    const { registerNote } = standingOf(this.#store, product, this.#config.discord.needsYouChannelId);
    return dossierCard(dossier, product.id, await this.#personalDatabase.fileUrl(dossierPath(product.rootDomain)), registerNote).message;
  }

  /** The landing page the Launch's website redirect leads to, and the root domain it is on. */
  async #readLanding(launch: Launch): Promise<Landing | { problem: string }> {
    const readAt = this.#clock.now();
    const read = await this.#browser.read(launch.website);
    if (!read.ok) return { problem: `its landing page won't load (${read.error})` };
    // Product Hunt's website is read only through the redirect; one that leads back there is no landing page. A bot
    // check there, such as the Cloudflare challenge the VM's browser met on 2026-10-31 (#85), is named instead,
    // since behind it the redirect may still lead to a landing page.
    if (onRootDomain(read.page.finalHost, 'producthunt.com')) {
      const { botCheck } = read.page;
      if (!botCheck) return { problem: 'its website redirect leads back to Product Hunt' };
      return { problem: `its website redirect stops at a bot check${botCheck === 'unknown' ? '' : ` (${botCheck})`} on Product Hunt` };
    }
    const root = rootDomain(read.page.finalHost);
    if (!root) return { problem: 'its landing page has no host' };
    this.#keep(root, launch.website, read.page, readAt);
    return { page: read.page, readAt, rootDomain: root };
  }

  /** Reads a page the landing page links to; one that won't load is left out, saying why. */
  async #readLinked(which: string, href: string | undefined, root: string): Promise<PageInput> {
    if (!href) return { missing: `the landing page links to no ${which}` };
    const readAt = this.#clock.now();
    const read = await this.#browser.read(href);
    if (!read.ok) {
      this.#log('dossier.page-unread', { url: href, error: read.error });
      return { missing: `the landing page links to a ${which}, but it won't load (${read.error})` };
    }
    this.#keep(root, href, read.page, readAt);
    return { page: read.page, readAt };
  }

  /** Keeps a read as it came for 90 days, outside git, for Rule cases. */
  #keep(root: string, url: string, page: PageRead, readAt: Date): void {
    this.#rawInputs.keep('pages', root, JSON.stringify({ url, readAt: readAt.toISOString(), page }));
  }

  /** Reads the rest of a new Product's pages, runs its Dossier, and keeps the Product with it. */
  async #writeNew(input: DossierLaunchInput, landing: Landing, interestScope: string): Promise<Tried> {
    const { launch, date } = input;
    const root = landing.rootDomain;
    const pricing = await this.#readLinked('pricing page', pricingLink(landing.page, root), root);
    const signupHref = signupLink(landing.page, root);
    const signup = await this.#readLinked('signup page', signupHref, root);
    const launchLink = launchUrl(launch.slug);
    const links: Dossier['links'] = {
      launch: launchLink,
      // The Maker comments are one source, linked at the first of them.
      ...(launch.makerComments[0] ? { 'maker-comment': `${launchLink}?comment=${encodeURIComponent(launch.makerComments[0].id)}` } : {}),
      'landing-page': citedUrl(landing.page),
      ...('page' in pricing ? { 'pricing-page': citedUrl(pricing.page) } : {}),
      ...('page' in signup ? { 'signup-page': citedUrl(signup.page) } : {}),
    };
    const given = new Set<SourceKey>([...(Object.keys(links) as SourceKey[]), 'interest-scope']);
    const base: Omit<Dossier, 'record'> = {
      name: launch.name.trim(),
      tagline: launch.tagline.trim(),
      rootDomain: root,
      launches: [{ postId: launch.postId, date, slug: launch.slug, fit: input.fit, rank: launch.rank, featuredCount: input.featuredCount }],
      links,
      readAt: landing.readAt.toISOString(),
      startUrl: signupHref ?? landing.page.finalUrl,
    };

    let kept: { record: DossierRecord; request: ModelRequest; final: boolean } | undefined;
    const result = await this.#pi.run({
      kind: 'dossier',
      role: 'registration',
      item: root,
      prompt: dossierPrompt({ interestScope, launch, date, landing, pricing, signup, given: [...given] }),
      onRecord: (record, runId) => {
        if (kept?.final) return { ok: false, error: 'The Dossier is recorded already; reply with one short line and stop.' };
        const read = readDossier(record, given);
        if (!read.ok) return read;
        // The forwarder records each model reply before it ends, so the reply holding this tool call is the latest.
        const request = this.#store.lastModelRequest(runId);
        if (!request) return { ok: false, error: 'No model request of this run is on record.' };
        if (kept) {
          // The one rewrite may shorten only What it is, For you and Note (#40 §4); every other part stays as first
          // recorded, and no source the first record cited is dropped.
          kept = { record: shortenedFrom(kept.record, read.record), request, final: true };
          return { ok: true, message: 'Recorded the shortened Dossier.' };
        }
        const over = overBy({ ...base, record: read.record }, 0);
        kept = { record: read.record, request, final: over === 0 };
        if (over === 0) return { ok: true, message: 'Recorded the Dossier.' };
        this.#log('dossier.over-length', { rootDomain: root, runId, over });
        return {
          ok: false,
          error:
            `The Dossier runs ${over.toLocaleString('en-US')} characters over Discord's 4,000. Call record_dossier once more ` +
            'with whatItIs, forYou and note shortened by at least that much, and every other part as it was.',
        };
      },
    });
    if (!kept) {
      if (result.outcome === 'stopped') return 'stopped';
      const why =
        result.outcome === 'capped'
          ? `its Dossier run hit its ${capText(result.cap!)}`
          : result.outcome === 'failed'
            ? `its Dossier run failed (${result.error ?? 'no reason given'})`
            : 'its Dossier run recorded no Dossier';
      return { unwritten: why };
    }

    const dossier: Dossier = { ...base, record: kept.record };
    const at = this.#clock.now().toISOString();
    const { provider, model } = kept.request;
    const id = this.#store.saveNewProduct({
      postId: launch.postId,
      title: postTitle(dossier),
      dossier: { dossier, runId: result.runId, provider, model, writtenAt: at },
      files: newProductFiles(dossier, 1),
    });
    this.#log('dossier.written', {
      postId: launch.postId,
      rootDomain: root,
      productId: id,
      state: dossier.record.state,
      runId: result.runId,
      provider,
      model,
    });
    if (result.outcome === 'stopped') return 'stopped';
    return { product: this.#store.product(id)! };
  }

  /** Posts the Product's Dossier as the first message of its post, once. */
  async #ensurePost(product: Product): Promise<void> {
    if (product.threadId) return;
    const forumId = this.#config.discord.productsForumId;
    if (product.postIntended) {
      // A stop between Discord taking the post and the store hearing back: the post is there, under its title.
      const found = await this.#discord.findForumPost(forumId, product.title, new Date(product.createdAt));
      if (found) {
        this.#store.saveProductPost(product.id, found);
        this.#log('dossier.post-read-back', { productId: product.id, threadId: found });
        return;
      }
    }
    const { dossier } = this.#store.latestDossier(product.id)!;
    const { message, shortened } = dossierCard(dossier, product.id, await this.#personalDatabase.fileUrl(dossierPath(product.rootDomain)));
    const tags = (await this.#tagIds(product)) ?? [];
    this.#store.saveProductPostIntended(product.id);
    const { threadId } = await this.#discord.createForumPost(forumId, product.title, message, tags);
    this.#store.saveProductPost(product.id, threadId);
    this.#log('dossier.posted', { productId: product.id, rootDomain: product.rootDomain, threadId, shortened });
  }

  /**
   * The forum tags for where the Product stands, by the names the person gave them: *no account* for a Product with
   * no Walkthrough to come, *Skipped* once its Dossier is withdrawn, and for an open or waitlisted Product the tag of
   * where its Walkthrough or Registration stands. Undefined if the forum's tags can't be read.
   */
  async #tagIds(product: Product): Promise<string[] | undefined> {
    const names = standingOf(this.#store, product, this.#config.discord.needsYouChannelId).tags;
    if (names.length === 0) return [];
    // A tag only labels the post, so a forum whose tags can't be read leaves the post's tags as they are.
    let tags: { id: string; name: string }[];
    try {
      tags = await this.#discord.forumTags(this.#config.discord.productsForumId);
    } catch (error) {
      this.#log('dossier.tags-unread', { error: errorText(error) });
      return undefined;
    }
    return names.flatMap((name) => {
      const tag = tags.find((t) => t.name.toLowerCase() === name);
      if (!tag) this.#log('dossier.tag-missing', { tag: name });
      return tag ? [tag.id] : [];
    });
  }
}

/** The #status line saying a Launch's Dossier won't be tried again, and why its tries wrote none. */
function stoppedLine(name: string, date: string, { tries, why }: DossierTries): string {
  const ended = tries === 1 ? `Its one try ended without one, because ${why}` : `Its ${tries} tries ended without one, the last because ${why}`;
  return `Dossiers: ${name}'s Dossier (${dayLabel(date)}) won't be tried again. ${ended}.`;
}

/** The first record with the rewrite's What it is, For you and Note, each citing what either version cited. */
function shortenedFrom(first: DossierRecord, rewrite: DossierRecord): DossierRecord {
  const merged = <P extends { sources: SourceKey[] }>(a: P, b: P): P => ({
    ...b,
    sources: SOURCE_KEYS.filter((k) => a.sources.includes(k) || b.sources.includes(k)),
  });
  return {
    ...first,
    whatItIs: merged(first.whatItIs, rewrite.whatItIs),
    forYou: merged(first.forYou, rewrite.forYou),
    note: first.note && (rewrite.note ? merged(first.note, rewrite.note) : first.note),
  };
}
