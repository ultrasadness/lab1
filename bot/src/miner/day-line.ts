// The Day's line (#9), drawn by plain code once every Featured Launch of the date has a judgment: the Fit of the
// ⌈√N⌉-th best eligible Launch, where N is the Featured count, never below the floor. Every eligible Launch at or
// above it is a Dossier, ties included. The model never decides Dossier or Skip.

export interface JudgedLaunch {
  fit: number;
  notAProduct: boolean;
  /** A re-Launch of a Product that already has a Registration is added to its Dossier, not judged against the line. */
  reLaunchOfRegistered: boolean;
}

export interface DayLine {
  featuredCount: number;
  line: number;
  /** The floor the line was drawn with, which an upgrade may change later. */
  floor: number;
  /** ⌈√N⌉: which best Fit the line follows. */
  k: number;
  /** The k-th best eligible Fit, if there were k eligible Launches. */
  kth: number | null;
  eligibleCount: number;
}

const eligible = (j: JudgedLaunch) => !j.notAProduct && !j.reLaunchOfRegistered;

export function drawDayLine(judged: JudgedLaunch[], featuredCount: number, floor: number): DayLine {
  const k = Math.ceil(Math.sqrt(featuredCount));
  const fits = judged.filter(eligible).map((j) => j.fit).sort((a, b) => b - a);
  const kth = k >= 1 && fits.length >= k ? fits[k - 1]! : null;
  return { featuredCount, line: Math.max(floor, kth ?? floor), floor, k, kth, eligibleCount: fits.length };
}

export type Outcome = 'dossier' | 'skip' | 'not-a-product';

export function outcomeOf(j: JudgedLaunch, line: number): Outcome {
  if (j.notAProduct) return 'not-a-product';
  return eligible(j) && j.fit >= line ? 'dossier' : 'skip';
}

export type Band = 'dossiers' | 'near-misses' | 'further-off' | 'far-off' | 'not-products';

export const BANDS: readonly Band[] = ['dossiers', 'near-misses', 'further-off', 'far-off', 'not-products'];

/** Near misses are one below the line, further off is Fit 3 up to two below it, and far off is Fit 0–2. */
export function bandOf(j: JudgedLaunch, line: number): Band {
  const outcome = outcomeOf(j, line);
  if (outcome === 'not-a-product') return 'not-products';
  if (outcome === 'dossier') return 'dossiers';
  if (j.fit === line - 1) return 'near-misses';
  return j.fit >= 3 ? 'further-off' : 'far-off';
}
