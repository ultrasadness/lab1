// ops/install on a throwaway VM (#71): every fixed path under OPS_ROOT, and the system's commands (useradd, getent,
// systemctl, docker and the rest) fakes on PATH that keep their state under it, so a second run sees what the first
// one did. Each test installs from a throwaway main checkout holding this checkout's files, whose origin/main the test
// moves as landing would. The Personal database's remote is a fake GitHub that lets in only the deploy keys added.
import { test, before, after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..');
const NODE_DIR = `opt/assistant/node-v24.22.0-linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}`;
const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Person', GIT_AUTHOR_EMAIL: 'p@example.com', GIT_COMMITTER_NAME: 'Person', GIT_COMMITTER_EMAIL: 'p@example.com' };

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60_000, env: { ...process.env, ...GIT_ENV } });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** The fakes, each keeping its state in $OPS_ROOT/fake. */
const FAKES: Record<string, string> = {
  useradd: `echo assistant > "$F/passwd"; echo assistant > "$F/groups"`,
  getent: `case "$1 $2" in
  "passwd assistant") [ -f "$F/passwd" ] && echo "assistant:x:998:998::/var/lib/assistant:/usr/sbin/nologin" ;;
  "group assistant") [ -f "$F/passwd" ] && echo "assistant:x:998:" ;;
  *) exit 2 ;;
esac`,
  id: `[ "$1" = -nG ] || exec /usr/bin/id "$@"; tr '\\n' ' ' < "$F/groups"; echo`,
  gpasswd: `grep -vx "$3" "$F/groups" > "$F/groups.new"; mv "$F/groups.new" "$F/groups"`,
  sudo: `if [ -f "$F/sudoers" ]; then echo "User assistant may run the following commands"; else echo "User assistant is not allowed to run sudo on vm."; fi`,
  'apt-get': `echo "apt-get $*" >> "$F/log"; case "$*" in *install*) printf '#!/bin/sh\\n' > "$(dirname "$0")/sqlite3"; chmod +x "$(dirname "$0")/sqlite3" ;; esac`,
  systemctl: `echo "systemctl $*" >> "$F/log"
case $1 in
  is-enabled) grep -qx "$2" "$F/enabled" 2>/dev/null && echo enabled || { echo disabled; exit 1; } ;;
  enable) echo "$3" >> "$F/enabled" ;;
  is-active) grep -qx "$3" "$F/active" 2>/dev/null ;;
  start|restart) echo "$2" >> "$F/active" ;;
esac`,
  'systemd-tmpfiles': `echo "systemd-tmpfiles $*" >> "$F/log"
dir=$(awk '{ print $2 }' "$2"); mkdir -p "$OPS_ROOT$dir"; chmod 2770 "$OPS_ROOT$dir"; printf '%s\\t%s\\n' "$OPS_ROOT$dir" assistant:assistant >> "$OPS_ROOT/owners"`,
  docker: `case "$*" in
  *" ps "*) cat "$F/running" 2>/dev/null ;;
  *" up "*) echo "docker $* BROWSER_SOCKET_DIR=$BROWSER_SOCKET_DIR BROWSER_SOCKET_GID=$BROWSER_SOCKET_GID BROWSER_SECCOMP_PROFILE=$BROWSER_SECCOMP_PROFILE" >> "$F/log"; printf 'browser\\npi\\n' > "$F/running" ;;
  *) echo "docker $*" >> "$F/log" ;;
esac`,
  curl: `[ ! -f "$F/newapi-down" ]`,
};

let template: string;

// One copy of this checkout's files, committed, that each test clones as its main checkout.
before(() => {
  template = mkdtempSync(join(tmpdir(), 'ops-install-template-'));
  const files = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: REPO, encoding: 'utf8', timeout: 60_000 })
    .stdout.split('\0')
    .filter((file) => file && existsSync(join(REPO, file)));
  for (const file of files) {
    mkdirSync(dirname(join(template, file)), { recursive: true });
    cpSync(join(REPO, file), join(template, file));
  }
  git(template, 'init', '-q', '-b', 'main');
  git(template, 'add', '-A');
  git(template, 'commit', '-q', '-m', 'lab1');
});
after(() => rmSync(template, { recursive: true, force: true }));

