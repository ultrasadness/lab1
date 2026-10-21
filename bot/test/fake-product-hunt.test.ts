// The fake Product Hunt refuses a query the live API would refuse: it checks each one, and its variables, against the
// live schema (bot/test/fixtures/producthunt/schema.graphql), so a wrong field, argument or enum value fails a test
// instead of failing at go-live. The bot's own queries pass it in every test that reads a day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeProductHunt, fixtureDay } from './harness/fake-product-hunt.ts';
import { TOKENS } from './harness/world.ts';

/** A GraphQL reply: the data asked for, or why the query was refused. */
interface Reply {
  data?: unknown;
  errors?: { message: string }[];
}

/** What the fake answers `query`, sent with the bot's token as the bot sends its own. */
async function ask(productHunt: FakeProductHunt, query: string, variables: Record<string, unknown>): Promise<Reply> {
  const response = await fetch(productHunt.apiUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKENS.productHunt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  return (await response.json()) as Reply;
}

/** Every reason a reply gives for refusing its query, on one line. */
const refusals = (reply: Reply) => reply.errors?.map((e) => e.message).join('; ') ?? '';

const DAY_QUERY = (nodeFields: string) => `query FeaturedLaunches($postedAfter: DateTime!, $postedBefore: DateTime!) {
  posts(featured: true, postedAfter: $postedAfter, postedBefore: $postedBefore, order: NEWEST, first: 20) {
    nodes { ${nodeFields} }
  }
}`;

test('a day query with one misspelled field is refused, with errors and no data', async (t) => {
  const productHunt = await FakeProductHunt.start({ token: TOKENS.productHunt });
  t.after(() => productHunt.close());
  productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');

  const reply = await ask(productHunt, DAY_QUERY('id name dailyRnak'), {
    postedAfter: '2026-10-12T07:00:00.000Z',
    postedBefore: '2026-10-13T07:00:00.000Z',
  });

  assert.equal(reply.data, undefined, 'no Launches come back');
  assert.match(refusals(reply), /dailyRnak/);
});

test('a comments query with an enum value the schema lacks is refused, with errors and no data', async (t) => {
  const productHunt = await FakeProductHunt.start({ token: TOKENS.productHunt });
  t.after(() => productHunt.close());
  const day = fixtureDay('2026-10-12');
  productHunt.addFeatured(day, '2026-10-12T07:01:00Z');

  // Comments come only NEWEST or VOTES_COUNT first.
  const reply = await ask(
    productHunt,
    `query LaunchComments($id: ID!) {
      post(id: $id) { comments(first: 20, order: OLDEST) { nodes { id body } } }
    }`,
    { id: day[0]!.id },
  );

  assert.equal(reply.data, undefined, 'no comments come back');
  assert.match(refusals(reply), /OLDEST/);
});

test('a day query sent without a variable it requires is refused, with errors and no data', async (t) => {
  const productHunt = await FakeProductHunt.start({ token: TOKENS.productHunt });
  t.after(() => productHunt.close());
  productHunt.addFeatured(fixtureDay('2026-10-12'), '2026-10-12T07:01:00Z');

  const reply = await ask(productHunt, DAY_QUERY('id name dailyRank'), { postedBefore: '2026-10-13T07:00:00.000Z' });

  assert.equal(reply.data, undefined, 'no Launches come back');
  assert.match(refusals(reply), /postedAfter/);
});
