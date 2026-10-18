// Writes the acceptance criteria of a spec's other open tickets as Markdown, so the reviewer can tell when a later
// ticket owns a finding.
//
//   gh issue list --state open --json number,title,body | node siblings.ts <ticket> <parent>
import { readFileSync } from 'node:fs';

const [ticket, parent] = process.argv.slice(2).map(Number);
const issues = JSON.parse(readFileSync(0, 'utf8')) as { number: number; title: string; body: string }[];

const ofSpec = (body: string) => new RegExp(`## Parent\\s+#${parent}\\b`).test(body);
const criteria = (body: string) =>
  body.match(/## Acceptance criteria\s*([\s\S]*?)(?=\n## |$)/)?.[1]?.trim() ?? '(no acceptance criteria)';

const siblings = issues.filter((i) => i.number !== ticket && ofSpec(i.body)).sort((a, b) => a.number - b.number);
process.stdout.write(
  siblings.length === 0
    ? `Spec #${parent} has no other open tickets.\n`
    : siblings.map((i) => `## #${i.number} ${i.title}\n\n${criteria(i.body)}\n`).join('\n'),
);