interface Vm {
  root: string;
  /** The main checkout ops/install runs from. */
  source: string;
  github: string;
  log(): string;
  /** Lands what the main checkout's main holds: origin/main moves to it. */
  land(): string;
  /** Changes the main checkout's config and commits it. */
  configure(change: (config: Record<string, any>) => void): void;
}

async function vm(t: TestContext): Promise<Vm> {
  const root = mkdtempSync(join(tmpdir(), 'ops-install-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'home/ubuntu/lab1');
  mkdirSync(dirname(source), { recursive: true });
  git(root, 'clone', '-q', template, source);
  chmodSync(join(root, 'home/ubuntu'), 0o750);
  mkdirSync(join(root, 'fake'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  for (const [name, body] of Object.entries(FAKES)) {
    writeFileSync(join(bin, name), `#!/bin/sh\nF="$OPS_ROOT/fake"\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  // Node is already in place, so no test downloads it.
  mkdirSync(join(root, NODE_DIR, 'bin'), { recursive: true });
  symlinkSync(process.execPath, join(root, NODE_DIR, 'bin/node'));

  const github = join(root, 'github');
  mkdirSync(github);
  git(github, 'init', '-q', '--bare', '-b', 'main', 'repo.git');
  const seed = join(root, 'seed');
  git(root, 'init', '-q', '-b', 'main', seed);
  writeFileSync(join(seed, 'README.md'), 'Personal database\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'First');
  git(seed, 'push', '-q', join(github, 'repo.git'), 'main');

  const machine: Vm = {
    root,
    source,
    github,
    log: () => (existsSync(join(root, 'fake/log')) ? readFileSync(join(root, 'fake/log'), 'utf8') : ''),
    land: () => {
      git(source, 'update-ref', 'refs/remotes/origin/main', 'refs/heads/main');
      return git(source, 'rev-parse', 'main');
    },
    configure: (change) => {
      const path = join(source, 'config/assistant.json');
      const config = JSON.parse(readFileSync(path, 'utf8'));
      change(config);
      writeFileSync(path, JSON.stringify(config, null, 2));
      git(source, 'commit', '-q', '-am', 'Configure');
    },
  };
  machine.configure((config) => {
    config.personalDatabase.ssh = [process.execPath, join(REPO, 'ops/test/fake-github.ts'), github];
  });
  machine.land();
  return machine;
}

interface Ran {
  code: number | null;
  out: string;
}

function install(machine: Vm, ...args: string[]): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(join(machine.source, 'ops/install'), args, {
      env: { ...process.env, ...GIT_ENV, PATH: `${join(machine.root, 'bin')}:${process.env.PATH}`, OPS_ROOT: machine.root },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`ops/install ${args.join(' ')} did not finish:\n${out}`));
    }, 50_000);
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

const mode = (path: string) => (statSync(path).mode & 0o7777).toString(8);
/** The owner ops/install last gave a path, as the fakes record it. */
const owner = (machine: Vm, path: string) =>
  readFileSync(join(machine.root, 'owners'), 'utf8')
    .split('\n')
    .filter((line) => line.startsWith(`${join(machine.root, path)}\t`))
    .at(-1)
    ?.split('\t')[1];

/** A deploy key in the credentials, added to the fake GitHub. */
function deployKey(machine: Vm): void {
  const key = join(machine.root, 'etc/assistant/credentials/personal-database-deploy-key');
  assert.equal(spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key], { timeout: 30_000 }).status, 0);
  writeFileSync(join(machine.github, 'deploy-keys'), readFileSync(`${key}.pub`));
}

/** A config the bot can start with. */
function usable(config: Record<string, any>): void {
  for (const id of ['personUserId', 'minerDaysForumId', 'productsForumId', 'statusChannelId', 'needsYouChannelId']) config.discord[id] = '123456789012345678';
  for (const role of ['miner', 'registration']) config.roles[role].providers[0].model = 'openai/gpt-6.1-sol';
}

test('a first install puts everything in place, and a second changes nothing', async (t) => {
  const machine = await vm(t);
  const first = await install(machine);
  assert.equal(first.code, 0, first.out);
  const main = git(machine.source, 'rev-parse', 'main');
  assert.equal(git(join(machine.root, 'opt/assistant/lab1'), 'rev-parse', 'HEAD'), main);
  assert.match(first.out, new RegExp(`The bot runs lab1 at ${main.slice(0, 7)}`));

  for (const [path, who, bits] of [
    ['var/lib/assistant', 'assistant:assistant', '700'],
    ['var/lib/assistant/.ssh', 'assistant:assistant', '700'],
    ['etc/assistant/credentials', 'root:root', '700'],
    ['var/backups/assistant', 'root:root', '700'],
    ['run/lab1-browser', 'assistant:assistant', '2770'],
  ] as const) {
    assert.equal(owner(machine, path), who, path);
    assert.equal(mode(join(machine.root, path)), bits, path);
  }
  assert.equal(readFileSync(join(machine.root, 'var/lib/assistant/.ssh/known_hosts'), 'utf8'), readFileSync(join(REPO, 'ops/github-known-hosts'), 'utf8'));
  for (const unit of readdirSync(join(REPO, 'ops/systemd'))) {
    assert.equal(readFileSync(join(machine.root, 'etc/systemd/system', unit), 'utf8'), readFileSync(join(REPO, 'ops/systemd', unit), 'utf8'), unit);
  }
  assert.equal(readFileSync(join(machine.root, 'etc/tmpfiles.d/assistant.conf'), 'utf8'), 'd /run/lab1-browser 2770 assistant assistant -\n');
  assert.equal(readFileSync(join(machine.root, 'etc/claude-code/managed-settings.d/assistant.json'), 'utf8'), readFileSync(join(REPO, 'ops/coding-sessions/claude-code.json'), 'utf8'));
  assert.equal(readFileSync(join(machine.root, 'etc/codex/requirements.toml'), 'utf8'), readFileSync(join(REPO, 'ops/coding-sessions/codex-requirements.toml'), 'utf8'));

  const log = machine.log();
  for (const unit of ['assistant-firewall.service', 'assistant-docker.socket', 'assistant-backup.timer', 'assistant.service']) assert.match(log, new RegExp(`^systemctl enable --quiet ${unit}$`, 'm'));
  for (const unit of ['assistant-docker.socket', 'assistant-backup.timer', 'assistant-firewall.service']) assert.match(log, new RegExp(`^systemctl start ${unit}$`, 'm'));
  // The firewall is in before the browser's container starts.
  assert.ok(log.indexOf('systemctl start assistant-firewall.service') < log.indexOf(' up --detach'), log);
  assert.match(
    log,
    new RegExp(
      `^docker compose --project-name lab1 --file ${machine.root}/opt/assistant/lab1/compose.yaml up --detach --build --quiet-pull ` +
        `BROWSER_SOCKET_DIR=/run/lab1-browser BROWSER_SOCKET_GID=998 BROWSER_SECCOMP_PROFILE=${machine.root}/opt/assistant/lab1/browser/seccomp_profile.json$`,
      'm',
    ),
  );
  // Without its tokens and config, the bot isn't started, and the person hears what it waits on.
  assert.doesNotMatch(log, /systemctl (re)?start assistant\.service/);
  assert.match(first.out, /The bot waits on:\n  - the Personal database's checkout: run ops\/install --personal-database/);
  assert.match(first.out, /^ {2}- config\/assistant\.json: discord\.personUserId must be the person's Discord user id$/m);
  assert.match(first.out, /^ {2}- discord-bot-token: ops\/token discord-bot-token$/m);
  // The alerts' ping URLs aren't the bot's to start with, but without them its alert can't go out.
  assert.match(first.out, /^The alerts, when the bot or the backup gives up, wait on:\n {2}- healthchecks-ping-backup: ops\/token healthchecks-ping-backup\n {2}- healthchecks-ping-bot: ops\/token healthchecks-ping-bot$/m);

  const second = await install(machine);
  assert.equal(second.code, 0, second.out);
  assert.match(second.out, /^Nothing to change\.$/m);
  assert.equal(machine.log().slice(log.length).match(/^(systemctl (enable|start|restart|daemon-reload)|docker compose .* up|systemd-tmpfiles|apt-get).*$/gm), null, machine.log().slice(log.length));
});

test('the dry run says what it would do, and changes nothing', async (t) => {
  const machine = await vm(t);
  const ran = await install(machine, '--dry-run');
  assert.equal(ran.code, 0, ran.out);
  assert.match(ran.out, /^Would create the assistant system user\.$/m);
  assert.match(ran.out, /^Would clone lab1 at [0-9a-f]{40} into /m);
  assert.match(ran.out, /^Would write .*\/etc\/systemd\/system\/assistant\.service\.$/m);
  assert.match(ran.out, /^Would build and start the compose project: Pi and the browser\.$/m);
  for (const path of ['opt/assistant/lab1', 'etc/assistant', 'var/lib/assistant', 'etc/systemd', 'fake/passwd']) assert.ok(!existsSync(join(machine.root, path)), path);
  assert.doesNotMatch(machine.log(), /systemctl (enable|start)|docker compose .* up/);
});

test('the assistant user keeps its own group alone, and no home is open to it', async (t) => {
  const machine = await vm(t);
  await install(machine);
  writeFileSync(join(machine.root, 'fake/groups'), 'assistant\ndocker\nsudo\nubuntu\n');
  chmodSync(join(machine.root, 'home/ubuntu'), 0o755);
  const ran = await install(machine);
  assert.equal(ran.code, 0, ran.out);
  for (const group of ['docker', 'sudo', 'ubuntu']) assert.match(ran.out, new RegExp(`^Take the assistant user out of the ${group} group\\.$`, 'm'));
  assert.equal(readFileSync(join(machine.root, 'fake/groups'), 'utf8'), 'assistant\n');
  assert.equal(mode(join(machine.root, 'home/ubuntu')), '750');
});

test('a sudo rule for the assistant user is a problem the install names', async (t) => {
  const machine = await vm(t);
  writeFileSync(join(machine.root, 'fake/sudoers'), '');
  const ran = await install(machine);
  assert.equal(ran.code, 1);
  assert.match(ran.out, /Problem: sudo lets the assistant user run something/);
});

test("the Personal database's checkout: made by a first run, checked out through the deploy key by a second", async (t) => {
  const machine = await vm(t);
  const url = 'git@github.com:person/personal-database.git';
  const first = await install(machine, '--personal-database', url);
  assert.equal(first.code, 0, first.out);
  const checkout = join(machine.root, 'var/lib/assistant/personal-database');
  assert.equal(git(checkout, 'remote', 'get-url', 'origin'), url);
  assert.match(first.out, /the Personal database's main, checked out once the deploy key is in place: ops\/token personal-database-deploy-key, then ops\/install again/);

  deployKey(machine);
  const main = git(join(machine.github, 'repo.git'), 'rev-parse', 'main');
  // The dry run fetches through the deploy key, and checks nothing out.
  const dry = await install(machine, '--dry-run');
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, new RegExp(`^GitHub lets the deploy key fetch ${url}: main is at ${main.slice(0, 12)}\\.$`, 'm'));
  assert.ok(!existsSync(join(checkout, 'README.md')));

  const second = await install(machine);
  assert.equal(second.code, 0, second.out);
  assert.equal(readFileSync(join(checkout, 'README.md'), 'utf8'), 'Personal database\n');
  assert.equal(git(checkout, 'rev-parse', 'HEAD'), main);
  assert.equal(git(checkout, 'rev-parse', '--abbrev-ref', 'main@{upstream}'), 'origin/main');
  assert.equal(owner(machine, 'var/lib/assistant/personal-database'), 'assistant:assistant');
  assert.match((await install(machine)).out, /^Nothing to change\.$/m);
});

test('a deploy key GitHub refuses leaves the checkout as it was, and says so', async (t) => {
  const machine = await vm(t);
  await install(machine, '--personal-database', 'git@github.com:person/personal-database.git');
  deployKey(machine);
  rmSync(join(machine.github, 'deploy-keys'));
  const ran = await install(machine);
  assert.equal(ran.code, 1);
  assert.match(ran.out, /Problem: GitHub refused the deploy key/);
  assert.ok(!existsSync(join(machine.root, 'var/lib/assistant/personal-database/README.md')));
});

test('the bot starts once its config and tokens are in place, and --deploy moves it to the landed main', async (t) => {
  const machine = await vm(t);
  machine.configure(usable);
  machine.land();
  await install(machine, '--personal-database', 'git@github.com:person/personal-database.git');
  deployKey(machine);
  for (const name of ['discord-bot-token', 'producthunt-token', 'newapi-key-miner', 'newapi-key-registration']) {
    writeFileSync(join(machine.root, 'etc/assistant/credentials', name), 'dummy', { mode: 0o600 });
  }
  const started = await install(machine);
  assert.equal(started.code, 0, started.out);
  assert.match(started.out, /^Start the bot\.$/m);
  assert.doesNotMatch(started.out, /The bot waits on/);
  const before = machine.log().length;

  writeFileSync(join(machine.source, 'NOTES.md'), 'A change that landed.\n');
  git(machine.source, 'add', 'NOTES.md');
  git(machine.source, 'commit', '-q', '-m', 'Land a change');
  const landed = machine.land();
  const deployed = await install(machine, '--deploy');
  assert.equal(deployed.code, 0, deployed.out);
  assert.equal(git(join(machine.root, 'opt/assistant/lab1'), 'rev-parse', 'HEAD'), landed);
  const log = machine.log().slice(before);
  assert.match(log, /^systemctl restart assistant-firewall\.service$/m);
  assert.match(log, /^docker compose .* up --detach --build/m);
  assert.match(log, /^systemctl restart assistant\.service$/m);
});

test("as root it runs only what main holds, and a dry run still tries what isn't committed", async (t) => {
  const machine = await vm(t);
  writeFileSync(join(machine.source, 'ops/backup'), '#!/bin/sh\necho changed in place\n');
  writeFileSync(join(machine.source, 'ops/new-script'), '#!/bin/sh\n');
  const ran = await install(machine);
  assert.equal(ran.code, 1);
  assert.match(ran.out, /ops\/install runs only what main holds, and in .* these differ from it:\n {2}ops\/backup\n {2}ops\/new-script\n/);
  assert.ok(!existsSync(join(machine.root, 'opt/assistant/lab1')), 'nothing was installed');
  assert.equal((await install(machine, '--dry-run')).code, 0);
});

test('a write that fails stops the install', async (t) => {
  const machine = await vm(t);
  mkdirSync(join(machine.root, 'etc'), { recursive: true });
  writeFileSync(join(machine.root, 'etc/systemd'), 'a file where the units folder goes');
  const ran = await install(machine);
  assert.notEqual(ran.code, 0);
  assert.match(ran.out, /^Write .*\/etc\/systemd\/system\/assistant-alert@\.service\.$/m);
  assert.doesNotMatch(ran.out, /The bot runs lab1/);
});

test("--deploy refuses a main that isn't origin/main yet, and changes nothing", async (t) => {
  const machine = await vm(t);
  await install(machine);
  const running = git(join(machine.root, 'opt/assistant/lab1'), 'rev-parse', 'HEAD');
  writeFileSync(join(machine.source, 'NOTES.md'), 'Not landed.\n');
  git(machine.source, 'add', 'NOTES.md');
  git(machine.source, 'commit', '-q', '-m', 'Not pushed');
  const ran = await install(machine, '--deploy');
  assert.equal(ran.code, 1);
  assert.match(ran.out, /Can't deploy: main \([0-9a-f]{40}\) isn't origin\/main/);
  assert.equal(git(join(machine.root, 'opt/assistant/lab1'), 'rev-parse', 'HEAD'), running);
});

test("a change in the bot's checkout that git didn't make is a problem the install names", async (t) => {
  const machine = await vm(t);
  await install(machine);
  writeFileSync(join(machine.root, 'opt/assistant/lab1/NOTES.md'), 'Edited in place.\n');
  git(join(machine.root, 'opt/assistant/lab1'), 'add', 'NOTES.md');
  const ran = await install(machine);
  assert.equal(ran.code, 1);
  assert.match(ran.out, /Problem: .*\/opt\/assistant\/lab1 has changes git didn't make/);
});

test("Codex requirements someone else wrote are left as they are, and named", async (t) => {
  const machine = await vm(t);
  mkdirSync(join(machine.root, 'etc/codex'), { recursive: true });
  writeFileSync(join(machine.root, 'etc/codex/requirements.toml'), 'allowed_approval_policies = ["never"]\n');
  const ran = await install(machine);
  assert.equal(ran.code, 1);
  assert.match(ran.out, /Problem: .*requirements\.toml holds requirements ops\/install didn't write/);
  assert.equal(readFileSync(join(machine.root, 'etc/codex/requirements.toml'), 'utf8'), 'allowed_approval_policies = ["never"]\n');
});

test("new-api not answering on loopback is a problem the install names", async (t) => {
  const machine = await vm(t);
  writeFileSync(join(machine.root, 'fake/newapi-down'), '');
  const ran = await install(machine);
  assert.equal(ran.code, 1);
  assert.match(ran.out, /Problem: new-api doesn't answer at http:\/\/127\.0\.0\.1:3000: publish its port on loopback/);
});

test("ops/install's changes run where set -e holds: never under ||, && or a condition", () => {
  // bash ignores set -e inside a function called under ||, && or in a condition, so a change made there carries on
  // past a failed step: in #71's first commit, a Node download whose SHA-256 didn't match would still have been
  // unpacked. The one change made in a condition, check_out_pd, chains its own steps with &&.
  const call = String.raw`(?:change|file|put_file)\b`;
  const inCondition = new RegExp(
    String.raw`(?:\|\||&&|\b(?:if|elif|while|until))\s*!?\s*${call}|(?:^|[;{(]|\bthen|\bdo)\s*${call}[^#]*(?:\|\||&&)`,
  );
  const lines = readFileSync(join(REPO, 'ops/install'), 'utf8').split('\n');
  const found = lines.flatMap((line, i) => (!/^\s*#/.test(line) && inCondition.test(line) && !/ check_out_pd; then$/.test(line) ? [`${i + 1}: ${line.trim()}`] : []));
  assert.deepEqual(found, []);
});

test('systemd reads every unit file without a complaint', { skip: spawnSync('sh', ['-c', 'command -v systemd-analyze'], { timeout: 5000 }).status !== 0 && 'needs systemd-analyze' }, async (t) => {
  // The units name the installed paths; here they name this checkout and this Node, which exist.
  const dir = mkdtempSync(join(tmpdir(), 'ops-units-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const units = readdirSync(join(REPO, 'ops/systemd'));
  for (const unit of units) {
    const text = readFileSync(join(REPO, 'ops/systemd', unit), 'utf8').replaceAll('/opt/assistant/node/bin/node', process.execPath).replaceAll('/opt/assistant/lab1', REPO);
    writeFileSync(join(dir, unit), text);
  }
  const verified = spawnSync('systemd-analyze', ['verify', ...units.map((unit) => join(dir, unit))], { encoding: 'utf8', timeout: 60_000 });
  const ours = `${verified.stdout}${verified.stderr}`.split('\n').filter((line) => /assistant/.test(line));
  assert.deepEqual(ours, []);
});
