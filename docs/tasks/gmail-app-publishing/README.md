# Publish the Gmail OAuth app

Kept for [Publish the Gmail OAuth app with its pages on pot.dpdns.org, and check a fresh token outlives 7 days](https://github.com/ultrasadness/lab1/issues/31).

## The pages

The source is in [`ops/pages`](../../../ops/pages): home, privacy and terms. The privacy text is the one settled in [Which model routes may read Signup mailbox mail under Google's Limited Use rules?](https://github.com/ultrasadness/lab1/issues/30), with the app name set to Signup Assistant and the date to 16 October 2026. Any change to ADR 0010's line changes the privacy page first.

They are served by the VM's Caddy at `https://pot.dpdns.org/`, `/privacy` and `/terms`:

- The files sit in Caddy's data volume at `/data/sites/pot.dpdns.org`, so Caddy only needed a graceful reload, with no container restart.
- This block was appended to `~/vps-deploy/new-api/Caddyfile`. The file before the change is `Caddyfile.bak-2026-10-16` beside it.

  ```caddyfile
  pot.dpdns.org {
  	encode gzip
  	root * /data/sites/pot.dpdns.org
  	try_files {path} {path}.html
  	file_server
  }
  ```

- **Redeploy** after editing a page: `docker cp ops/pages/. caddy:/data/sites/pot.dpdns.org/`. Until `ops/upgrade` exists, that is the whole deploy.
- **Roll back:** restore the backup over the Caddyfile in place (`cat Caddyfile.bak-2026-10-16 > Caddyfile`, which keeps the bind mount's inode), then run `docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`.

## The wizard

`publish.sh` walks the person through the steps only they can do:

1. Add the Cloudflare DNS record for `pot.dpdns.org` and turn off Always Use HTTPS.
2. Fill in Branding.
3. Press Publish app.
4. Consent again from the Signup mailbox.
5. Start the day-8 check.

It runs beside the helper in `~/lab1-gmail-spike/` on the VM, and resumes from a stage with `bash publish.sh <stage>`.

`gmail_spike.py` is the helper from [Check that API drafts edit in Gmail iOS and that tokens outlive 7 days](https://github.com/ultrasadness/lab1/issues/17) (branch `task/gmail-checks`), with two changes:

- The day-8 check now comments on ticket 31.
- A consent records `refresh_token_expires_in`: the field and its number, or that it is absent. It never records the token.
