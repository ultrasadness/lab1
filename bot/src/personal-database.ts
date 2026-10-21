// The Personal database writer (ADR 0008): the bot's own checkout of the person's private repo of Markdown on GitHub.
// Every write goes through one lock that fast-forwards the checkout to GitHub's `main`, writes the files queued in
// the live store, commits each one and pushes with the deploy key, which reaches that repo only (ADR 0009). The files
// are views the bot writes from the store, and it never reads state back from them (ADR 0007). A push GitHub refuses
// leaves the commits in the checkout, and the bot tries again a while later, and at each sync until then.
// When the checkout and GitHub's `main` each hold commits the other lacks, the bot stops committing (#14) and pushes
// its own commits to a branch of their own. One #needs-you card asks the person to merge that branch with a merge
// commit, and the bot commits again once `main` holds its commits (ADR 0012). Work that doesn't commit carries on.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inMinutes, type Clock } from './clock.ts';
import { linkButton, section, text } from './discord/components.ts';
import { refused } from './discord/rest.ts';
import { errorText, type Log } from './log.ts';
import type { NeedsYou } from './needs-you.ts';
import { shortTime } from './pacific.ts';
import { kill } from './process-group.ts';
import type { Divergence, PersonalDatabaseWrite, Store } from './store.ts';

/** How long one git command may take, a fetch or push to GitHub included, before it is killed. */
const GIT_TIMEOUT_MS = 120_000;
const OUTPUT_KEPT = 4000;

/** GitHub's branch the checkout follows, and where the bot pushes. */
const MAIN = 'refs/heads/main';
const ORIGIN_MAIN = 'refs/remotes/origin/main';

interface GitResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export class PersonalDatabase {
  #dir: string;
  #ssh: string[];
  #deployKey: string;
  #retryMinutes: number;
  #store: Store;
  #needsYou: NeedsYou;
  #clock: Clock;
  #log: Log;
  /** The lock: each sync starts once the one before it has ended. */
  #lock: Promise<void> = Promise.resolve();
  #cancelRetry = () => {};
  #stopped = false;

  constructor(options: {
    /** The bot's checkout of the repo, cloned from GitHub. */
    dir: string;
    /** The ssh command git reaches GitHub through. */
    ssh: string[];
    /** The deploy key's file. */
    deployKey: string;
    /** How long work left after a sync waits before the next try. */
    retryMinutes: number;
    store: Store;
    needsYou: NeedsYou;
    clock: Clock;
    log: Log;
  }) {
    this.#dir = options.dir;
    this.#ssh = options.ssh;
    this.#deployKey = options.deployKey;
    this.#retryMinutes = options.retryMinutes;
    this.#store = options.store;
    this.#needsYou = options.needsYou;
    this.#clock = options.clock;
    this.#log = options.log;
  }

