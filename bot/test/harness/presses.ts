// No test may ever see two presses for one *intended* mark (#56). Each press a page received is matched to a mark of its
// own: one the bot logged as `registration.press-intended`, or for the press of a verification code as
// `registration.verify-intended` (#58), in the same session, on the page as fingerprinted then, and didn't take back.
// Only a press the browser service refused takes its mark back, as `registration.press-refused` or
// `registration.verify-refused`, since a refusal comes before any click. A mark is used once, so a second press of one
// fails whatever else is marked.
import type { LogEntry } from '../../src/assistant.ts';
import type { SeenPress } from './fake-browser.ts';

/** The presses no mark accounts for, each said as the test failure names it; none when every press has its own. */
export function pressesWithoutMark(logs: readonly LogEntry[], presses: readonly Pick<SeenPress, 'session' | 'fingerprint' | 'button'>[]): string[] {
  const keyOf = (session: unknown, fingerprint: unknown) => `${String(session)} ${String(fingerprint).slice(0, 16)}`;
  const byPress = new Map<number, string>();
  const byVerification = new Map<number, string>();
  const marks = new Map<string, number>();
  for (const line of logs) {
    if (line.event === 'registration.press-intended') {
      const key = keyOf(line.session, line.fingerprint);
      byPress.set(Number(line.press), key);
      marks.set(key, (marks.get(key) ?? 0) + 1);
    } else if (line.event === 'registration.press-refused') {
      const key = byPress.get(Number(line.press));
      if (key) marks.set(key, marks.get(key)! - 1);
    } else if (line.event === 'registration.verify-intended' && line.step === 'code') {
      const key = keyOf(line.session, line.fingerprint);
      byVerification.set(Number(line.productId), key);
      marks.set(key, (marks.get(key) ?? 0) + 1);
    } else if (line.event === 'registration.verify-refused' && line.step === 'code') {
      const key = byVerification.get(Number(line.productId));
      if (key) marks.set(key, marks.get(key)! - 1);
    }
  }
  return presses.flatMap((p) => {
    const key = keyOf(p.session, p.fingerprint);
    const left = marks.get(key) ?? 0;
    if (left > 0) {
      marks.set(key, left - 1);
      return [];
    }
    return [`a press of "${p.button}" in session ${p.session} with no intended mark of its own`];
  });
}
