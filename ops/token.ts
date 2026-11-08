// `ops/token <name>` (ADR 0009): the only way a token is obtained or replaced. The person runs it as root on the VM,
// from the iPhone over SSH. It reads the value without echo, or for Gmail's refresh token the address Safari can't load
// at the end of the consent, and for the Personal database's deploy key it makes the key pair here, so the private key
// never leaves the VM (settled on #71). It checks the value with a harmless call, and only once that passes writes it to
// /etc/assistant/credentials/<name> (root, mode 600) and restarts the service that reads it. A value that fails its
// check changes nothing. ops/README.md lists every token; together they are the runbook for rebuilding the VM.
//
//   ops/token <name>              obtain or replace one token
//   ops/token --check [<name>…]   check the tokens in place, every one when none is named, changing nothing
//   ops/token --dry-run <name>    read and check a value, and say what would be written and restarted
//   ops/token --list              every token's name and what it is for
//
// With OPS_ROOT set (the tests), every fixed path is taken under it, systemctl and the rest come from PATH, and
// OPS_ENDPOINTS may name other addresses for Google.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { loadConfig, type Config } from '../bot/src/config.ts';
import { onlyCollection } from '../bot/src/password-vault.ts';
import { kill } from '../bot/src/process-group.ts';

const ROOT = process.env.OPS_ROOT ?? '';
const TESTING = ROOT !== '';
const CREDENTIALS = `${ROOT}/etc/assistant/credentials`;
const UNITS = `${ROOT}/etc/systemd/system`;
const KNOWN_HOSTS = `${ROOT}/var/lib/assistant/.ssh/known_hosts`;
/** The `bw` that ops/install pins, as `bitwarden.command` in the bot's config names it. */
const BW = `${ROOT}/opt/assistant/bw/node_modules/.bin/bw`;
const BOT_UNIT = 'assistant.service';
const HTTP_TIMEOUT_MS = 20_000;
const COMMAND_TIMEOUT_MS = TESTING && process.env.OPS_COMMAND_TIMEOUT_MS ? Number(process.env.OPS_COMMAND_TIMEOUT_MS) : 60_000;
/** How long the deploy key's prompt waits for the person to add the key to GitHub. */
const PERSON_WAIT_MS = 30 * 60_000;

const ENDPOINTS = {
  googleAuth: 'https://accounts.google.com/o/oauth2/v2/auth',
  googleToken: 'https://oauth2.googleapis.com/token',
  gmail: 'https://gmail.googleapis.com/gmail/v1/users/me',
  ...(TESTING && process.env.OPS_ENDPOINTS ? (JSON.parse(process.env.OPS_ENDPOINTS) as Record<string, string>) : {}),
};
/** The Signup mailbox's only scopes (#16): reading and drafting, so the Assistant can't delete mail. */
const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/gmail.readonly'];
/** Where Google sends Safari after the consent. Nothing listens there, so Safari shows its address and an error. */
const GMAIL_REDIRECT = 'http://127.0.0.1:8765';

type Checked = { ok: true; note: string } | { ok: false; why: string };

interface Token {
  name: string;
  what: string;
  /** How the value is obtained: read without echo, or by a flow of its own. */
  obtain?: (input: Input, context: Context) => Promise<string | { refused: string }>;
  /** Checks a value with a harmless call. */
  check: (value: string, context: Context) => Promise<Checked>;
  /** The service restarted once the token changes, if a running service holds it. */
  unit?: string;
  /** Who reads the token, when no running service holds it. */
  readBy?: string;
}

interface Context {
  config: Config;
  /** The text of a token already in place, by name. */
  inPlace(name: string): string | undefined;
}

/** Every model role in the spec (#41), each with a new-api key of its own; the bot reads only those it has brought up. */
const KEY_ROLES = ['miner', 'registration', 'mail', 'question', 'checks'] as const;

