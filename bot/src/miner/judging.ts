// A Miner judging run's input and output. The input is Product Hunt data only (name, tagline, description, topics
// and the Maker comment), never votes or rank. The output is one judgment per Launch, written through our Pi
// extension's schema-checked record tool, and checked again here before it is kept.
import { fence as block } from '../fence.ts';
import type { Launch } from '../store.ts';

export interface JudgmentRecord {
  postId: string;
  fit: number;
  notAProduct: boolean;
  reason: string;
  rulesApplied: string[];
}

export const REASON_MAX_CHARS = 240;

/** The run's prompt: the Interest scope, then each Launch in Product Hunt order. */
export function judgingPrompt(interestScope: string, launches: Launch[]): string {
  const parts = [
    'Interest scope:',
    block(interestScope),
    '',
    `Judge these ${launches.length} Launches, each on its own. Call record_judgment once for each.`,
  ];
  for (const launch of launches) {
    parts.push(
      '',
      `Launch · Post id ${launch.postId}`,
      'Name:',
      block(launch.name),
      'Tagline:',
      block(launch.tagline),
      'Topics:',
      block(launch.topics.join(', ') || 'none'),
      'Description:',
      block(launch.description || 'none'),
      ...(launch.makerComment ? ['Maker comment:', block(launch.makerComment)] : ['Maker comment: none']),
    );
  }
  return parts.join('\n');
}

/** Checks a record from a run against the run's own Launches. The extension's schema checked it once already. */
export function readJudgment(record: unknown, expected: ReadonlySet<string>): { ok: true; judgment: JudgmentRecord } | { ok: false; error: string } {
  const r = (record as { kind?: unknown; record?: Record<string, unknown> } | null) ?? {};
  if (r.kind !== 'judgment' || typeof r.record !== 'object' || r.record === null) return { ok: false, error: 'Expected a judgment record.' };
  const { postId, fit, notAProduct, reason, rulesApplied } = r.record;
  if (typeof postId !== 'string' || !expected.has(postId)) return { ok: false, error: `Post id ${String(postId)} is not one of this run's Launches.` };
  if (typeof fit !== 'number' || !Number.isInteger(fit) || fit < 0 || fit > 10) return { ok: false, error: 'fit must be a whole number from 0 to 10.' };
  if (typeof notAProduct !== 'boolean') return { ok: false, error: 'notAProduct must be true or false.' };
  if (typeof reason !== 'string' || !reason.trim() || /[\r\n]/.test(reason) || reason.length > REASON_MAX_CHARS) {
    return { ok: false, error: `reason must be one line of at most ${REASON_MAX_CHARS} characters.` };
  }
  if (!Array.isArray(rulesApplied) || rulesApplied.length > 0) return { ok: false, error: 'rulesApplied must be empty: no Rules exist yet.' };
  return { ok: true, judgment: { postId, fit, notAProduct, reason: reason.trim(), rulesApplied: [] } };
}
