/**
 * Detects editable "parameter" tokens inside a spec clause's prose — a color
 * word/hex, a font name, a number with a unit, or a styling adjective — so the
 * UI can make just that word clickable and pop the right widget (color picker,
 * slider, font selector, option list). Pure string work; no React.
 */
import { GOOGLE_FONTS } from './fonts';

export type ParamKind = 'color' | 'fontFamily' | 'number' | 'size' | 'weight' | 'radius';

export interface ParamMatch {
  start: number;
  end: number;
  text: string;
  kind: ParamKind;
}

/** Tailwind/CSS color family names → a representative hex (picker seed). */
export const COLOR_NAMES: Record<string, string> = {
  slate: '#64748b', gray: '#6b7280', grey: '#6b7280', zinc: '#71717a', neutral: '#737373', stone: '#78716c',
  red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308', lime: '#84cc16',
  green: '#22c55e', emerald: '#10b981', teal: '#14b8a6', cyan: '#06b6d4', sky: '#0ea5e9',
  blue: '#3b82f6', indigo: '#6366f1', violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef',
  pink: '#ec4899', rose: '#f43f5e', black: '#000000', white: '#ffffff',
};

export const SIZE_OPTIONS = ['tiny', 'small', 'medium', 'large', 'huge'];
export const WEIGHT_OPTIONS = ['thin', 'light', 'normal', 'medium', 'semibold', 'bold', 'heavy', 'black'];
export const RADIUS_OPTIONS = ['sharp', 'rounded', 'round', 'pill', 'circular'];

// Recognized adjectives (a superset of the canonical options above, so the UI
// can match what the model actually wrote and still offer the clean option set).
const SIZE_WORDS = [...SIZE_OPTIONS, 'big', 'compact', 'oversized'];
const WEIGHT_WORDS = [...WEIGHT_OPTIONS, 'regular', 'extrabold', 'bolder', 'lighter'];
const RADIUS_WORDS = [...RADIUS_OPTIONS, 'rounded-full', 'square'];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordGroup(words: string[]): RegExp {
  // Longer alternatives first so e.g. "rounded-full" wins over "rounded".
  const sorted = [...words].sort((a, b) => b.length - a.length).map(escapeRegex);
  return new RegExp(`\\b(?:${sorted.join('|')})\\b`, 'gi');
}

const COLOR_NAME_RE = wordGroup(Object.keys(COLOR_NAMES));
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const RGB_RE = /\brgba?\([^)]*\)/gi;
const NUMBER_RE = /\b\d+(?:\.\d+)?(?:px|rem|pt|%)\b/gi;
const SIZE_RE = wordGroup(SIZE_WORDS);
const WEIGHT_RE = wordGroup(WEIGHT_WORDS);
const RADIUS_RE = wordGroup(RADIUS_WORDS);

const FONT_RES: RegExp[] = GOOGLE_FONTS.map((f) => new RegExp(`\\b${escapeRegex(f)}\\b`, 'gi'));

/** All non-overlapping parameter tokens in `text`, sorted by position. */
export function findParams(text: string): ParamMatch[] {
  const raw: ParamMatch[] = [];
  const collect = (re: RegExp, kind: ParamKind) => {
    for (const m of text.matchAll(re)) {
      if (m.index === undefined) continue;
      raw.push({ start: m.index, end: m.index + m[0].length, text: m[0], kind });
    }
  };

  for (const re of FONT_RES) collect(re, 'fontFamily');
  collect(HEX_RE, 'color');
  collect(RGB_RE, 'color');
  collect(COLOR_NAME_RE, 'color');
  collect(NUMBER_RE, 'number');
  collect(SIZE_RE, 'size');
  collect(WEIGHT_RE, 'weight');
  collect(RADIUS_RE, 'radius');

  // Resolve overlaps: keep earliest, and the longest at a tie.
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: ParamMatch[] = [];
  let lastEnd = -1;
  for (const m of raw) {
    if (m.start >= lastEnd) {
      out.push(m);
      lastEnd = m.end;
    }
  }
  return out;
}

/** Replace [start,end) of `text` with `replacement`. */
export function spliceText(text: string, start: number, end: number, replacement: string): string {
  return text.slice(0, start) + replacement + text.slice(end);
}

/** Parse a number token into value + unit (defaults to px). */
export function parseNumber(token: string): { value: number; unit: string } {
  const m = token.match(/^(\d+(?:\.\d+)?)(px|rem|pt|%)?$/i);
  return { value: m ? Number(m[1]) : 0, unit: m?.[2] ?? 'px' };
}

/** Max sensible slider value per unit. */
export function numberMax(unit: string): number {
  if (unit === '%') return 100;
  if (unit === 'rem') return 8;
  if (unit === 'pt') return 96;
  return 128;
}
