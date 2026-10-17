// Local test pages for the browser seam harness. Each route is keyed by host and path; HTML lives beside this file.
import fs from 'node:fs';
import http from 'node:http';

type Route = (res: http.ServerResponse) => void;

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

const routes: Record<string, Route> = {
  'acme.test/signup': page('signup.html'),
  'acme.test/get-started': page('get-started.html'),
  'acme.test/register': redirect('http://accounts.authvendor.test/sign-up?redirect_url=http%3A%2F%2Facme.test%2Fwelcome'),
  'accounts.authvendor.test/sign-up': page('vendor-sign-up.html'),
  'acme.test/your-key': page('your-key.html'),
  'acme.test/consent-known': page('consent-known.html'),
  'acme.test/consent-unknown': page('consent-unknown.html'),
  'acme.test/protected': page('interstitial.html', 403, { server: 'cloudflare', 'cf-mitigated': 'challenge' }),
  'acme.test/signup-turnstile': page('turnstile.html'),
  'acme.test/permissions': page('permissions.html'),
  'acme.test/export.csv': download('export.csv'),
  'acme.test/hang': page('hang.html'),
  'acme.test/trial': page('trial.html'),
  'acme.test/checkout': page('checkout.html'),
  'checkoutshopper-live.adyen.com/checkoutshopper/securedfields/card.html': page('card-frame.html'),
};

http
  .createServer((req, res) => {
    const host = (req.headers.host ?? '').split(':')[0];
    const route = routes[`${host}${new URL(req.url ?? '/', 'http://x').pathname}`];
    if (route) return route(res);
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end('<h1>Not found</h1>');
  })
  .listen(80, () => console.log('test pages ready'));
