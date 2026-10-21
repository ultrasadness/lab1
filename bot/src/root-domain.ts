// A Product's key (ADR 0007): the root domain of the site its Launch's website redirect leads to, as Product Hunt's
// own six-month rule for re-Launches counts it. The root domain is the public suffix and the one label before it.
// The Public Suffix List is long; this keeps the suffixes of more than one label that Product sites use. A suffix
// missing here makes every site under it one Product, so a new one is added here when a Dossier shows one.

const MULTI_LABEL_SUFFIXES = new Set([
  // Countries' second levels.
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'ac.uk', 'gov.uk',
  'com.au', 'net.au', 'org.au', 'co.nz', 'org.nz', 'co.za', 'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'or.kr',
  'com.br', 'com.mx', 'com.ar', 'com.co', 'com.cn', 'net.cn', 'org.cn', 'com.hk', 'com.tw', 'com.sg', 'com.my',
  'co.in', 'net.in', 'org.in', 'firm.in', 'co.id', 'co.il', 'co.th', 'com.tr', 'com.ua', 'com.pl', 'com.vn',
  'com.ph', 'com.pk', 'com.ng', 'com.eg', 'com.sa', 'co.ke',
  // Hosts that give each customer a site of its own.
  'github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com',
  'herokuapp.com', 'fly.dev', 'onrender.com', 'railway.app', 'up.railway.app', 'replit.app', 'repl.co',
  'lovable.app', 'bolt.host', 'framer.website', 'framer.app', 'webflow.io', 'notion.site', 'carrd.co', 'super.site',
  'substack.com', 'gitbook.io', 'readthedocs.io', 'azurewebsites.net', 'cloudfront.net', 'appspot.com',
  'streamlit.app', 'hf.space', 'glitch.me', 'surge.sh', 'deno.dev', 'myshopify.com', 'wixsite.com', 'blogspot.com',
]);

/** The root domain of a host: `hindsight.vectorize.io` → `vectorize.io`, `x.github.io` stays itself. */
export function rootDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  // An IP address, or a host of one label, is its own key.
  if (labels.length < 2 || /^\d+$/.test(labels.at(-1)!) || host.includes(':')) return labels.join('.');
  for (let i = 1; i < labels.length - 1; i++) {
    if (MULTI_LABEL_SUFFIXES.has(labels.slice(i).join('.'))) return labels.slice(i - 1).join('.');
  }
  return labels.slice(-2).join('.');
}

/** Whether a host is the root domain or one of its subdomains. */
export const onRootDomain = (host: string, root: string) => {
  const h = host.toLowerCase().replace(/\.$/, '');
  return h === root || h.endsWith(`.${root}`);
};
