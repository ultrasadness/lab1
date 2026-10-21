// A child the bot starts as the leader of its own process group (`detached: true`), so a signal reaches everything it
// started too: Pi through the command that wraps it, or the ssh that git runs.
import type { ChildProcess } from 'node:child_process';

/**
 * Signals the child's whole process group: the command and everything it started, which can outlive the command
 * itself. Once the group is gone there is nothing left to signal.
 */
export function signal(child: ChildProcess, name: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, name);
  } catch {
    if (child.exitCode === null && child.signalCode === null) child.kill(name);
  }
}

/** Kills the child's process group and lets go of its pipes, so the child closes even if something else holds them. */
export function kill(child: ChildProcess): void {
  signal(child, 'SIGKILL');
  for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.destroy();
}
