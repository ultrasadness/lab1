// `npm run check:docs`: each doc the person reads has a Simplified Chinese side that stays in step with its
// English side (docs/agents/doc-pairs.md). The pre-commit hook and CI run it.
import { join } from 'node:path';
import { checkDocs } from './doc-pairs.ts';

/** The paired docs, each named by its English side, and `docs/adr/`, where every ADR is a pair. */
const PAIRS = ['CONTEXT.md', 'bot/README.md', 'browser/README.md', 'docs/adr/'];

const { ok, output } = checkDocs(process.argv.slice(2), join(import.meta.dirname, '..'), PAIRS);
(ok ? process.stdout : process.stderr).write(output);
process.exitCode = ok ? 0 : 1;