const TOKENS: Token[] = [
  {
    name: 'discord-bot-token',
    what: "the Discord bot's token, from the Developer Portal's Bot page",
    unit: BOT_UNIT,
    check: async (value, { config }) => {
      const response = await request(`${config.discord.apiBaseUrl}/users/@me`, { headers: { authorization: `Bot ${value}` } });
      if (!response.ok) return refusedBy('Discord', response);
      const user = (await response.json()) as { username?: string };
      return { ok: true, note: `Discord knows it as the bot ${user.username ?? '(unnamed)'}` };
    },
  },
  {
    name: 'producthunt-token',
    what: "Product Hunt API v2's developer token",
    unit: BOT_UNIT,
    check: async (value, { config }) => {
      const response = await request(config.productHunt.apiUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${value}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ query: 'query { posts(first: 1) { edges { node { id } } } }' }),
      });
      if (!response.ok) return refusedBy('Product Hunt', response);
      const body = (await response.json()) as { errors?: { message: string }[] };
      if (body.errors?.length) return { ok: false, why: `Product Hunt refused the query: ${body.errors.map((e) => e.message).join('; ')}` };
      return { ok: true, note: 'Product Hunt answered a query for one Launch' };
    },
  },
  ...[...KEY_ROLES, 'probe' as const].map(
    (role): Token => ({
      name: `newapi-key-${role}`,
      what: role === 'probe' ? "the probe key, for the daily 1-token check of each plan behind new-api" : `the ${role} role's new-api key`,
      unit: BOT_UNIT,
      check: async (value, { config }) => {
        const response = await request(`${config.gateway.baseUrl}/models`, { headers: { authorization: `Bearer ${value}` } });
        if (!response.ok) return refusedBy('new-api', response);
        const body = (await response.json()) as { data?: { id?: unknown }[] };
        const listed = new Set((body.data ?? []).map((model) => model.id));
        // The forwarder asks new-api for <role>@<provider> (ADR 0011), so a role's key must reach each such name its
        // providers in the config give: a token limited to the upstream model's name, or another role's key, fails here
        // rather than at the role's first run (#85). A role not brought up yet has no providers to reach.
        const roles: Partial<Record<string, { providers: { name: string }[] }>> = config.roles;
        const names = (roles[role]?.providers ?? []).map((provider) => `${role}@${provider.name}`);
        const unreached = names.filter((name) => !listed.has(name));
        if (unreached.length > 0) {
          return {
            ok: false,
            why: `new-api doesn't let it reach ${unreached.join(', ')}, which the ${role} role asks for: in new-api, its token's model limit must name it, and the key must be that role's own`,
          };
        }
        return { ok: true, note: names.length > 0 ? `new-api lets it reach ${names.join(', ')}` : `new-api lists ${listed.size} models for it` };
      },
    }),
  ),
  {
    name: 'gmail-client-secret',
    what: "the Gmail OAuth client: the JSON Google Cloud's Credentials page downloads for the Desktop app client",
    unit: BOT_UNIT,
    obtain: async (input) => {
      const pasted = await input.hidden('Paste the client JSON (it starts {"installed":), then press Enter: ');
      const client = clientPair(pasted);
      return client ? JSON.stringify(client) : { refused: 'that is not the client JSON: it needs a client_id and a client_secret' };
    },
    check: async (value) => {
      const client = clientPair(value);
      if (!client) return { ok: false, why: 'the file holds no client_id and client_secret' };
      // Google checks the client before the code, so a made-up code is refused as invalid_grant when the pair is right.
      const response = await request(ENDPOINTS.googleToken, {
        method: 'POST',
        body: new URLSearchParams({ grant_type: 'authorization_code', code: '4/not-a-real-code', redirect_uri: GMAIL_REDIRECT, code_verifier: 'x'.repeat(43), ...client }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (body.error === 'invalid_grant' || body.error === 'invalid_request') return { ok: true, note: 'Google accepts this client id and secret' };
      if (body.error === 'invalid_client') return { ok: false, why: 'Google refuses this client id and secret (invalid_client)' };
      return refusedBy('Google', response);
    },
  },
  {
    name: 'gmail-refresh-token',
    what: "the Signup mailbox's refresh token, from a consent in Safari (needs gmail-client-secret in place)",
    unit: BOT_UNIT,
    obtain: gmailConsent,
    check: async (value, context) => {
      const client = clientPair(context.inPlace('gmail-client-secret') ?? '');
      if (!client) return { ok: false, why: 'gmail-client-secret is not in place: run ops/token gmail-client-secret first' };
      const refreshed = await request(ENDPOINTS.googleToken, {
        method: 'POST',
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: value, ...client }),
      });
      if (!refreshed.ok) return refusedBy('Google', refreshed);
      const { access_token, scope = '' } = (await refreshed.json()) as { access_token: string; scope?: string };
      const granted = scope.split(' ').filter(Boolean).sort();
      if (granted.join(' ') !== GMAIL_SCOPES.join(' ')) return { ok: false, why: `the token holds ${granted.join(', ') || 'no scope'}, not exactly gmail.readonly and gmail.compose` };
      const profile = await request(`${ENDPOINTS.gmail}/profile`, { headers: { authorization: `Bearer ${access_token}` } });
      if (!profile.ok) return refusedBy('Gmail', profile);
      const { emailAddress } = (await profile.json()) as { emailAddress?: string };
      return { ok: true, note: `it reads and drafts in ${emailAddress ?? 'an unnamed mailbox'}` };
    },
  },
  {
    name: 'bitwarden-api-key',
    what: "the bot's Bitwarden account's personal API key (logged in as that account: Settings, Security, Keys)",
    unit: BOT_UNIT,
    obtain: async (input) => {
      const clientId = (await input.hidden('Paste the client_id (it starts user.), then press Enter: ')).trim();
      const clientSecret = (await input.hidden('Paste the client_secret, then press Enter: ')).trim();
      if (!/^user\.[0-9a-f-]{36}$/.test(clientId) || !clientSecret) return { refused: 'that is not a personal API key: its client_id starts user.' };
      return JSON.stringify({ client_id: clientId, client_secret: clientSecret });
    },
    // Through bw, not a request of ops/token's own to Bitwarden's token endpoint, which refused every key for lacking a
    // header bw sends (#54). What this asks is then what the bot asks.
    check: async (value) => {
      const key = clientPair(value);
      if (!key) return { ok: false, why: 'the file holds no client_id and client_secret' };
      return loggedInBw(key, async () => ({ ok: true, note: 'bw logs in with it' }));
    },
  },
  {
    name: 'bitwarden-master-password',
    what: "the bot's Bitwarden account's master password (needs bitwarden-api-key in place)",
    unit: BOT_UNIT,
    check: async (value, context) => {
      const key = clientPair(context.inPlace('bitwarden-api-key') ?? '');
      if (!key) return { ok: false, why: 'bitwarden-api-key is not in place: run ops/token bitwarden-api-key first' };
      // What the bot will ask: unlock with the password, sync, and read the one collection its account may see (ADR 0004).
      return loggedInBw(key, async (env) => {
        const unlock = await run(BW, ['unlock', '--passwordenv', 'BW_PASSWORD', '--raw', '--nointeraction'], { ...env, BW_PASSWORD: value });
        if (!unlock.ok) return { ok: false, why: 'bw refuses this master password' };
        const session = { ...env, BW_SESSION: unlock.stdout.trim() };
        const sync = await run(BW, ['sync', '--nointeraction'], session);
        if (!sync.ok) return { ok: false, why: `bw can't sync: ${lastLine(sync.stderr)}` };
        const listed = await run(BW, ['list', 'collections', '--nointeraction'], session);
        if (!listed.ok) return { ok: false, why: `bw can't list the account's collections: ${lastLine(listed.stderr)}` };
        return registrationsOnly(listed.stdout);
      });
    },
  },
  ...(['bot', 'miner', 'backup', 'weekly'] as const).map(
    (check): Token => ({
      name: `healthchecks-ping-${check}`,
      what: `the ping URL of healthchecks.io's ${check === 'weekly' ? 'weekly check' : `${check} check`}`,
      ...(check === 'bot' || check === 'miner' ? { unit: BOT_UNIT } : { readBy: check === 'backup' ? 'the nightly backup and its alert' : 'the weekly check' }),
      check: async (value) => {
        if (!(TESTING ? /^https?:\/\/\S+$/ : /^https:\/\/\S+$/).test(value)) return { ok: false, why: 'a ping URL starts https://' };
        // A log event shows in the check's history and changes nothing else.
        const response = await request(`${value.replace(/\/$/, '')}/log`, { method: 'POST', body: 'ops/token checked this ping URL' });
        if (!response.ok) return refusedBy('healthchecks.io', response);
        return { ok: true, note: 'healthchecks.io took a log event on it' };
      },
    }),
  ),
  {
    name: 'personal-database-deploy-key',
    what: "the Personal database repo's deploy key, made on the VM, with write access to that repo only",
    unit: BOT_UNIT,
    obtain: makeDeployKey,
    check: async (value, { config }) => {
      const dir = secretDir();
      try {
        const key = join(dir, 'key');
        writeFileSync(key, value.endsWith('\n') ? value : `${value}\n`, { mode: 0o600 });
        return await checkDeployKey(config, key);
      } finally {
        forget(dir);
      }
    },
  },
];

