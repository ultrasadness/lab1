// What a read sees of a page: its text, its visible forms and their fields, and its links.
// takeSnapshot runs inside the page through page.evaluate, so it must not use anything outside its own body:
// its helpers, such as shown(), have copies in the other functions that run in a page (walls.ts).
import type { Field, Form, Link, Snapshot, SubmitControl } from './api.ts';

export function takeSnapshot(): Snapshot {
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
      if (!seen.has(key)) {
        seen.add(key);
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

  const fieldOf = (el: Element): Field => {
    const type =
      el instanceof HTMLInputElement ? el.type : el instanceof HTMLSelectElement ? 'select' : el instanceof HTMLTextAreaElement ? 'textarea' : (el.getAttribute('role') ?? 'textbox');
    const field: Field = {
      type,
      name: el.getAttribute('name') || null,
      label: labelOf(el),
      required: (isNative(el) && el.required) || el.getAttribute('aria-required') === 'true',
      autocomplete: clean(el.getAttribute('autocomplete')) || null,
      links: linksIn(labelAnchorsOf(el)),
    };
    if (el instanceof HTMLSelectElement) {
      field.value = el.value;
      field.options = Array.from(el.options).map((o) => ({ label: clean(o.label || o.text), value: o.value, selected: o.selected }));
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
  const radioGroupOf = (radios: HTMLInputElement[]): Field => {
    const first = radios[0]!;
    const fieldset = first.closest('fieldset');
    return {
      type: 'radio',
      name: first.name || null,
      label: clean(fieldset?.querySelector('legend')?.textContent) || clean(first.closest('[role=radiogroup]')?.getAttribute('aria-label')),
      required: radios.some((r) => r.required),
      autocomplete: null,
      options: radios.map((r) => ({ label: labelOf(r), value: r.value, selected: r.checked })),
      links: [],
    };
  };

  // A choice keeps its first radio's place among the fields.
  const fieldsOf = (els: Element[]): Field[] => {
    const entries: (Element | HTMLInputElement[])[] = [];
    const groups = new Map<string, HTMLInputElement[]>();
    for (const el of els) {
      if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) {
        const group = groups.get(el.name);
        if (group) group.push(el);
        else {
          groups.set(el.name, [el]);
          entries.push(groups.get(el.name)!);
        }
      } else entries.push(el);
    }
    return entries.map((e) => (Array.isArray(e) ? radioGroupOf(e) : fieldOf(e)));
  };

  const submitsOf = (form: HTMLFormElement): SubmitControl[] =>
    Array.from(form.elements)
      .filter(
        (e): e is HTMLButtonElement | HTMLInputElement =>
          (e instanceof HTMLButtonElement && e.type === 'submit') || (e instanceof HTMLInputElement && (e.type === 'submit' || e.type === 'image')),
      )
      .filter(shown)
      .map((e) => ({
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
  for (const [owner, els] of byOwner) {
    if (!owner) continue;
    const fields = fieldsOf(els);
    forms.push({
      formElement: true,
      action: owner.hasAttribute('action') ? owner.action : null,
      method: owner.method,
      fields,
      submits: submitsOf(owner),
      links: linksIn([...Array.from(owner.querySelectorAll('a')), ...els.flatMap(labelAnchorsOf)]),
    });
  }
  const loose = byOwner.get(null);
  if (loose) {
    forms.push({
      formElement: false,
      action: null,
      method: null,
      fields: fieldsOf(loose),
      submits: [],
      links: linksIn(loose.flatMap(labelAnchorsOf)),
    });
  }

  return {
    url: location.href,
    title: clean(document.title),
    text: (document.body?.innerText ?? '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim(),
    forms,
    links: linksIn(all.filter((el) => el instanceof HTMLAnchorElement)),
  };
}
