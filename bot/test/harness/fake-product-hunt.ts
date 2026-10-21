// A fake Product Hunt API v2. It serves fixture Launches through the one GraphQL endpoint, paged as the real API
// pages them, and records every request it answers so tests can check what was asked for. Like the real API, it
// refuses a query that Product Hunt's live schema (#79) doesn't accept, or variables that don't fit it.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { buildSchema, GraphQLError, parse, validate, validateExecutionArgs, type DocumentNode } from 'graphql';

/** A Launch as the real API returned it on Oct 11–14 (the fixtures). */
export interface FixturePost {
  id: string;
  name: string;
  tagline: string;
  description: string;
  slug: string;
  dailyRank: number | null;
  votesCount: number;
  commentsCount: number;
  topics: { nodes: { name: string }[] };
  makers: { id: string }[];
  comments: { nodes: FixtureComment[] };
}

export interface FixtureComment {
  body: string;
  createdAt: string;
  parentId: string | null;
  userId: string;
}

export function fixtureDay(date: string): FixturePost[] {
  return JSON.parse(readFileSync(new URL(`../fixtures/producthunt/${date}.json`, import.meta.url), 'utf8')) as FixturePost[];
}

interface Served {
  post: FixturePost;
  featured: boolean;
  /** When the Launch was posted; for a Featured Launch this is also when it was featured. */
  at: string;
  /** The order Product Hunt created the Launches in, which breaks ties between equal posting times. */
  created: number;
}

export interface ProductHuntRequest {
  kind: 'posts' | 'comments';
  query: string;
  variables: Record<string, unknown>;
}

const PAGE = 20;

/** Product Hunt's live schema, as the person captured it by introspection. */
const SCHEMA = buildSchema(readFileSync(new URL('../fixtures/producthunt/schema.graphql', import.meta.url), 'utf8'));

export class FakeProductHunt {
  readonly requests: ProductHuntRequest[] = [];
  /** Called after each page of `posts` is served, with how many pages have been, as when votes move Launches mid-read. */
  onPostsPage: (pagesServed: number) => void = () => {};
  /** Every Launch served, in Product Hunt's current ranking. */
  #served: Served[] = [];
  #postsPages = 0;
  #server: http.Server;
  #token: string;

  private constructor(token: string) {
    this.#token = token;
    this.#server = http.createServer((req, res) => void this.#handle(req, res));
  }