/**
 * A client id and secret, as a token file stores them for Gmail's client and Bitwarden's API key, or as Google's
 * downloaded JSON holds them under `installed` (or `web`).
 */
function clientPair(text: string): { client_id: string; client_secret: string } | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, { client_id?: unknown; client_secret?: unknown }> & { client_id?: unknown; client_secret?: unknown };
    const client = parsed.installed ?? parsed.web ?? parsed;
    if (typeof client.client_id === 'string' && typeof client.client_secret === 'string') return { client_id: client.client_id, client_secret: client.client_secret };
  } catch {}
  return undefined;
}

/** bw's own reason for a failure: on a new data folder, its stderr opens with lines saying it made one. */
const lastLine = (stderr: string): string => (stderr.trim().split('\n').at(-1) ?? '').replace(/\.$/, '');

/**
 * Logs bw in with the API key in a throwaway data folder, as the bot logs in, asks `then` what it needs of the account,
 * and logs out. sudo's PATH doesn't name our Node, which bw starts through env. Each Secret reaches only the command
 * that needs it.
 */
async function loggedInBw(key: { client_id: string; client_secret: string }, then: (env: NodeJS.ProcessEnv) => Promise<Checked>): Promise<Checked> {
  if (!existsSync(BW)) return { ok: false, why: "bw isn't installed on the VM, so this token can't be checked: run ops/install" };
  const data = secretDir();
  try {
    const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}`, BITWARDENCLI_APPDATA_DIR: data };
    const login = await run(BW, ['login', '--apikey', '--nointeraction'], { ...env, BW_CLIENTID: key.client_id, BW_CLIENTSECRET: key.client_secret });
    if (!login.ok) return { ok: false, why: `bw can't log in with the API key: ${lastLine(login.stderr)}` };
    try {
      return await then(env);
    } finally {
      await run(BW, ['logout', '--nointeraction'], env);
    }
  } finally {
    forget(data);
  }
}

