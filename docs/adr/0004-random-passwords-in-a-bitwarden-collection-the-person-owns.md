# Registration passwords are random and kept in a Bitwarden collection the person owns

Each Registration gets its own random password. The bot generates it, never the model, when the person approves the Walkthrough, and saves it as an item in the Password vault. The Password vault is a *Registrations* collection in a free two-person Bitwarden organization owned by the person's own account. The bot has its own free Bitwarden account, on a Signup mailbox plus-address, as the organization's second member, with access to that collection only. The person already uses Bitwarden, so the password reaches their iPhone through Bitwarden's iOS AutoFill, both at signup in a Handoff and at every later login, and their personal vault never touches the VM. Decided in [How are Registration passwords made, kept, and reached from the iPhone?](https://github.com/ultrasadness/lab1/issues/7).

## Considered Options

- **Passwords derived from one base secret** (`HMAC(secret, root domain)`), the person's starting idea. HMAC removes the risk of a visible pattern, but derivation still has three costs:
  - **State for each site:** sites' length and character rules, and a counter for each reset, still have to be stored.
  - **One key to everything:** the bot would hold the base secret to fill by reference, so one leak exposes every past and future password, and rotating the secret changes every site's password.
  - **No AutoFill on the iPhone:** LessPass, the maintained option, appears to be copy-and-paste only, and that hurts most in a Handoff.
- **The bot logging into the person's own Bitwarden account:** the simplest sharing, but it puts the person's master password and whole personal vault on the VM.
- **The bot's account owning the organization:** the same sharing, but the bot could delete the organization and everything in it. It is the fallback only if the person already owns a free organization, since each account can own one.
- **Vaultwarden self-hosted on the VM over Tailscale:** no third party, but another server to run, back up and keep compatible with Bitwarden's clients (a client release broke against it in July 2026). No source confirms that iOS AutoFill works through it.
- **Apple Passwords:** nothing on a server can write to it; every import starts on the person's device.
- **An encrypted file on the VM, with passwords sent over Discord:** no Secret goes into a message to the person. Discord is not end-to-end encrypted and keeps deleted messages in its backups.

## Consequences

- **No model ever sees a password.** The bot's interface offers the model two things: create this Registration's password, and fill it into a field by reference. The Walkthrough names the vault item and never shows the value. Registration records and the bot's logs hold only the item ID.
- **Each item** is named after the Product. Its website is the Product's root domain, which AutoFill needs, and its username is the Signup identity's address. The default password is 24 characters with all character classes. If a form refuses it, the bot makes a new one within the same Approval. When the Walkthrough has no password field, no item is created.
- **The Assistant only creates items.** It never changes or deletes one. An _abandoned_ Registration's item stays, with the outcome in its notes. Changing a password after the Registration is the person's own act.
- **The VM holds the bot account's API key and unlock password** in the bot's credential directory. The bot runs `bw` for each operation, with the session key in memory only, so no local Bitwarden API (`bw serve`) listens. Decided in [Where do the Assistant's Secrets and tokens live, and how is each one obtained and replaced?](https://github.com/ultrasadness/lab1/issues/25); see [ADR 0009](./0009-the-bot-runs-as-its-own-user-and-holds-every-token-outside-the-containers.md).
