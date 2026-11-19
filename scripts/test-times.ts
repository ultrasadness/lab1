// A test reporter that records how long each test file took (#110): the sum of its top-level tests' times, which is
// how long the file holds a shard that runs its files one at a time. `npm test` adds it beside the spec reporter when
// `TEST_RECORD` names a file to write, and `scripts/plan-shards.ts` plans a later run's shards from the records. The
// spec reporter's output names no test's file, where each test event does.
import { relative, sep } from 'node:path';

type Event = { type: string; data: { file?: string; nesting: number; details?: { duration_ms?: number } } };

export default async function* record(source: AsyncIterable<Event>): AsyncGenerator<string> {
  const times: Record<string, number> = {};
  for await (const { type, data } of source) {
    if ((type !== 'test:pass' && type !== 'test:fail') || data.nesting !== 0 || !data.file) continue;
    const file = relative(process.cwd(), data.file).split(sep).join('/');
    times[file] = (times[file] ?? 0) + (data.details?.duration_ms ?? 0);
  }
  yield `${JSON.stringify(times, null, 2)}\n`;
}
