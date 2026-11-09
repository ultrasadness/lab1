// ops/token with dummy values only (#71), as the person runs it: values typed on stdin, checked against fakes of
// Discord, Product Hunt, new-api, Google, Gmail, `bw` and healthchecks.io, written under a throwaway OPS_ROOT,
// and the service restarted through a fake systemctl that logs each call. The Personal database's remote is a fake
// GitHub that lets in only the deploy keys the test adds, as GitHub does.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROLES } from '../../bot/src/config.ts';

const REPO = join(import.meta.dirname, '..', '..');
const OPS_TOKEN = join(REPO, 'ops', 'token');
const BOT_TOKENS = [
  'discord-bot-token',
  'producthunt-token',
  'newapi-key-miner',
  'newapi-key-registration',
  'personal-database-deploy-key',
  'healthchecks-ping-bot',
  'bitwarden-api-key',
  'bitwarden-master-password',
];
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose';

interface Vm {
  root: string;
  credentials: string;
  checkout: string;
  github: string;
  env: NodeJS.ProcessEnv;
  /** The systemctl calls made, one per line. */
  systemctl(): string;
  /** Places a token as an earlier ops/token would have. */
  put(name: string, value: string): void;
  /** The PKCE challenges the fake Google was shown at consent, by state. */
  consents: Map<string, string>;
}

const body = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let text = '';
    req.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
    req.on('end', () => resolve(text));
  });

