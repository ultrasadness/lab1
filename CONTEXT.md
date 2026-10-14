# Growing Personal Assistant

A personal assistant that keeps working for one person: it watches Product Hunt for new products that match their interests, prepares an account registration for each worthwhile one, handles the email that registering produces, and asks before anything consequential. It grows by turning the person's corrections into rules it applies next time.

## Language

### Discovery

**Product**:
Software or an online service someone makes that you could use, whether or not it needs an account: one per website or company. Hardware, and announcements with nothing to use, are not Products.
_Avoid_: App, tool, startup

**Launch**:
One appearance of a Product on Product Hunt on a given day. A Product can have several Launches, but at most one Registration.
_Avoid_: Post, listing

**Featured Launch**:
A Launch that Product Hunt places on the day's main list. Most Launches on a given day are not featured, and the Miner judges only Featured Launches.
_Avoid_: Top post, homepage launch

**Maker comment**:
A comment the Product's own makers post on its Launch; often where an Offer appears.
_Avoid_: First comment, founder comment

**Offer**:
Better-than-usual terms a Product gives for signing up or paying, such as a discount, credits or a longer free plan, with its code, deadline or cap when it has them.
_Avoid_: Coupon, deal, promo

**Interest scope**:
The person's stated preferences that each Launch is judged against.
_Avoid_: Preferences, filters, tags

**Fit**:
How well one Launch matches the Interest scope, as a whole number from 0 to 10, judged on that Launch alone.
_Avoid_: Score, relevance, rating

**Day's line**:
The lowest Fit that gets a Dossier on a given Pacific day: the Fit of that day's N-th best Launch, where N grows with how many Launches were featured, but never below a fixed floor. It is drawn once the whole day is judged, and a Correction never moves it.
_Avoid_: Threshold, cutoff, quota

**Miner**:
The part of the Assistant that turns a day's Launches into Dossiers, or into Skips.
_Avoid_: Scraper, crawler

**Skip**:
A one-line reason the Miner gives for not preparing a Dossier for a Launch, usually naming its Fit and the Day's line. Skips exist so they can be corrected.

**Dossier**:
The Assistant's write-up of one Product: whether it is open or waitlisted, how to register, any Offers, scope and potential use for the person. Every claim cites its source.
_Avoid_: Report, summary, notes

### Acting

**Walkthrough**:
The concrete registration plan put to the person for Approval: which fields, which values, which Signup identity, which terms are accepted, and what happens on submit.
_Avoid_: Plan, proposal, guide

**Approval**:
The person's explicit yes to one exact Walkthrough, letting the Assistant prepare that Registration and submit it if the filled form matches what was shown; to one exact filled form, letting the Assistant submit it; or to one exact Reply draft. It covers only what was shown.
_Avoid_: Confirmation, consent, OK

**Registration**:
The act of creating an account for a Product, from its Approval on, and its outcome: _registered_, _waitlisted_, _handed off_, or _abandoned_. A Product has at most one. A waitlisted Registration that later receives an invite, a handed-off one whose verification email arrives, or an abandoned one the person starts again, is the same Registration moving forward.
_Avoid_: Signup, account creation, onboarding

**Wall**:
Something in a Registration that filling approved values can't get past, such as a bot check, sign-in only through another account, a phone check or card fields. A Registration at a wall goes to a Takeover or a Handoff, or is abandoned.
_Avoid_: Blocker, obstacle, CAPTCHA (alone)

**Takeover**:
The person taking live control of the Assistant's browser session from their phone, to get past a wall.
_Avoid_: Remote control, screen share

**Handoff**:
The rest of a Registration given to the person to finish on their own device, with what is needed to finish it.
_Avoid_: Escalation, fallback

**Signup identity**:
The name and email address a Registration uses. Its address always delivers to the Signup mailbox.
_Avoid_: Account, alias, persona

**Signup mailbox**:
The mailbox kept only for Registrations. Every Signup identity's address delivers to it, and it is the only mailbox the Assistant reads.
_Avoid_: Inbox, signup Gmail, registration account

**Reply draft**:
An email reply the Assistant prepares from the Personal database; only the person's approved final version is ever sent.
_Avoid_: Response, message

**Hard limit**:
Something the Assistant never does, even with Approval in the moment.
_Avoid_: Guardrail, policy

**Secret**:
A value that lets whoever holds it act as the person on a Product: a password, a verification code, a magic or reset link, an access token. The Assistant never puts a Secret into a model's input or into a message to the person, not even a short-lived code; where a Secret must reach a form, it is filled by reference. Not the same as the sensitive data the Profile leaves out.
_Avoid_: Credential, sensitive data

**Password vault**:
The collection in the person's password manager that holds each Registration's password. The Assistant adds to it and fills from it by reference; the person reads it on their own devices and is the only one who changes a password once the Registration is done. The Personal database never holds a Secret; it only points into the Password vault.
_Avoid_: Keychain, password store, vault (alone)

### Memory

**Personal database**:
The person's facts and the Assistant's records about them, kept where the person can read and edit them directly.
_Avoid_: Knowledge base, memory, vault

**Profile**:
The everyday facts about the person: names they go by and the email addresses to use. Their everyday address is a fact here, never a Signup identity. Deliberately excludes sensitive data.
_Avoid_: User info, bio

**Correction**:
Something the person tells the Assistant it got wrong. It always fixes the item it was made on, and may also change the Interest scope or become a Rule.
_Avoid_: Feedback, complaint

**Rule**:
A general statement of how the Assistant should work, drawn from a Correction and kept only once the person says so, then applied in every later session. Facts about the person are never Rules; they belong in the Profile.
_Avoid_: Memory, preference, instruction
