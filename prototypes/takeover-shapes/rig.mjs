// PROTOTYPE, throwaway: a stand-in browser service for "Which Takeover shape works from the iPhone?" (issue #21).
// Four test Registrations, each in its own headed browser on its own Xvfb display: two taken over through
// noVNC, two through Playwright's Dashboard, each shape at phone and desktop window size.
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const TS_HOST = process.env.TS_HOST;
const NOVNC_HTTPS = 8444, DASH_HTTPS = 8445;
const CHROME_UI = 88; // tab strip + toolbar, in DIPs
const SIZES = {
  phone: { w: 500, h: 900, dsf: 2, label: 'phone-sized' }, // 500 DIPs is Chrome's narrowest window,
  desktop: { w: 1280, h: 800, dsf: 1, label: 'desktop-sized' },
};
const REGS = [
  { id: 'acme', product: 'Acme Notes', shape: 'novnc', size: 'phone', display: 1 },
  { id: 'birch', product: 'Birch Docs', shape: 'novnc', size: 'desktop', display: 2 },
  { id: 'cobalt', product: 'Cobalt CRM', shape: 'dashboard', size: 'phone', display: 3 },
  { id: 'delta', product: 'Delta Sheets', shape: 'dashboard', size: 'desktop', display: 4 },
];
const TOKENS = '/tmp/vnc-tokens';
const FORM = fs.readFileSync(new URL('./form.html', import.meta.url), 'utf8');
const LAUNCHER = fs.readFileSync(new URL('./launcher.html', import.meta.url), 'utf8');

const now = () => new Date().toISOString().slice(11, 19);
const log = (r, line) => { r.log.push(`${now()} ${line}`); console.log(`[${r.id}] ${line}`); };
const run = (cmd, args, env = {}) => {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'inherit', 'inherit'] });
  p.on('exit', (code) => console.log(`${cmd} ${args[0] ?? ''} exited ${code}`));
  return p;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- displays, VNC servers, websockify, Dashboard ---
fs.mkdirSync(TOKENS, { recursive: true });
fs.mkdirSync('/tmp/.X11-unix', { mode: 0o1777 }); // Xvfb runs as pwuser and can't make it itself
for (const r of REGS) {
  const s = SIZES[r.size];
  run('Xvfb', [`:${r.display}`, '-screen', '0', `${s.w * s.dsf}x${(s.h + CHROME_UI) * s.dsf}x24`, '-nolisten', 'tcp']);
}
for (const r of REGS) { r.log = []; r.driver = 'bot'; r.status = 'starting'; r.token = null; }
const startVnc = (r) => run('x11vnc', ['-display', `:${r.display}`, '-rfbport', `${5900 + r.display}`, '-localhost', '-nopw', '-forever', '-shared', '-noxdamage', '-quiet']);
run('websockify', ['--web', '/opt/novnc', '--token-plugin', 'TokenFile', '--token-source', TOKENS, '0.0.0.0:6080']);
run('npx', ['playwright', 'cli', 'show', '--port=9330', '--host=0.0.0.0']);
await sleep(1500);

// --- one browser per Registration ---
async function startSession(r) {
  const s = SIZES[r.size];
  r.code = String(crypto.randomInt(100000, 1000000));
  r.password = crypto.randomBytes(15).toString('base64url');
  r.context = await r.browser.newContext({ viewport: null });
  const watch = (page) => {
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.frame() === page.mainFrame())
        log(r, `service saw ${r.driver === 'person' ? "the person's" : "the bot's"} POST ${new URL(req.url()).pathname}`);
    });
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) log(r, `nav ${f.url().replace(/^https?:\/\/127\.0\.0\.1:8091/, '')}`); });
  };
  const page = r.page = await r.context.newPage();
  watch(page);
  r.context.on('page', (p) => { log(r, 'new tab opened'); watch(p); });
  await page.goto(`http://127.0.0.1:8091/form/${r.id}`);
  // Plain code fills the approved values; the password is filled "by reference".
  await page.fill('input[name=name]', 'Sam Example');
  await page.fill('input[name=email]', `signup+${r.id}@example.com`);
  await page.fill('input[name=password]', r.password);
  r.status = 'at wall';
  log(r, `filled name, email, password; stopped at the bot check (window ${s.w}x${s.h} @${s.dsf}x)`);
}

// --- Takeover start and end ---
async function takeover(r) {
  r.driver = 'person'; r.status = 'taken over';
  if (r.shape === 'novnc') {
    r.token = crypto.randomBytes(18).toString('base64url');
    fs.writeFileSync(`${TOKENS}/${r.id}`, `${r.token}: localhost:${5900 + r.display}\n`);
    log(r, 'Takeover started: noVNC token minted');
    const path = encodeURIComponent(`websockify?token=${r.token}`);
    return `https://${TS_HOST}:${NOVNC_HTTPS}/vnc.html?autoconnect=1&reconnect=1&resize=scale&show_dot=1&path=${path}`;
  }
  if (!r.bound) { await r.browser.bind(`Registration: ${r.product}`, { workspaceDir: '/app' }); r.bound = true; }
  log(r, 'Takeover started: browser bound to the Dashboard');
  return `https://${TS_HOST}:${DASH_HTTPS}/`;
}

