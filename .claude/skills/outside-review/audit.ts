// Lists every shell command Codex ran in a review and flags each one that reached past the repo and the review's
// folder, read the environment, used the network or tried to change something. The sandbox is the guarantee; this
// is the record of what Codex tried.
//
//   node audit.ts <out> <repo>      writes <out>/audit.md and prints a one-line summary
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [out, repo] = process.argv.slice(2) as [string, string];

interface Command {
  command: string;
  exit_code: number | null;
}

const commands: Command[] = readFileSync(`${out}/events.jsonl`, 'utf8')
  .split('\n')
  .filter(Boolean)
  .flatMap((line) => {
    const event = JSON.parse(line) as { type?: string; item?: { type?: string } & Command };
    return event.type === 'item.completed' && event.item?.type === 'command_execution' ? [event.item] : [];
  });

// The paths every command may name: the repo, the review's folder, and the system's and Node's programs.
const inside = [repo, out, '/dev/null', '/bin/', '/usr/bin/', dirname(process.execPath)];

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
  if (/\bgit\s+(commit|push|reset|checkout|switch|add|stash|rebase|merge|tag|branch\s+-[dD])\b|\b(rm|mv)\s/.test(command)) {
    reasons.push('tries to change something');
  }
  return reasons;
}

const flagged = commands.map((c) => ({ ...c, reasons: flags(c.command) })).filter((c) => c.reasons.length > 0);
const block = (text: string) => '```\n' + (text.length > 600 ? `${text.slice(0, 600)}…` : text) + '\n```';
writeFileSync(
  `${out}/audit.md`,
  [
    '# Audit',
    '',
    `Codex ran ${commands.length} shell commands; ${flagged.length} flagged.`,
    '',
    ...flagged.flatMap((c) => [`- ${c.reasons.join('; ')} (exit ${c.exit_code ?? '?'})`, '', block(c.command), '']),
    '## Every command',
    '',
    ...commands.map((c) => block(c.command)),
    '',
  ].join('\n'),
);
console.log(`Audit: ${commands.length} commands, ${flagged.length} flagged: ${out}/audit.md`);
