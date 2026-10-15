/** Paired non-parametric statistics for small-N within-subjects studies. */
import { median } from './metrics';

export { median };

export function quantile(xs: number[], q: number): number {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export function mean(xs: number[]): number {
  const v = xs.filter(Number.isFinite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf, |error| < 1.5e-7). */
export function normCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Average ranks (1-based) with ties sharing the mean rank. */
export function rank(values: number[]): number[] {
  const idx = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(values.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = r;
    i = j + 1;
  }
  return ranks;
}

export interface WilcoxonResult {
  /** Pairs with a non-zero difference (zeros dropped, Wilcoxon's method). */
  n: number;
  zeros: number;
  wPlus: number;
  wMinus: number;
  /** min(W+, W−), the usual reported statistic. */
  w: number;
  z: number;
  p: number;
  method: 'exact' | 'normal';
  /** Effect size r = |Z| / √N (N = non-zero pairs). */
  r: number;
}

/**
 * Two-sided Wilcoxon signed-rank test on paired samples (after − before).
 * Exact permutation distribution for n ≤ 30 (ties handled exactly on doubled
 * mid-ranks), otherwise the normal approximation with tie and continuity
 * corrections. Z (for r) always comes from the normal approximation.
 */
export function wilcoxon(before: number[], after: number[]): WilcoxonResult | null {
  const diffs: number[] = [];
  let zeros = 0;
  for (let i = 0; i < before.length; i++) {
    const d = after[i] - before[i];
    if (!Number.isFinite(d)) continue;
    if (d === 0) zeros++;
    else diffs.push(d);
  }
  const n = diffs.length;
  if (n === 0) return null;
  const ranks = rank(diffs.map(Math.abs));
  let wPlus = 0;
  diffs.forEach((d, i) => { if (d > 0) wPlus += ranks[i]; });
  const total = (n * (n + 1)) / 2;
  const wMinus = total - wPlus;
  const w = Math.min(wPlus, wMinus);

  // Normal approximation (tie-corrected variance, continuity correction).
  const counts = new Map<number, number>();
  ranks.forEach((r) => counts.set(r, (counts.get(r) ?? 0) + 1));
  let tie = 0;
  counts.forEach((t) => { tie += t ** 3 - t; });
  const mu = total / 2;
  const sigma = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24 - tie / 48);
  const zRaw = sigma > 0 ? (wPlus - mu - Math.sign(wPlus - mu) * 0.5) / sigma : 0;
  const z = Number.isFinite(zRaw) ? zRaw : 0;

  let p: number;
  let method: 'exact' | 'normal';
  if (n <= 30) {
    method = 'exact';
    const r2 = ranks.map((r) => Math.round(r * 2));
    const max = r2.reduce((a, b) => a + b, 0);
    let dist = new Float64Array(max + 1);
    dist[0] = 1;
    for (const r of r2) {
      const next = new Float64Array(max + 1);
      for (let s = 0; s <= max; s++) {
        if (!dist[s]) continue;
        next[s] += dist[s];
        next[s + r] += dist[s];
      }
      dist = next;
    }
    const all = 2 ** n;
    const obs = Math.round(w * 2);
    let tail = 0;
    for (let s = 0; s <= obs; s++) tail += dist[s];
    p = Math.min(1, (2 * tail) / all);
  } else {
    method = 'normal';
    p = Math.min(1, 2 * (1 - normCdf(Math.abs(z))));
  }
  return { n, zeros, wPlus, wMinus, w, z, p, method, r: n ? Math.abs(z) / Math.sqrt(n) : 0 };
}

/** "−72%" style relative change of b against a. */
export function pctChange(a: number, b: number): number {
  return a ? (b - a) / Math.abs(a) : NaN;
}

export function fmtPct(x: number, digits = 0): string {
  if (!Number.isFinite(x)) return '—';
  const v = (x * 100).toFixed(digits);
  return `${x > 0 ? '+' : x < 0 ? '−' : ''}${v.replace('-', '')}%`;
}

export function fmtP(p: number): string {
  if (!Number.isFinite(p)) return '—';
  if (p < 0.001) return 'p < .001';
  return `p = ${p.toFixed(3).replace(/^0/, '')}`;
}

export function fmtNum(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return '—';
  if (Math.abs(x) >= 1000) return Math.round(x).toLocaleString('en-US');
  return Number.isInteger(x) ? String(x) : x.toFixed(digits);
}
