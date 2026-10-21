// `npm run check:docs`: each doc the person reads has a Simplified Chinese side that stays in step with its
// English side, and every other doc is listed as unpaired (docs/agents/doc-pairs.md). The pre-commit hook and CI
// run it.
import { join } from 'node:path';
import { checkDocs } from './doc-pairs.ts';

/** The paired docs, each named by its English side, and `docs/adr/`, where every ADR is a pair. */
const PAIRS = ['CONTEXT.md', 'bot/README.md', 'browser/README.md', 'docs/hooks-and-ci.md', 'docs/adr/'];

/**
 * The docs with no Chinese side, each a file or a directory covering everything under it: agent instructions, test
 * fixtures, the course's brief as received, and other sessions' worktrees.
 */
const UNPAIRED = [
  'AGENTS.md',
  'CLAUDE.md',
  'CODING_STANDARDS.md',
  '.claude/skills/',
  'docs/agents/',
  'bot/test/fixtures/',
  'docs/lab1.md',
  '.claude/worktrees/',
];

const { ok, output } = checkDocs(process.argv.slice(2), join(import.meta.dirname, '..'), PAIRS, UNPAIRED);
(ok ? process.stdout : process.stderr).write(output);
process.exitCode = ok ? 0 : 1;
