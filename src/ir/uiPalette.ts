/**
 * A small design palette derived from the UI already on the canvas, used to
 * theme filled wireframe placeholders so they look like they belong to the
 * design they are drawn into (see `fillComponent` in wireframe.ts).
 *
 * Pure: reads Tailwind utilities (`bg-indigo-600`, `text-zinc-900`,
 * `border-white/10`, `rounded-xl`, ...) and inline `style` colours of the IR's
 * nodes and returns concrete hex colours. Only base utilities count: variants
 * (`hover:`, `dark:`, `md:`) are ignored because they do not paint at rest.
 *
 * Roles: the neutral family (zinc, slate, ...) drives text, icons, surfaces and
 * borders; the most used chromatic family on buttons, active items, badges and
 * links becomes the accent. Shades are chosen by scheme (light or dark page),
 * so an empty canvas still gets a tasteful neutral + indigo palette.
 */

import type { IR, IRNode } from './types';

type RGB = [number, number, number];

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const;
type Shade = (typeof SHADES)[number];

/** Tailwind v3 colour palette (50 .. 950), exact hexes. */
const TW_SRC: Record<string, string> = {
  slate: 'f8fafc f1f5f9 e2e8f0 cbd5e1 94a3b8 64748b 475569 334155 1e293b 0f172a 020617',
  gray: 'f9fafb f3f4f6 e5e7eb d1d5db 9ca3af 6b7280 4b5563 374151 1f2937 111827 030712',
  zinc: 'fafafa f4f4f5 e4e4e7 d4d4d8 a1a1aa 71717a 52525b 3f3f46 27272a 18181b 09090b',
  neutral: 'fafafa f5f5f5 e5e5e5 d4d4d4 a3a3a3 737373 525252 404040 262626 171717 0a0a0a',
  stone: 'fafaf9 f5f5f4 e7e5e4 d6d3d1 a8a29e 78716c 57534e 44403c 292524 1c1917 0c0a09',
  red: 'fef2f2 fee2e2 fecaca fca5a5 f87171 ef4444 dc2626 b91c1c 991b1b 7f1d1d 450a0a',
  orange: 'fff7ed ffedd5 fed7aa fdba74 fb923c f97316 ea580c c2410c 9a3412 7c2d12 431407',
  amber: 'fffbeb fef3c7 fde68a fcd34d fbbf24 f59e0b d97706 b45309 92400e 78350f 451a03',
  yellow: 'fefce8 fef9c3 fef08a fde047 facc15 eab308 ca8a04 a16207 854d0e 713f12 422006',
  lime: 'f7fee7 ecfccb d9f99d bef264 a3e635 84cc16 65a30d 4d7c0f 3f6212 365314 1a2e05',
  green: 'f0fdf4 dcfce7 bbf7d0 86efac 4ade80 22c55e 16a34a 15803d 166534 14532d 052e16',
  emerald: 'ecfdf5 d1fae5 a7f3d0 6ee7b7 34d399 10b981 059669 047857 065f46 064e3b 022c22',
  teal: 'f0fdfa ccfbf1 99f6e4 5eead4 2dd4bf 14b8a6 0d9488 0f766e 115e59 134e4a 042f2e',
  cyan: 'ecfeff cffafe a5f3fc 67e8f9 22d3ee 06b6d4 0891b2 0e7490 155e75 164e63 083344',
  sky: 'f0f9ff e0f2fe bae6fd 7dd3fc 38bdf8 0ea5e9 0284c7 0369a1 075985 0c4a6e 082f49',
  blue: 'eff6ff dbeafe bfdbfe 93c5fd 60a5fa 3b82f6 2563eb 1d4ed8 1e40af 1e3a8a 172554',
  indigo: 'eef2ff e0e7ff c7d2fe a5b4fc 818cf8 6366f1 4f46e5 4338ca 3730a3 312e81 1e1b4b',
  violet: 'f5f3ff ede9fe ddd6fe c4b5fd a78bfa 8b5cf6 7c3aed 6d28d9 5b21b6 4c1d95 2e1065',
  purple: 'faf5ff f3e8ff e9d5ff d8b4fe c084fc a855f7 9333ea 7e22ce 6b21a8 581c87 3b0764',
  fuchsia: 'fdf4ff fae8ff f5d0fe f0abfc e879f9 d946ef c026d3 a21caf 86198f 701a75 4a044e',
  pink: 'fdf2f8 fce7f3 fbcfe8 f9a8d4 f472b6 ec4899 db2777 be185d 9d174d 831843 500724',
  rose: 'fff1f2 ffe4e6 fecdd3 fda4af fb7185 f43f5e e11d48 be123c 9f1239 881337 4c0519',
};

const TW: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(TW_SRC).map(([family, list]) => [
    family,
    Object.fromEntries(list.split(' ').map((hex, i) => [SHADES[i], `#${hex}`])),
  ]),
);

