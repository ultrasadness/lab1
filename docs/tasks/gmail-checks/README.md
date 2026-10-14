# Gmail checks for the Signup mailbox

Throwaway assets for [Check that API drafts edit in Gmail iOS and that tokens outlive 7 days](https://github.com/ultrasadness/lab1/issues/17), run on 2026-10-14.

- `results.md`: what the run found, addresses and names masked. The resolution comment on the ticket is the summary.
- `wizard.sh`: walks the person through making the Signup mailbox, a Google Cloud OAuth client and consent, then each check. Resume at a stage with `bash wizard.sh <stage>`.
- `gmail_spike.py`: the stdlib-only helper the wizard calls. It never prints a Secret.

To run them again, copy both scripts to a private directory outside the repo (`mkdir -m 700`). They write `.env`, `token.json`, `state.json` and `results.md` next to themselves.
