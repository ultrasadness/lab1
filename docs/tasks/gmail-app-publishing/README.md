# Publish the Gmail OAuth app

Kept for [Publish the Gmail OAuth app with its pages on pot.dpdns.org, and check a fresh token outlives 7 days](https://github.com/ultrasadness/lab1/issues/31).

## The pages

The source is in [`ops/pages`](../../../ops/pages): home, privacy and terms. The privacy text is the one settled in [Which model routes may read Signup mailbox mail under Google's Limited Use rules?](https://github.com/ultrasadness/lab1/issues/30), with the app name set to Signup Assistant and the date to 16 October 2026. Any change to ADR 0010's line changes the privacy page first.

They are served by the VM's Caddy at `/`, `/privacy` and `/terms` on a random subdomain of `pot.dpdns.org`. The subdomain is named in `PAGES` in `publish.sh`. The apex is skipped because it draws the most scanning, and a random name isn't in scanners' wordlists.

- **No public certificate names it.** Caddy serves it with `tls internal`, so it never shows up in Certificate Transparency logs. The DNS record must stay proxied: visitors see Cloudflare's `*.pot.dpdns.org` certificate, and only Cloudflare connects to Caddy. That works in SSL mode Full. Under Full (strict), the wizard has the person add a Configuration Rule setting Full for this one hostname.
- **Google's authorized domain is `pot.dpdns.org`.** Google takes only the top private domain there, and URLs on any subdomain of it then count.
- **The files sit in Caddy's data volume** at `/data/sites/gmail-app`, so Caddy only needed a graceful reload, with no container restart.
- **This block was appended to `~/vps-deploy/new-api/Caddyfile`.** The file before the change is `Caddyfile.bak-2026-10-16` beside it.

  ```caddyfile
  <PAGES> {
  	tls internal
  	encode gzip
  	root * /data/sites/gmail-app
  	try_files {path} {path}.html
  	file_server
  }
  ```

- **Redeploy** after editing a page: `docker cp ops/pages/. caddy:/data/sites/gmail-app/`. Until `ops/upgrade` exists, that is the whole deploy.
- **Roll back:** restore the backup over the Caddyfile in place (`cat Caddyfile.bak-2026-10-16 > Caddyfile`, which keeps the bind mount's inode), then run `docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`.

## The wizard

`publish.sh` walks the person through the steps only they can do:

1. Add the proxied Cloudflare DNS record for the pages, and the strict-SSL exception if Cloudflare answers 526.
2. Optionally turn off Always Use HTTPS so `na` and `gl` renew. The pages don't need this, but their origin certificates end 30 Oct, because Cloudflare's redirect sends Let's Encrypt's `http://` check to new-api.
3. Fill in Branding.
4. Press Publish app.
5. Consent again from the Signup mailbox.
6. Start the day-8 check.

It runs beside the helper in `~/lab1-gmail-spike/` on the VM, and resumes from a stage with `bash publish.sh <stage>`.

`gmail_spike.py` is the helper from [Check that API drafts edit in Gmail iOS and that tokens outlive 7 days](https://github.com/ultrasadness/lab1/issues/17) (branch `task/gmail-checks`), with two changes:

- The day-8 check now comments on ticket 31.
- A consent records `refresh_token_expires_in`: the field and its number, or that it is absent. It never records the token.
