// What a read or a session sees of a page: its text, its visible forms and their fields, and its links. In a session
// it also gives each field, submit control and link a ref, and gives plain code each visible field's raw state, which
// the page check and the fingerprint judge.
// takeSnapshot runs inside the page through page.evaluate, so it must not use anything outside its own body:
// its helpers, such as shown(), have copies in the other functions that run in a page (walls.ts).
import type { Field, Form, Link, Snapshot, SubmitControl } from './api.ts';

/** What a session hands in: the elements it filled, each fill's with its mark, and the latest snapshot's field refs. */
export interface SessionView {
  fills: { elements: Element[]; mark: string }[];
  refs: Element[][];
  /** The submit control plain code asks about, or null. */
  button: Element | null;
}

/** A visible field as plain code sees it, never shown to a model. */
export interface FieldState {
  /** `text` for anything typed into, `select` and `radio` for a choice by label, `box` for anything ticked. */
  kind: 'text' | 'select' | 'radio' | 'box';
  label: string;
  /** The raw value: typed text, or the chosen option's label. Empty for none, such as a placeholder option. */
  value: string;
  checked: boolean;
  required: boolean;
  /** The links in a box's label, such as the terms it accepts. */
  links: string[];
  /** Which of the session's fills holds this field, or -1. */
  fill: number;
  /** Which of the latest snapshot's field refs names it, or -1. */
  ref: number;
}

export interface ButtonState {
  /** Whether it is a native submit control of a form. */
  submit: boolean;
  /** The form it submits, as an index into the snapshot's forms, or -1. */
  form: number;
  onlySubmit: boolean;
  /** Whether each of the session's fills is in that form, or no longer shown, as an earlier step's (#55). */
  fillsInForm: boolean[];
  /** Each control of the form that fails its validity, hidden ones included, as form.checkValidity() judges. */
  invalid: { label: string; ref: number; validity: string }[];
}

export interface PageView {
  snapshot: Snapshot;
  /** In a session: the elements the refs point at, and each ref with its elements' indexes. */
  elements: Element[];
  refs: { ref: string; kind: 'field' | 'submit'; elements: number[] }[];
  /** In a session: each snapshot form's visible fields, in the same order. */
  states: FieldState[][];
  button: ButtonState | null;
}