/** Whether `bw list collections` answered with the *Registrations* collection alone, which is what the bot asks. */
function registrationsOnly(listed: string): Checked {
  let parsed: unknown;
  try {
    parsed = JSON.parse(listed);
  } catch {
    return { ok: false, why: "bw's list of collections isn't JSON" };
  }
  const only = onlyCollection(parsed);
  return 'problem' in only ? { ok: false, why: only.problem } : { ok: true, note: "bw unlocks with it, and the bot's account sees only Registrations" };
}

/** The folders holding a secret while ops/token works with it, each removed when it is done or stopped. */
const secretDirs = new Set<string>();

/**
 * A folder for a secret in the making, such as the deploy key while GitHub is asked: inside the credentials folder,
 * root's alone and denied to coding sessions, unless a dry run without root can't write there.
 */
function secretDir(): string {
  let parent = tmpdir();
  try {
    accessSync(CREDENTIALS, constants.W_OK);
    parent = CREDENTIALS;
  } catch {}
  const dir = mkdtempSync(join(parent, '.ops-token-'));
  secretDirs.add(dir);
  return dir;
}

function forget(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  secretDirs.delete(dir);
}

// Ctrl-C at a prompt shown as typed, or an SSH app that drops, ends ops/token: no secret it holds stays behind.
for (const [signal, code] of [['SIGINT', 130], ['SIGHUP', 129], ['SIGTERM', 143]] as const) {
  process.once(signal, () => {
    for (const dir of secretDirs) rmSync(dir, { recursive: true, force: true });
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.exit(code);
  });
}