/** A VM in a throwaway folder: ops/install's folders and the bot's unit, the fakes, and the bot's checkout. */
async function vm(t: TestContext): Promise<Vm> {
  const root = mkdtempSync(join(tmpdir(), 'ops-token-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const credentials = join(root, 'etc/assistant/credentials');
  mkdirSync(credentials, { recursive: true, mode: 0o700 });
  mkdirSync(join(root, 'etc/systemd/system'), { recursive: true });
  copyFileSync(join(REPO, 'ops/systemd/assistant.service'), join(root, 'etc/systemd/system/assistant.service'));
  mkdirSync(join(root, 'var/lib/assistant/.ssh'), { recursive: true });
  writeFileSync(join(root, 'var/lib/assistant/.ssh/known_hosts'), readFileSync(join(REPO, 'ops/github-known-hosts')));

  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'systemctl'), `#!/bin/sh\necho "$*" >> ${join(root, 'systemctl.log')}\n`);
  chmodSync(join(bin, 'systemctl'), 0o755);

  const consents = new Map<string, string>();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    const auth = req.headers.authorization ?? '';
    const text = await body(req);
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (url.pathname === '/discord/users/@me') {
      if (auth === 'Bot good-discord') return json(200, { username: 'lab1-assistant' });
      // A refusal in the fields Bitwarden's token endpoint answered #54 with, beside a field that says nothing about why.
      if (auth === 'Bot no-header') return json(400, { error: 'version_header_missing', error_description: 'No client version header found.', echoed: 'a-field-nothing-names' });
      if (auth === 'Bot long-reason') return json(400, { message: `line one\n${'x'.repeat(1000)}` });
      if (auth === 'Bot echoed-value') return json(401, { message: 'no such token: echoed-value' });
      return json(401, { message: '401: Unauthorized' });
    }
    if (url.pathname === '/producthunt') {
      if (auth !== 'Bearer good-ph') return json(401, { error: 'invalid_oauth_token' });
      return json(200, { data: { posts: { edges: [{ node: { id: '1' } }] } } });
    }
    if (url.pathname === '/newapi/v1/models') {
      // The miner role's own key, and a key whose token new-api limits to the upstream model's name.
      if (auth === 'Bearer good-key') return json(200, { data: [{ id: 'miner@openrouter' }] });
      if (auth === 'Bearer upstream-key') return json(200, { data: [{ id: 'nvidia/nemotron-3-ultra-550b-a55b:free' }] });
      return json(401, { error: { message: 'invalid token' } });
    }
    if (url.pathname === '/google/token') {
      const form = new URLSearchParams(text);
      if (form.get('client_id') === 'unauthorized.apps.googleusercontent.com') return json(400, { error: 'unauthorized_client', error_description: 'Unauthorized' });
      if (form.get('client_id') !== 'client.apps.googleusercontent.com' || form.get('client_secret') !== 'good-secret') return json(401, { error: 'invalid_client' });
      if (form.get('grant_type') === 'refresh_token') {
        return form.get('refresh_token') === 'good-refresh' ? json(200, { access_token: 'good-access', scope: GMAIL_SCOPE }) : json(400, { error: 'invalid_grant' });
      }
      // A code from a consent is good once its verifier matches the challenge Google was shown.
      const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
      if (form.get('code') === 'good-code' && [...consents.values()].includes(challenge)) return json(200, { refresh_token: 'good-refresh', scope: GMAIL_SCOPE });
      return json(400, { error: 'invalid_grant' });
    }
    if (url.pathname === '/gmail/profile') return auth === 'Bearer good-access' ? json(200, { emailAddress: 'signup@example.com' }) : json(401, {});
    if (url.pathname.startsWith('/hc/') && req.method === 'POST') {
      res.writeHead(url.pathname === '/hc/good-uuid/log' ? 200 : 404);
      return res.end(url.pathname === '/hc/good-uuid/log' ? 'OK' : 'not found');
    }
    json(404, {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // The Personal database: a bare repo with one commit on main, behind the fake GitHub, and the bot's checkout of it.
  const github = join(root, 'github');
  mkdirSync(github);
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Person', GIT_AUTHOR_EMAIL: 'p@example.com', GIT_COMMITTER_NAME: 'Person', GIT_COMMITTER_EMAIL: 'p@example.com' } });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  };
  git(github, 'init', '-q', '--bare', '-b', 'main', 'repo.git');
  const checkout = join(root, 'var/lib/assistant/personal-database');
  mkdirSync(checkout, { recursive: true });
  git(checkout, 'init', '-q', '-b', 'main');
  git(checkout, 'remote', 'add', 'origin', 'git@github.com:person/personal-database.git');
  writeFileSync(join(checkout, 'README.md'), 'Personal database\n');
  git(checkout, 'add', '.');
  git(checkout, 'commit', '-q', '-m', 'First');
  git(checkout, 'push', '-q', join(github, 'repo.git'), 'main');

  const config = JSON.parse(readFileSync(join(REPO, 'config/assistant.json'), 'utf8')) as Record<string, Record<string, unknown>>;
  config.discord!.apiBaseUrl = `${base}/discord`;
  config.productHunt!.apiUrl = `${base}/producthunt`;
  config.gateway!.baseUrl = `${base}/newapi/v1`;
  config.personalDatabase = { ...config.personalDatabase, dir: checkout, ssh: [process.execPath, join(REPO, 'ops/test/fake-github.ts'), github] };
  writeFileSync(join(root, 'assistant.json'), JSON.stringify(config));

  return {
    root,
    credentials,
    checkout,
    github,
    consents,
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      OPS_ROOT: root,
      ASSISTANT_CONFIG: join(root, 'assistant.json'),
      OPS_ENDPOINTS: JSON.stringify({ googleAuth: `${base}/google/auth`, googleToken: `${base}/google/token`, gmail: `${base}/gmail` }),
    },
    systemctl: () => (existsSync(join(root, 'systemctl.log')) ? readFileSync(join(root, 'systemctl.log'), 'utf8') : ''),
    put: (name, value) => writeFileSync(join(credentials, name), value, { mode: 0o600 }),
  };
}

interface Ran {
  code: number | null;
  out: string;
}

/**
 * Runs ops/token with `args`, typing each of `typed` once the output so far matches its prompt. A function in `typed`
 * reads the output so far and returns what to type.
 */
function opsToken(machine: Vm, args: string[], typed: { after: RegExp; type: string | ((out: string) => string) }[] = []): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(OPS_TOKEN, args, { env: machine.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let next = 0;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`ops/token ${args.join(' ')} did not finish:\n${out}`));
    }, 45_000);
    const onOutput = (chunk: Buffer) => {
      out += chunk.toString('utf8');
      while (next < typed.length && typed[next]!.after.test(out)) {
        const { type } = typed[next++]!;
        child.stdin.write(`${typeof type === 'function' ? type(out) : type}\n`);
      }
      if (next === typed.length) child.stdin.end();
    };
    child.stdout.on('data', onOutput);
    child.stderr.on('data', onOutput);
    if (typed.length === 0) child.stdin.end();
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

const mode = (path: string) => statSync(path).mode & 0o777;
const placeBotTokensBut = (machine: Vm, but: string) => BOT_TOKENS.filter((name) => name !== but).forEach((name) => machine.put(name, `old-${name}`));

test('a token is checked, written for root alone, and its service restarted once all its tokens are in place', async (t) => {
  const machine = await vm(t);
  placeBotTokensBut(machine, 'discord-bot-token');
  const ran = await opsToken(machine, ['discord-bot-token'], [{ after: /Paste/, type: 'good-discord' }]);
  assert.equal(ran.code, 0, ran.out);
  assert.match(ran.out, /It works: Discord knows it as the bot lab1-assistant/);
  assert.equal(readFileSync(join(machine.credentials, 'discord-bot-token'), 'utf8'), 'good-discord');
  assert.equal(mode(join(machine.credentials, 'discord-bot-token')), 0o600);
  assert.equal(machine.systemctl(), 'reset-failed assistant.service\nrestart assistant.service\n');
});

test('a value that fails its check changes nothing', async (t) => {
  const machine = await vm(t);
  placeBotTokensBut(machine, 'producthunt-token');
  machine.put('producthunt-token', 'old-but-working');
  const ran = await opsToken(machine, ['producthunt-token'], [{ after: /Paste/, type: 'mistyped' }]);
  assert.equal(ran.code, 1);
  assert.match(ran.out, /Nothing changed: Product Hunt refused it with 401/);
  assert.equal(readFileSync(join(machine.credentials, 'producthunt-token'), 'utf8'), 'old-but-working');
  assert.equal(machine.systemctl(), '');
});