  /** A file the person keeps in the repo, such as the Interest scope, as the checkout last fast-forwarded it. */
  read(path: string): string {
    return readFileSync(join(this.#dir, path), 'utf8');
  }

  /** Queues a file to write in a commit of its own. It is written at the next sync. */
  queue(write: Omit<PersonalDatabaseWrite, 'queuedAt'>): void {
    this.#store.queuePersonalDatabaseWrite({ ...write, queuedAt: this.#clock.now().toISOString() });
  }

  /**
   * Under the lock: fast-forwards the checkout to GitHub, writes and commits every queued file, then pushes. Work it
   * leaves, such as commits GitHub refused, gets another sync after the retry time.
   */
  sync(): Promise<void> {
    const run = this.#lock.then(async () => {
      let left = true;
      try {
        left = await this.#sync();
      } catch (error) {
        this.#log('personal-database.sync-failed', { error: errorText(error) });
      }
      this.#cancelRetry();
      if (left && !this.#stopped) this.#cancelRetry = inMinutes(this.#clock, this.#retryMinutes, () => void this.sync());
    });
    this.#lock = run;
    return run;
  }

  /** Stops trying again later. A sync already started runs to its end. */
  stop(): void {
    this.#stopped = true;
    this.#cancelRetry();
  }

  /** Resolves once no sync is waiting or running. */
  async whenIdle(): Promise<void> {
    for (let lock = this.#lock; ; lock = this.#lock) {
      await lock;
      if (lock === this.#lock) return;
    }
  }

  /** Returns whether work is left for a later sync. */
  async #sync(): Promise<boolean> {
    // The checkout is the bot's alone, so anything uncommitted in it is a write that stopped before its commit. That
    // file is still queued in the store, and is written again below.
    await this.#git('reset', '--quiet', '--hard');
    await this.#git('clean', '--quiet', '--force', '-d');
    const github = await this.#fastForward();
    const open = this.#store.openDivergence();
    if (github === 'diverged') {
      await this.#diverged(open);
      return true;
    }
    if (open) {
      // Until a fetch shows `main` holding the bot's commits, it still commits nothing.
      if (github === 'unreachable') return true;
      await this.#rejoined(open);
    }
    for (const write of this.#store.personalDatabaseWrites()) await this.#commit(write);
    return !(await this.#push());
  }

  /**
   * Fetches GitHub's `main`, and fast-forwards the checkout to it when it has moved on. Says whether GitHub couldn't
   * be reached, or each side holds commits the other lacks.
   */
  async #fastForward(): Promise<'fetched' | 'unreachable' | 'diverged'> {
    const fetched = await this.#tryGit('fetch', '--quiet', 'origin', `+${MAIN}:${ORIGIN_MAIN}`);
    if (fetched.code !== 0) {
      this.#log('personal-database.fetch-failed', { error: whatGitSaid(fetched) });
      return 'unreachable';
    }
    const [ours, theirs] = [await this.#rev('HEAD'), await this.#rev(ORIGIN_MAIN)];
    if (ours === theirs || (await this.#isAncestor(theirs, ours))) return 'fetched';
    if (!(await this.#isAncestor(ours, theirs))) return 'diverged';
    await this.#git('merge', '--quiet', '--ff-only', ORIGIN_MAIN);
    this.#log('personal-database.fast-forwarded', { from: ours, to: theirs });
    return 'fetched';
  }

  /** Puts the bot's own commits on a branch of their own on GitHub, and tells the person once. */
  async #diverged(open: Divergence | undefined): Promise<void> {
    if (!open) {
      const [ours, theirs] = [await this.#rev('HEAD'), await this.#rev(ORIGIN_MAIN)];
      const branch = `assistant/unmerged-${ours.slice(0, 8)}`;
      this.#store.saveDivergence({ foundAt: this.#clock.now().toISOString(), ours, theirs, branch });
      this.#log('personal-database.diverged', { ours, theirs, branch });
    }
    const d = this.#store.openDivergence()!;
    if (!d.branchPushedAt) {
      // Never forced: the branch may already hold the person's own commits, such as a conflict resolved on GitHub.
      const pushed = await this.#tryGit('push', '--quiet', 'origin', `${d.ours}:refs/heads/${d.branch}`);
      // The card asks the person to merge the branch, so it waits until the branch is on GitHub.
      if (pushed.code !== 0) {
        this.#log('personal-database.branch-push-refused', { branch: d.branch, error: whatGitSaid(pushed) });
        return;
      }
      this.#store.saveDivergenceBranchPushed(d.id, this.#clock.now().toISOString());
    }
    if (d.cardIntended) return;
    const commits = Number(await this.#git('rev-list', '--count', `${d.theirs}..${d.ours}`));
    const page = gitHubPage((await this.#git('remote', 'get-url', 'origin')).trim());
    const rejoin = [
      `To rejoin them, merge \`${d.branch}\` into \`main\` with **Create a merge commit**, so that \`main\` holds the Assistant's commits as they are; a squash or rebase doesn't. The Assistant commits again within ${this.#retryMinutes} minutes of the merge.`,
      `-# Found at ${shortTime(new Date(d.foundAt))}`,
    ].join('\n');
    // Marked before it is sent; an uncertain send counts as sent (ADR 0007).
    this.#store.saveDivergenceCardIntended(d.id, true);
    try {
      const { messageId } = await this.#needsYou.post('Personal database: the histories have diverged', [
        text(
          `GitHub's \`main\` has commits the Assistant's checkout doesn't, and the checkout has ${commits} commit${commits === 1 ? '' : 's'} that \`main\` doesn't. The Assistant has stopped committing to the Personal database. What it would write waits in the live store, and everything else carries on.`,
        ),
        page ? section(rejoin, linkButton('Merge on GitHub', `${page}/compare/main...${d.branch}?expand=1`)) : text(rejoin),
      ]);
      this.#store.saveDivergenceCard(d.id, messageId);
    } catch (error) {
      if (refused(error)) this.#store.saveDivergenceCardIntended(d.id, false);
      this.#log('personal-database.card-failed', { error: errorText(error) });
    }
  }

  /** `main` holds the bot's commits again: committing resumes, and the card shrinks to a line. */
  async #rejoined(d: Divergence): Promise<void> {
    const at = this.#clock.now();
    this.#store.saveDivergenceRejoined(d.id, at.toISOString());
    this.#log('personal-database.rejoined', { branch: d.branch });
    if (!d.cardMessageId) return;
    try {
      await this.#needsYou.shrink(
        d.cardMessageId,
        `Personal database: the histories rejoined at ${shortTime(at)}. The Assistant is committing again.`,
      );
    } catch (error) {
      this.#log('personal-database.card-failed', { error: errorText(error) });
    }
  }

  async #commit(write: PersonalDatabaseWrite): Promise<void> {
    const file = join(this.#dir, write.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, write.content);
    await this.#git('add', '--', write.path);
    // A file written again just as it was changes nothing, and gets no commit.
    if ((await this.#tryGit('diff', '--cached', '--quiet')).code === 1) {
      await this.#git('commit', '--quiet', '-m', write.message);
      this.#log('personal-database.committed', { path: write.path, commit: await this.#rev('HEAD') });
    }
    this.#store.removePersonalDatabaseWrite(write.path, write.content);
  }

  /** Pushes the commits GitHub's `main` doesn't have yet, if there are any. Returns whether GitHub has them all. */
  async #push(): Promise<boolean> {
    const unpushed = Number(await this.#git('rev-list', '--count', `${ORIGIN_MAIN}..HEAD`));
    if (unpushed === 0) return true;
    const pushed = await this.#tryGit('push', '--quiet', 'origin', `HEAD:${MAIN}`);
    if (pushed.code !== 0) {
      this.#log('personal-database.push-refused', { unpushed, error: whatGitSaid(pushed) });
      return false;
    }
    this.#log('personal-database.pushed', { commits: unpushed, head: await this.#rev('HEAD') });
    return true;
  }

  async #rev(ref: string): Promise<string> {
    return (await this.#git('rev-parse', '--verify', '--quiet', ref)).trim();
  }

  async #isAncestor(ancestor: string, of: string): Promise<boolean> {
    const result = await this.#tryGit('merge-base', '--is-ancestor', ancestor, of);
    if (result.code !== 0 && result.code !== 1) throw new Error(`git merge-base failed: ${whatGitSaid(result)}`);
    return result.code === 0;
  }

  /** Runs git in the checkout, and throws unless it succeeds. */
  async #git(...args: string[]): Promise<string> {
    const result = await this.#tryGit(...args);
    if (result.code !== 0) throw new Error(`git ${args[0]} failed: ${whatGitSaid(result)}`);
    return result.stdout;
  }

  /**
   * Runs git in the checkout, and says how it ended, success or not. A command still running after the time limit
   * is killed, with all it started.
   */
  #tryGit(...args: string[]): Promise<GitResult> {
    return new Promise((resolve) => {
      const child = spawn('git', args, { cwd: this.#dir, env: this.#env(), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      let stdout = '';
      let stderr = '';
      child.stdout!.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
      child.stderr!.on('data', (chunk: Buffer) => (stderr = (stderr + chunk.toString('utf8')).slice(-OUTPUT_KEPT)));
      const timer = setTimeout(() => {
        stderr += `\nkilled after ${GIT_TIMEOUT_MS / 1000} seconds`;
        kill(child);
      }, GIT_TIMEOUT_MS);
      child.on('error', (error) => (stderr += `\n${error.message}`));
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
  }

  /** Git's environment: only this checkout, no git config of the machine's, and the deploy key for GitHub. */
  #env(): NodeJS.ProcessEnv {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
    const at = `${Math.floor(this.#clock.now().getTime() / 1000)} +0000`;
    return {
      ...env,
      GIT_DIR: join(this.#dir, '.git'),
      GIT_WORK_TREE: this.#dir,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_SSH_COMMAND: [...this.#ssh, '-i', this.#deployKey, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes'].map(shellQuote).join(' '),
      GIT_AUTHOR_NAME: 'Assistant',
      GIT_AUTHOR_EMAIL: 'assistant@localhost',
      GIT_AUTHOR_DATE: at,
      GIT_COMMITTER_NAME: 'Assistant',
      GIT_COMMITTER_EMAIL: 'assistant@localhost',
      GIT_COMMITTER_DATE: at,
    };
  }
}

/** GitHub's page for the repo an ssh remote URL names, if it names one. */
function gitHubPage(remote: string): string | undefined {
  const m = remote.match(/^(?:ssh:\/\/)?git@([^/:]+)[:/](.+?)(?:\.git)?\/?$/);
  return m ? `https://${m[1]}/${m[2]}` : undefined;
}

/** What a failed git command said, in one line. */
const whatGitSaid = (result: GitResult) => result.stderr.trim().split('\n').slice(-3).join(' | ') || `exited with ${result.code}`;

const shellQuote = (word: string) => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`);
