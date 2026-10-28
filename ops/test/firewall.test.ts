// ops/firewall's rules (#71), applied for real inside a network namespace of the test's own, where an unprivileged
// user may change the firewall, so nothing on the host changes. What the rules do to the browser container's traffic
// is ops/firewall check's, run on the VM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIREWALL = join(import.meta.dirname, '..', 'firewall');
const namespaces = spawnSync('unshare', ['-rn', 'iptables', '-t', 'raw', '-S'], { timeout: 10_000 }).status === 0;

/** Runs a shell script as root of a fresh network namespace, and returns what it printed. */
function inNamespace(script: string): string {
  const r = spawnSync('unshare', ['-rn', 'bash', '-c', script], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, FIREWALL } });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  return r.stdout;
}

test('apply puts each rule in once however often it runs, and remove takes every one out', { skip: !namespaces && 'needs unprivileged network namespaces' }, () => {
  const [v4, v6, after] = inNamespace(
    '"$FIREWALL" apply >/dev/null; "$FIREWALL" apply >/dev/null; iptables -t raw -S; echo ---; ip6tables -t raw -S; echo ---; "$FIREWALL" remove >/dev/null; iptables -t raw -S; ip6tables -t raw -S',
  ).split('---\n') as [string, string, string];

  assert.equal(v4.match(/^-A PREROUTING .*$/gm)?.join('\n'), '-A PREROUTING -i br-lab1-browser -j LAB1-BROWSER');
  assert.equal(v6.match(/^-A PREROUTING .*$/gm)?.join('\n'), '-A PREROUTING -i br-lab1-browser -j LAB1-BROWSER');
  const dropped = (rules: string) => (rules.match(/^-A LAB1-BROWSER (.*) -j DROP$/gm) ?? []).map((rule) => rule.replace(/^-A LAB1-BROWSER (?:-d )?(.*) -j DROP$/, '$1'));
  // The private ranges, Tailscale's, link-local (Oracle's metadata among them), loopback and the host's own addresses.
  for (const range of ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '169.254.0.0/16', '127.0.0.0/8', '-m addrtype --dst-type LOCAL']) {
    assert.equal(dropped(v4).filter((d) => d === range).length, 1, range);
  }
  // IPv6's loopback, link-local and unique-local (Tailscale's among them) ranges, multicast and the host's addresses.
  for (const range of ['::1/128', 'fe80::/10', 'fc00::/7', 'ff00::/8', '-m addrtype --dst-type LOCAL']) {
    assert.equal(dropped(v6).filter((d) => d === range).length, 1, range);
  }
  assert.doesNotMatch(after, /LAB1-BROWSER/);
});

test('apply lets Pi’s bridge reach the forwarder ahead of the host’s own INPUT rules, once, and remove takes it out', { skip: !namespaces && 'needs unprivileged network namespaces' }, () => {
  // Oracle's Ubuntu image ends INPUT with a REJECT of all but ssh, http and https (found at go-live, #85).
  const [before, after] = inNamespace(
    'iptables -A INPUT -p tcp --dport 22 -j ACCEPT; iptables -A INPUT -j REJECT --reject-with icmp-host-prohibited; ' +
      '"$FIREWALL" apply >/dev/null; "$FIREWALL" apply >/dev/null; iptables -S INPUT; echo ---; "$FIREWALL" remove >/dev/null; iptables -S INPUT',
  ).split('---\n') as [string, string];
  const { host, port } = forwarder();
  assert.deepEqual(before.match(/^-A INPUT .*$/gm), [
    `-A INPUT -d ${host}/32 -i docker0 -p tcp -m tcp --dport ${port} -j ACCEPT`,
    '-A INPUT -p tcp -m tcp --dport 22 -j ACCEPT',
    '-A INPUT -j REJECT --reject-with icmp-host-prohibited',
  ]);
  assert.deepEqual(after.match(/^-A INPUT .*$/gm), ['-A INPUT -p tcp -m tcp --dport 22 -j ACCEPT', '-A INPUT -j REJECT --reject-with icmp-host-prohibited']);
});

test('the dry run prints the rules for both families and changes nothing', () => {
  const r = spawnSync(FIREWALL, ['--dry-run'], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^-A LAB1-BROWSER -d 169\.254\.0\.0\/16 -j DROP$/m);
  assert.match(r.stdout, /^-A LAB1-BROWSER -d fc00::\/7 -j DROP$/m);
  assert.equal(r.stdout.match(/^\*raw$/gm)?.length, 2);
  const { host, port } = forwarder();
  assert.match(r.stdout, new RegExp(`^-I INPUT 1 -i docker0 -d ${host} -p tcp --dport ${port} -j ACCEPT$`, 'm'));
});

/** The forwarder's address in the config, where Pi's container reaches the bot. */
function forwarder(): { host: string; port: number } {
  const config = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'config', 'assistant.json'), 'utf8')) as { forwarder: { host: string; port: number } };
  return config.forwarder;
}
