// The ssh git runs to reach a fake GitHub in the ops tests, in place of OpenSSH: `node fake-github.ts <state dir> <ssh
// args>`. As a GitHub deploy key does, it lets in only a key whose public half has been added, listed one per line in
// <state dir>/deploy-keys, or in <state dir>/deploy-keys-read-only for a key added without write access, which may
// fetch but not push. It serves the repo at <state dir>/repo.git.
import { existsSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const [stateDir, ...args] = process.argv.slice(2);
if (!stateDir) throw new Error('usage: fake-github.ts <state dir> <ssh args>');
// Git asks an ssh it doesn't know by name whether it is OpenSSH, with -G; this one isn't.
if (args.includes('-G')) process.exit(255);

let key: string | undefined;
const rest: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-i') key = args[++i];
  else if (args[i] === '-o' || args[i] === '-p') i++;
  else rest.push(args[i]!);
}
const service = (rest[1] ?? '').match(/^(git-upload-pack|git-receive-pack) '.+'$/)?.[1];
if (!service) {
  process.stderr.write('fake GitHub: no shell access\n');
  process.exit(1);
}
const publicHalf = (path: string) => spawnSync('ssh-keygen', ['-y', '-f', path], { encoding: 'utf8', timeout: 10_000 }).stdout.trim().split(' ').slice(0, 2).join(' ');
const added = (file: string) =>
  existsSync(join(stateDir, file)) ? readFileSync(join(stateDir, file), 'utf8').split('\n').map((line) => line.trim().split(' ').slice(0, 2).join(' ')) : [];
const half = key && existsSync(key) ? publicHalf(key) : undefined;
const writable = half !== undefined && added('deploy-keys').includes(half);
if (!writable && !(half !== undefined && added('deploy-keys-read-only').includes(half))) {
  process.stderr.write('git@github.com: Permission denied (publickey).\n');
  process.exit(255);
}
if (service === 'git-receive-pack' && !writable) {
  process.stderr.write('ERROR: The key you are authenticating with has been marked as read only.\n');
  process.exit(1);
}
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
if (service === 'git-upload-pack') {
  const served = spawnSync('git', ['upload-pack', join(stateDir, 'repo.git')], { stdio: 'inherit', env, timeout: 60_000 });
  process.exit(served.status ?? 1);
}
// GitHub ends a push's session, with status 1 and no output, when the client sends anything, or ends its input, before
// GitHub has sent its refs. Tried on 2026-10-28 (#85): a push of nothing written at once failed so, even for a key with
// write access, and the same push written once the refs had come passed. A real git push reads the refs first.
const pack = spawn('git', ['receive-pack', join(stateDir, 'repo.git')], { stdio: ['pipe', 'pipe', 'inherit'], env });
const killer = setTimeout(() => pack.kill(), 60_000);
let refs = Buffer.alloc(0);
let sent = false;
const abort = () => {
  pack.kill();
  process.exit(1);
};
process.stdin.on('data', (chunk: Buffer) => (sent ? pack.stdin.write(chunk) : abort()));
process.stdin.on('end', () => (sent ? pack.stdin.end() : abort()));
pack.stdout.on('data', (chunk: Buffer) => {
  if (sent) return void process.stdout.write(chunk);
  refs = Buffer.concat([refs, chunk]);
  // The refs end with a flush-pkt. They are held a moment, as GitHub's own hops hold them, so that input a client sends
  // without waiting for them comes first.
  if (refs.subarray(-4).toString() !== '0000') return;
  setTimeout(() => {
    sent = true;
    process.stdout.write(refs);
  }, 200);
});
pack.on('close', (code) => {
  clearTimeout(killer);
  process.exitCode = code ?? 1;
  process.stdin.destroy();
});