/** The consent in Safari: a link to open, then the address Safari can't load, traded for the refresh token. */
async function gmailConsent(input: Input, context: Context): Promise<string | { refused: string }> {
  const client = clientPair(context.inPlace('gmail-client-secret') ?? '');
  if (!client) return { refused: 'gmail-client-secret is not in place: run ops/token gmail-client-secret first' };
  const verifier = randomBytes(48).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  const link = `${ENDPOINTS.googleAuth}?${new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: GMAIL_REDIRECT,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state,
  })}`;
  say('Open this link in Safari, signed in to the Signup mailbox\'s Google account:', '', link, '');
  say(`Safari ends on a page that won't load, at ${GMAIL_REDIRECT}/?state=…. Copy that page's whole address.`);
  const address = (await input.hidden('Paste the address, then press Enter: ')).replace(/\s+/g, '');
  const query = new URLSearchParams(address.includes('?') ? address.slice(address.indexOf('?') + 1).split('#')[0] : address);
  if (query.get('error')) return { refused: `Google answered ${query.get('error')}: nothing was granted` };
  if (query.get('state') !== state) return { refused: 'that address is from another consent (its state differs): run ops/token gmail-refresh-token again' };
  const code = query.get('code');
  if (!code) return { refused: 'there is no code in that address: copy the whole address and try again' };
  const response = await request(ENDPOINTS.googleToken, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: GMAIL_REDIRECT, code_verifier: verifier, ...client }),
  });
  const body = (await response.json().catch(() => ({}))) as { refresh_token?: string; error?: string };
  if (!response.ok || !body.refresh_token) return { refused: `Google gave no refresh token: ${body.error ?? `it answered ${response.status}`}` };
  return body.refresh_token;
}

/** Makes an ed25519 key pair here, shows the public key for GitHub, and waits for the person to add it. */
async function makeDeployKey(input: Input, context: Context): Promise<string | { refused: string }> {
  const missing = checkoutMissing(context.config);
  if (missing) return { refused: missing };
  const dir = secretDir();
  try {
    const key = join(dir, 'key');
    const made = await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'assistant@lab1 Personal database', '-f', key]);
    if (!made.ok) return { refused: `ssh-keygen failed: ${made.stderr.trim()}` };
    say(
      "Add this public key to the Personal database repo: Settings, Deploy keys, Add deploy key. Tick \"Allow write access\".",
      '',
      readFileSync(`${key}.pub`, 'utf8').trim(),
      '',
    );
    for (let attempt = 1; ; attempt++) {
      await input.line('Press Enter once GitHub shows the key. ', PERSON_WAIT_MS);
      const checked = await checkDeployKey(context.config, key);
      if (checked.ok) return readFileSync(key, 'utf8');
      say(`Not yet: ${checked.why}`);
      if (attempt === 5) return { refused: 'GitHub still refuses the key; nothing changed. Remove it from the repo and run ops/token again.' };
    }
  } finally {
    forget(dir);
  }
}

/**
 * The deploy key as the bot uses it, from its checkout: `git ls-remote origin main` reads through it, and a push of
 * nothing proves it may write (settled on #71). That push is what `git push` sends when it has nothing to push: one
 * flush to GitHub's receiving end, which refuses a read-only key there. As git does, it waits for GitHub's refs first:
 * GitHub ends a session whose input comes before them, even for a key that may write (#85).
 */
