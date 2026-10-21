# A diverged Personal database rejoins through a branch the person merges

English | [中文](0012-a-diverged-personal-database-rejoins-through-a-branch-the-person-merges.zh.md)

The bot pushes the Personal database after each commit ([ADR 0008](./0008-the-personal-database-is-its-own-repo-and-code-ships-only-through-ops-upgrade.md)), and stops committing once its checkout and GitHub's `main` have diverged ([How does a Correction become a Rule, and how do we prove it carries over?](https://github.com/ultrasadness/lab1/issues/14)). They diverge when GitHub refuses a push, so the bot's commits wait in the checkout, and the person commits on GitHub before the next push gets through, such as a Rule edited in GitHub's web editor. Nothing said how the two sides join again, and the person has only an iPhone. So the bot pushes its own commits to a branch of their own, `assistant/unmerged-<commit>`, and one `#needs-you` card links GitHub's page for merging it into `main`. The person merges it with a merge commit. At its next fast-forward the bot finds its commits in `main`, fast-forwards and commits again, and the card shrinks to a line. Decided in [Write Miner days to the Personal database](https://github.com/ultrasadness/lab1/issues/44).

## Considered Options

- **A button on the card that starts again from GitHub:** one tap drops the bot's unpushed commits, resets the checkout to `main` and writes every view again from the live store. It is the least work for the person, but everything the bot commits would then have to be rebuilt from the store, a kept Rule and an Interest scope change included.
- **The card only tells the person, who merges on the VM over SSH:** the least code, but it needs a terminal and the bot's own user, where every other fix works from the phone.
- **The bot merges or rebases by itself:** against #14, which stops committing on a divergence so that the person's edit and the bot's write are never joined without the person.

## Consequences

- **The branch is pushed once and never forced,** since the person may resolve a conflict on it in GitHub's pull request. The card waits until the branch is on GitHub, so its link always opens it.
- **Only a merge commit rejoins the two.** A squash or rebase merge leaves `main` without the bot's own commits, so the bot stays stopped. The card says to create a merge commit.
- **While the two are diverged, the bot still fetches** before each run and every `personalDatabase.retryMinutes` (30 minutes to start). Runs read the checkout as it is. Each file the bot would write waits in the live store at its latest version, and is committed once they rejoin.
- **The fallback is the button above,** if merging from the phone traps the person, such as in a conflict GitHub's editor can't resolve.