async function endTakeover(r, how) {
  if (r.shape === 'novnc') {
    fs.rmSync(`${TOKENS}/${r.id}`, { force: true });
    r.token = null;
    r.vnc.kill(); // cut any live viewer, then serve the display again for the next Takeover
    await sleep(300);
    r.vnc = startVnc(r);
  } else if (r.bound) {
    await r.browser.unbind(); r.bound = false;
  }
  r.driver = 'bot';
  r.status = how === 'submitted' ? 'I submitted' : 'continued';
  log(r, `Takeover ended: ${how}; link revoked`);
}

// --- the test form (inside the container only) ---
const body = (req) => new Promise((res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => res(new URLSearchParams(b))); });
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const renderForm = (r, error = '', f) => FORM.replaceAll('{{PRODUCT}}', r.product).replaceAll('{{ID}}', r.id)
  .replace('{{NAME}}', esc(f?.get('name'))).replace('{{EMAIL}}', esc(f?.get('email')))
  .replace('{{ERROR}}', error ? `<div class="error">${error}</div>` : '');
const html = (res, s, code = 200) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' }); res.end(s); };

http.createServer(async (req, res) => {
  const [, kind, id] = req.url.split('/');
  const r = REGS.find((x) => x.id === id);
  if (kind === 'form' && r) return html(res, renderForm(r));
  if (kind === 'terms') return html(res, '<h1>Terms</h1><p>Prototype terms. Close this tab.</p>');
  if (kind === 'submit' && r && req.method === 'POST') {
    const f = await body(req);
    const problems = [];
    if (f.get('code') !== r.code) problems.push('wrong verification code');
    if (!f.get('cf-turnstile-response')) problems.push('bot check not completed');
    if (f.get('password') !== r.password) problems.push('password does not match what was filled');
    if (problems.length) {
      log(r, `server rejected the form: ${problems.join(', ')}`);
      return html(res, renderForm(r, `Please fix: ${problems.join(', ')}. Your password was cleared.`, f));
    }
    r.status = 'submitted (server accepted)';
    log(r, 'server accepted the form: account "created"');
    return html(res, `<meta name=viewport content="width=device-width"><h1>Welcome to ${r.product}</h1><p>Account created. Check your email to verify.</p>`);
  }
  html(res, 'not found', 404);
}).listen(8091, '127.0.0.1');

// --- the Discord stand-in, published to the tailnet ---
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const [, kind, id] = url.pathname.split('/');
  const r = REGS.find((x) => x.id === id);
  try {
    if (url.pathname === '/') return html(res, LAUNCHER);
    if (kind === 'state') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(REGS.map((x) => ({
        id: x.id, product: x.product, status: x.status, driver: x.driver, log: x.log,
        shapeLabel: x.shape === 'novnc' ? 'noVNC' : 'Playwright Dashboard', sizeLabel: SIZES[x.size].label,
      }))));
    }
    if (kind === 'inbox') {
      return html(res, `<meta name=viewport content="width=device-width"><body style="font:16px -apple-system,sans-serif;padding:12px">
        <h2>Inbox (Gmail stand-in)</h2>${REGS.map((x) => `<p><b>${x.product}</b> &lt;no-reply@${x.id}.test&gt;<br>Your verification code is <b style="font-size:22px">${x.code}</b></p>`).join('')}
        <p><a href="/">Back to the thread</a></p>`);
    }
    if (kind === 'takeover' && r) { res.writeHead(302, { location: await takeover(r) }); return res.end(); }
    if (kind === 'end' && r && req.method === 'POST') { await endTakeover(r, url.searchParams.get('how')); return res.end('ok'); }
    if (kind === 'refill' && r && req.method === 'POST') {
      log(r, `bot filled the password again by reference${r.driver === 'person' ? ' WHILE THE PERSON HELD THE SESSION' : ''}`);
      await r.page.fill('input[name=password]', r.password);
      return res.end('ok');
    }
    if (kind === 'reset' && r && req.method === 'POST') {
      if (r.driver === 'person') await endTakeover(r, 'continue');
      await r.context.close(); r.log = []; await startSession(r);
      return res.end('ok');
    }
    html(res, 'not found', 404);
  } catch (e) {
    console.error(e); html(res, String(e), 500);
  }
}).listen(8090, '0.0.0.0');
async function startBrowsers() {
  for (const r of REGS) {
    r.browser = await chromium.launch({
      headless: false,
      chromiumSandbox: true,
      env: { ...process.env, DISPLAY: `:${r.display}` },
      args: ['--window-position=0,0', `--window-size=${SIZES[r.size].w},${SIZES[r.size].h + CHROME_UI}`, `--force-device-scale-factor=${SIZES[r.size].dsf}`],
    });
    const probe = await r.browser.newPage();
    await probe.goto('chrome://sandbox');
    const sandboxed = (await probe.textContent('body')).includes('You are adequately sandboxed');
    await probe.close();
    log(r, `${r.browser.version()}, sandbox ${sandboxed ? 'ON' : 'OFF'}`);
    if (!sandboxed) throw new Error('refusing to run without the Chromium sandbox');
    if (r.shape === 'novnc') r.vnc = startVnc(r);
    await startSession(r);
  }
}
await startBrowsers();
console.log('rig ready');
