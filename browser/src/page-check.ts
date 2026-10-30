// The page check (ADR 0005, #10): what must hold of a filled page before plain code presses anything. It judges only
// the form the named button submits, from what the page holds in each visible field of it and what the session filled
// there. Hidden inputs and fields elsewhere on the page never reach it.
import type { CheckFailure, CheckRequest, CheckRule, PageCheck } from './api.ts';
import type { ButtonState, FieldState } from './snapshot.ts';

export interface CheckedPage {
  /** The top-level page's host. */
  host: string;
  /** The visible fields of the button's form. */
  fields: FieldState[];
  button: ButtonState;
}

/**
 * @param fills what went into each of the session's fills: the approved value, an option's label, `ticked` or
 *   `left unticked`, or the Secret filled by reference.
 * @param refs the latest snapshot's field refs, which a field's state indexes.
 */
export function judge(page: CheckedPage, fills: { value: string }[], refs: string[], request: CheckRequest): PageCheck {
  const failures: CheckFailure[] = [];
  const fail = (rule: CheckRule, field: { label: string; ref: number } | null, validity?: string) =>
    failures.push({ rule, field: field?.label ?? null, ref: field && field.ref >= 0 ? (refs[field.ref] ?? null) : null, ...(validity ? { validity } : {}) });

  if (page.host !== request.signupHost) fail('off-host', null);

  // Either Signup identity address counts for a field filled with one.
  const holds = (held: string, approved: string) => held === approved || (request.identity.includes(held) && request.identity.includes(approved));
  for (const field of page.fields) {
    const fill = field.fill >= 0 ? fills[field.fill] : undefined;
    if (field.kind === 'box') {
      const approved = fill?.value === 'ticked';
      const terms = field.links.length > 0;
      if (field.checked) {
        // A ticked box that links documents accepts them, so they must be the approved terms.
        if (terms && !field.links.every((href) => request.terms.includes(href))) fail('other-terms', field);
        else if (!approved && !(field.required && terms)) fail('unapproved-box', field);
      } else if (approved) {
        fail('unapproved-value', field);
      }
      continue;
    }
    if (fill ? !holds(field.value, fill.value) : field.value !== '') fail('unapproved-value', field);
  }

  for (const invalid of page.button.invalid) fail('invalid', invalid, invalid.validity);
  return { pass: failures.length === 0, failures };
}
