// `npm run capture:producthunt-schema`: captures Product Hunt's live schema by introspection and writes it as SDL
// beside the Product Hunt fixtures (#78). The person runs it, since agents never read the token: it reads the token
// itself, as the bot does, from `producthunt-token` in $CREDENTIALS_DIRECTORY, and asks the API the bot's config
// names ($ASSISTANT_CONFIG, default config/assistant.json). An argument writes the schema elsewhere.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildClientSchema, getIntrospectionQuery, printSchema, validateSchema, type GraphQLSchema, type IntrospectionQuery } from 'graphql';
import { loadConfig } from '../bot/src/config.ts';

const ROOT = join(import.meta.dirname, '..');
/** How much of a reply that isn't a schema an error quotes. */
const QUOTED_CHARS = 200;
/** How long Product Hunt has to answer, body included. */
const TIME_LIMIT_SECONDS = 60;

/**
 * The live schema as SDL, and what graphql-js finds invalid in it. Throws, with the reason, on any reply that doesn't
 * build a schema.
 */
async function captureSchema(apiUrl: string, token: string): Promise<{ sdl: string; problems: string[] }> {
  let response: Response;
  let body: string;
  try {
    response = await fetch(apiUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query: getIntrospectionQuery() }),
      signal: AbortSignal.timeout(TIME_LIMIT_SECONDS * 1000),
    });
    body = await response.text();
  } catch (error) {
    if ((error as Error).name === 'TimeoutError') throw new Error(`Product Hunt didn't answer within ${TIME_LIMIT_SECONDS} seconds`);
    // fetch says only "fetch failed"; its cause says why.
    throw new Error(`couldn't reach Product Hunt: ${((error as Error).cause as Error | undefined)?.message ?? (error as Error).message}`);
  }
  /** The start of the reply, on one line, with the token taken out before it is cut. */
  const quoted = () => {
    const text = redact(body, token).replace(/\s+/g, ' ').trim();
    return text.length > QUOTED_CHARS ? `${text.slice(0, QUOTED_CHARS)}…` : text;
  };
  if (!response.ok) throw new Error(`Product Hunt answered ${response.status}: ${quoted()}`);
  let reply: unknown;
  try {
    reply = JSON.parse(body);
  } catch {
    throw new Error(`Product Hunt's reply isn't JSON: ${quoted()}`);
  }
  if (typeof reply !== 'object' || reply === null || Array.isArray(reply)) {
    throw new Error(`Product Hunt's reply isn't a GraphQL response: ${quoted()}`);
  }
  const { data, errors } = reply as { data?: unknown; errors?: unknown };
  const refusals = errors === undefined || errors === null ? [] : Array.isArray(errors) ? errors : [errors];
  if (refusals.length > 0) {
    throw new Error(`Product Hunt refused the introspection query: ${refusals.map(errorMessage).join('; ')}`);
  }
  if (typeof data !== 'object' || data === null || !('__schema' in data)) {
    throw new Error(`Product Hunt's reply doesn't build a schema, since it holds no data.__schema: ${quoted()}`);
  }
  let schema: GraphQLSchema;
  try {
    schema = buildClientSchema(data as IntrospectionQuery);
  } catch (error) {
    throw new Error(`Product Hunt's reply doesn't build a schema: ${(error as Error).message}`);
  }
  // graphql-js checks rules Product Hunt's server may not, such as an object having every field of its interface. The
  // live schema is what the API accepts either way, so it is written, and what graphql-js objects to is named.
  return { sdl: printSchema(schema), problems: validateSchema(schema).map((problem) => problem.message) };
}

/** A GraphQL error's message, or the error itself when it has none. */
function errorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : JSON.stringify(error);
}

/** `text` with the token taken out. */
function redact(text: string, token: string): string {
  return token ? text.replaceAll(token, '[the token]') : text;
}

/** The Product Hunt token, read as the bot reads it. Throws, saying why, when there's no token to read. */
function readToken(): string {
  const dir = process.env.CREDENTIALS_DIRECTORY;
  if (!dir) throw new Error('CREDENTIALS_DIRECTORY is not set: point it at the folder that holds producthunt-token');
  let token: string;
  try {
    token = readFileSync(join(dir, 'producthunt-token'), 'utf8').trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`there's no producthunt-token in $CREDENTIALS_DIRECTORY (${dir})`);
    throw error;
  }
  if (!token) throw new Error(`producthunt-token in $CREDENTIALS_DIRECTORY (${dir}) is empty`);
  return token;
}

const out = process.argv[2] ?? join(ROOT, 'bot', 'test', 'fixtures', 'producthunt', 'schema.graphql');
// Every message goes out with the token taken out, in case Product Hunt quotes it back.
let token = '';
try {
  token = readToken();
  const config = loadConfig(process.env.ASSISTANT_CONFIG ?? join(ROOT, 'config', 'assistant.json'));
  const { sdl, problems } = await captureSchema(config.productHunt.apiUrl, token);
  if (sdl.includes(token)) throw new Error("Product Hunt's schema holds the token");
  writeFileSync(out, sdl);
  console.log(`Wrote Product Hunt's schema to ${out}`);
  if (problems.length > 0) console.error(`capture:producthunt-schema: graphql-js finds Product Hunt's schema invalid: ${problems.join('; ')}`);
} catch (error) {
  console.error(`capture:producthunt-schema: ${redact((error as Error).message, token).replace(/\.$/, '')}. Nothing was written.`);
  process.exitCode = 1;
}
