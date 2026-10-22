// A fake GitHub holding the person's Personal database repo: a local bare repo that git reaches through `fake-ssh.ts`.
// Tests read what GitHub holds, have it refuse pushes, and commit and merge on it as the person would from GitHub.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const REPO_PATH = '/person/personal-database.git';

export interface FakeSshState {
  /** The local bare repo the fake GitHub serves. */
  bareDir: string;
  /** The repo's path on the fake GitHub, as the remote URL names it. */
  repoPath: string;
  /** The deploy key's contents. */
  deployKey: string;
}

export interface FakeSshConnection {
  service: string;
  path: string;
  /** Whether the connection came with the deploy key. */
  deployKey: boolean;
  refused: boolean;
}

export const STATE_FILE = 'state.json';
export const CONNECTIONS_FILE = 'connections.jsonl';
/** While this file is in the state dir, GitHub refuses every push. */
export const REFUSE_PUSHES_FILE = 'refuse-pushes';

export class FakeGitRemote {
  /** The repo's URL, as the bot's checkout names its origin. */
  readonly url = `ssh://git@github.test${REPO_PATH}`;
  /** The repo's page on the fake GitHub. */
  readonly webUrl = 'https://github.test/person/personal-database';
  /** The ssh command git runs to reach this GitHub. */
  readonly ssh: string[];
  #bare: string;
  #state: string;
  /** The person's own clone, for commits made as from GitHub's web editor. */
  #person: string;

  private constructor(dir: string) {
    this.#bare = join(dir, 'github.git');
    this.#state = join(dir, 'fake-ssh');
    this.#person = join(dir, 'person');
    this.ssh = [process.execPath, join(import.meta.dirname, 'fake-ssh.ts'), this.#state];
  }

  /** A repo on GitHub whose first commit holds these files, which only this deploy key may reach. */
  static create(options: { dir: string; deployKey: string; files: Record<string, string> }): FakeGitRemote {
    const remote = new FakeGitRemote(options.dir);
    mkdirSync(remote.#state, { recursive: true });
    const state: FakeSshState = { bareDir: remote.#bare, repoPath: REPO_PATH, deployKey: options.deployKey };
    writeFileSync(join(remote.#state, STATE_FILE), JSON.stringify(state));
    git(options.dir, 'init', '--quiet', '--bare', '--initial-branch=main', remote.#bare);
    git(options.dir, 'clone', '--quiet', remote.#bare, remote.#person);
    git(remote.#person, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    for (const [path, content] of Object.entries(options.files)) remote.#write(path, content);
    git(remote.#person, 'commit', '--quiet', '-m', 'Start the Personal database');
    git(remote.#person, 'push', '--quiet', 'origin', 'main');
    return remote;
  }

  /** Clones the repo where the bot keeps its checkout, with its origin on this GitHub, as the install does. */
  cloneTo(checkout: string): void {
    git(dirname(checkout), 'clone', '--quiet', this.#bare, checkout);
    git(checkout, 'remote', 'set-url', 'origin', this.url);
  }

  /** A file as GitHub holds it on a branch, or undefined if it isn't there. */
  file(path: string, branch = 'main'): string | undefined {
    try {
      return git(this.#bare, 'show', `${branch}:${path}`);
    } catch {
      return undefined;
    }
  }

  /**
   * The subjects of a branch's own line of commits, oldest first: a branch merged into it shows as its merge. With
   * `leavingOut`, a commit that changed nothing outside that folder is left out.
   */
  subjects(branch = 'main', options: { leavingOut?: string } = {}): string[] {
    const commits = git(this.#bare, 'log', '--first-parent', '--reverse', '--format=%H %s', branch).split('\n').filter(Boolean);
    const folder = options.leavingOut;
    return commits
      .map((line) => [line.slice(0, line.indexOf(' ')), line.slice(line.indexOf(' ') + 1)] as const)
      .filter(([sha]) => {
        if (!folder) return true;
        const changed = git(this.#bare, 'diff-tree', '--no-commit-id', '--name-only', '-r', '-m', '--first-parent', '--root', sha).split('\n').filter(Boolean);
        return changed.length === 0 || changed.some((path) => !path.startsWith(`${folder}/`));
      })
      .map(([, subject]) => subject);
  }

  /** The commit a branch on GitHub is at. */
  head(branch = 'main'): string {
    return git(this.#bare, 'rev-parse', `refs/heads/${branch}`).trim();
  }

  /** The branches on GitHub. */
  branches(): string[] {
    return git(this.#bare, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/').split('\n').filter(Boolean);
  }

  /** While true, GitHub refuses every push. */
  set refusePushes(refuse: boolean) {
    const flag = join(this.#state, REFUSE_PUSHES_FILE);
    if (refuse) writeFileSync(flag, '');
    else rmSync(flag, { force: true });
  }

  /** Every ssh connection made to GitHub, oldest first. */
  connections(): FakeSshConnection[] {
    const log = join(this.#state, CONNECTIONS_FILE);
    if (!existsSync(log)) return [];
    return readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as FakeSshConnection);
  }

  /** The person commits a file on main, as from GitHub's web editor. */
  commitAsPerson(path: string, content: string, message: string): void {
    this.#syncPerson();
    this.#write(path, content);
    git(this.#person, 'commit', '--quiet', '-m', message);
    git(this.#person, 'push', '--quiet', 'origin', 'main');
  }

  /** The person merges a branch into main with GitHub's "Create a merge commit". */
  mergeAsPerson(branch: string): void {
    this.#syncPerson();
    git(this.#person, 'merge', '--quiet', '--no-ff', '-m', `Merge branch '${branch}'`, `origin/${branch}`);
    git(this.#person, 'push', '--quiet', 'origin', 'main');
  }

  #syncPerson(): void {
    git(this.#person, 'fetch', '--quiet', 'origin');
    git(this.#person, 'reset', '--quiet', '--hard', 'origin/main');
  }

  #write(path: string, content: string): void {
    mkdirSync(dirname(join(this.#person, path)), { recursive: true });
    writeFileSync(join(this.#person, path), content);
    git(this.#person, 'add', '--', path);
  }
}

/** Runs git as the person, away from any git config of the machine's. */
function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
    env: {
      ...env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'The person',
      GIT_AUTHOR_EMAIL: 'person@example.com',
      GIT_COMMITTER_NAME: 'The person',
      GIT_COMMITTER_EMAIL: 'person@example.com',
    },
  });
}