async function checkDeployKey(config: Config, key: string): Promise<Checked> {
  const missing = checkoutMissing(config);
  if (missing) return { ok: false, why: missing };
  const ssh = [
    ...config.personalDatabase.ssh,
    ...['-i', key, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', `UserKnownHostsFile=${KNOWN_HOSTS}`, '-o', 'StrictHostKeyChecking=yes'],
    // A GitHub that stops answering ends the check, rather than the person's wait.
    ...['-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2'],
  ];
  const listed = await git(config, ['ls-remote', 'origin', 'main'], { GIT_SSH_COMMAND: ssh.map((part) => `'${part.replaceAll("'", `'\\''`)}'`).join(' ') });
  if (!listed.ok) return { ok: false, why: `GitHub refused the key: ${listed.stderr.trim().split('\n')[0] ?? ''}` };
  const main = listed.stdout.match(/^([0-9a-f]{40})\trefs\/heads\/main$/m)?.[1];
  const origin = sshTarget((await git(config, ['remote', 'get-url', 'origin'])).stdout.trim());
  if (!origin) return { ok: false, why: "the checkout's origin is not an ssh URL such as git@github.com:<owner>/<repo>.git" };
  const pushed = await run(ssh[0]!, [...ssh.slice(1), ...origin.port, origin.host, `git-receive-pack '${origin.path}'`], process.env, {
    // The refs end with a flush-pkt.
    after: /0000$/,
    send: '0000',
  });
  if (!pushed.ok) {
    return { ok: false, why: `GitHub lets the key read but not push (${pushed.stderr.trim().split('\n')[0] ?? ''}): delete it from the repo's Deploy keys and add it again with "Allow write access" ticked` };
  }
  return { ok: true, note: `it may push, and the repo's ${main ? `main is at ${main.slice(0, 12)}` : 'has no main branch yet'}` };
}

/** Where an ssh git URL points: `git@github.com:owner/repo.git`, or `ssh://git@github.com[:port]/owner/repo.git`. */
function sshTarget(url: string): { host: string; port: string[]; path: string } | undefined {
  const full = url.match(/^ssh:\/\/([^/:]+)(?::(\d+))?(\/.+)$/);
  if (full) return { host: full[1]!, port: full[2] ? ['-p', full[2]] : [], path: full[3]! };
  const short = url.match(/^([^/:]+):(?!\/\/)(.+)$/);
  return short ? { host: short[1]!, port: [], path: short[2]! } : undefined;
}

/** Why the bot's checkout of the Personal database can't be used yet, if it can't. */
function checkoutMissing(config: Config): string | undefined {
  const dir = config.personalDatabase.dir;
  if (!existsSync(join(dir, '.git'))) return `${dir} is not a checkout yet: run ops/install --personal-database <the repo's ssh URL> first`;
  return undefined;
}

/**
 * Git in the bot's checkout, as the bot runs it: with no git config but the checkout's own. Naming GIT_DIR also lets
 * root work in a checkout the `assistant` user owns.
 */
function git(config: Config, args: string[], env: NodeJS.ProcessEnv = {}): ReturnType<typeof run> {
  return run('git', args, {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    GIT_DIR: join(config.personalDatabase.dir, '.git'),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    ...env,
  });
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
}

async function refusedBy(who: string, response: Response): Promise<Checked> {
  const dead = response.status === 401 || response.status === 403;
  return { ok: false, why: `${who} ${dead ? 'refused it' : 'answered'} with ${response.status}` };
}

/**
 * Runs a command to its end, or kills it after a minute: the command and whatever it started, such as the ssh git runs,
 * which can hold the command's pipes after it is gone. Its input is written at once, or once its output matches `after`.
 */
function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  input?: string | { after: RegExp; send: string },
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], detached: true });
    let stdout = '';
    let stderr = '';
    let waiting = typeof input === 'object' ? input : undefined;
    const killer = setTimeout(() => {
      stderr = `killed after ${COMMAND_TIMEOUT_MS / 1000} seconds\n${stderr}`;
      kill(child);
    }, COMMAND_TIMEOUT_MS);
    child.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (waiting?.after.test(stdout)) {
        child.stdin?.end(waiting.send);
        waiting = undefined;
      }
    });
    child.stderr!.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.stdin?.on('error', () => {});
    if (typeof input === 'string') child.stdin?.end(input);
    child.once('error', (e) => (stderr += e.message));
    child.once('close', (code) => {
      clearTimeout(killer);
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
}

const say = (...lines: string[]): void => {
  process.stdout.write(`${lines.join('\n')}\n`);
};

/**
 * What the person types. On a terminal, a hidden read turns echo off, so nothing pasted shows; piped input, as in the
 * tests, is read a line at a time.
 */
class Input {
  #lines: string[] = [];
  #waiting: ((line: string | undefined) => void) | undefined;
  #ended = false;

  constructor() {
    if (process.stdin.isTTY) return;
    const lines = createInterface({ input: process.stdin });
    lines.on('line', (line) => (this.#waiting ? this.#take(line) : this.#lines.push(line)));
    lines.on('close', () => {
      this.#ended = true;
      this.#take(undefined);
    });
  }

  #take(line: string | undefined): void {
    const waiting = this.#waiting;
    this.#waiting = undefined;
    waiting?.(line);
  }

  /** One line, shown as typed, waited for at most `ms`. */
  line(prompt: string, ms = PERSON_WAIT_MS): Promise<string> {
    return this.#read(prompt, false, ms);
  }

  /** One line with echo off, waited for at most 30 minutes. */
  hidden(prompt: string): Promise<string> {
    return this.#read(prompt, true, PERSON_WAIT_MS);
  }

  #read(prompt: string, hidden: boolean, ms: number): Promise<string> {
    // Echo goes off before the prompt shows, so nothing typed after it can be echoed.
    if (process.stdin.isTTY) process.stdin.setRawMode(hidden);
    process.stdout.write(prompt);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`nothing was typed within ${ms / 60_000} minutes`)), ms);
      const done = (line: string | undefined) => {
        clearTimeout(timer);
        if (hidden) process.stdout.write('\n');
        if (line === undefined) reject(new Error('the input ended'));
        else resolve(line);
      };
      if (!process.stdin.isTTY) {
        if (this.#lines.length > 0) return done(this.#lines.shift());
        if (this.#ended) return done(undefined);
        this.#waiting = done;
        return;
      }
      // A terminal: raw mode reads each key with echo off; Enter ends the line, Ctrl-C or Ctrl-D stops.
      let typed = '';
      process.stdin.setEncoding('utf8');
      const onData = (chunk: string) => {
        if (!hidden) {
          typed += chunk;
          if (!/[\r\n]/.test(typed)) return;
          return finish(typed.split(/[\r\n]/)[0]!);
        }
        for (const char of chunk) {
          if (char === '\r' || char === '\n') return finish(typed);
          if (char === '\u0003' || char === '\u0004') return finish(undefined);
          if (char === '\u007f' || char === '\b') typed = typed.slice(0, -1);
          else typed += char;
        }
      };
      const finish = (line: string | undefined) => {
        process.stdin.off('data', onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        done(line);
      };
      process.stdin.on('data', onData);
      process.stdin.resume();
    });
  }
}

