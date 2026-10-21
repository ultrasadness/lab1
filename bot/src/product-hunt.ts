// Product Hunt API v2, the only way the Assistant reads Product Hunt. A Miner date's read asks for exactly that
// Pacific day's Featured Launches, paged, with all their comments; each raw response is kept for 90 days.
import type { Launch } from './store.ts';
import type { Log } from './log.ts';
import { pacificDay } from './pacific.ts';

const DAY_QUERY = `query FeaturedLaunches($postedAfter: DateTime!, $postedBefore: DateTime!, $after: String) {
  posts(featured: true, postedAfter: $postedAfter, postedBefore: $postedBefore, order: NEWEST, first: 20, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name tagline description slug dailyRank website
      topics(first: 10) { nodes { name } }
      makers { id }
      comments(first: 20) { pageInfo { hasNextPage endCursor } nodes { id body createdAt parentId userId } }
    }
  }
}`;

const COMMENTS_QUERY = `query LaunchComments($id: ID!, $after: String) {
  post(id: $id) {
    comments(first: 20, after: $after) { pageInfo { hasNextPage endCursor } nodes { id body createdAt parentId userId } }
  }
}`;

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface Comment {
  id: string;
  body: string;
  createdAt: string;
  parentId: string | null;
  userId: string;
}

interface Connection<T> {
  pageInfo: PageInfo;
  nodes: T[];
}

interface Post {
  id: string;
  name: string;
  tagline: string;
  description: string | null;
  slug: string;
  dailyRank: number | null;
  /** Product Hunt's redirect to the Product's website: the only way the Assistant reaches the site from a Launch. */
  website: string;
  topics: { nodes: { name: string }[] };
  makers: { id: string }[];
  comments: Connection<Comment>;
}

const MAX_RATE_LIMIT_WAITS = 2;
const MAKER_COMMENT_CHARS = 2000;
/** How many of a Launch's Maker comments are kept, in their order, for its Dossier. */
const MAKER_COMMENTS_KEPT = 10;

export class ProductHunt {
  #apiUrl: string;
  #token: string;
  #keepRaw: (body: string, date: string) => void;
  #log: Log;

  constructor(options: { apiUrl: string; token: string; keepRaw: (body: string, date: string) => void; log: Log }) {
    this.#apiUrl = options.apiUrl;
    this.#token = options.token;
    this.#keepRaw = options.keepRaw;
    this.#log = options.log;
  }

  /** Every Launch Product Hunt featured on a Pacific date, in its ranking, with each one's Maker comment. */
  async featuredLaunches(date: string): Promise<Launch[]> {
    // Every Featured Launch is posted at the moment it is featured, so the day's bounds select exactly its set.
    // Pages are offsets into the order asked for, and votes move the ranking while the day is read, so the pages
    // follow posting time instead and the ranking is sorted here.
    const day = pacificDay(date);
    const posts = new Map<string, Post>();
    let after: string | null = null;
    do {
      const data = (await this.#query(date, DAY_QUERY, {
        postedAfter: day.start.toISOString(),
        postedBefore: day.end.toISOString(),
        after,
      })) as { posts: Connection<Post> };
      for (const post of data.posts.nodes) if (!posts.has(post.id)) posts.set(post.id, post);
      after = data.posts.pageInfo.hasNextPage ? data.posts.pageInfo.endCursor : null;
    } while (after);
    const ranked = [...posts.values()].sort((a, b) => (a.dailyRank ?? Infinity) - (b.dailyRank ?? Infinity));

    const launches: Launch[] = [];
    for (const [index, post] of ranked.entries()) {
      const comments = [...post.comments.nodes];
      let cursor = post.comments.pageInfo.hasNextPage ? post.comments.pageInfo.endCursor : null;
      while (cursor) {
        const data = (await this.#query(date, COMMENTS_QUERY, { id: post.id, after: cursor })) as {
          post: { comments: Connection<Comment> } | null;
        };
        if (!data.post) break;
        comments.push(...data.post.comments.nodes);
        cursor = data.post.comments.pageInfo.hasNextPage ? data.post.comments.pageInfo.endCursor : null;
      }
      launches.push({
        postId: post.id,
        // A daily rank read before votes moved can match one read after; the place in the sorted ranking can't.
        rank: index + 1,
        name: post.name,
        tagline: post.tagline,
        description: post.description ?? '',
        slug: post.slug,
        topics: post.topics.nodes.map((t) => t.name),
        website: post.website,
        ...makerComments(post.makers, comments),
      });
    }
    return launches;
  }

  async #query(date: string, query: string, variables: Record<string, unknown>): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(this.#apiUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ query, variables }),
      });
      const body = await response.text();
      if (response.status === 429 && attempt < MAX_RATE_LIMIT_WAITS) {
        const seconds = Math.min(Number(response.headers.get('x-rate-limit-reset')) || 60, 900);
        this.#log('product-hunt.rate-limited', { waitSeconds: seconds });
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        continue;
      }
      if (!response.ok) throw new Error(`Product Hunt answered ${response.status}`);
      this.#keepRaw(body, date);
      const parsed = JSON.parse(body) as { data?: unknown; errors?: { message: string }[] };
      if (parsed.errors?.length) throw new Error(`Product Hunt refused the query: ${parsed.errors.map((e) => e.message).join('; ')}`);
      return parsed.data;
    }
  }
}

/**
 * The Launch's Maker comments (#19): every comment whose author is one of its makers, those that start a thread first,
 * each set earliest first. The first is the Maker comment the Miner judges by. Product Hunt shows a redacted maker as
 * id "0", which never matches. Nothing is guessed from wording.
 */
function makerComments(makers: { id: string }[], comments: Comment[]): Pick<Launch, 'makerComment' | 'makerComments'> {
  const makerIds = new Set(makers.map((m) => m.id).filter((id) => id && id !== '0'));
  const kept = comments
    .filter((c) => makerIds.has(c.userId))
    .sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null) || a.createdAt.localeCompare(b.createdAt))
    .slice(0, MAKER_COMMENTS_KEPT)
    .map((c) => {
      const text = htmlToText(c.body);
      return { id: c.id, text: text.length > MAKER_COMMENT_CHARS ? `${text.slice(0, MAKER_COMMENT_CHARS)}…` : text };
    });
  return { makerComment: kept[0]?.text ?? null, makerComments: kept };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === '#') {
        const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        // As a browser does, a code that names no character reads as the replacement character.
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '�';
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
