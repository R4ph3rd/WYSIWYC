/** SUS (Brooke, 1996) and raw NASA-TLX (Hart, 2006) definitions + scoring. */

export const SUS_ITEMS = [
  'I think that I would like to use this system frequently.',
  'I found the system unnecessarily complex.',
  'I thought the system was easy to use.',
  'I think that I would need the support of a technical person to be able to use this system.',
  'I found the various functions in this system were well integrated.',
  'I thought there was too much inconsistency in this system.',
  'I would imagine that most people would learn to use this system very quickly.',
  'I found the system very cumbersome to use.',
  'I felt very confident using the system.',
  'I needed to learn a lot of things before I could get going with this system.',
] as const;

/** 1 = strongly disagree … 5 = strongly agree. Returns 0–100, or null if incomplete. */
export function susScore(answers: (number | null)[]): number | null {
  if (answers.length !== 10 || answers.some((a) => a === null)) return null;
  let sum = 0;
  answers.forEach((a, i) => {
    sum += i % 2 === 0 ? (a as number) - 1 : 5 - (a as number);
  });
  return sum * 2.5;
}

export type TlxKey = 'mental' | 'physical' | 'temporal' | 'performance' | 'effort' | 'frustration';

export const TLX_SCALES: { key: TlxKey; label: string; question: string; low: string; high: string }[] = [
  { key: 'mental', label: 'Mental demand', question: 'How mentally demanding was the task?', low: 'Very low', high: 'Very high' },
  { key: 'physical', label: 'Physical demand', question: 'How physically demanding was the task?', low: 'Very low', high: 'Very high' },
  { key: 'temporal', label: 'Temporal demand', question: 'How hurried or rushed was the pace of the task?', low: 'Very low', high: 'Very high' },
  { key: 'performance', label: 'Performance', question: 'How successful were you in accomplishing what you were asked to do?', low: 'Perfect', high: 'Failure' },
  { key: 'effort', label: 'Effort', question: 'How hard did you have to work to accomplish your level of performance?', low: 'Very low', high: 'Very high' },
  { key: 'frustration', label: 'Frustration', question: 'How insecure, discouraged, irritated, stressed and annoyed were you?', low: 'Very low', high: 'Very high' },
];

export type TlxAnswers = Record<TlxKey, number | null>;

export function emptyTlx(): TlxAnswers {
  return { mental: null, physical: null, temporal: null, performance: null, effort: null, frustration: null };
}

/** Raw TLX: unweighted mean of the six 0–100 subscales. */
export function rawTlx(a: TlxAnswers): number | null {
  const v = Object.values(a);
  if (v.some((x) => x === null)) return null;
  return (v as number[]).reduce((s, x) => s + x, 0) / v.length;
}
