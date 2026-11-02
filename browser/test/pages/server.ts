// Local test pages for the browser seam harness. Each route is keyed by host and path; HTML lives beside this file.
// What a session sends a Product, each form posted and each verification link opened, is logged as a `received` line,
// which tests read from the container's log.
import fs from 'node:fs';
import http from 'node:http';

type Route = (res: http.ServerResponse, req: http.IncomingMessage) => void;

const page = (file: string, status = 200, headers: Record<string, string> = {}): Route => (res) => {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
  res.end(fs.readFileSync(new URL(file, import.meta.url)));
};
const download = (filename: string): Route => (res) => {
  res.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': `attachment; filename="${filename}"` });
  res.end('name,email\nSam Example,sam@example.test\n');
};
const redirect = (location: string): Route => (res) => {
  res.writeHead(302, { location });
  res.end();
};
const slow = (route: Route, ms: number): Route => (res, req) => setTimeout(() => route(res, req), ms);
const received = (req: http.IncomingMessage, body: string) =>
  console.log(`received ${JSON.stringify({ host: (req.headers.host ?? '').split(':')[0], method: req.method, url: req.url, body })}`);
const verified: Route = (res, req) => {
  received(req, '');
  page('session/verified.html')(res, req);
};
// Any form posted to /api/… on any host.
const submitted = (req: http.IncomingMessage, res: http.ServerResponse) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => (body += chunk));
  req.on('end', () => {
    received(req, body);
    page('session/received.html')(res, req);
  });
};

const routes: Record<string, Route> = {
  'acme.test/signup': page('signup.html'),
  'acme.test/get-started': page('get-started.html'),
  'acme.test/register': redirect('http://accounts.authvendor.test/sign-up?redirect_url=http%3A%2F%2Facme.test%2Fwelcome'),
  'accounts.authvendor.test/sign-up': page('vendor-sign-up.html'),
  'acme.test/your-key': page('your-key.html'),
  'acme.test/consent-known': page('consent-known.html'),
  'acme.test/consent-unknown': page('consent-unknown.html'),
  // Slow to answer, so the reload or redirect is still on its way while the cookie step runs.
  'acme.test/consent-reload': slow(page('consent-reload.html'), 1_500),
  'acme.test/consent-redirect': page('consent-redirect.html'),
  'acme.test/consent-known-slow': slow(page('consent-known.html'), 1_500),
  'acme.test/protected': page('interstitial.html', 403, { server: 'cloudflare', 'cf-mitigated': 'challenge' }),
  'acme.test/signup-turnstile': page('turnstile.html'),
  'acme.test/permissions': page('permissions.html'),
  'acme.test/export.csv': download('export.csv'),
  'acme.test/hang': page('hang.html'),
  'acme.test/redirect-relative': redirect('/signup'),
  'acme.test/redirect-file': redirect('file:///etc/passwd'),
  'acme.test/no-answer': () => {},
  'acme.test/trial': page('trial.html'),
  'acme.test/checkout': page('checkout.html'),
  'checkoutshopper-live.adyen.com/checkoutshopper/securedfields/card.html': page('card-frame.html'),
  'checkoutshopper-live.adyen.com/newsletter': page('provider-newsletter.html'),
  'acme.test/session/signup': page('session/signup.html'),
  'acme.test/session/remember': page('session/remember.html'),
  'acme.test/session/echo': page('session/echo.html'),
  'acme.test/session/card': page('session/card.html'),
  'acme.test/session/custom': page('session/custom.html'),
  'acme.test/session/verify': page('session/verify.html'),
  'acme.test/session/verified': verified,
  'acme.test/session/shot': page('session/shot.html'),
  'accounts.authvendor.test/session/steps': page('session/steps.html'),
  'acme.test/session/review': page('session/review.html'),
};

http
  .createServer((req, res) => {
    const host = (req.headers.host ?? '').split(':')[0];
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (req.method === 'POST' && path.startsWith('/api/')) return submitted(req, res);
    const route = routes[`${host}${path}`];
    if (route) return route(res, req);
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end('<h1>Not found</h1>');
  })
  .listen(80, () => console.log('test pages ready'));
