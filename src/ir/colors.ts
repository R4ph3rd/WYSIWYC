/**
 * Colour vocabulary + helpers shared by the parameter lexer and the binding
 * resolver. Pure. Tailwind colours are approximated from the family's 500 hex,
 * lightened/darkened by shade — accurate enough to tell which clause colour
 * word a node currently carries (green vs red, indigo vs violet).
 */

/** Tailwind/CSS color family names → a representative hex (widget seed). */
export const COLOR_NAMES: Record<string, string> = {
  slate: '#64748b', gray: '#6b7280', grey: '#6b7280', zinc: '#71717a', neutral: '#737373', stone: '#78716c',
  red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308', lime: '#84cc16',
  green: '#22c55e', emerald: '#10b981', teal: '#14b8a6', cyan: '#06b6d4', sky: '#0ea5e9',
  blue: '#3b82f6', indigo: '#6366f1', violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef',
  pink: '#ec4899', rose: '#f43f5e', black: '#000000', white: '#ffffff',
};

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

/** Any CSS-ish colour we can read (hex, rgb(), a colour family word) → RGB. */
export function parseColor(value: string | undefined | null): RGB | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v.startsWith('#')) return hexToRgb(v);
  const rgb = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const base = v.split(/\s+/).pop() ?? v;
  const named = COLOR_NAMES[v] ?? COLOR_NAMES[base];
  return named ? hexToRgb(named) : null;
}

/**
 * A Tailwind colour utility VALUE (after the prefix) → hex:
 * "emerald-600" → a darkened emerald, "white", "[#123456]", "rose-500/40".
 */
export function twColorHex(value: string): string | null {
  const v = value.replace(/\/\d+$/, '');
  const arb = v.match(/^\[(#[0-9a-fA-F]{3,8}|rgba?\([^\]]*\))\]$/);
  if (arb) {
    const rgb = parseColor(arb[1].replace(/_/g, ' '));
    return rgb ? rgbToHex(rgb) : null;
  }
  if (v === 'white') return '#ffffff';
  if (v === 'black') return '#000000';
  const m = v.match(/^([a-z]+)-(\d{2,3})$/);
  if (!m || !COLOR_NAMES[m[1]]) return null;
  const base = hexToRgb(COLOR_NAMES[m[1]])!;
  const shade = Number(m[2]);
  if (shade === 500) return rgbToHex(base);
  if (shade < 500) {
    const t = ((500 - shade) / 500) * 0.92;
    return rgbToHex(base.map((c) => c + (255 - c) * t) as RGB);
  }
  const t = ((shade - 500) / 500) * 0.85;
  return rgbToHex(base.map((c) => c * (1 - t)) as RGB);
}

/** 0 (opposite) … 1 (identical) colour similarity, hue-weighted RGB distance. */
export function colorSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ra = parseColor(a ?? null);
  const rb = parseColor(b ?? null);
  if (!ra || !rb) return 0;
  // Compare chroma direction too, so a dark green is still nearer "green" than "slate".
  const d = Math.hypot(ra[0] - rb[0], ra[1] - rb[1], ra[2] - rb[2]) / 441.7;
  const norm = (c: RGB) => {
    const mean = (c[0] + c[1] + c[2]) / 3;
    return c.map((x) => x - mean);
  };
  const na = norm(ra);
  const nb = norm(rb);
  const la = Math.hypot(...na);
  const lb = Math.hypot(...nb);
  const hue = la > 12 && lb > 12 ? (na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2]) / (la * lb) : la <= 12 && lb <= 12 ? 1 : 0;
  return 0.5 * (1 - d) + 0.5 * ((hue + 1) / 2);
}

/** Nearest named colour family to a hex (for keeping prose readable). */
export function nearestColorName(hex: string): string {
  const lc = hex.toLowerCase();
  const exact = Object.keys(COLOR_NAMES).find((name) => COLOR_NAMES[name].toLowerCase() === lc);
  if (exact) return exact;
  if (!parseColor(lc)) return hex;
  let best = 'blue';
  let bestSim = -Infinity;
  for (const [name, namedHex] of Object.entries(COLOR_NAMES)) {
    if (name === 'grey') continue;
    const sim = colorSimilarity(lc, namedHex);
    if (sim > bestSim) { bestSim = sim; best = name; }
  }
  return best;
}