// On #54, Bitwarden's 400 said why in its body and ops/token showed only the status, so a script had to go and read it,
// and that script printed a session key into an agent's session.
test("a refusal gives the service's own reason, from the fields that hold one and no others", async (t) => {
  const machine = await vm(t);
  const flat = await opsToken(machine, ['discord-bot-token'], [{ after: /Paste/, type: 'no-header' }]);
  assert.equal(flat.code, 1);
  assert.match(flat.out, /Nothing changed: Discord answered with 400: version_header_missing; No client version header found\.$/m);
  assert.doesNotMatch(flat.out, /a-field-nothing-names/);

  const nested = await opsToken(machine, ['newapi-key-miner'], [{ after: /Paste/, type: 'revoked' }]);
  assert.match(nested.out, /Nothing changed: new-api refused it with 401: invalid token\.$/m);

  // Google's check has already read the body, to tell a good client from a bad one.
  const client = JSON.stringify({ installed: { client_id: 'unauthorized.apps.googleusercontent.com', client_secret: 'any' } });
  const read = await opsToken(machine, ['gmail-client-secret'], [{ after: /Paste/, type: client }]);
  assert.match(read.out, /Nothing changed: Google answered with 400: unauthorized_client; Unauthorized\.$/m);

  const long = await opsToken(machine, ['discord-bot-token'], [{ after: /Paste/, type: 'long-reason' }]);
  assert.match(long.out, /Nothing changed: Discord answered with 400: line one x+…\.$/m);
  assert.ok(long.out.length < 500, `a reason is cut short:\n${long.out}`);

  // A body that isn't JSON names no field, so the status stands alone.
  const base = JSON.parse(machine.env.OPS_ENDPOINTS!).googleToken.replace('/google/token', '');
  const plain = await opsToken(machine, ['healthchecks-ping-bot'], [{ after: /Paste/, type: `${base}/hc/unknown` }]);
  assert.match(plain.out, /Nothing changed: healthchecks\.io answered with 404\.$/m);
});

test("the bot isn't started while another of its tokens is missing, and the person is told which", async (t) => {
  const machine = await vm(t);
  const ran = await opsToken(machine, ['newapi-key-miner'], [{ after: /Paste/, type: 'good-key' }]);
  assert.equal(ran.code, 0, ran.out);
  assert.match(ran.out, /new-api lets it reach miner@openrouter/);
  assert.match(ran.out, /assistant\.service waits on: discord-bot-token, producthunt-token, newapi-key-registration, personal-database-deploy-key, healthchecks-ping-bot, bitwarden-api-key, bitwarden-master-password\./);
  assert.equal(machine.systemctl(), '');
});

