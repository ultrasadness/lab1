# Growing Personal Assistant

A personal assistant that keeps working for one person: it watches Product Hunt for new products that match their interests, prepares an account registration for each worthwhile one, handles the email that registering produces, and asks before anything consequential. It grows by turning the person's corrections into rules it applies next time.

## Language

### Discovery

**Product**:
A thing someone makes and you could hold an account with: one per website or company.
_Avoid_: App, tool, startup

**Launch**:
One appearance of a Product on Product Hunt on a given day. A Product can have several Launches; only the first can lead to a Registration.
_Avoid_: Post, listing

**Featured Launch**:
A Launch that Product Hunt places on the day's main list. Most Launches on a given day are not featured.
_Avoid_: Top post, homepage launch

**Maker comment**:
A comment the Product's own makers post on its Launch; often where an offer or coupon appears.
_Avoid_: First comment, founder comment

**Interest scope**:
The person's stated preferences that each Launch is judged against.
_Avoid_: Preferences, filters, tags

**Miner**:
The part of the Assistant that turns a day's Launches into Dossiers, or into Skips.
_Avoid_: Scraper, crawler

**Skip**:
A one-line reason the Miner gives for not preparing a Dossier for a Launch. Skips exist so they can be corrected.

**Dossier**:
The Assistant's write-up of one Product: whether it is open or waitlisted, how to register, usable coupons, scope and potential use for the person. Every claim cites its source.
_Avoid_: Report, summary, notes

### Acting

**Walkthrough**:
The concrete registration plan put to the person for Approval: which fields, which values, which Signup identity, and what happens on submit.
_Avoid_: Plan, proposal, guide

**Approval**:
The person's explicit yes to one exact Walkthrough, letting the Assistant prepare that Registration, or to one exact Reply draft. It covers only what was shown, and never covers submitting a Registration: that is always the person's own act.
_Avoid_: Confirmation, consent, OK

**Registration**:
The act of creating an account for a Product, and its outcome: _registered_, _waitlisted_, _handed off_, or _abandoned_. A waitlisted Registration that later receives an invite, or a handed-off one whose verification email arrives, is the same Registration moving forward.
_Avoid_: Signup, account creation, onboarding

**Takeover**:
The person taking live control of the Assistant's browser session from their phone, to press the buttons that send their data to the Product or to get past a wall.
_Avoid_: Remote control, screen share

**Handoff**:
The rest of a Registration given to the person to finish on their own device, with what is needed to finish it.
_Avoid_: Escalation, fallback

**Signup identity**:
The name and email address a Registration uses.
_Avoid_: Account, alias, persona

**Reply draft**:
An email reply the Assistant prepares from the Personal database; only the person's approved final version is ever sent.
_Avoid_: Response, message

**Hard limit**:
Something the Assistant never does, even with Approval in the moment.
_Avoid_: Guardrail, policy

### Memory

**Personal database**:
The person's facts and the Assistant's records about them, kept where the person can read and edit them directly.
_Avoid_: Knowledge base, memory, vault

**Profile**:
The everyday facts about the person: names they go by and the email addresses to use. Deliberately excludes sensitive data.
_Avoid_: User info, bio

**Correction**:
Something the person tells the Assistant it got wrong.
_Avoid_: Feedback, complaint

**Rule**:
A Correction kept in a form the Assistant applies in future sessions.
_Avoid_: Memory, preference, instruction