const NEUTRALS = new Set(['slate', 'gray', 'zinc', 'neutral', 'stone']);
/** Families that usually carry status meaning (up/down, warning), not brand. */
const SEMANTIC = new Set(['green', 'emerald', 'red', 'amber', 'yellow', 'orange', 'lime']);

const DEFAULT_NEUTRAL = 'zinc';
const DEFAULT_ACCENT = 'indigo';

/** Exact Tailwind hex for `family-shade` (undefined when unknown). */
export function twHex(family: string, shade: string): string | undefined {
  return TW[family]?.[shade];
}

/* ------------------------------------------------------------------------ */
/* Colour math                                                              */
/* ------------------------------------------------------------------------ */

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function hexToRgb(hex: string): RGB | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

function toHex(rgb: RGB): string {
  return '#' + rgb.map((c) => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, '0')).join('');
}

/** `a` over `b` with weight `t` of `a` (0..1). */
export function mix(a: string, b: string, t: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return a;
  return toHex(ra.map((c, i) => c * t + rb[i] * (1 - t)) as RGB);
}

/** CIE L* (0 black .. 100 white). */
export function lightnessOf(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 100;
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const y = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

/** Max - min channel spread: ~0 for greys, large for saturated colours. */
function chroma(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  return Math.max(...rgb) - Math.min(...rgb);
}

/** Parse `#hex`, `rgb()/rgba()` into an opaque hex composited over `under`. */
function cssColorOver(value: string | undefined, under: string): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === 'transparent' || v === 'none' || v === '') return null;
  if (v === 'white') return '#ffffff';
  if (v === 'black') return '#000000';
  if (v.startsWith('#')) {
    const rgb = hexToRgb(v);
    if (!rgb) return null;
    const h = v.slice(1);
    const a = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
    return a >= 1 ? toHex(rgb) : mix(toHex(rgb), under, a);
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(v);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    if (p.length < 3 || p.slice(0, 3).some(Number.isNaN)) return null;
    const a = p[3] === undefined || Number.isNaN(p[3]) ? 1 : clamp(p[3] > 1 ? p[3] / 100 : p[3], 0, 1);
    return mix(toHex([p[0], p[1], p[2]]), under, a);
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Tailwind utility parsing                                                 */
/* ------------------------------------------------------------------------ */

interface TwColor {
  /** Tailwind family ('zinc', 'indigo', ...) or null for an arbitrary value. */
  family: string | null;
  shade: Shade | null;
  hex: string;
  alpha: number;
}

/** Parse a colour utility value: `indigo-600`, `white/10`, `white/[0.04]`, `[#123456]`. */
function parseTwColor(value: string): TwColor | null {
  const m = /^(.+?)(?:\/(\[[\d.]+\]|\d{1,3}))?$/.exec(value);
  if (!m) return null;
  const [, base, rawAlpha] = m;
  let alpha = 1;
  if (rawAlpha !== undefined) {
    alpha = rawAlpha.startsWith('[') ? parseFloat(rawAlpha.slice(1, -1)) : Number(rawAlpha) / 100;
    if (Number.isNaN(alpha)) return null;
    alpha = clamp(alpha > 1 ? alpha / 100 : alpha, 0, 1);
  }
  if (base === 'white') return { family: 'white', shade: null, hex: '#ffffff', alpha };
  if (base === 'black') return { family: 'black', shade: null, hex: '#000000', alpha };
  const arb = /^\[(#[0-9a-f]{3,8})\]$/i.exec(base);
  if (arb) {
    const rgb = hexToRgb(arb[1]);
    return rgb ? { family: null, shade: null, hex: toHex(rgb), alpha } : null;
  }
  const fam = /^([a-z]+)-(\d{2,3})$/.exec(base);
  if (!fam || !TW[fam[1]] || !(SHADES as readonly string[]).includes(fam[2])) return null;
  return { family: fam[1], shade: fam[2] as Shade, hex: TW[fam[1]][fam[2]], alpha };
}

const RADIUS: Record<string, number> = {
  'rounded-none': 0,
  'rounded-sm': 2,
  rounded: 4,
  'rounded-md': 6,
  'rounded-lg': 8,
  'rounded-xl': 12,
  'rounded-2xl': 16,
  'rounded-3xl': 24,
  'rounded-full': 9999,
};

function radiusOf(cls: string): number | undefined {
  if (cls in RADIUS) return RADIUS[cls];
  const arb = /^rounded-\[(\d+(?:\.\d+)?)px\]$/.exec(cls);
  return arb ? Number(arb[1]) : undefined;
}

/** Base (variant-free) utility classes of a node. */
function baseClasses(node: IRNode): string[] {
  return (node.tailwind ?? '').split(/\s+/).filter((c) => c && !c.includes(':'));
}

/* ------------------------------------------------------------------------ */
/* Palette                                                                  */
/* ------------------------------------------------------------------------ */

export interface UIPalette {
  /** True when the page behind the component is dark. */
  dark: boolean;
  /** Neutral Tailwind family driving text and surfaces (zinc, slate, ...). */
  neutral: string;
  /** Font stack of the UI (root frame / most used), if any. */
  fontFamily?: string;
  /** The page colour behind the component. */
  page: string;
  /** Card / panel surface. */
  surface: string;
  /** Inset field background (inputs, search). */
  field: string;
  border: string;
  /** Headings and strong values. */
  text: string;
  /** Body copy, nav labels. */
  textBody: string;
  /** Captions, placeholders, secondary labels. */
  textMuted: string;
  /** Icon glyph colour. */
  icon: string;
  /** Primary colour (primary buttons, active indicator). */
  accent: string;
  /** Text on `accent`. */
  onAccent: string;
  /** Light accent tint (avatars, images, soft badges). */
  accentSoft: string;
  /** Text on `accentSoft`. */
  accentSoftText: string;
  /** Mid accent tint (shapes on a soft tint). */
  accentMid: string;
  /** Card radius. */
  radius: number;
  /** Control radius (buttons, inputs). */
  controlRadius: number;
}

function topKey<K>(counts: Map<K, number>): K | undefined {
  let best: K | undefined;
  let bestN = -Infinity;
  counts.forEach((n, k) => {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  });
  return best;
}

function bump<K>(counts: Map<K, number>, key: K, by = 1): void {
  counts.set(key, (counts.get(key) ?? 0) + by);
}

function isCardLike(classes: string[]): boolean {
  const rounded = classes.some((c) => radiusOf(c) !== undefined && radiusOf(c)! >= 6 && radiusOf(c)! < 9999);
  const edged = classes.some((c) => c === 'border' || c.startsWith('shadow'));
  return rounded && edged;
}

/**
 * Derive the palette from `ir`'s nodes. `page` is the opaque colour behind the
 * component (see `wireframeBackdrop`); nodes in `exclude` (the host and its
 * generated children) are ignored so a fill never feeds on itself.
 */
export function derivePalette(ir: IR | undefined, page: string, exclude: Set<string> = new Set()): UIPalette {
  const pageHex = cssColorOver(page, '#ffffff') ?? '#ffffff';
  const dark = lightnessOf(pageHex) < 50;
  const nodes = (ir?.nodes ?? []).filter((n) => !exclude.has(n.id));

  const neutralCounts = new Map<string, number>();
  const accentFamilies = new Map<string, number>();
  const accentShades = new Map<string, number>();
  const accentCustom = new Map<string, number>();
  const headingColors = new Map<string, number>();
  const surfaceCounts = new Map<string, number>();
  const borderCounts = new Map<string, number>();
  const cardRadius = new Map<number, number>();
  const controlRadius = new Map<number, number>();
  const fonts = new Map<string, number>();

  for (const node of nodes) {
    const classes = baseClasses(node);
    const cardLike = isCardLike(classes);
    const control = node.role === 'button' || node.role === 'input';
    for (const cls of classes) {
      const r = radiusOf(cls);
      if (r !== undefined && r < 9999) {
        if (control) bump(controlRadius, r);
        else if (cardLike) bump(cardRadius, r);
      }
      const m = /^(bg|text|border|divide|from|via|to|ring)-(.+)$/.exec(cls);
      if (!m) continue;
      const color = parseTwColor(m[2]);
      if (!color) continue;
      const [, prefix] = m;
      if (color.family && NEUTRALS.has(color.family)) bump(neutralCounts, color.family);
      if (prefix === 'text' && node.role === 'heading' && color.alpha === 1) bump(headingColors, color.hex);
      if (prefix === 'bg' && cardLike) bump(surfaceCounts, mix(color.hex, pageHex, color.alpha));
      if ((prefix === 'border' || prefix === 'divide') && node.role !== 'button')
        bump(borderCounts, `${color.hex}|${color.alpha}`);
      // Accent candidates: chromatic colours, weighted by how "primary" the use is.
      const chromatic = color.family ? !NEUTRALS.has(color.family) && color.family !== 'white' && color.family !== 'black' : chroma(color.hex) > 40;
      if (!chromatic || color.alpha < 0.5) continue;
      let weight =
        prefix === 'bg'
          ? node.role === 'button'
            ? 4
            : 2
          : prefix === 'text'
            ? 1.5
            : prefix === 'from' || prefix === 'via' || prefix === 'to'
              ? 0.5
              : 1;
      if (color.family && SEMANTIC.has(color.family)) weight *= 0.35;
      if (color.family) {
        bump(accentFamilies, color.family, weight);
        if (color.shade) bump(accentShades, `${color.family}-${color.shade}|${prefix}`, weight);
      } else {
        bump(accentCustom, color.hex, weight);
      }
    }
    const s = node.style;
    if (s?.fontFamily) bump(fonts, s.fontFamily, node.parentId === null ? 10 : 1);
    for (const value of [s?.fill, s?.fontColor]) {
      const hex = cssColorOver(value, pageHex);
      if (hex && chroma(hex) > 60) bump(accentCustom, hex, value === s?.fill ? (node.role === 'button' ? 4 : 2) : 1.5);
    }
  }

  const neutral = topKey(neutralCounts) ?? DEFAULT_NEUTRAL;
  const N = (shade: Shade) => TW[neutral][shade];

  // Accent: best Tailwind family vs best custom hex.
  const fam = topKey(accentFamilies);
  const custom = topKey(accentCustom);
  const useCustom =
    custom !== undefined && (fam === undefined || (accentCustom.get(custom) ?? 0) > (accentFamilies.get(fam) ?? 0));
  const surface = topKey(surfaceCounts) ?? (dark ? mix('#ffffff', pageHex, 0.03) : '#ffffff');

  let accent: string;
  let accentSoft: string;
  let accentSoftText: string;
  let accentMid: string;
  if (useCustom && custom) {
    accent = custom;
    accentSoft = mix(custom, surface, dark ? 0.26 : 0.14);
    accentMid = mix(custom, surface, dark ? 0.5 : 0.42);
    accentSoftText = dark ? mix(custom, '#ffffff', 0.6) : mix(custom, '#000000', 0.7);
  } else {
    const family = fam ?? DEFAULT_ACCENT;
    // Most used background shade of the family, kept in a readable band.
    const allowed: Shade[] = dark ? ['400', '500', '600'] : ['500', '600', '700'];
    const shadeCounts = new Map<Shade, number>();
    // Ties go to the conventional primary shade of the scheme.
    shadeCounts.set(dark ? '500' : '600', 0.01);
    accentShades.forEach((n, key) => {
      const [name, prefix] = key.split('|');
      const [f, sh] = name.split('-');
      if (f === family && allowed.includes(sh as Shade)) bump(shadeCounts, sh as Shade, prefix === 'bg' ? n * 2 : n);
    });
    const shade = topKey(shadeCounts) ?? (dark ? '500' : '600');
    const F = (s: Shade) => TW[family][s];
    accent = F(shade);
    accentSoft = dark ? mix(F('500'), surface, 0.26) : F('100');
    accentMid = dark ? mix(F('400'), surface, 0.55) : F('300');
    accentSoftText = dark ? F('300') : F('700');
  }
  const onAccent = lightnessOf(accent) > 62 ? N('950') : '#ffffff';

  const headingTop = topKey(headingColors);
  const headingOk =
    headingTop !== undefined && chroma(headingTop) < 30 && Math.abs(lightnessOf(headingTop) - lightnessOf(surface)) > 60;
  const text = headingOk ? headingTop! : dark ? N('50') : N('900');

  const borderKey = topKey(borderCounts);
  let border = dark ? N('800') : N('200');
  if (borderKey) {
    const [hex, a] = borderKey.split('|');
    const candidate = mix(hex, surface, Number(a));
    // Only a subtle hairline counts (not an accent ring).
    if (chroma(candidate) < 30 && Math.abs(lightnessOf(candidate) - lightnessOf(surface)) < 35) border = candidate;
  }

  return {
    dark,
    neutral,
    fontFamily: topKey(fonts),
    page: pageHex,
    surface,
    field: dark ? mix('#ffffff', surface, 0.04) : '#ffffff',
    border,
    text,
    textBody: dark ? N('400') : N('600'),
    textMuted: dark ? N('500') : N('500'),
    icon: dark ? N('500') : N('400'),
    accent,
    onAccent,
    accentSoft,
    accentSoftText,
    accentMid,
    radius: topKey(cardRadius) ?? 12,
    controlRadius: topKey(controlRadius) ?? 6,
  };
}

/** Text inks readable on `bg`, in the palette's neutral family. */
export function inksOn(palette: UIPalette, bg: string): { text: string; body: string; muted: string; icon: string } {
  const darkBg = lightnessOf(bg) < 50;
  if (darkBg === palette.dark && Math.abs(lightnessOf(bg) - lightnessOf(palette.surface)) < 30) {
    return { text: palette.text, body: palette.textBody, muted: palette.textMuted, icon: palette.icon };
  }
  const N = (shade: Shade) => TW[palette.neutral][shade];
  return darkBg
    ? { text: N('50'), body: N('300'), muted: N('400'), icon: N('400') }
    : { text: N('900'), body: N('700'), muted: N('500'), icon: N('500') };
}
