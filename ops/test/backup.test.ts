// ops/backup under a throwaway OPS_ROOT (#71), with a fake sqlite3 that copies the store as `.backup` would, and a
// fake docker whose pg_dump writes a dump, or fails while the test says so.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BACKUP = join(import.meta.dirname, '..', 'backup');

const FAKES: Record<string, string> = {
  sqlite3: `echo "sqlite3 $*" >> "$OPS_ROOT/log"; to=$(echo "$3" | sed "s/^.backup '\\(.*\\)'$/\\1/"); cp "$1" "$to"`,
  docker: `echo "docker $*" >> "$OPS_ROOT/log"; [ ! -f "$OPS_ROOT/pgdump-fails" ] || { echo "pg_dump: connection refused" >&2; exit 1; }; echo "PGDMP new-api"`,
};

interface Vm {
  root: string;
  backups: string;
  run(...args: string[]): { code: number | null; out: string };
}

function vm(t: TestContext, options: { store?: boolean } = {}): Vm {
  const root = mkdtempSync(join(tmpdir(), 'ops-backup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  for (const [name, body] of Object.entries(FAKES)) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  if (options.store !== false) {
    mkdirSync(join(root, 'var/lib/assistant'), { recursive: true });
    writeFileSync(join(root, 'var/lib/assistant/assistant.sqlite'), 'SQLite format 3\0the live store');
  }
  return {
    root,
    backups: join(root, 'var/backups/assistant'),
    run: (...args) => {
      const r = spawnSync(BACKUP, args, { encoding: 'utf8', timeout: 30_000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OPS_ROOT: root } });
      return { code: r.status, out: `${r.stdout}${r.stderr}` };
    },
  };
}

/** Today's Pacific date, which names tonight's backup. */
const tonight = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
const mode = (path: string) => (statSync(path).mode & 0o777).toString(8);

test("a night's backup holds the live store and new-api's dump, for root alone", (t) => {
  const machine = vm(t);
  const ran = machine.run();
  assert.equal(ran.code, 0, ran.out);
  const night = join(machine.backups, tonight());
  assert.equal(readFileSync(join(night, 'assistant.sqlite'), 'utf8'), 'SQLite format 3\0the live store');
  assert.equal(readFileSync(join(night, 'new-api.dump'), 'utf8'), 'PGDMP new-api\n');
  assert.equal(mode(machine.backups), '700');
  assert.equal(mode(night), '700');
  for (const file of readdirSync(night)) assert.equal(mode(join(night, file)), '600', file);
  const log = readFileSync(join(machine.root, 'log'), 'utf8');
  assert.match(log, /^sqlite3 .*\/var\/lib\/assistant\/assistant\.sqlite \.timeout 60000 \.backup '.*\/\.partial-[^/]+\/assistant\.sqlite'$/m);
  assert.match(log, /^docker exec postgres pg_dump --username root --format custom new-api$/m);
});

test('the 7 latest nights are kept', (t) => {
  const machine = vm(t);
  const older = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'];
  for (const night of older) mkdirSync(join(machine.backups, night), { recursive: true });
  assert.equal(machine.run().code, 0);
  assert.deepEqual(readdirSync(machine.backups).sort(), [...older.slice(2), tonight()]);
});

test('a dump that fails keeps the earlier nights as they were, and fails the run', (t) => {
  const machine = vm(t);
  assert.equal(machine.run().code, 0);
  writeFileSync(join(machine.root, 'pgdump-fails'), '');
  const kept = readFileSync(join(machine.backups, tonight(), 'new-api.dump'), 'utf8');
  const ran = machine.run();
  assert.notEqual(ran.code, 0);
  assert.match(ran.out, /pg_dump: connection refused/);
  assert.equal(readFileSync(join(machine.backups, tonight(), 'new-api.dump'), 'utf8'), kept);
  assert.deepEqual(readdirSync(machine.backups), [tonight()], 'no partial folder is left');
});

test('before the bot has run, only new-api is backed up', (t) => {
  const machine = vm(t, { store: false });
  const ran = machine.run();
  assert.equal(ran.code, 0, ran.out);
  assert.match(ran.out, /There is no live store at .* yet, so only new-api is backed up\./);
  assert.deepEqual(readdirSync(join(machine.backups, tonight())), ['new-api.dump']);
});

test('the dry run changes nothing', (t) => {
  const machine = vm(t);
  const ran = machine.run('--dry-run');
  assert.equal(ran.code, 0, ran.out);
  assert.match(ran.out, /^Would back up the live store, .*assistant\.sqlite \(there\)/m);
  assert.match(ran.out, /^Would write them to .*\/var\/backups\/assistant\/\d{4}-\d{2}-\d{2}\/ and keep the 7 latest nights\.$/m);
  assert.ok(!existsSync(machine.backups));
});
