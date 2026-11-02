// The ssh git runs to reach the fake GitHub, in place of OpenSSH: `node fake-ssh.ts <state dir> <ssh args>`. It lets
// in only the deploy key, and only for the Personal database's repo, as a GitHub deploy key does. It serves that repo
// from a local bare repo, and refuses or holds every push while the test has GitHub doing so. Each connection is logged
// to the state dir, so a test can tell which key each fetch and push came with.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CONNECTIONS_FILE, HOLD_PUSHES_FILE, REFUSE_PUSHES_FILE, STATE_FILE, type FakeSshConnection, type FakeSshState } from './fake-git-remote.ts';

const [stateDir, ...args] = process.argv.slice(2);
if (!stateDir) throw new Error('usage: fake-ssh.ts <state dir> <ssh args>');
/** How long a push is held, unless something kills it first: past the bot's own limit on a git command. */
const HELD_MS = 300_000;
const state = JSON.parse(readFileSync(join(stateDir, STATE_FILE), 'utf8')) as FakeSshState;

// Git asks an ssh it doesn't know by name whether it is OpenSSH, with -G; this one isn't, so git passes it only the
// host and the command.
if (args.includes('-G')) process.exit(255);

let key: string | undefined;
const rest: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-i') key = args[++i];
  else if (args[i] === '-o' || args[i] === '-p') i++;
  else rest.push(args[i]!);
}
const [, command = ''] = rest;
const match = command.match(/^(git-upload-pack|git-receive-pack) '(.+)'$/);
if (!match) {
  process.stderr.write(`fake GitHub: no shell access, and "${command}" isn't a git command\n`);
  process.exit(1);
}
const [, service, path] = match;

const deployKey = key !== undefined && existsSync(key) && readFileSync(key, 'utf8') === state.deployKey;
const refused = service === 'git-receive-pack' && existsSync(join(stateDir, REFUSE_PUSHES_FILE));
const held = service === 'git-receive-pack' && !refused && existsSync(join(stateDir, HOLD_PUSHES_FILE));
const connection: FakeSshConnection = { service: service!, path: path!, deployKey, refused, held };
appendFileSync(join(stateDir, CONNECTIONS_FILE), `${JSON.stringify(connection)}\n`);

if (!deployKey) {
  process.stderr.write('git@github.test: Permission denied (publickey).\n');
  process.exit(255);
}
if (path !== state.repoPath) {
  process.stderr.write('ERROR: Repository not found.\n');
  process.exit(1);
}
if (refused) {
  process.stderr.write('ERROR: GitHub is refusing pushes right now.\n');
  process.exit(1);
}
if (held) {
  await delay(HELD_MS);
  process.exit(1);
}
// The far end of a real ssh never sees the client's environment, such as the GIT_DIR of the bot's checkout.
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
const served = spawnSync('git', [service!.replace(/^git-/, ''), state.bareDir], { stdio: 'inherit', env, timeout: 60_000 });
process.exit(served.status ?? 1);
