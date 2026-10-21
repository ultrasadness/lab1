// The Product Hunt schema capture (#78): the script reads the token as the bot does, sends the standard
// introspection query and writes the schema as SDL. Each test runs it as the person would, as its own process, against
// a local server that answers introspection from a slice of Product Hunt's schema, so no test reaches the live API.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildSchema,
  getIntrospectionQuery,
  graphql,
  printSchema,
  type GraphQLObjectType,
  type IntrospectionQuery,
  type IntrospectionType,
} from 'graphql';

const ROOT = join(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'capture-producthunt-schema.ts');
/** Made up for each run, in the shape of a Product Hunt token. */
const TOKEN = randomBytes(32).toString('base64url');

/** A slice of Product Hunt's API, with what SDL can lose in a round trip: descriptions, defaults, a deprecation. */
const SERVED = buildSchema(`
"""An ISO-8601 encoded UTC date time string."""
scalar DateTime

"""The query root of Product Hunt's API."""
type Query {
  """Look up a Post by its id or slug."""
  post(id: ID, slug: String): Post

  """Look up Posts by the given filters."""
  posts(featured: Boolean, postedAfter: DateTime, postedBefore: DateTime, order: PostsOrder = RANKING, first: Int, after: String): PostConnection!
}

"""An object with an ID."""
interface Node {
  id: ID!
}

"""A post."""
type Post implements Node {
  id: ID!
  name: String!
  tagline: String!
  description: String
  slug: String!

  """The post's rank on its day, once the day is over."""
  dailyRank: Int
  votesCount: Int! @deprecated(reason: "Use the score instead.")
  featuredAt: DateTime
  comments(first: Int, after: String, order: CommentsOrder = NEWEST): CommentConnection!
}

"""A comment on a post."""
type Comment implements Node {
  id: ID!
  body: String!
  createdAt: DateTime!
  parentId: ID
  userId: ID!
}

type PostConnection {
  pageInfo: PageInfo!
  nodes: [Post!]!
}

type CommentConnection {
  pageInfo: PageInfo!
  nodes: [Comment!]!
}

type PageInfo {
  hasNextPage: Boolean!
  endCursor: String
}

enum PostsOrder {
  FEATURED_AT
  NEWEST
  RANKING
  VOTES
}

enum CommentsOrder {
  NEWEST
  VOTES_COUNT
}
`);

interface Answer {
  status: number;
  body: string;
}

/** How the local server answers a request, by default as a GraphQL server would. */
type Answering = (request: { authorization: string | undefined; query: string }) => Answer | Promise<Answer>;

const asGraphql: Answering = async ({ authorization, query }) => {
  if (authorization !== `Bearer ${TOKEN}`) {
    return { status: 401, body: JSON.stringify({ error: 'invalid_oauth_token', error_description: 'The access token is invalid' }) };
  }
  return { status: 200, body: JSON.stringify(await graphql({ schema: SERVED, source: query })) };
};

