// Lists every shell command Codex ran in a review and flags each one that reached past the repo and the review's
// folder, read the environment, used the network, reached for Docker or sudo, or tried to change something. The sandbox
// is the guarantee; this is the record of what Codex tried. A run it can read no commands from is reported as unaudited,
// since that is what a change to Codex's events would look like.
//
//   node audit.ts <out> <repo> <checkout>      writes <out>/audit.md and prints a one-line summary
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [out, repo, checkout] = process.argv.slice(2) as [string, string, string];

interface Command {
  command: string;
  exit_code: number | null;
}

/** A line it can't read counts against the audit rather than ending it: a stopped run's last line can be cut short. */
let unreadable = 0;
/**
 * Each command by its id, from either of its events: a command still running when the limit killed Codex has only the
 * started one, and a command that hangs is the likeliest reason a run reaches the limit.
 */
const byId = new Map<string, Command>();
for (const line of readFileSync(`${out}/events.jsonl`, 'utf8').split('\n').filter(Boolean)) {
  try {
    const event = JSON.parse(line) as { type?: string; item?: { id?: string; type?: string } & Partial<Command> };
    if ((event.type !== 'item.started' && event.type !== 'item.completed') || event.item?.type !== 'command_execution') continue;
    const { id, command, exit_code: exitCode } = event.item;
    if (typeof id === 'string' && typeof command === 'string') {
      byId.set(id, { command, exit_code: exitCode ?? null });
      continue;
    }
  } catch {
    // Counted below.
  }
  unreadable++;
}
const commands = [...byId.values()];

// The paths every command may name: the repo and the checkout that holds a worktree's git data, the review's folder, and
// the system's and Node's programs.
const inside = [repo, checkout, out, '/dev/null', '/bin/', '/usr/bin/', dirname(process.execPath)];

function flags(command: string): string[] {
  const reasons: string[] = [];
  // Paths begin a word; one shorter than three characters, or a URL's `//host`, is code in the command, not a path.
  const paths = [...command.matchAll(/(?:^|[\s'"=(<>])((?:~|\/)[\w.@+\-/]*)/g)]
    .map((m) => m[1]!)
    .filter((p) => p.length >= 3 && !p.startsWith('//'));
  const outside = paths.filter((p) => !inside.some((root) => p.startsWith(root)));
  if (outside.length > 0) reasons.push(`names paths outside the repo: ${[...new Set(outside)].join(', ')}`);
  if (/(^|[\s/])\.\.\//.test(command)) reasons.push('climbs out of the repo with ../');
  // A command that dumps the environment starts a command line; `env:` in a script's spawn options does not.
  if (/(^|[;&|`]|\$\(|-lc ['"])\s*(printenv|env|export -p|declare -x)(?=[\s'"]|$)|\/proc\//m.test(command)) {
    reasons.push('reads the environment or other processes');
  }
  if (/\b(curl|wget|ssh|scp|nc)\b/.test(command)) reasons.push('uses the network');
  // Anywhere in the command, as the network's programs are: it errs toward flagging, since a search for the word also
  // shows, and the many ways to start a program (a path, a prefix, a subshell) would each slip past a narrower pattern.
  if (/\b(sudo|docker)\b/.test(command)) reasons.push('reaches for Docker or sudo');
  if (/\bgit\s+(commit|push|reset|checkout|switch|add|stash|rebase|merge|tag|branch\s+-[dD])(?![\w-])|\b(rm|mv)\s/.test(command)) {
    reasons.push('tries to change something');
  }
  return reasons;
}

const flagged = commands.map((c) => ({ ...c, reasons: flags(c.command) })).filter((c) => c.reasons.length > 0);
const summary =
  commands.length === 0
    ? 'Unaudited: no shell commands could be read from this run. Codex may have run none, or its events may have changed.'
    : `Codex ran ${commands.length} shell commands; ${flagged.length} flagged.`;
const warning = unreadable === 0 ? [] : [`${unreadable} events could not be read, so this may miss commands.`, ''];
const block = (text: string) => '```\n' + (text.length > 600 ? `${text.slice(0, 600)}…` : text) + '\n```';
writeFileSync(
  `${out}/audit.md`,
  [
    '# Audit',
    '',
    summary,
    '',
    ...warning,
    ...flagged.flatMap((c) => [`- ${c.reasons.join('; ')} (exit ${c.exit_code ?? '?'})`, '', block(c.command), '']),
    '## Every command',
    '',
    ...commands.map((c) => block(c.command)),
    '',
  ].join('\n'),
);
console.log(`Audit: ${summary} ${warning[0] ?? ''} ${out}/audit.md`);