/** Writes a token's file under the credentials directory: root's, mode 600, put in place whole. */
function place(name: string, value: string): void {
  const temporary = join(CREDENTIALS, `.${name}.new`);
  // ssh wants a private key's file to end its last line.
  writeFileSync(temporary, name === 'personal-database-deploy-key' && !value.endsWith('\n') ? `${value}\n` : value, { mode: 0o600 });
  renameSync(temporary, join(CREDENTIALS, name));
}

/** The tokens a unit file hands its service, by the LoadCredential= paths it names. */
function unitCredentials(unit: string): string[] | undefined {
  const path = join(UNITS, unit);
  if (!existsSync(path)) return undefined;
  return [...readFileSync(path, 'utf8').matchAll(/^LoadCredential=[^:\n]+:(\S+)$/gm)].map((m) => m[1]!.split('/').at(-1)!);
}

/** Restarts the token's service, once everything it needs is in place; otherwise says what it waits on. */
async function restart(token: Token, config: Config, dryRun: boolean): Promise<void> {
  if (!token.unit) return say(`No service to restart: ${token.readBy} reads it at the next run.`);
  const credentials = unitCredentials(token.unit);
  if (!credentials) return say(`${token.unit} isn't installed yet: ops/install puts it in, and starts it once its tokens are in place.`);
  // A dry run counts the token it checked as in place, as it would be.
  const waits = credentials.filter((name) => name !== token.name && !existsSync(join(CREDENTIALS, name)));
  if (token.unit === BOT_UNIT && !(await git(config, ['rev-parse', '--verify', '-q', 'HEAD'])).ok) {
    waits.push("the Personal database's checkout (ops/install checks out its main once the deploy key works)");
  }
  if (waits.length > 0) return say(`${token.unit} waits on: ${waits.join(', ')}. It starts once they are in place.`);
  if (dryRun) return say(`Would restart ${token.unit}.`);
  await run('systemctl', ['reset-failed', token.unit]);
  const restarted = await run('systemctl', ['restart', token.unit]);
  say(restarted.ok ? `Restarted ${token.unit}.` : `systemctl couldn't restart ${token.unit}: ${restarted.stderr.trim()}`);
  if (!restarted.ok) process.exitCode = 1;
}