/** A local server answering as `answering` says, closed when the test ends. Resolves to its URL. */
async function serve(t: TestContext, answering: Answering = asGraphql): Promise<string> {
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const { query } = JSON.parse(raw) as { query: string };
    const { status, body } = await answering({ authorization: req.headers.authorization, query });
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v2/api/graphql`;
}

interface Capture {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Where the script was told to write the schema. */
  out: string;
}

/** A schema written by an earlier capture, which a failed one leaves as it was. */
const EARLIER = 'type Query {\n  earlier: String\n}\n';

/**
 * Runs the script as the person would: the token in `$CREDENTIALS_DIRECTORY` and the bot's config at
 * `$ASSISTANT_CONFIG`, whose Product Hunt API is `apiUrl`. It writes into a throwaway folder, over an earlier capture
 * when `earlier` says so. `token` is the token file's text, or null for no file, and `credentialsDirectory: false`
 * leaves `$CREDENTIALS_DIRECTORY` unset.
 */
async function capture(
  t: TestContext,
  apiUrl: string,
  options: { earlier?: boolean; token?: string | null; credentialsDirectory?: boolean } = {},
): Promise<Capture> {
  const dir = mkdtempSync(join(tmpdir(), 'capture-schema-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const token = options.token === undefined ? `${TOKEN}\n` : options.token;
  if (token !== null) writeFileSync(join(dir, 'producthunt-token'), token);
  const config = JSON.parse(readFileSync(join(ROOT, 'config', 'assistant.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(join(dir, 'assistant.json'), JSON.stringify({ ...config, productHunt: { apiUrl } }));
  const out = join(dir, 'schema.graphql');
  if (options.earlier) writeFileSync(out, EARLIER);
  const env: NodeJS.ProcessEnv = { ...process.env, CREDENTIALS_DIRECTORY: dir, ASSISTANT_CONFIG: join(dir, 'assistant.json') };
  if (options.credentialsDirectory === false) delete env.CREDENTIALS_DIRECTORY;
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, out], { env, timeout: 30_000 }, (error, stdout, stderr) =>
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : null) : 0, stdout, stderr, out }),
    );
  });
}

/** Whether any 8 characters of the token appear in anything the run printed or wrote. */
function leaked(run: Capture): boolean {
  let written = '';
  try {
    written = readFileSync(run.out, 'utf8');
  } catch {}
  const pieces = Array.from({ length: TOKEN.length - 7 }, (_, i) => TOKEN.slice(i, i + 8));
  return [run.stdout, run.stderr, written].some((text) => pieces.some((piece) => text.includes(piece)));
}

/** That the run failed, saying `reason`, and left the earlier capture as it was. */
function assertWroteNothing(run: Capture, reason: RegExp, what?: string): void {
  assert.notEqual(run.code, 0, what);
  assert.match(run.stderr, reason, what);
  assert.equal(readFileSync(run.out, 'utf8'), EARLIER, what);
}

/** The served schema's introspection, as a reply body, with `change` made to a copy of its types. */
async function changed(change: (types: IntrospectionType[]) => IntrospectionType[]): Promise<string> {
  const { data } = (await graphql({ schema: SERVED, source: getIntrospectionQuery() })) as unknown as { data: IntrospectionQuery };
  return JSON.stringify({ data: { __schema: { ...data.__schema, types: change(structuredClone([...data.__schema.types])) } } });
}

test('the written schema builds back into the schema the API serves', async (t) => {
  const queries: string[] = [];
  const api = await serve(t, (request) => (queries.push(request.query), asGraphql(request)));
  const run = await capture(t, api);
  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(queries, [getIntrospectionQuery()]);
  const written = readFileSync(run.out, 'utf8');
  assert.equal(printSchema(buildSchema(written)), printSchema(SERVED));
  assert.match(written, /^ {2}dailyRank: Int$/m);
});

test('on an HTTP error it says what the API answered, writes nothing and exits non-zero', async (t) => {
  const cloudflare = await serve(t, () => ({ status: 403, body: '<!DOCTYPE html><title>Just a moment...</title>' }));
  assertWroteNothing(await capture(t, cloudflare, { earlier: true }), /Product Hunt answered 403: <!DOCTYPE html><title>Just a moment\.\.\.<\/title>/);
});

test('on GraphQL errors it names them and writes nothing, even beside a schema', async (t) => {
  const cases: [string, unknown, RegExp][] = [
    [
      'a list',
      [{ message: 'Field "__type" is not allowed' }, { code: 'RATE_LIMITED' }],
      /refused the introspection query: Field "__type" is not allowed; \{"code":"RATE_LIMITED"\}/,
    ],
    ['one error, not in a list', { message: 'Rate limited' }, /refused the introspection query: Rate limited/],
  ];
  for (const [what, errors, reason] of cases) {
    const api = await serve(t, async (request) => {
      const answer = JSON.parse((await asGraphql(request)).body) as Record<string, unknown>;
      return { status: 200, body: JSON.stringify({ ...answer, errors }) };
    });
    assertWroteNothing(await capture(t, api, { earlier: true }), reason, what);
  }
});

test("on a reply that doesn't build a schema it says why and writes nothing", async (t) => {
  const replies: [string, string, RegExp][] = [
    ['an HTML page', '<html><title>Just a moment...</title></html>', /reply isn't JSON: <html><title>Just a moment\.\.\.<\/title><\/html>/],
    ['null', 'null', /reply isn't a GraphQL response: null/],
    ['a list', '[]', /reply isn't a GraphQL response: \[\]/],
    ['no data', '{}', /reply doesn't build a schema/],
    ['data with no schema', '{"data":{}}', /reply doesn't build a schema/],
    [
      'a type it names but leaves out',
      await changed((types) => types.filter((type) => type.name !== 'PageInfo')),
      /reply doesn't build a schema: .*PageInfo/,
    ],
  ];
  for (const [what, body, reason] of replies) {
    assertWroteNothing(await capture(t, await serve(t, () => ({ status: 200, body })), { earlier: true }), reason, what);
  }
});

test("a schema that builds but breaks one of graphql-js's own rules is written, with the rule named", async (t) => {
  // graphql-js checks rules a server may not, such as an object having every field of its interface.
  const body = await changed((types) =>
    types.map((type) => (type.name === 'Post' && type.kind === 'OBJECT' ? { ...type, fields: type.fields.filter((f) => f.name !== 'id') } : type)),
  );
  const run = await capture(t, await serve(t, () => ({ status: 200, body })), { earlier: true });
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stderr, /graphql-js finds Product Hunt's schema invalid: Interface field Node\.id expected but Post does not provide it/);
  const post = buildSchema(readFileSync(run.out, 'utf8'), { assumeValid: true }).getType('Post') as GraphQLObjectType;
  assert.deepEqual(Object.keys(post.getFields()), ['name', 'tagline', 'description', 'slug', 'dailyRank', 'votesCount', 'featuredAt', 'comments']);
});

test('the token reaches only the API, even when the API echoes it back', async (t) => {
  const run = await capture(t, await serve(t));
  assert.equal(run.code, 0, run.stderr);
  assert.equal(leaked(run), false, 'a capture that succeeds');

  const echoes: [string, Answering][] = [
    // Quoted again and again, so that one runs past where the quote of the reply is cut.
    ['an HTTP error', ({ authorization }) => ({ status: 401, body: `${authorization?.slice('Bearer '.length)} is invalid. `.repeat(10) })],
    ['a GraphQL error', ({ authorization }) => ({ status: 200, body: JSON.stringify({ errors: [{ message: `${authorization} is rate limited` }] }) })],
    [
      'a schema',
      async (request) => {
        const answer = await asGraphql(request);
        return { ...answer, body: answer.body.replace('A post.', `A post for ${TOKEN}.`) };
      },
    ],
  ];
  for (const [what, answering] of echoes) {
    const run = await capture(t, await serve(t, answering), { earlier: true });
    assert.equal(leaked(run), false, what);
    assertWroteNothing(run, /the token/, what);
  }
});

test('without a usable token it says why and asks the API nothing', async (t) => {
  let asked = 0;
  const api = await serve(t, (request) => (asked++, asGraphql(request)));
  const cases: [string, Parameters<typeof capture>[2], RegExp][] = [
    ['no credentials directory', { credentialsDirectory: false }, /CREDENTIALS_DIRECTORY is not set/],
    ['no token file', { token: null }, /no producthunt-token in \$CREDENTIALS_DIRECTORY/],
    ['an empty token file', { token: ' \n' }, /producthunt-token in \$CREDENTIALS_DIRECTORY \(.*\) is empty/],
  ];
  for (const [what, options, reason] of cases) {
    assertWroteNothing(await capture(t, api, { ...options, earlier: true }), reason, what);
  }
  assert.equal(asked, 0);
});

test("when the API can't be reached it says so and writes nothing", async (t) => {
  const closed = http.createServer();
  await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const port = (closed.address() as AddressInfo).port;
  await new Promise<void>((resolve) => closed.close(() => resolve()));
  assertWroteNothing(await capture(t, `http://127.0.0.1:${port}/v2/api/graphql`, { earlier: true }), /couldn't reach Product Hunt: .*ECONNREFUSED/);
});
