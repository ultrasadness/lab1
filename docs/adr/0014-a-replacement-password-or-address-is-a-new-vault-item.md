# A replacement password or address is a new vault item, and an outcome goes only in `registration.md`

English | [中文](0014-a-replacement-password-or-address-is-a-new-vault-item.zh.md)

[ADR 0004](./0004-random-passwords-in-a-bitwarden-collection-the-person-owns.md) has the Assistant create one vault item at Approval and never change or delete one. It also gives a form that refuses the password a new one within the same Approval, switches the username to the plain address when `+` is refused, and keeps an _abandoned_ Registration's outcome in its item's notes. Without changing an item, none of the three can be done to the item made at Approval. So each replacement is a new item, and an outcome is written only to `registration.md`. Decided in [Fill and press a clean Registration](https://github.com/ultrasadness/lab1/issues/56). This narrows ADR 0004, which stays as it is otherwise, and [ADR 0006](./0006-registration-browser-in-its-own-container-driven-through-fixed-actions.md)'s one fill run per page.

## Considered Options

- **The bot edits its own Registration's item until the outcome:** one item per Product, always right, and the notes could hold the outcome. Rejected for now: it would be the first time the bot changes an item, a mistake in it would land on a password already in use, and creating alone is simpler. It is the fallback if two items for one site confuse AutoFill in use.
- **Creating the item only once the form has taken the password:** no stale item, but the password would exist only in the bot's memory while the form is filled, and a Handoff needs the item before any form is filled.

## Consequences

- **A form that refuses the password** gets a new item with a narrower password: letters and digits alone, 24 characters, then 16 for a form that refuses that one too. A form is filled again at most twice on one page.
- **A form that refuses `+`** gets a new item whose username is the plain address, when the Walkthrough has a password field. It keeps the password the page holds already, so the account's password is the new item's whichever field the form refused. With no password field, there is no item, and only the address changes.
- **The page is filled again** under the same Approval. Its next fill run must fill the refused field again before plain code takes a button from it, since the page may still hold what it refused, and the page gets at most 3 fill runs in all.
- **Each new item's notes** name the item it replaces and why, as "Replaces item … : the form refused its password." Its name and website are the first item's.
- **The first item stays.** After a refused password it holds one no account uses, and after a refused `+` the account's password beside an address the form refused. The person deletes it in Bitwarden when they like, and until then AutoFill offers both for that site.
- **`registration.md`** names on each approved line the item then holding the password, and gets a line for each replacement, naming both items.
- **An outcome is never written to an item's notes.** `registration.md` holds it, and an _abandoned_ Registration's item stays as it was made.
- **A replacement is made once.** The bot keeps its notes in the live store before it asks `bw`, and reads the Password vault for an item with those notes before it creates one, as [ADR 0007](./0007-live-state-in-sqlite-and-an-uncertain-step-counts-as-done.md) has it for the first item.
- **How the bot learns of a refusal:** only from the fill run, which reads the page's own words and ends with `finish(stuck)` and the reason `password-refused` or `plus-refused`. A refusal shown only after the final press isn't caught, since no model reads the page then. The fallback, if a form that refuses through the browser's own validity with no words is seen waiting at a failed check, is to read the page check's `invalid` on that field as a refusal too.
