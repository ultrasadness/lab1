// Dossiers (#47): for each of a date's Launches at or above its line, plain code reads the Product's pages, a
// registration-role run writes the Dossier, and the bot posts it silently as the first message of the Product's one
// post in the Products forum, and queues its folder for the Personal database.
// A Product is keyed by the root domain its landing page is on, so a Launch of a Product that already has a Dossier is
// filed under it and gets no second post; adding it to that Dossier is #66's. Each step is kept in the store as it
// happens, so a pass that stops picks up where it left off: a Dossier already written isn't written again, and a post
// marked as started is looked for on Discord before it is created again. A Dossier that can't be written is tried
// again at the date's next pass, and the date's list waits on it.
// A Correction that puts a Dossier's Launch below its day's line withdraws it (#48): the post stays as the record,
// closed and tagged *Skipped*, its first message replaced. One that puts it back above the line reopens the post with
// its Dossier.
import type { BrowserService, PageRead } from '../browser.ts';
import type { Clock } from '../clock.ts';
import type { Config } from '../config.ts';
import { asEdit, type MessagePayload } from '../discord/components.ts';
import type { DiscordRest } from '../discord/rest.ts';
import { errorText, type Log } from '../log.ts';
import { launchUrl } from '../miner/day-post.ts';
import type { PersonalDatabase } from '../personal-database.ts';
import { capText, type PiRunner } from '../pi-runs.ts';
import type { RawInputs } from '../raw-inputs.ts';
import { onRootDomain, rootDomain } from '../root-domain.ts';
import type { Launch, ModelRequest, Product, Store } from '../store.ts';
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

/** Whether the Dossiers were written, the Assistant stopped the work, or why one or more couldn't be. */
export type Written = 'done' | 'stopped' | { problem: string };

/** The landing page read, and the root domain it is on. */
type Landing = Read & { rootDomain: string };

/** The tag that marks a Product with no account to make (#33), and the one that marks a withdrawn Dossier (#40 §2). */
const NO_ACCOUNT_TAG = 'no account';
const SKIPPED_TAG = 'skipped';

export class Dossiers {
  #config: Config;
  #store: Store;
  #browser: BrowserService;
  #pi: PiRunner;
  #discord: DiscordRest;
  #personalDatabase: PersonalDatabase;
  #rawInputs: RawInputs;
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
    this.#clock = options.clock;
    this.#log = options.log;
  }

  /**
   * Writes and posts the Dossier of each Launch that has none yet, in the order given. One that can't be written
   * doesn't stop the rest; the outcome says why each such one couldn't.
   */
  async writeFor(launches: DossierLaunchInput[]): Promise<Written> {
    const problems: string[] = [];
    // Read once for the pass, as GitHub has it, so an edit the person made there counts from the next pass.
    let interestScope: Promise<string> | undefined;
    const readInterestScope = () =>
      (interestScope ??= this.#personalDatabase.sync().then(() => this.#personalDatabase.read('profile/interest-scope.md')));
    for (const input of launches) {
      let written: Written;
      try {
        written = await this.#write(input, readInterestScope);
      } catch (error) {
        written = { problem: `the Assistant hit an error (${errorText(error)})` };
      }
      if (written === 'stopped') return 'stopped';
      if (written !== 'done') {
        this.#log('dossier.unwritten', { postId: input.launch.postId, problem: written.problem });
        problems.push(`the Dossier for ${input.launch.name.trim()} couldn't be written: ${written.problem}`);
      }
    }
    return problems.length > 0 ? { problem: problems.join('; ') } : 'done';
  }

  async #write(input: DossierLaunchInput, interestScope: () => Promise<string>): Promise<Written> {
    const { launch } = input;
    let product = this.#store.productOfLaunch(launch.postId);
    if (!product) {
      const landing = await this.#readLanding(launch);
      if ('problem' in landing) return landing;
      const known = this.#store.productByDomain(landing.rootDomain);
      if (known) {
        this.#store.saveProductLaunch(launch.postId, known.id, this.#clock.now().toISOString());
        this.#log('dossier.re-launch', { postId: launch.postId, rootDomain: known.rootDomain, productId: known.id });
        product = known;
      } else {
        const written = await this.#writeNew(input, landing, await interestScope());
        if (typeof written === 'string' || 'problem' in written) return written;
        product = written.product;
      }
    }
    if (product.withdrawnAt) return this.#putBack(product);
    await this.#ensurePost(product);
    return 'done';
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
    const tags = await this.#tagIds(dossier, true);
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
  async #putBack(product: Product): Promise<Written> {
    const threadId = product.threadId!;
    const { dossier } = this.#store.latestDossier(product.id)!;
    const tags = await this.#tagIds(dossier, false);
    // writeFor names the Dossier this is about.
    if (!tags) return { problem: "its post can't be reopened while the Products forum's tags can't be read" };
    const { message } = dossierCard(dossier, product.id, await this.#personalDatabase.fileUrl(dossierPath(product.rootDomain)));
    await this.#discord.editThread(threadId, { archived: false });
    await this.#discord.editMessage(threadId, threadId, asEdit(message));
    await this.#discord.editThread(threadId, { applied_tags: tags });
    this.#store.saveProductWithdrawn(product.id, null);
    this.#log('dossier.put-back', { productId: product.id, threadId });
    return 'done';
  }

  /** The landing page the Launch's website redirect leads to, and the root domain it is on. */
  async #readLanding(launch: Launch): Promise<Landing | { problem: string }> {
    const readAt = this.#clock.now();
    const read = await this.#browser.read(launch.website);
    if (!read.ok) return { problem: `its landing page won't load (${read.error})` };
    // Product Hunt's website is read only through the redirect; one that leads back there is no landing page.
    if (onRootDomain(read.page.finalHost, 'producthunt.com')) return { problem: 'its website redirect leads back to Product Hunt' };
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
  async #writeNew(input: DossierLaunchInput, landing: Landing, interestScope: string): Promise<Written | { product: Product }> {
    const { launch, date } = input;
    const root = landing.rootDomain;
    const pricing = await this.#readLinked('pricing page', pricingLink(landing.page, root), root);
    const signup = await this.#readLinked('signup page', signupLink(landing.page, root), root);
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
      return { problem: why };
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
    const tags = (await this.#tagIds(dossier, false)) ?? [];
    this.#store.saveProductPostIntended(product.id);
    const { threadId } = await this.#discord.createForumPost(forumId, product.title, message, tags);
    this.#store.saveProductPost(product.id, threadId);
    this.#log('dossier.posted', { productId: product.id, rootDomain: product.rootDomain, threadId, shortened });
  }

  /**
   * The forum tags for where the Product stands, by the names the person gave them: *no account* for a Product with
   * no Walkthrough to come, and *Skipped* once its Dossier is withdrawn. An Open or Waitlisted Product gets its
   * *Walkthrough* tag with its Walkthrough (#53). Undefined if the forum's tags can't be read.
   */
  async #tagIds(dossier: Dossier, withdrawn: boolean): Promise<string[] | undefined> {
    const names = [...(dossier.record.state === 'no-account' ? [NO_ACCOUNT_TAG] : []), ...(withdrawn ? [SKIPPED_TAG] : [])];
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
