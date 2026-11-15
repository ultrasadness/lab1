# Plain code submits a Registration after a page check, and no Claude model prepares one

English | [中文](0005-plain-code-submits-a-registration-after-a-page-check.zh.md)

After the person approves a Walkthrough, the Assistant fills the form and submits it itself. But the submit is never a model's action. The fill run ends by naming the button to press. Plain code then checks the filled page and presses that button only if the page matches what was approved. If it doesn't match, the person gets a screenshot of the filled form and one Submit tap on Discord. Earlier, every Registration ended with the person pressing submit in a Takeover. That rested on Anthropic's Usage Policy ("Utilize automation in account creation"), which no other provider's policy matches. With Pi as the harness and no Claude model preparing a Registration, the clause no longer applies, and the person wanted as little friction as the design safely allows. Decided in [Does Claude's Usage Policy allow the Assistant to submit a Registration?](https://github.com/ultrasadness/lab1/issues/15).

## Considered Options

- **The person always submits, in a Takeover** (the line until this re-check): safe under any provider. Rejected because it costs a phone session on every clean Registration, and its only policy reason is gone.
- **The person submits with one Discord tap every time:** a screenshot of the filled form and a Submit button. Kept as the fallback when the check fails, not as the default.
- **The model presses submit during the fill run:** simplest. Rejected because injected page text, or a relay that rewrites tool calls, could then create an account. With plain code pressing the button, the model's browser tool has no submit action at all.
- **Allowing Claude models and checking per run:** let a Claude model prepare Registrations, and send any Registration a Claude model filled to a Takeover, based on the gateway log. Rejected: it adds a second route to save nothing, since the person uses no Claude model elsewhere.

## Consequences

- **The check:** all of these must hold before plain code presses anything. It looks only at the form the named button submits, including fields tied to it by `form=`. Fields elsewhere on the page, and hidden inputs, are ignored.
  - The top-level page is on the signup host the Walkthrough names. That host comes from reading the signup page before Approval, and it may be an auth vendor's hosted page rather than the Product's own domain.
  - Every visible field is in one of four states. It is filled from a Walkthrough key and holds that key's approved value (either Signup identity address counts). It is filled by reference. It was filled by the person in a Takeover. Or it is empty. Any other value fails the check, including one the page preset or a page script changed.
  - The browser's own validity check passes, so no required field is empty.
  - The only box ticked without the person's say is a required terms box, and its links point to the terms the Walkthrough links.

  Continue/Next and Join waitlist are pressed under the same check. The check first required every field to be named in the Walkthrough. Now a field the Walkthrough never named may stay empty: the read before Approval sees only a form's first page, so naming every field would fail every later page. Refined in [What happens when a Registration hits a wall, and where do borderline in-page actions fall?](https://github.com/ultrasadness/lab1/issues/10).
- **A failed check** goes to the Submit tap when the person can see the difference on the screenshot: an unapproved value or choice. Three failures go back as an amended Walkthrough instead: a required field with no approved value, different terms or a new box asking for agreement, and a page on another host. The amended Walkthrough is a new version, approved within the same browser session.
- **Verification:** an emailed code is filled by reference and Verify pressed. The verification link is opened by plain code, by reference. Both happen only when all of these hold. Otherwise the person taps it in Gmail.
  - Gmail's own authentication verdict on the mail shows DMARC pass for the Product's domain or one of its subdomains. The From header alone never counts.
  - Gmail received it within 1 minute of the form being submitted.
  - It holds exactly one code or link.
  - Plain code acts within 2 minutes of Gmail receiving it, since a code or link expires within minutes. A mail read
    late, as after an outage, goes to the person.

  Sharpened in [Which Gmail permissions does the Assistant hold, and what may it do with them?](https://github.com/ultrasadness/lab1/issues/16), and the last condition in [Verify a Registration by plain code](https://github.com/ultrasadness/lab1/issues/58).
- **What stays the person's:**
  - OAuth consent ("Sign in with Google"), which in practice is a Handoff.
  - A Product whose terms ban bot-made accounts, which goes straight to a Handoff. A Product whose terms ban only automated access takes the normal route, with the clause quoted in its Dossier.
  - Registering through a Product's own signup API stays ruled out, because the check is built around a web page.
- **Gateway:** no model role that prepares a Registration maps to a Claude model. On OpenRouter, the model is named and Anthropic is excluded as a host. A relay is judged by the model it advertises.
- **A Takeover is now only for walls.**