export function takeSnapshot(session: SessionView | null): PageView {
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

  function* walk(root: Document | ShadowRoot): Generator<Element> {
    for (const el of Array.from(root.querySelectorAll('*'))) {
      yield el;
      if (el.shadowRoot) yield* walk(el.shadowRoot);
    }
  }
  const all = Array.from(walk(document));

  const shown = (el: Element) => {
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && el.checkVisibility({ visibilityProperty: true });
  };
  const labelsOf = (el: Element): HTMLLabelElement[] => ('labels' in el && el.labels ? Array.from(el.labels as NodeListOf<HTMLLabelElement>) : []);
  const labelAnchorsOf = (el: Element) => labelsOf(el).flatMap((l) => Array.from(l.querySelectorAll('a')));
  // A styled checkbox often hides the native box and shows its label instead.
  const fieldShown = (el: Element) => shown(el) || (el.matches('input[type=checkbox], input[type=radio]') && labelsOf(el).some(shown));

  // In a session, every field, submit control and link gets a ref; links share one per text and URL.
  const elements: Element[] = [];
  const refs: PageView['refs'] = [];
  const counts = { field: 0, submit: 0 };
  const refOf = (kind: 'field' | 'submit', els: Element[]) => {
    const ref = `${kind === 'field' ? 'f' : 'b'}${++counts[kind]}`;
    refs.push({ ref, kind, elements: els.map((el) => elements.push(el) - 1) });
    return ref;
  };
  // A form's own properties, which a control named `elements` or `action` would otherwise stand in for.
  const formProperty = <T>(form: HTMLFormElement, name: 'elements' | 'action' | 'method'): T =>
    Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, name)!.get!.call(form) as T;
  const formControls = (form: HTMLFormElement) => Array.from(formProperty<HTMLFormControlsCollection>(form, 'elements'));
  const linkRefs = new Map<string, string>();
  const groupOf = (groups: Element[][], els: Element[]) => groups.findIndex((group) => els.some((el) => group.includes(el)));
  const markOf = (els: Element[]) => {
    const i = session ? groupOf(session.fills.map((f) => f.elements), els) : -1;
    return i >= 0 ? session!.fills[i]!.mark : undefined;
  };

  const linkOf = (a: HTMLAnchorElement): Link => ({
    text: clean(a.innerText) || clean(a.getAttribute('aria-label')) || clean(a.querySelector('img')?.alt),
    href: a.href,
  });
  const linksIn = (anchors: Element[]): Link[] => {
    const seen = new Set<string>();
    const links: Link[] = [];
    for (const a of anchors) {
      if (!(a instanceof HTMLAnchorElement) || !a.hasAttribute('href') || a.protocol === 'javascript:' || !shown(a)) continue;
      const link = linkOf(a);
      const key = `${link.text}\n${link.href}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (session) {
        if (!linkRefs.has(key)) linkRefs.set(key, `l${linkRefs.size + 1}`);
        links.push({ ref: linkRefs.get(key)!, ...link });
      } else {
        links.push(link);
      }
    }
    return links;
  };

  // A label's own words, without the text of the controls inside it (a select's options, say).
  const labelText = (label: Element) => {
    const copy = label.cloneNode(true) as Element;
    copy.querySelectorAll('input, select, textarea, button, option').forEach((n) => n.remove());
    return clean(copy.textContent);
  };
  const labelOf = (el: Element): string => {
    const root = el.getRootNode() as Document | ShadowRoot;
    const labelledBy = (el.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .map((id) => (id ? root.getElementById(id) : null))
      .filter((e): e is HTMLElement => e !== null)
      .map((e) => clean(e.textContent))
      .join(' ');
    return (
      clean(labelledBy) ||
      clean(el.getAttribute('aria-label')) ||
      clean(labelsOf(el).map(labelText).join(' ')) ||
      clean(el.getAttribute('placeholder')) ||
      clean(el.getAttribute('title'))
    );
  };

  type NativeField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  const isNative = (el: Element): el is NativeField =>
    el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
  const NOT_FIELDS = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
  // Controls a page builds from divs, which say what they are only through their role.
  const CUSTOM_CONTROLS = '[role=checkbox], [role=switch], [role=radio], [role=combobox], [role=textbox], [role=listbox], [contenteditable=""], [contenteditable=true]';
  const isField = (el: Element) => {
    if (isNative(el)) return !(el instanceof HTMLInputElement && NOT_FIELDS.has(el.type));
    return el.matches(CUSTOM_CONTROLS) && !el.querySelector('input, select, textarea') && !el.closest('input, select, textarea');
  };
  const ownerOf = (el: Element): HTMLFormElement | null => (isNative(el) ? el.form : el.closest('form'));
  const typeOf = (el: Element) =>
    el instanceof HTMLInputElement ? el.type : el instanceof HTMLSelectElement ? 'select' : el instanceof HTMLTextAreaElement ? 'textarea' : (el.getAttribute('role') ?? 'textbox');
  const optionLabel = (o: HTMLOptionElement) => clean(o.label || o.text);

  const fieldOf = (el: Element): Field => {
    const type = typeOf(el);
    const field: Field = {
      ...(session ? { ref: refOf('field', [el]) } : {}),
      type,
      name: el.getAttribute('name') || null,
      label: labelOf(el),
      required: (isNative(el) && el.required) || el.getAttribute('aria-required') === 'true',
      autocomplete: clean(el.getAttribute('autocomplete')) || null,
      links: linksIn(labelAnchorsOf(el)),
    };
    // A session's snapshot shows what filled a field, never what the field holds.
    if (session) {
      const mark = markOf([el]);
      if (mark) field.filled = mark;
      if (el instanceof HTMLSelectElement) field.options = Array.from(el.options).map((o) => ({ label: optionLabel(o), value: o.value }));
      return field;
    }
    if (el instanceof HTMLSelectElement) {
      field.value = el.value;
      field.options = Array.from(el.options).map((o) => ({ label: optionLabel(o), value: o.value, selected: o.selected }));
    } else if (el instanceof HTMLInputElement && (type === 'checkbox' || type === 'radio')) {
      field.checked = el.checked;
    } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el.value && type !== 'password') field.value = el.value;
    } else if (type === 'checkbox' || type === 'switch' || type === 'radio') {
      field.checked = el.getAttribute('aria-checked') === 'true';
    } else if (clean(el.textContent)) {
      field.value = clean(el.textContent);
    }
    return field;
  };

  // Radios sharing a name are one choice, labelled by their fieldset's legend.
  const radioGroupLabel = (first: Element) =>
    clean(first.closest('fieldset')?.querySelector('legend')?.textContent) || clean(first.closest('[role=radiogroup]')?.getAttribute('aria-label'));
  const radioGroupOf = (radios: HTMLInputElement[]): Field => {
    const first = radios[0]!;
    const mark = markOf(radios);
    return {
      ...(session ? { ref: refOf('field', radios) } : {}),
      type: 'radio',
      name: first.name || null,
      label: radioGroupLabel(first),
      required: radios.some((r) => r.required),
      autocomplete: null,
      ...(mark ? { filled: mark } : {}),
      options: radios.map((r) => (session ? { label: labelOf(r), value: r.value } : { label: labelOf(r), value: r.value, selected: r.checked })),
      links: [],
    };
  };

  // What plain code sees of a field: its raw value or state.
  const stateOf = (els: Element[]): FieldState => {
    const el = els[0]!;
    const type = typeOf(el);
    const base = {
      label: labelOf(el),
      value: '',
      checked: false,
      required: (isNative(el) && el.required) || el.getAttribute('aria-required') === 'true',
      links: labelAnchorsOf(el).flatMap((a) => (a instanceof HTMLAnchorElement && a.hasAttribute('href') ? [a.href] : [])),
      fill: session ? groupOf(session.fills.map((f) => f.elements), els) : -1,
      ref: session ? groupOf(session.refs, els) : -1,
    };
    if (els.length > 1 || (el instanceof HTMLInputElement && type === 'radio' && el.name)) {
      const radios = els as HTMLInputElement[];
      const checked = radios.find((r) => r.checked);
      return { ...base, kind: 'radio', label: radioGroupLabel(el), value: checked ? labelOf(checked) : '', required: radios.some((r) => r.required) };
    }
    if (el instanceof HTMLSelectElement) {
      const chosen = Array.from(el.selectedOptions).filter((o) => o.value !== '');
      return { ...base, kind: 'select', value: chosen.map(optionLabel).join(', ') };
    }
    if (el instanceof HTMLInputElement && (type === 'checkbox' || type === 'radio')) return { ...base, kind: 'box', checked: el.checked };
    if (isNative(el)) return { ...base, kind: 'text', value: el.value };
    if (type === 'checkbox' || type === 'switch' || type === 'radio') return { ...base, kind: 'box', checked: el.getAttribute('aria-checked') === 'true' };
    return { ...base, kind: type === 'combobox' || type === 'listbox' ? 'select' : 'text', value: clean(el.textContent) };
  };

  // A choice keeps its first radio's place among the fields.
  const entriesOf = (els: Element[]): Element[][] => {
    const entries: Element[][] = [];
    const groups = new Map<string, HTMLInputElement[]>();
    for (const el of els) {
      if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) {
        const group = groups.get(el.name);
        if (group) group.push(el);
        else {
          groups.set(el.name, [el]);
          entries.push(groups.get(el.name)!);
        }
      } else entries.push([el]);
    }
    return entries;
  };
  const fieldsOf = (entries: Element[][]): Field[] =>
    entries.map((e) => (e.length > 1 || (e[0] instanceof HTMLInputElement && e[0].type === 'radio' && e[0].name) ? radioGroupOf(e as HTMLInputElement[]) : fieldOf(e[0]!)));

  const isSubmit = (e: Element): e is HTMLButtonElement | HTMLInputElement =>
    (e instanceof HTMLButtonElement && e.type === 'submit') || (e instanceof HTMLInputElement && (e.type === 'submit' || e.type === 'image'));
  const shownSubmitsOf = (form: HTMLFormElement) => formControls(form).filter(isSubmit).filter(shown);
  const submitsOf = (form: HTMLFormElement): SubmitControl[] =>
    shownSubmitsOf(form).map((e) => ({
      ...(session ? { ref: refOf('submit', [e]) } : {}),
      label:
        e instanceof HTMLButtonElement
          ? clean(e.innerText) || clean(e.getAttribute('aria-label'))
          : clean(e.type === 'image' ? e.alt : e.value) || 'Submit',
      disabled: e.disabled,
    }));

  const byOwner = new Map<HTMLFormElement | null, Element[]>();
  for (const el of all) {
    if (!isField(el) || !fieldShown(el)) continue;
    const owner = ownerOf(el);
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), el]);
  }

  const forms: Form[] = [];
  const states: FieldState[][] = [];
  const owners: (HTMLFormElement | null)[] = [];
  // A session can press a form that shows only a button, such as a step that confirms what earlier ones filled.
  if (session) {
    for (const form of all) if (form instanceof HTMLFormElement && !byOwner.has(form) && shownSubmitsOf(form).length > 0) byOwner.set(form, []);
  }
  for (const [owner, els] of byOwner) {
    if (!owner) continue;
    const entries = entriesOf(els);
    forms.push({
      formElement: true,
      action: owner.hasAttribute('action') ? formProperty<string>(owner, 'action') : null,
      method: formProperty<string>(owner, 'method'),
      fields: fieldsOf(entries),
      submits: submitsOf(owner),
      links: linksIn([...Array.from(owner.querySelectorAll('a')), ...els.flatMap(labelAnchorsOf)]),
    });
    if (session) states.push(entries.map(stateOf));
    owners.push(owner);
  }
  const loose = byOwner.get(null);
  if (loose) {
    const entries = entriesOf(loose);
    forms.push({
      formElement: false,
      action: null,
      method: null,
      fields: fieldsOf(entries),
      submits: [],
      links: linksIn(loose.flatMap(labelAnchorsOf)),
    });
    if (session) states.push(entries.map(stateOf));
    owners.push(null);
  }

  // The form a submit control submits, and what the page check and press need to know of it.
  let button: ButtonState | null = null;
  const target = session?.button;
  if (target) {
    const form = isSubmit(target) ? target.form : null;
    const inForm = (el: Element) => (form ? (isNative(el) ? el.form === form : el.closest('form') === form) : false);
    const controls = form ? (formControls(form).filter((e) => 'validity' in e && (e as NativeField).willValidate) as NativeField[]) : [];
    // The browser's own check, which also shows the page's messages for the controls that fail.
    if (form) HTMLFormElement.prototype.checkValidity.call(form);
    const seen = new Set<string>();
    const invalid: ButtonState['invalid'] = [];
    const VALIDITY_FLAGS = ['valueMissing', 'typeMismatch', 'patternMismatch', 'tooLong', 'tooShort', 'rangeUnderflow', 'rangeOverflow', 'stepMismatch', 'badInput', 'customError'] as const;
    for (const el of controls) {
      if (el.validity.valid) continue;
      // A radio group fails as one.
      const key = el instanceof HTMLInputElement && el.type === 'radio' && el.name ? `radio:${el.name}` : '';
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      const group = key ? controls.filter((c) => c instanceof HTMLInputElement && c.type === 'radio' && c.name === el.name) : [el];
      const flag = VALIDITY_FLAGS.find((k) => el.validity[k]);
      invalid.push({ label: key ? radioGroupLabel(el) : labelOf(el), ref: groupOf(session.refs, group), validity: flag ?? 'customError' });
    }
    button = {
      submit: Boolean(form),
      form: form ? owners.indexOf(form) : -1,
      onlySubmit: form ? (() => {
        const submits = shownSubmitsOf(form);
        return submits.length === 1 && submits[0] === target;
      })() : false,
      fillsInForm: session.fills.map((f) => f.elements.every(inForm) || !f.elements.some(fieldShown)),
      invalid,
    };
  }

  return {
    snapshot: {
      url: location.href,
      title: clean(document.title),
      text: (document.body?.innerText ?? '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim(),
      forms,
      links: linksIn(all.filter((el) => el instanceof HTMLAnchorElement)),
    },
    elements,
    refs,
    states,
    button,
  };
}