test('a pasted value never shows on the terminal', { skip: spawnSync('sh', ['-c', 'command -v script'], { timeout: 5000 }).status !== 0 && 'needs script(1)' }, async (t) => {
  const machine = await vm(t);
  // script(1) gives ops/token a terminal of its own, which would echo whatever is typed unless echo is off.
  const child = spawn('script', ['-qfec', `${OPS_TOKEN} discord-bot-token`, '/dev/null'], { env: machine.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  const finished = new Promise<number | null>((resolve) => child.once('close', resolve));
  child.stdout.on('data', (chunk: Buffer) => {
    out += chunk.toString('utf8');
    if (/Paste/.test(out) && !child.stdin.writableEnded) child.stdin.end('good-discord\r');
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
  assert.equal(await finished, 0, out);
  clearTimeout(timer);
  assert.match(out, /It works/);
  assert.ok(!out.includes('good-discord'), `the token showed:\n${out}`);
});

// The forwarder asks new-api for <role>@<provider> (ADR 0011). At #85's go-live both role tokens were limited to the
// upstream model's name, and the registration role's slot held the miner key; each check passed, and every run failed.
test("a role's key is refused unless new-api lets it reach each model name the role asks for", async (t) => {
  const machine = await vm(t);
  const upstream = await opsToken(machine, ['newapi-key-miner'], [{ after: /Paste/, type: 'upstream-key' }]);
  assert.equal(upstream.code, 1, upstream.out);
  assert.match(upstream.out, /Nothing changed: new-api doesn't let it reach miner@openrouter, which the miner role asks for/);
  const another = await opsToken(machine, ['newapi-key-registration'], [{ after: /Paste/, type: 'good-key' }]);
  assert.equal(another.code, 1, another.out);
  assert.match(another.out, /Nothing changed: new-api doesn't let it reach registration@openrouter, which the registration role asks for/);
  assert.ok(!existsSync(join(machine.credentials, 'newapi-key-miner')));
  assert.ok(!existsSync(join(machine.credentials, 'newapi-key-registration')));
  assert.equal(machine.systemctl(), '');
});

test('the check mode reports each token in place, and fails while one is dead', async (t) => {
  const machine = await vm(t);
  machine.put('discord-bot-token', 'good-discord');
  machine.put('newapi-key-registration', 'revoked');
  machine.put('healthchecks-ping-bot', `${JSON.parse(machine.env.OPS_ENDPOINTS!).googleToken.replace('/google/token', '')}/hc/good-uuid`);
  const ran = await opsToken(machine, ['--check']);
  assert.equal(ran.code, 1);
  assert.match(ran.out, /^discord-bot-token: works \(Discord knows it as the bot lab1-assistant\)$/m);
  assert.match(ran.out, /^newapi-key-registration: DEAD \(new-api refused it with 401: invalid token\); replace it with ops\/token newapi-key-registration$/m);
  assert.match(ran.out, /^healthchecks-ping-bot: works \(healthchecks\.io took a log event on it\)$/m);
  assert.equal(machine.systemctl(), '');
});

test('the dry run reads and checks a value, and writes and restarts nothing', async (t) => {
  const machine = await vm(t);
  placeBotTokensBut(machine, 'discord-bot-token');
  const ran = await opsToken(machine, ['--dry-run', 'discord-bot-token'], [{ after: /Paste/, type: 'good-discord' }]);
  assert.equal(ran.code, 0, ran.out);
  assert.match(ran.out, /Would write .*discord-bot-token\.\nWould restart assistant\.service\./);
  assert.ok(!existsSync(join(machine.credentials, 'discord-bot-token')));
  assert.equal(machine.systemctl(), '');
});

test('Gmail: the client JSON, then a consent whose failed address is pasted back, gives the refresh token', async (t) => {
  const machine = await vm(t);
  const client = JSON.stringify({ installed: { client_id: 'client.apps.googleusercontent.com', client_secret: 'good-secret', redirect_uris: ['http://localhost'] } });
  const secret = await opsToken(machine, ['gmail-client-secret'], [{ after: /Paste/, type: client }]);
  assert.equal(secret.code, 0, secret.out);
  assert.match(secret.out, /Google accepts this client id and secret/);
  assert.deepEqual(JSON.parse(readFileSync(join(machine.credentials, 'gmail-client-secret'), 'utf8')), { client_id: 'client.apps.googleusercontent.com', client_secret: 'good-secret' });

  // Safari follows the link and ends at the loopback address it can't load; the person pastes that address.
  const safari = (out: string) => {
    const link = new URL(out.match(/^http\S+\/google\/auth\?\S+$/m)![0]);
    assert.equal(link.searchParams.get('scope'), 'https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.readonly');
    assert.equal(link.searchParams.get('access_type'), 'offline');
    machine.consents.set(link.searchParams.get('state')!, link.searchParams.get('code_challenge')!);
    return `http://127.0.0.1:8765/?state=${link.searchParams.get('state')}&code=good-code&scope=${encodeURIComponent(GMAIL_SCOPE)}`;
  };
  const refresh = await opsToken(machine, ['gmail-refresh-token'], [{ after: /Paste the address/, type: safari }]);
  assert.equal(refresh.code, 0, refresh.out);
  assert.match(refresh.out, /It works: it reads and drafts in signup@example\.com\./);
  assert.equal(readFileSync(join(machine.credentials, 'gmail-refresh-token'), 'utf8'), 'good-refresh');
});

test('Gmail: an address from another consent changes nothing', async (t) => {
  const machine = await vm(t);
  machine.put('gmail-client-secret', JSON.stringify({ client_id: 'client.apps.googleusercontent.com', client_secret: 'good-secret' }));
  const ran = await opsToken(machine, ['gmail-refresh-token'], [{ after: /Paste the address/, type: 'http://127.0.0.1:8765/?state=stale&code=good-code' }]);
  assert.equal(ran.code, 1);
  assert.match(ran.out, /Nothing changed: that address is from another consent/);
  assert.ok(!existsSync(join(machine.credentials, 'gmail-refresh-token')));
});

test('the deploy key is made on the VM: only its public half is shown, and it is kept once GitHub lets it in', async (t) => {
  const machine = await vm(t);
  placeBotTokensBut(machine, 'personal-database-deploy-key');
  let publicKey = '';
  const ran = await opsToken(machine, ['personal-database-deploy-key'], [
    // The first Enter comes before the key is on GitHub, which refuses it; the second once it is.
    { after: /Press Enter/, type: '' },
    {
      after: /Not yet: GitHub refused the key: git@github\.com: Permission denied \(publickey\)\.\nPress Enter/,
      type: (out) => {
        publicKey = out.match(/^ssh-ed25519 \S+ assistant@lab1 Personal database$/m)![0];
        writeFileSync(join(machine.github, 'deploy-keys'), `${publicKey}\n`);
        return '';
      },
    },
  ]);
  assert.equal(ran.code, 0, ran.out);
  assert.match(ran.out, /It works: it may push, and the repo's main is at [0-9a-f]{12}\./);
  assert.deepEqual(readdirSync(machine.credentials).filter((name) => name.startsWith('.')), [], 'no folder of its work is left');
  assert.ok(!ran.out.includes('PRIVATE KEY'), 'the private key is never shown');
  const key = readFileSync(join(machine.credentials, 'personal-database-deploy-key'), 'utf8');
  assert.match(key, /^-----BEGIN OPENSSH PRIVATE KEY-----\n[\s\S]+\n-----END OPENSSH PRIVATE KEY-----\n$/);
  assert.equal(mode(join(machine.credentials, 'personal-database-deploy-key')), 0o600);
  const derived = spawnSync('ssh-keygen', ['-y', '-f', join(machine.credentials, 'personal-database-deploy-key')], { encoding: 'utf8', timeout: 10_000 }).stdout.trim();
  assert.equal(derived.split(' ').slice(0, 2).join(' '), publicKey.split(' ').slice(0, 2).join(' '));
  assert.equal(machine.systemctl(), 'reset-failed assistant.service\nrestart assistant.service\n');
});

test('a deploy key added without write access is refused, naming the box to tick', async (t) => {
  const machine = await vm(t);
  const ran = await opsToken(machine, ['personal-database-deploy-key'], [
    {
      after: /Press Enter/,
      type: (out) => {
        writeFileSync(join(machine.github, 'deploy-keys-read-only'), `${out.match(/^ssh-ed25519 \S+ .*$/m)![0]}\n`);
        return '';
      },
    },
    ...Array.from({ length: 4 }, (_, i) => ({ after: new RegExp(`(Press Enter[\\s\\S]*){${i + 2}}`), type: '' })),
  ]);
  assert.equal(ran.code, 1);
  assert.match(ran.out, /Not yet: GitHub lets the key read but not push \(ERROR: The key you are authenticating with has been marked as read only\.\): delete it from the repo's Deploy keys and add it again with "Allow write access" ticked/);
  assert.ok(!existsSync(join(machine.credentials, 'personal-database-deploy-key')));
});

test('the deploy key in the making never leaves the credentials folder, and goes when the SSH session drops', async (t) => {
  const machine = await vm(t);
  const child = spawn(OPS_TOKEN, ['personal-database-deploy-key'], { env: machine.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
  const closed = new Promise<number | null>((resolve) => child.once('close', (code) => resolve(code)));
  const end = Date.now() + 20_000;
  while (!/Press Enter/.test(out) && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 50));
  const working = readdirSync(machine.credentials).filter((name) => name.startsWith('.ops-token-'));
  assert.equal(working.length, 1, `the key is made in the credentials folder: ${out}`);
  assert.ok(existsSync(join(machine.credentials, working[0]!, 'key')));
  child.kill('SIGHUP');
  assert.equal(await closed, 129);
  assert.deepEqual(readdirSync(machine.credentials), []);
});

test('a GitHub that stops answering ends the check, with whatever ssh started', async (t) => {
  const machine = await vm(t);
  machine.put('personal-database-deploy-key', 'not checked by GitHub');
  // An ssh that hangs, as on a stalled connection, holding git's pipes through a child of its own. It answers git's
  // `-G` question at once, as fake-github.ts does, so the hang comes in the fetch itself.
  const hang = join(machine.root, 'bin/hanging-ssh');
  writeFileSync(hang, '#!/bin/sh\ncase " $* " in *" -G "*) exit 255 ;; esac\nsleep 300 &\nwait\n');
  chmodSync(hang, 0o755);
  const config = JSON.parse(readFileSync(machine.env.ASSISTANT_CONFIG!, 'utf8'));
  config.personalDatabase.ssh = [hang];
  writeFileSync(machine.env.ASSISTANT_CONFIG!, JSON.stringify(config));
  const started = Date.now();
  const ran = await opsToken({ ...machine, env: { ...machine.env, OPS_COMMAND_TIMEOUT_MS: '2000' } }, ['--check', 'personal-database-deploy-key']);
  assert.ok(Date.now() - started < 15_000, `took ${Date.now() - started} ms`);
  assert.equal(ran.code, 1);
  assert.match(ran.out, /personal-database-deploy-key: DEAD \(GitHub refused the key: killed after 2 seconds\)/);
});

test('a deploy key GitHub keeps refusing changes nothing', async (t) => {
  const machine = await vm(t);
  const ran = await opsToken(
    machine,
    ['personal-database-deploy-key'],
    Array.from({ length: 5 }, (_, i) => ({ after: new RegExp(`(Press Enter[\\s\\S]*){${i + 1}}`), type: '' })),
  );
  assert.equal(ran.code, 1);
  assert.match(ran.out, /Nothing changed: GitHub still refuses the key/);
  assert.ok(!existsSync(join(machine.credentials, 'personal-database-deploy-key')));
});

test('a ping URL only the backup reads restarts nothing', async (t) => {
  const machine = await vm(t);
  const hc = JSON.parse(machine.env.OPS_ENDPOINTS!).googleToken.replace('/google/token', '/hc/good-uuid');
  const ran = await opsToken(machine, ['healthchecks-ping-backup'], [{ after: /Paste/, type: hc }]);
  assert.equal(ran.code, 0, ran.out);
  assert.match(ran.out, /No service to restart: the nightly backup and its alert reads it at the next run\./);
  assert.equal(machine.systemctl(), '');
});

/** A `bw` at the path `ops/install` gives it, answering as @bitwarden/cli 2026.10.0 does (`bot/test/harness/fake-bw.ts`). */
function placeBw(machine: Vm, collections: string[] = ['Registrations']): void {
  const bin = join(machine.root, 'opt/assistant/bw/node_modules/.bin');
  mkdirSync(bin, { recursive: true });
  const listed = JSON.stringify(collections.map((name, i) => ({ object: 'collection', id: `collection-${i}`, organizationId: 'organization', name })));
  writeFileSync(
    join(bin, 'bw'),
    `#!/bin/sh
echo "$* data=$BITWARDENCLI_APPDATA_DIR session=$BW_SESSION" >> "$OPS_ROOT/bw.log"
case "$1" in
  login)
    # Every run on a new data folder says this first, as the trial on #54 saw.
    echo "Could not find data file, \\"$BITWARDENCLI_APPDATA_DIR/data.json\\"; creating it instead." >&2
    case "$BW_CLIENTSECRET" in
      # A login that never ends, as the real one does on a port that doesn't answer (#54's review tried it), having said
      # something else first, and one that fails saying nothing.
      hangs) echo 'a warning before it hangs' >&2; echo $$ > "$OPS_ROOT/bw.pid"; exec sleep 60 ;;
      silent) exit 1 ;;
    esac
    [ "$BW_CLIENTID" = user.0b1c2d3e-0000-4000-8000-000000000001 ] && [ "$BW_CLIENTSECRET" = good-bw ] || { echo 'client_id or client_secret is incorrect. Try again.' >&2; exit 1; }
    # With --nointeraction its message holds a session key, as the trial on #54 saw.
    echo 'You are logged in! ex: $ bw list items --session the-login-key' ;;
  unlock) [ "$BW_PASSWORD" = good-master ] || { echo 'Invalid master password.' >&2; exit 1; }; printf 'the-session-key' ;;
  sync)
    [ ! -e "$OPS_ROOT/bw-cant-sync" ] || { echo 'Syncing failed: connect ECONNREFUSED' >&2; exit 1; }
    echo 'Syncing complete.' ;;
  list)
    [ ! -e "$OPS_ROOT/bw-cant-list" ] || { echo 'Vault is locked.' >&2; exit 1; }
    printf '%s' '${listed}' ;;
  logout) echo 'You have logged out.' ;;
  *) echo "Invalid command: $*" >&2; exit 1 ;;
esac
`,
    { mode: 0o755 },
  );
}

const placeApiKey = (machine: Vm) => machine.put('bitwarden-api-key', JSON.stringify({ client_id: 'user.0b1c2d3e-0000-4000-8000-000000000001', client_secret: 'good-bw' }));

const typeApiKey = (secret: string) => [
  { after: /client_id/, type: 'user.0b1c2d3e-0000-4000-8000-000000000001' },
  { after: /client_secret/, type: secret },
];

test('Bitwarden: the API key is checked as the bot will use it, by bw logging in, in a throwaway data folder', async (t) => {
  const machine = await vm(t);
  placeBw(machine);

  const refused = await opsToken(machine, ['bitwarden-api-key'], typeApiKey('wrong'));
  assert.equal(refused.code, 1);
  assert.match(refused.out, /Nothing changed: bw can't log in with the API key: client_id or client_secret is incorrect\. Try again\./);
  assert.doesNotMatch(refused.out, /Could not find/, 'only the line that says why');
  assert.ok(!existsSync(join(machine.credentials, 'bitwarden-api-key')));

  const placed = await opsToken(machine, ['bitwarden-api-key'], typeApiKey('good-bw'));
  assert.equal(placed.code, 0, placed.out);
  assert.match(placed.out, /bw logs in with it/);
  assert.ok(!placed.out.includes('the-login-key'), "what bw's login prints isn't shown");

  const log = readFileSync(join(machine.root, 'bw.log'), 'utf8');
  assert.deepEqual(log.split('\n').slice(-3, -1).map((line) => line.split(' data=')[0]), ['login --apikey --nointeraction', 'logout --nointeraction']);
  assert.ok(!log.includes('good-bw'), 'no Secret on a command line');
  assert.deepEqual(readdirSync(machine.credentials).filter((name) => name.startsWith('.')), [], 'no data folder is left');
});

test('Bitwarden: neither token can be checked without the bw that ops/install puts in place', async (t) => {
  const machine = await vm(t);
  const key = await opsToken(machine, ['bitwarden-api-key'], typeApiKey('good-bw'));
  assert.equal(key.code, 1);
  assert.match(key.out, /Nothing changed: bw isn't installed on the VM, so this token can't be checked: run ops\/install/);

  placeApiKey(machine);
  const password = await opsToken(machine, ['bitwarden-master-password'], [{ after: /Paste/, type: 'good-master' }]);
  assert.equal(password.code, 1);
  assert.match(password.out, /Nothing changed: bw isn't installed on the VM, so this token can't be checked: run ops\/install/);
});

test('Bitwarden: the master password is checked as the bot will use it, in a throwaway data folder', async (t) => {
  const machine = await vm(t);
  placeApiKey(machine);
  placeBw(machine);

  const refused = await opsToken(machine, ['bitwarden-master-password'], [{ after: /Paste/, type: 'wrong' }]);
  assert.equal(refused.code, 1);
  assert.match(refused.out, /Nothing changed: bw refuses this master password/);
  assert.ok(!existsSync(join(machine.credentials, 'bitwarden-master-password')));

  const placed = await opsToken(machine, ['bitwarden-master-password'], [{ after: /Paste/, type: 'good-master' }]);
  assert.equal(placed.code, 0, placed.out);
  assert.match(placed.out, /bw unlocks with it, and the bot's account sees only Registrations/);
  assert.ok(!placed.out.includes('the-login-key') && !placed.out.includes('the-session-key'), "what bw's login and unlock print isn't shown");
  assert.equal(readFileSync(join(machine.credentials, 'bitwarden-master-password'), 'utf8'), 'good-master');

  const log = readFileSync(join(machine.root, 'bw.log'), 'utf8');
  assert.deepEqual(log.split('\n').slice(-6, -1).map((line) => line.split(' data=')[0]), ['login --apikey --nointeraction', 'unlock --passwordenv BW_PASSWORD --raw --nointeraction', 'sync --nointeraction', 'list collections --nointeraction', 'logout --nointeraction']);
  assert.match(log.split('\n').at(-3)!, /session=the-session-key$/, 'what it asks is what the bot asks, with the session key');
  assert.ok(!log.includes('good-master') && !log.includes('good-bw'), 'no Secret on a command line');
  assert.deepEqual(readdirSync(machine.credentials).filter((name) => name.startsWith('.')), [], 'no data folder is left');
});

test('Bitwarden: an account that sees more than the Registrations collection is refused, since the bot would hold every Approval', async (t) => {
  const machine = await vm(t);
  placeApiKey(machine);
  placeBw(machine, ['Registrations', 'Everything']);
  const ran = await opsToken(machine, ['bitwarden-master-password'], [{ after: /Paste/, type: 'good-master' }]);
  assert.equal(ran.code, 1);
  assert.match(ran.out, /Nothing changed: the bot's account sees 2 collections, and should see only Registrations/);
  assert.ok(!existsSync(join(machine.credentials, 'bitwarden-master-password')));
});

test("Bitwarden: a sync or a list that fails gives bw's reason, and nothing bw printed before it", async (t) => {
  const machine = await vm(t);
  placeApiKey(machine);
  placeBw(machine);
  for (const [marker, said] of [
    ['bw-cant-sync', /Nothing changed: bw can't sync: Syncing failed: connect ECONNREFUSED\.$/m],
    ['bw-cant-list', /Nothing changed: bw can't list the account's collections: Vault is locked\.$/m],
  ] as const) {
    writeFileSync(join(machine.root, marker), '');
    const ran = await opsToken(machine, ['bitwarden-master-password'], [{ after: /Paste/, type: 'good-master' }]);
    rmSync(join(machine.root, marker));
    assert.equal(ran.code, 1, ran.out);
    assert.match(ran.out, said);
    assert.ok(!ran.out.includes('the-login-key') && !ran.out.includes('the-session-key'), `a key showed:\n${ran.out}`);
  }
});

test('Bitwarden: a bw that hangs or says nothing is reported as that, not by its line about the data folder', async (t) => {
  const machine = await vm(t);
  placeBw(machine);
  const quick = { ...machine, env: { ...machine.env, OPS_COMMAND_TIMEOUT_MS: '500' } };
  const hung = await opsToken(quick, ['bitwarden-api-key'], typeApiKey('hangs'));
  assert.equal(hung.code, 1, hung.out);
  assert.match(hung.out, /Nothing changed: bw can't log in with the API key: killed after 0\.5 seconds\.$/m);

  const silent = await opsToken(machine, ['bitwarden-api-key'], typeApiKey('silent'));
  assert.equal(silent.code, 1, silent.out);
  assert.match(silent.out, /Nothing changed: bw can't log in with the API key: it said nothing\.$/m);
});

test('Bitwarden: stopping ops/token stops the bw it started, which holds a Secret in its environment, and removes its data folder', async (t) => {
  const machine = await vm(t);
  placeBw(machine);
  const child = spawn(OPS_TOKEN, ['bitwarden-api-key'], { env: machine.env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end('user.0b1c2d3e-0000-4000-8000-000000000001\nhangs\n');
  const closed = new Promise<number | null>((resolve) => child.once('close', (code) => resolve(code)));
  const pause = () => new Promise((resolve) => setTimeout(resolve, 50));
  const pidFile = join(machine.root, 'bw.pid');
  const started = Date.now() + 20_000;
  while (!existsSync(pidFile) && Date.now() < started) await pause();
  const pid = Number(readFileSync(pidFile, 'utf8'));
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  t.after(() => {
    if (alive()) process.kill(pid, 'SIGKILL');
  });
  child.kill('SIGTERM');
  assert.equal(await closed, 143);
  const gone = Date.now() + 5_000;
  while (alive() && Date.now() < gone) await pause();
  assert.ok(!alive(), 'bw runs on, with the API key in its environment');
  assert.deepEqual(readdirSync(machine.credentials).filter((name) => name.startsWith('.')), [], 'no data folder is left');
});

test('what a check says never holds the value it was given', async (t) => {
  const machine = await vm(t);
  const echoed = await opsToken(machine, ['discord-bot-token'], [{ after: /Paste/, type: 'echoed-value' }]);
  assert.match(echoed.out, /Nothing changed: Discord refused it with 401: no such token: <the value>\.$/m);
  assert.doesNotMatch(echoed.out, /echoed-value/);
  machine.put('discord-bot-token', 'echoed-value');
  const inPlace = await opsToken(machine, ['--check', 'discord-bot-token']);
  assert.match(inPlace.out, /^discord-bot-token: DEAD \(Discord refused it with 401: no such token: <the value>\)/m);
  assert.doesNotMatch(inPlace.out, /echoed-value/);

  // Node refuses to hand on a value holding a NUL, and quotes the value in the error it throws.
  placeBw(machine);
  const thrown = await opsToken(machine, ['bitwarden-api-key'], typeApiKey('good\0part-of-the-secret'));
  assert.match(thrown.out, /Nothing changed: the check failed: TypeError ERR_INVALID_ARG_VALUE\.$/m);
  assert.doesNotMatch(thrown.out, /part-of-the-secret/);

  // A service that can't be reached still says what kind of failure it was.
  const nobody = createServer();
  await new Promise<void>((resolve) => nobody.listen(0, '127.0.0.1', resolve));
  const { port } = nobody.address() as AddressInfo;
  await new Promise((resolve) => nobody.close(resolve));
  const down = await opsToken(machine, ['healthchecks-ping-bot'], [{ after: /Paste/, type: `http://127.0.0.1:${port}/unreachable` }]);
  assert.match(down.out, /Nothing changed: the check failed: TypeError ECONNREFUSED\.$/m);
});

test('ops/token names every token ADR 0009 lists, and the bot unit hands over each one the bot reads', async (t) => {
  const machine = await vm(t);
  const names = (await opsToken(machine, ['--list'])).out.split('\n').filter(Boolean).map((line) => line.split(':')[0]);
  assert.deepEqual(names, [
    'discord-bot-token',
    'producthunt-token',
    'newapi-key-miner',
    'newapi-key-registration',
    'newapi-key-mail',
    'newapi-key-question',
    'newapi-key-checks',
    'newapi-key-probe',
    'gmail-client-secret',
    'gmail-refresh-token',
    'bitwarden-api-key',
    'bitwarden-master-password',
    'healthchecks-ping-bot',
    'healthchecks-ping-miner',
    'healthchecks-ping-backup',
    'healthchecks-ping-weekly',
    'personal-database-deploy-key',
  ]);
  // The bot reads the tokens its `tokenFile` names from $CREDENTIALS_DIRECTORY, so the unit must hand each one over.
  const source = readFileSync(join(REPO, 'bot/src/assistant.ts'), 'utf8');
  const tokenFile = source.slice(source.indexOf('const tokenFile = {'), source.indexOf('};', source.indexOf('const tokenFile = {')));
  const read = [...tokenFile.matchAll(/'([a-z-]+)'|`([a-z-]+)\$\{role\}`/g)].flatMap((m) => (m[1] ? [m[1]] : ROLES.map((role) => `${m[2]}${role}`)));
  assert.ok(read.length >= 5, `read the bot's token names: ${read.join(', ')}`);
  const unit = readFileSync(join(REPO, 'ops/systemd/assistant.service'), 'utf8');
  const handed = [...unit.matchAll(/^LoadCredential=([^:]+):\/etc\/assistant\/credentials\/(\S+)$/gm)].map((m) => [m[1], m[2]]);
  assert.deepEqual(handed.sort(), read.map((name) => [name, name]).sort());
  for (const name of read) assert.ok(names.includes(name), name);
});

test('an unknown token name is refused', async (t) => {
  const machine = await vm(t);
  const ran = await opsToken(machine, ['openai-key']);
  assert.equal(ran.code, 2);
  assert.match(ran.out, /There is no token named openai-key/);
});
