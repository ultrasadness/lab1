// A Correction's sorting run (#49), whatever item the Correction was made on: a run of the item's role, loading the
// Rules of the Correction's scope, records one sort, which plain code checks and keeps under the Correction's key. A
// run that records none leaves the Correction unsorted, saying why, so it is fix only.
import type { Clock } from '../clock.ts';
import type { Role } from '../config.ts';
import type { Log } from '../log.ts';
import { capText, type PiRunner, type RunResult } from '../pi-runs.ts';
import type { Store } from '../store.ts';
import { cardFits } from './proposals.ts';
import type { RuleScope } from './rules.ts';
import { readSort, type Proposal, type SortedItem } from './sorting.ts';

export async function runSort(options: {
  pi: PiRunner;
  store: Store;
  clock: Clock;
  log: Log;
  /** The Correction's key, which the sort is kept under. */
  correction: string;
  role: Role;
  /** What the run works on, as its run record names it. */
  runItem: string;
  scope: RuleScope;
  item: SortedItem;
  interestScope: string;
  prompt: string;
  /** Why a proposal can't go to the person as it stands, if it can't, which the run is told so it may sort again. */
  check?: (proposal: Proposal) => string | undefined;
}): Promise<'stopped' | void> {
  const { pi, store, clock, log, correction, item, interestScope, scope } = options;
  const result = await pi.run({
    kind: 'correction-sorting',
    role: options.role,
    item: options.runItem,
    ruleScope: scope,
    prompt: options.prompt,
    onRecord: (record, runId, rules) => {
      const read = readSort(record, { scope, rules, interestScope });
      if (!read.ok) return read;
      const { sort: s, rulesApplied } = read;
      const problem = s.outcome === 'proposed' ? options.check?.(s.proposal) : undefined;
      if (problem) return { ok: false, error: problem };
      if (s.outcome === 'proposed' && !cardFits(s.proposal, item, rulesApplied)) {
        return { ok: false, error: 'That proposal is too long to show on one Discord card. Sort the Correction otherwise.' };
      }
      const kept = store.saveSort({
        correction,
        item,
        outcome: s.outcome,
        hardLimit: s.outcome === 'declined' ? s.hardLimit : null,
        proposal: s.outcome === 'proposed' ? s.proposal : null,
        why: null,
        rulesApplied,
        runId,
        sortedAt: clock.now().toISOString(),
      });
      if (!kept) return { ok: false, error: 'The Correction is sorted already; the first sort stands.' };
      log('correction.sort-recorded', { correction, outcome: s.outcome, runId });
      return { ok: true, message: 'Recorded the sort.' };
    },
  });
  if (result.outcome === 'stopped') return 'stopped';
  if (store.sortOf(correction)) return;
  const why = unrecorded(result, 'sort');
  const sortedAt = clock.now().toISOString();
  store.saveSort({ correction, item, outcome: 'unsorted', hardLimit: null, proposal: null, why, rulesApplied: [], runId: result.runId, sortedAt });
  log('correction.unsorted', { correction, runId: result.runId, why });
}

/** Why a run recorded nothing, as an item's history says it. */
export function unrecorded(result: RunResult, what: string): string {
  if (result.outcome === 'capped') return `its run hit its ${capText(result.cap!)}`;
  if (result.outcome === 'failed') return `its run failed (${result.error ?? 'no reason given'})`;
  return `its run recorded no ${what}`;
}