async function main(args: string[]): Promise<number> {
  const config = loadConfig(process.env.ASSISTANT_CONFIG ?? join(import.meta.dirname, '..', 'config', 'assistant.json'));
  const inPlace = (name: string) => (existsSync(join(CREDENTIALS, name)) ? readFileSync(join(CREDENTIALS, name), 'utf8').trim() : undefined);
  const context: Context = { config, inPlace };
  const named = (name: string) => TOKENS.find((token) => token.name === name);

  if (args[0] === '--list') {
    for (const token of TOKENS) say(`${token.name}: ${token.what}`);
    return 0;
  }
  if (!TESTING && process.getuid?.() !== 0 && args[0] !== '--dry-run') {
    say('ops/token runs as root: sudo ops/token …');
    return 1;
  }
  if (args[0] === '--check') {
    const names = args.slice(1).length > 0 ? args.slice(1) : TOKENS.map((token) => token.name).filter((name) => inPlace(name) !== undefined);
    let dead = 0;
    for (const name of names) {
      const token = named(name);
      const value = inPlace(name);
      if (!token) return unknown(name);
      if (value === undefined) {
        say(`${name}: not in place`);
        dead++;
        continue;
      }
      const checked = await token.check(value, context).catch((e: unknown): Checked => ({ ok: false, why: `the check failed: ${(e as Error).message}` }));
      say(checked.ok ? `${name}: works (${checked.note})` : `${name}: DEAD (${checked.why}); replace it with ops/token ${name}`);
      if (!checked.ok) dead++;
    }
    return dead > 0 ? 1 : 0;
  }

  const dryRun = args[0] === '--dry-run';
  const name = dryRun ? args[1] : args[0];
  const token = name ? named(name) : undefined;
  if (!name || args.length !== (dryRun ? 2 : 1)) {
    say('Usage: ops/token <name> | --check [<name>…] | --dry-run <name> | --list');
    return 2;
  }
  if (!token) return unknown(name);
  if (!dryRun && !existsSync(CREDENTIALS)) {
    say(`${CREDENTIALS} doesn't exist yet: run ops/install first.`);
    return 1;
  }

  const input = new Input();
  const obtained = token.obtain ? await token.obtain(input, context) : (await input.hidden(`Paste ${token.what}, then press Enter: `)).trim();
  if (typeof obtained !== 'string') {
    say(`Nothing changed: ${obtained.refused}`);
    return 1;
  }
  if (!obtained) {
    say('Nothing changed: nothing was pasted.');
    return 1;
  }
  const checked = await token.check(obtained, context).catch((e: unknown): Checked => ({ ok: false, why: `the check failed: ${(e as Error).message}` }));
  if (!checked.ok) {
    say(`Nothing changed: ${checked.why}.`);
    return 1;
  }
  say(`It works: ${checked.note}.`);
  if (dryRun) say(`Would write ${join(CREDENTIALS, name)}.`);
  else {
    place(name, obtained);
    say(`Wrote ${join(CREDENTIALS, name)}.`);
  }
  await restart(token, config, dryRun);
  return process.exitCode === 1 ? 1 : 0;
}

function unknown(name: string): number {
  say(`There is no token named ${name}. ops/token --list names them all.`);
  return 2;
}

process.exit(
  await main(process.argv.slice(2)).catch((e: unknown) => {
    say(`ops/token stopped: ${(e as Error).message}`);
    return 1;
  }),
);
