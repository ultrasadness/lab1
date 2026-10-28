// The shell check (#71 retro): shellcheck over every shell script in the repo, the git hooks and ops/ among them, as
// the pre-commit hook and CI run it. A script is a file whose first line is a sh or bash shebang. It reads the folder it
// runs in, the repo's top or the hook's staged copy, leaving out git's own, installed dependencies, links and other
// sessions' worktrees.
//
//   node scripts/check-shell.ts
import { spawnSync } from 'node:child_process';
import { openSync, readSync, closeSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const SHEBANG = /^#!\s*(?:\/usr\/bin\/env\s+|\/usr\/bin\/|\/bin\/)(?:ba)?sh\b/;
const NOT_OURS = new Set(['.git', 'node_modules']);

/** The shell scripts under `dir`, as paths from `root`. */
function scripts(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink() || NOT_OURS.has(entry.name) || relative(root, path) === join('.claude', 'worktrees')) return [];
    if (entry.isDirectory()) return scripts(root, path);
    return entry.isFile() && SHEBANG.test(firstLine(path)) ? [relative(root, path)] : [];
  });
}

function firstLine(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(128);
    return head.subarray(0, readSync(fd, head, 0, head.length, 0)).toString('utf8').split('\n')[0]!;
  } finally {
    closeSync(fd);
  }
}

const root = process.cwd();
const found = scripts(root).sort();
if (found.length === 0) {
  console.log('There are no shell scripts to check.');
  process.exit(0);
}
const checked = spawnSync('shellcheck', found, { cwd: root, encoding: 'utf8', timeout: 60_000 });
if (checked.error) {
  const missing = (checked.error as NodeJS.ErrnoException).code === 'ENOENT';
  console.error(missing ? "shellcheck isn't installed: sudo apt-get install shellcheck" : `shellcheck didn't run: ${checked.error.message}`);
  process.exit(1);
}
process.stdout.write(checked.stdout);
process.stderr.write(checked.stderr);
if (checked.status === 0) console.log(`${found.length} shell scripts pass shellcheck.`);
process.exit(checked.status ?? 1);