  static async start(options: { token: string }): Promise<FakeProductHunt> {
    const ph = new FakeProductHunt(options.token);
    await new Promise<void>((resolve) => ph.#server.listen(0, '127.0.0.1', resolve));
    return ph;
  }

  get apiUrl(): string {
    return `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}/v2/api/graphql`;
  }

  async close(): Promise<void> {
    this.#server.closeAllConnections();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  /** Serves `posts` as Featured Launches, featured at `featuredAt`, in this order of rank. */
  addFeatured(posts: FixturePost[], featuredAt: string): void {
    for (const post of posts) this.#served.push({ post, featured: true, at: featuredAt, created: this.#served.length });
  }

  /** Serves `posts` as Launches Product Hunt did not feature. */
  addUnfeatured(posts: FixturePost[], postedAt: string): void {
    for (const post of posts) this.#served.push({ post, featured: false, at: postedAt, created: this.#served.length });
  }

  /** Swaps two Launches' places in the ranking, and their daily ranks, as votes do during the day. */
  swapRanks(a: string, b: string): void {
    const i = this.#served.findIndex((s) => s.post.id === a);
    const j = this.#served.findIndex((s) => s.post.id === b);
    const [first, second] = [this.#served[i]!, this.#served[j]!];
    [this.#served[i], this.#served[j]] = [second, first];
    [first.post.dailyRank, second.post.dailyRank] = [second.post.dailyRank, first.post.dailyRank];
  }

  async #handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'x-rate-limit-limit': '6250',
        'x-rate-limit-remaining': String(6250 - 100 * this.requests.length),
        'x-rate-limit-reset': '900',
      });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST' || !req.url?.startsWith('/v2/api/graphql')) return reply(404, { error: 'not_found' });
    if (req.headers.authorization !== `Bearer ${this.#token}`) {
      return reply(401, { error: 'invalid_oauth_token', error_description: 'The access token is invalid' });
    }
    const { query, variables = {} } = JSON.parse(raw) as { query: string; variables?: Record<string, unknown> };
    // The real API checks a query and its variables against its schema before it reads anything, and answers one that
    // fails with the reasons alone. Which HTTP status it gives them hasn't been tried; the bot's read fails on either.
    const refusals = schemaRefusals(query, variables);
    if (refusals.length > 0) return reply(200, { errors: refusals });

    if (/\bpost\s*\(\s*id:/.test(query)) {
      this.requests.push({ kind: 'comments', query, variables });
      const served = this.#served.find((s) => s.post.id === variables.id);
      if (!served) return reply(200, { data: { post: null } });
      return reply(200, { data: { post: { id: served.post.id, comments: commentsPage(served.post, variables.after) } } });
    }

    if (/\bposts\s*\(/.test(query)) {
      this.requests.push({ kind: 'posts', query, variables });
      const after = Date.parse(String(variables.postedAfter));
      const before = Date.parse(String(variables.postedBefore));
      const featuredOnly = /featured:\s*true/.test(query);
      const matching = this.#served.filter((s) => {
        const at = Date.parse(s.at);
        return at >= after && at < before && (s.featured || !featuredOnly);
      });
      // The real API pages by offset into the order asked for, so a Launch that moves between pages can be read twice
      // or not at all. RANKING moves with votes; NEWEST follows posting time, which votes never change.
      const order = query.match(/\border:\s*(\w+)/)?.[1] ?? 'RANKING';
      if (order === 'NEWEST') matching.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.created - b.created);
      else if (order !== 'RANKING') return reply(200, { errors: [{ message: `The fake doesn't serve order ${order}` }] });
      const start = variables.after ? Number(Buffer.from(String(variables.after), 'base64').toString()) : 0;
      const page = matching.slice(start, start + PAGE);
      const end = start + page.length;
      this.onPostsPage(++this.#postsPages);
      return reply(200, {
        data: {
          posts: {
            pageInfo: { hasNextPage: end < matching.length, endCursor: Buffer.from(String(end)).toString('base64') },
            nodes: page.map((s) => ({
              ...s.post,
              featuredAt: s.featured ? s.at : null,
              createdAt: s.at,
              comments: commentsPage(s.post, undefined),
            })),
          },
        },
      });
    }

    reply(200, { errors: [{ message: 'The fake only answers posts and post comments queries' }] });
  }
}

/**
 * Why the live schema doesn't accept `query` with `variables`: no query at all, a syntax error, every rule the query
 * breaks, or each variable that is missing or doesn't fit its type. None when it is accepted.
 */
function schemaRefusals(query: unknown, variables: Record<string, unknown>): readonly GraphQLError[] {
  if (typeof query !== 'string') return [new GraphQLError('The request has no query')];
  let document: DocumentNode;
  try {
    document = parse(query);
  } catch (error) {
    // Given a string, parse throws only a syntax error.
    return [error as GraphQLError];
  }
  const broken = validate(SCHEMA, document);
  if (broken.length > 0) return broken;
  const execution = validateExecutionArgs({ schema: SCHEMA, document, variableValues: variables });
  return 'operation' in execution ? [] : execution;
}

function commentsPage(post: FixturePost, cursor: unknown) {
  const all = post.comments.nodes;
  const start = cursor ? Number(Buffer.from(String(cursor), 'base64').toString()) : 0;
  const nodes = all.slice(start, start + PAGE).map((c, i) => ({ id: `${post.id}-c${start + i}`, ...c }));
  const end = start + nodes.length;
  return { pageInfo: { hasNextPage: end < all.length, endCursor: Buffer.from(String(end)).toString('base64') }, nodes };
}
