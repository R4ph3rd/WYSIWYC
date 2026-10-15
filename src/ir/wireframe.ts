/**
 * Grey-wireframe generation and placeholder filling for chosen components.
 *
 * Flow in WYSIWYC: the user draws a rough shape, then picks what UI component
 * it is (e.g. "Item card"). `wireframeChildren` fills that shape with a GREY
 * WIREFRAME of the component's expected parts (image block, title bar,
 * description lines, button, ...). A second action, `fillComponent` /
 * `fillPlaceholders`, turns the grey blocks into placeholder content (labels,
 * sample copy, icons) themed with a palette derived from the surrounding UI
 * (see uiPalette.ts), measured so no two parts overlap.
 *
 * Everything here is pure: no React, no DOM, no network and no store access.
 * Only `nextNodeId` (id allocation), the palette helpers and the IR types are
 * imported.
 *
 * Layout model: children are flat IRNodes (`parentId = host.id`) with ABSOLUTE
 * layout relative to the host's top-left corner. A component label is resolved
 * (case-insensitive, by keyword) through a small registry to an ordered list
 * of part kinds plus a layout strategy:
 *  - `vertical`   parts stacked top to bottom (cards, menu, rail, stat)
 *  - `horizontal` a left-to-right row, last button right-aligned (header bars)
 *  - `leading`    first part on the left, the rest stacked on its right
 *  - `rows`       stacked leading rows, optionally last row pinned (sidebar)
 *  - `split`      text stack on the left, one part on the right (banner, hero)
 *  - `tabs`       equal cells with centered labels and an underline
 *  - `grid`       one cell repeated in columns and rows (card grid, gallery)
 *  - `center`     parts centered and scaled to the host (button, avatar, icon)
 *  - `atomic`     the host itself is the component, so there are no children
 *
 * Every label `componentInfer.ts` can emit has its own registry entry, so the
 * three candidates offered for one shape build visibly different wireframes.
 *
 * Text bars are told apart again in `fillPlaceholders` by their (distinct)
 * bar heights, see `TEXT_BAR_HEIGHT`, so the wireframe stays free of extra
 * metadata and the placeholder step never changes ids.
 *
 * Greys are RELATIVE to what is behind each part: parts carry a lightness
 * offset (`TONE`, CIE L* units) away from the host's effective background
 * (darker on light hosts, lighter on dark ones) and the actual color is
 * interpolated along the Tailwind slate scale, so a part never matches the
 * shape it sits on. A part overlapping an earlier opaque part is toned against
 * that part instead.
 */

import { nextNodeId } from './ids';
import type { IR, IRNode, NodeRole, NodeStyle } from './types';
import { derivePalette, inksOn, twHex, type UIPalette } from './uiPalette';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const PAD = 12;
const GAP = 8;
const BAR_GAP = 6;
const DEFAULT_HOST_W = 200;
const DEFAULT_HOST_H = 200;
const IMAGE_MIN_H = 24;
const IMAGE_MAX_H = 160;

/** Fill of a freshly drawn rectangle/circle (see DEFAULT_STYLE in manipulate.ts). */
const DRAWN_FILL = '#e2e8f0';
/** What is behind a host when the caller does not say (plain white page). */
const DEFAULT_BACKDROP = '#ffffff';

/**
 * Lightness offsets (L*) from the background, per part. Larger = more contrast,
 * which doubles as the hierarchy: image < text bars < title < button / icon.
 * `input` is special-cased (an inset field, see `inputFill`).
 */
const TONE = {
  image: 10,
  text: 15,
  divider: 15,
  badge: 15,
  title: 24,
  button: 30,
  icon: 30,
  input: 8,
  inputStroke: 30,
} as const;

type ToneKind = Exclude<keyof typeof TONE, 'inputStroke'>;

/** Minimum L* distance between a part and what is behind it. */
const MIN_TONE_DELTA = 5;

/* -------------------------------------------------------------------------- */
/* Background-relative slate tones                                            */
/* -------------------------------------------------------------------------- */

type RGB = [number, number, number];

/** Tailwind slate scale plus white, light to dark. */
const SLATE_SCALE: Record<string, string> = {
  white: '#ffffff',
  '50': '#f8fafc',
  '100': '#f1f5f9',
  '200': '#e2e8f0',
  '300': '#cbd5e1',
  '400': '#94a3b8',
  '500': '#64748b',
  '600': '#475569',
  '700': '#334155',
  '800': '#1e293b',
  '900': '#0f172a',
  '950': '#020617',
};

function hexToRgb(hex: string): RGB | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

/** Parse a CSS color into rgb + alpha (hex, rgb()/rgba(), a few keywords). */
function parseColor(value: string | undefined): { rgb: RGB; alpha: number } | null {
  if (value === undefined) return null;
  const v = value.trim().toLowerCase();
  if (v === '') return null;
  if (v === 'transparent' || v === 'none') return { rgb: [255, 255, 255], alpha: 0 };
  if (v === 'white') return { rgb: [255, 255, 255], alpha: 1 };
  if (v === 'black') return { rgb: [0, 0, 0], alpha: 1 };
  if (v.startsWith('#')) {
    const rgb = hexToRgb(v);
    if (!rgb) return null;
    const h = v.slice(1);
    const alpha =
      h.length === 8 ? parseInt(h.slice(6), 16) / 255 : h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1;
    return { rgb, alpha };
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(v);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const rgb = parts
      .slice(0, 3)
      .map((p) => (p.endsWith('%') ? parseFloat(p) * 2.55 : parseFloat(p))) as RGB;
    if (rgb.some((c) => Number.isNaN(c))) return null;
    const rawA = parts[3];
    const alpha =
      rawA === undefined ? 1 : rawA.endsWith('%') ? parseFloat(rawA) / 100 : parseFloat(rawA);
    return { rgb, alpha: Number.isNaN(alpha) ? 1 : clamp(alpha, 0, 1) };
  }
  return null;
}

/** `bg-white`, `bg-slate-200`, `bg-gray-800/50`, ... (neutral families only). */
function tailwindBg(tailwind: string): string | undefined {
  let found: string | undefined;
  for (const cls of tailwind.split(/\s+/)) {
    // Variants (hover:, dark:, md:) do not match: only the base class paints.
    const m =
      /^bg-(white|black|transparent|(?:slate|gray|zinc|neutral|stone)-(\d{2,3}))(?:\/(\d{1,3}))?$/.exec(
        cls,
      );
    if (!m) continue;
    const family = m[1].split('-')[0];
    const base =
      m[1] === 'black'
        ? '#000000'
        : m[1] === 'transparent'
          ? 'transparent'
          : m[2] === undefined
            ? SLATE_SCALE.white
            : (twHex(family, m[2]) ?? SLATE_SCALE[m[2]]);
    if (base === undefined) continue;
    if (m[3] === undefined || base === 'transparent') {
      found = base;
    } else {
      const rgb = hexToRgb(base) as RGB;
      found = `rgba(${rgb.join(',')},${clamp(Number(m[3]) / 100, 0, 1)})`;
    }
  }
  return found;
}

function composite(top: { rgb: RGB; alpha: number }, under: RGB): RGB {
  return top.rgb.map((c, i) => c * top.alpha + under[i] * (1 - top.alpha)) as RGB;
}

/** The opaque color a node paints over `backdrop` (fill, else Tailwind bg). */
function effectiveFill(node: IRNode, backdrop: RGB): RGB {
  const parsed = parseColor(node.style?.fill ?? tailwindBg(node.tailwind ?? ''));
  if (!parsed) return backdrop;
  const opacity = clamp(node.style?.opacity ?? 1, 0, 1);
  return composite({ rgb: parsed.rgb, alpha: parsed.alpha * opacity }, backdrop);
}

/** CIE L* (0 black .. 100 white) of an sRGB color. */
function lightness([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

/** Slate stops sorted dark to light, for interpolation by lightness. */
const SLATE_STOPS = Object.values(SLATE_SCALE)
  .map((hex) => {
    const rgb = hexToRgb(hex) as RGB;
    return { rgb, l: lightness(rgb) };
  })
  .sort((a, b) => a.l - b.l);
const L_MIN = SLATE_STOPS[0].l;
const L_MAX = SLATE_STOPS[SLATE_STOPS.length - 1].l;

function toHex(rgb: RGB): string {
  return '#' + rgb.map((c) => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, '0')).join('');
}

/** The slate-scale color at lightness `l` (linear between neighbouring stops). */
function slateAt(l: number): RGB {
  const t = clamp(l, L_MIN, L_MAX);
  for (let i = 1; i < SLATE_STOPS.length; i += 1) {
    const lo = SLATE_STOPS[i - 1];
    const hi = SLATE_STOPS[i];
    if (t <= hi.l) {
      const f = hi.l === lo.l ? 0 : (t - lo.l) / (hi.l - lo.l);
      return lo.rgb.map((c, k) => c + (hi.rgb[k] - c) * f) as RGB;
    }
  }
  return SLATE_STOPS[SLATE_STOPS.length - 1].rgb;
}

/**
 * A slate grey `delta` L* away from `bg`: darker on light backgrounds, lighter
 * on dark ones (the far side always has >= 50 L* of room).
 */
function tone(bg: RGB, delta: number): string {
  const bgL = lightness(bg);
  const sign = bgL > 50 ? -1 : 1;
  return toHex(slateAt(bgL + sign * Math.max(delta, MIN_TONE_DELTA)));
}

/** An inset field: a notch toward the near end (white-ish on light hosts). */
function inputFill(bg: RGB): string {
  const bgL = lightness(bg);
  const l = bgL + (bgL > 50 ? 1 : -1) * TONE.input;
  return l >= L_MIN && l <= L_MAX ? toHex(slateAt(l)) : tone(bg, TONE.input);
}

/**
 * The opaque color behind `host`: its ancestors' fills composited over the
 * canvas background. Pure; pass the result as `backdrop` below.
 */
export function wireframeBackdrop(ir: IR, host: IRNode): string {
  const byId = new Map(ir.nodes.map((n) => [n.id, n]));
  const chain: IRNode[] = [];
  const seen = new Set<string>([host.id]);
  let parentId = host.parentId;
  while (parentId !== null && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    seen.add(parentId);
    chain.unshift(parent);
    parentId = parent.parentId;
  }
  const canvas = parseColor(ir.canvas?.background);
  let rgb: RGB = canvas ? composite(canvas, [255, 255, 255]) : [255, 255, 255];
  chain.forEach((node) => {
    rgb = effectiveFill(node, rgb);
  });
  return toHex(rgb);
}

/** The host's own effective color over `backdrop` (no host: a drawn shape). */
function hostBackground(host: IRNode | undefined, backdrop: string | undefined): RGB {
  if (!host) return hexToRgb(DRAWN_FILL) as RGB;
  const parsed = parseColor(backdrop ?? DEFAULT_BACKDROP);
  const under: RGB = parsed ? composite(parsed, [255, 255, 255]) : [255, 255, 255];
  return effectiveFill(host, under);
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * What is directly behind item `index`: the latest earlier item with an
 * opaque fill that overlaps it, else the host background.
 */
function backgroundBehind(items: { rect: Rect; fill: RGB | null }[], index: number, hostBg: RGB): RGB {
  for (let i = index - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item.fill && overlaps(item.rect, items[index].rect)) return item.fill;
  }
  return hostBg;
}

/* -------------------------------------------------------------------------- */
/* Part kinds                                                                 */
/* -------------------------------------------------------------------------- */

type PartKind =
  | 'image'
  | 'photo'
  | 'avatar'
  | 'title'
  | 'caption'
  | 'subtitle'
  | 'description'
  | 'button'
  | 'link'
  | 'stat'
  | 'label'
  | 'tag'
  | 'icon'
  | 'glyph'
  | 'dot'
  | 'person'
  | 'picture'
  | 'blob'
  | 'badge'
  | 'input'
  | 'divider'
  | 'indicator';

/**
 * One grey bar. `radius: 'round'` means min(w, h) / 2 (circular for squares).
 * Sizing, first match wins: `rel` (fraction of the box's smaller side, for
 * glyphs that scale with tiny hosts), `fillH` (full box height), else `h`.
 * An `overlay` bar sits inside the previous bar's corner instead of below it.
 */
interface Bar {
  role: NodeRole;
  h: number;
  /** Fraction of the available width (default 1). Ignored when `w` is set. */
  wFrac?: number;
  /** Fixed width in px (capped by the available width). */
  w?: number;
  /** Height as a fraction of the box's smaller side (width: `relW`, default `rel`). */
  rel?: number;
  relW?: number;
  fillH?: boolean;
  overlay?: 'topLeft' | 'topRight';
  /** Lightness offset from what is behind the bar (resolved in `paint`). */
  tone: ToneKind;
  radius: number | 'round';
  strokeWidth?: number;
}

/** Bar heights of the text kinds; unique so placeholders can tell them apart. */
const TEXT_BAR_HEIGHT = {
  description: 10,
  label: 11,
  link: 12,
  subtitle: 14,
  stat: 24,
} as const;

type TextKind = keyof typeof TEXT_BAR_HEIGHT;

const PART_BARS: Record<PartKind, Bar[]> = {
  image: [{ role: 'image', h: 96, tone: 'image', radius: 8 }],
  // Product photo with a "sale" badge pinned in its corner.
  photo: [
    { role: 'image', h: 96, tone: 'image', radius: 8 },
    { role: 'badge', h: 18, w: 40, overlay: 'topLeft', tone: 'badge', radius: 9999 },
  ],
  avatar: [{ role: 'image', h: 48, w: 48, tone: 'image', radius: 'round' }],
  title: [{ role: 'heading', h: 16, wFrac: 0.7, tone: 'title', radius: 4 }],
  // A short, bold label inside a control (button text).
  caption: [{ role: 'heading', h: 12, wFrac: 0.5, tone: 'title', radius: 4 }],
  subtitle: [{ role: 'text', h: TEXT_BAR_HEIGHT.subtitle, wFrac: 0.5, tone: 'text', radius: 4 }],
  description: [
    { role: 'text', h: TEXT_BAR_HEIGHT.description, wFrac: 1, tone: 'text', radius: 4 },
    { role: 'text', h: TEXT_BAR_HEIGHT.description, wFrac: 1, tone: 'text', radius: 4 },
    { role: 'text', h: TEXT_BAR_HEIGHT.description, wFrac: 0.6, tone: 'text', radius: 4 },
  ],
  button: [{ role: 'button', h: 28, wFrac: 0.4, tone: 'button', radius: 6 }],
  link: [{ role: 'text', h: TEXT_BAR_HEIGHT.link, wFrac: 0.4, tone: 'text', radius: 4 }],
  stat: [{ role: 'text', h: TEXT_BAR_HEIGHT.stat, wFrac: 0.5, tone: 'text', radius: 4 }],
  label: [{ role: 'text', h: TEXT_BAR_HEIGHT.label, wFrac: 0.35, tone: 'text', radius: 4 }],
  // Label-height text filling most of a small pill (badge text).
  tag: [{ role: 'text', h: TEXT_BAR_HEIGHT.label, wFrac: 0.6, tone: 'title', radius: 4 }],
  icon: [{ role: 'icon', h: 20, w: 20, tone: 'icon', radius: 4 }],
  glyph: [{ role: 'icon', h: 0, rel: 0.5, tone: 'icon', radius: 4 }],
  dot: [{ role: 'icon', h: 0, rel: 0.45, tone: 'button', radius: 'round' }],
  // Head and shoulders silhouette.
  person: [
    { role: 'image', h: 0, rel: 0.36, tone: 'title', radius: 'round' },
    { role: 'image', h: 0, rel: 0.22, relW: 0.62, tone: 'title', radius: 'round' },
  ],
  // Image placeholder with a "sun" in the corner.
  picture: [
    { role: 'image', h: 0, wFrac: 1, fillH: true, tone: 'image', radius: 4 },
    { role: 'icon', h: 0, rel: 0.24, overlay: 'topLeft', tone: 'title', radius: 'round' },
  ],
  // Decorative artwork: a soft blob with an accent shape on top.
  blob: [
    { role: 'image', h: 0, rel: 0.6, tone: 'image', radius: 'round' },
    { role: 'image', h: 0, rel: 0.35, overlay: 'topRight', tone: 'title', radius: 6 },
  ],
  badge: [{ role: 'badge', h: 18, wFrac: 0.25, tone: 'badge', radius: 9999 }],
  input: [{ role: 'input', h: 32, tone: 'input', radius: 6, strokeWidth: 1 }],
  divider: [{ role: 'divider', h: 1, tone: 'divider', radius: 0 }],
  // Active-tab underline.
  indicator: [{ role: 'divider', h: 3, wFrac: 0.6, tone: 'button', radius: 2 }],
};

/* -------------------------------------------------------------------------- */
/* Component registry                                                         */
/* -------------------------------------------------------------------------- */

type LayoutKind =
  | 'vertical'
  | 'horizontal'
  | 'leading'
  | 'rows'
  | 'split'
  | 'tabs'
  | 'grid'
  | 'center'
  | 'atomic';

interface ComponentSpec {
  id: string;
  /** Lowercase word phrases; a phrase matches a contiguous run of label words. */
  keywords: string[];
  parts: PartKind[];
  layout: LayoutKind;
  /** Horizontal alignment of parts in a vertical layout (and placeholder text). */
  align?: 'left' | 'center';
  /** Vertical gap between parts (default `GAP`). */
  gap?: number;
  /** vertical / rows: push the last part (row) to the bottom edge. */
  pinLast?: boolean;
  /** horizontal: 'center' groups all parts mid-row (no right-aligned button). */
  justify?: 'start' | 'center';
  /** rows: one entry per row; a multi-part row is a leading part + stacked rest. */
  rows?: PartKind[][];
  /** grid: the parts of one cell, repeated across the host. */
  cell?: PartKind[];
  /** Placeholder copy for headings, buttons and text bars of this component. */
  heading?: string;
  button?: string;
  text?: Partial<Record<TextKind, string>>;
}

/**
 * Ordered registry: the first entry with a matching keyword wins, so specific
 * phrases are listed before generic ones (e.g. "card grid" before "card",
 * "icon button" before "button"). Every label `componentInfer.ts` emits has
 * its own entry, so the three candidates offered for one shape always build
 * visibly different wireframes (different parts and/or layout strategy).
 */
const REGISTRY: ComponentSpec[] = [
  {
    // Avatar beside a title and a subtitle.
    id: 'listItem',
    keywords: ['list item', 'list row', 'row item'],
    parts: ['avatar', 'title', 'subtitle'],
    layout: 'leading',
    heading: 'List item title',
  },
  {
    id: 'stat',
    keywords: ['stat card', 'stat', 'metric', 'kpi'],
    parts: ['label', 'stat'],
    layout: 'vertical',
    heading: 'Metric',
  },
  {
    // Slim column of icon-only destinations.
    id: 'navRail',
    keywords: ['navigation rail', 'nav rail', 'rail'],
    parts: ['icon', 'icon', 'icon', 'icon'],
    layout: 'vertical',
    align: 'center',
    gap: 20,
  },
  {
    // Text options separated by dividers.
    id: 'menu',
    keywords: ['menu', 'dropdown', 'option list'],
    parts: ['link', 'divider', 'link', 'divider', 'link', 'divider', 'link'],
    layout: 'vertical',
    gap: 10,
    text: { link: 'Menu item' },
  },
  {
    // Account header, labelled nav items, action pinned at the bottom.
    id: 'sidebar',
    keywords: ['sidebar', 'side bar', 'drawer', 'side navigation'],
    parts: [],
    rows: [['avatar', 'title'], ['divider'], ['icon', 'link'], ['icon', 'link'], ['icon', 'link'], ['button']],
    layout: 'rows',
    gap: 14,
    pinLast: true,
    heading: 'Workspace',
    button: 'New item',
    text: { link: 'Section' },
  },
  {
    id: 'tabBar',
    keywords: ['tab bar', 'tabs', 'tab'],
    parts: ['link', 'link', 'link'],
    layout: 'tabs',
    text: { link: 'Tab' },
  },
  {
    // A centered row of page links.
    id: 'navBar',
    keywords: ['navigation bar', 'nav bar', 'navbar', 'nav'],
    parts: ['link', 'link', 'link', 'link'],
    layout: 'horizontal',
    justify: 'center',
    text: { link: 'Page' },
  },
  {
    id: 'toolbar',
    keywords: ['toolbar', 'tool bar', 'action bar'],
    parts: ['icon', 'icon', 'icon', 'button'],
    layout: 'horizontal',
    button: 'Save',
  },
  {
    id: 'header',
    keywords: ['header bar', 'header', 'app bar', 'top bar'],
    parts: ['icon', 'title', 'link', 'button'],
    layout: 'horizontal',
    heading: 'Brand',
    button: 'Sign in',
  },
  {
    id: 'searchBar',
    keywords: ['search bar', 'search'],
    parts: ['icon', 'label'],
    layout: 'horizontal',
    text: { label: 'Search...' },
  },
  {
    // Placeholder text at the start of the field.
    id: 'inputField',
    keywords: ['input field', 'input', 'text field'],
    parts: ['label'],
    layout: 'horizontal',
    text: { label: 'Type here...' },
  },
  {
    // Before 'button' so "Radio button" does not resolve to a plain button.
    id: 'radio',
    keywords: ['radio button', 'radio', 'checkbox'],
    parts: ['dot'],
    layout: 'center',
    align: 'center',
  },
  {
    id: 'iconButton',
    keywords: ['icon button'],
    parts: ['glyph'],
    layout: 'center',
    align: 'center',
  },
  {
    // A centered bold label.
    id: 'button',
    keywords: ['button', 'cta'],
    parts: ['caption'],
    layout: 'center',
    align: 'center',
    heading: 'Button',
  },
  {
    // Message on the left, action on the right.
    id: 'banner',
    keywords: ['banner', 'promo'],
    parts: ['title', 'description', 'button'],
    layout: 'split',
    heading: 'Announcement',
    button: 'Learn more',
  },
  {
    // Headline, copy and action on the left, big image on the right.
    id: 'hero',
    keywords: ['hero'],
    parts: ['title', 'subtitle', 'button', 'image'],
    layout: 'split',
    heading: 'Big headline',
    button: 'Get started',
  },
  {
    id: 'cardGrid',
    keywords: ['card grid', 'grid'],
    parts: [],
    cell: ['image', 'title'],
    layout: 'grid',
    heading: 'Card title',
  },
  {
    id: 'gallery',
    keywords: ['image gallery', 'gallery'],
    parts: [],
    cell: ['image'],
    layout: 'grid',
  },
  {
    id: 'featureList',
    keywords: ['feature list', 'features'],
    parts: [],
    rows: [['icon', 'title', 'label'], ['icon', 'title', 'label'], ['icon', 'title', 'label']],
    layout: 'rows',
    gap: 16,
    heading: 'Feature',
    text: { label: 'Short benefit' },
  },
  {
    id: 'section',
    keywords: ['content section', 'section'],
    parts: ['title', 'subtitle', 'description'],
    layout: 'vertical',
    heading: 'Section title',
  },
  {
    // Image on the left, text on the right.
    id: 'mediaObject',
    keywords: ['media object', 'media'],
    parts: ['image', 'title', 'description'],
    layout: 'leading',
    heading: 'Media title',
  },
  {
    id: 'profileCard',
    keywords: ['profile card', 'contact card', 'user card'],
    parts: ['avatar', 'title', 'subtitle', 'button'],
    layout: 'vertical',
    align: 'center',
    heading: 'Full name',
    button: 'Follow',
    text: { subtitle: 'Role or short bio' },
  },
  {
    id: 'productCard',
    keywords: ['product card'],
    parts: ['photo', 'title', 'stat', 'button'],
    layout: 'vertical',
    heading: 'Product name',
    button: 'Add to cart',
    text: { stat: '$49.00' },
  },
  {
    id: 'itemCard',
    keywords: ['item card'],
    parts: ['image', 'title', 'description', 'button'],
    layout: 'vertical',
    heading: 'Card title',
    button: 'Learn more',
  },
  {
    // Heading over a rule, then body copy.
    id: 'panel',
    keywords: ['panel'],
    parts: ['title', 'divider', 'description'],
    layout: 'vertical',
    heading: 'Panel title',
  },
  {
    id: 'card',
    keywords: ['card', 'tile'],
    parts: ['image', 'title', 'description'],
    layout: 'vertical',
    heading: 'Card title',
  },
  {
    id: 'avatar',
    keywords: ['avatar', 'profile picture'],
    parts: ['person'],
    layout: 'center',
    align: 'center',
  },
  {
    id: 'progressRing',
    keywords: ['progress ring', 'progress circle', 'spinner'],
    parts: ['stat'],
    layout: 'center',
    align: 'center',
    text: { stat: '75%' },
  },
  {
    id: 'thumbnail',
    keywords: ['thumbnail', 'image block', 'image', 'photo', 'picture'],
    parts: ['picture'],
    layout: 'center',
    align: 'center',
  },
  {
    id: 'illustration',
    keywords: ['illustration', 'artwork'],
    parts: ['blob'],
    layout: 'center',
    align: 'center',
  },
  {
    id: 'badge',
    keywords: ['badge', 'tag', 'chip', 'pill'],
    parts: ['tag'],
    layout: 'center',
    align: 'center',
    // A squashed tag bar in a tiny host reads as description height.
    text: { label: 'New', description: 'New' },
  },
  {
    id: 'icon',
    keywords: ['icon', 'glyph'],
    parts: ['glyph'],
    layout: 'center',
    align: 'center',
  },
  {
    // The host itself IS the component; there is nothing to put inside. Lines
    // and pen paths also land here: the renderer draws no children for them.
    id: 'atomic',
    keywords: [
      'status dot',
      'dot',
      'divider',
      'separator',
      'progress bar',
      'scrollbar',
      'annotation',
      'custom shape',
    ],
    parts: [],
    layout: 'atomic',
  },
];

const DEFAULT_SPEC: ComponentSpec = {
  id: 'default',
  keywords: [],
  parts: ['title', 'description'],
  layout: 'vertical',
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 0)
    .map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word));
}

function containsPhrase(words: string[], phrase: string[]): boolean {
  if (phrase.length === 0 || phrase.length > words.length) return false;
  for (let start = 0; start + phrase.length <= words.length; start += 1) {
    if (phrase.every((word, i) => words[start + i] === word)) return true;
  }
  return false;
}

function resolveComponent(label: string): ComponentSpec {
  const words = tokenize(label);
  for (const spec of REGISTRY) {
    if (spec.keywords.some((keyword) => containsPhrase(words, tokenize(keyword)))) {
      return spec;
    }
  }
  return DEFAULT_SPEC;
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                     */
/* -------------------------------------------------------------------------- */

/** A positioned grey box, before it becomes an IRNode. */
interface Draft {
  role: NodeRole;
  x: number;
  y: number;
  w: number;
  h: number;
  tone: ToneKind;
  radius: number;
  strokeWidth?: number;
}

interface PlacedPart {
  drafts: Draft[];
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Height of a part made of fixed-height bars (overlays add nothing). */
function partHeight(kind: PartKind): number {
  const bars = PART_BARS[kind].filter((bar) => bar.overlay === undefined);
  return bars.reduce((sum, bar) => sum + bar.h, 0) + Math.max(0, bars.length - 1) * BAR_GAP;
}

function offset(drafts: Draft[], dx: number, dy: number): Draft[] {
  return drafts.map((d) => ({ ...d, x: Math.round(d.x + dx), y: Math.round(d.y + dy) }));
}

/**
 * Place the bars of one part inside the box `x..x+availW` starting at `y`.
 * `flexH` overrides the height of the first bar (used for flexible images);
 * `fillWidth` makes every bar use the full available width; `boxH` is the box
 * height that `rel` / `fillH` bars are sized against (default: `availW`).
 */
function placePart(
  kind: PartKind,
  x: number,
  y: number,
  availW: number,
  options: { flexH?: number; fillWidth?: boolean; align?: 'left' | 'center'; boxH?: number } = {},
): PlacedPart {
  const boxH = options.boxH ?? availW;
  const minSide = Math.min(availW, boxH);
  const drafts: Draft[] = [];
  let base: Draft | undefined;
  let cursor = y;
  PART_BARS[kind].forEach((bar, index) => {
    if (bar.overlay !== undefined && base !== undefined) {
      // Pinned inside the previous bar's corner; does not advance the cursor.
      const side = Math.min(base.w, base.h);
      const h = bar.rel !== undefined ? Math.round(bar.rel * side) : Math.min(bar.h, base.h);
      const w = bar.rel !== undefined ? Math.round((bar.relW ?? bar.rel) * side) : Math.min(bar.w ?? bar.h, base.w);
      const inset = Math.round(side * 0.1);
      drafts.push({
        role: bar.role,
        x: bar.overlay === 'topLeft' ? base.x + inset : base.x + base.w - w - inset,
        y: base.y + inset,
        w: Math.max(1, w),
        h: Math.max(1, h),
        tone: bar.tone,
        radius: bar.radius === 'round' ? Math.round(Math.min(w, h) / 2) : bar.radius,
        strokeWidth: bar.strokeWidth,
      });
      return;
    }
    let h: number;
    if (index === 0 && options.flexH !== undefined) h = options.flexH;
    else if (bar.rel !== undefined) h = Math.max(1, Math.round(bar.rel * minSide));
    else if (bar.fillH) h = Math.max(1, Math.round(boxH));
    else h = bar.h;
    const rawW =
      bar.rel !== undefined
        ? (bar.relW ?? bar.rel) * minSide
        : bar.w !== undefined
          ? Math.min(bar.w, availW)
          : availW * (options.fillWidth ? 1 : (bar.wFrac ?? 1));
    const w = Math.max(1, Math.round(Math.min(rawW, availW)));
    const dx = options.align === 'center' ? (availW - w) / 2 : 0;
    base = {
      role: bar.role,
      x: Math.round(x + dx),
      y: Math.round(cursor),
      w,
      h,
      tone: bar.tone,
      radius: bar.radius === 'round' ? Math.round(Math.min(w, h) / 2) : bar.radius,
      strokeWidth: bar.strokeWidth,
    };
    drafts.push(base);
    cursor += h + BAR_GAP;
  });
  return { drafts, height: Math.max(0, cursor - BAR_GAP - y) };
}

/** True for parts whose first bar is a flexible-height image block. */
function isFlexImage(kind: PartKind): boolean {
  return kind === 'image' || kind === 'photo';
}

/**
 * Stack parts top to bottom; an image part absorbs the remaining height.
 * With `pinLast` the last part sits on the bottom edge.
 */
function layoutVertical(
  parts: PartKind[],
  x: number,
  availW: number,
  hostH: number,
  spec: ComponentSpec,
): Draft[] {
  const gap = spec.gap ?? GAP;
  const imageIndex = parts.findIndex(isFlexImage);
  let imageH: number | undefined;
  if (imageIndex >= 0) {
    const others = parts.reduce(
      (sum, kind, i) => (i === imageIndex ? sum : sum + partHeight(kind)),
      0,
    );
    const avail = hostH - PAD * 2 - others - (parts.length - 1) * gap;
    imageH = Math.round(clamp(avail, IMAGE_MIN_H, IMAGE_MAX_H));
  }

  const drafts: Draft[] = [];
  let y = PAD;
  parts.forEach((kind, i) => {
    const pinned = spec.pinLast === true && i === parts.length - 1 && parts.length > 1;
    const placed = placePart(kind, x, 0, availW, {
      flexH: i === imageIndex ? imageH : undefined,
      align: spec.align,
    });
    const top = pinned ? Math.max(y, hostH - PAD - placed.height) : y;
    drafts.push(...offset(placed.drafts, 0, top));
    y = top + placed.height + gap;
  });
  return drafts;
}

/** Desired width of a part in a horizontal row (before shrink-to-fit). */
function rowPartWidth(kind: PartKind, iw: number): number {
  switch (kind) {
    case 'icon':
      return 20;
    case 'title':
      return Math.min(iw * 0.25, 140);
    case 'link':
      return Math.min(iw * 0.15, 96);
    case 'button':
      return clamp(iw * 0.15, 56, 88);
    case 'label':
      return Math.min(iw * 0.4, 160);
    default:
      return Math.min(iw * 0.2, 96);
  }
}

/**
 * Left-to-right row, vertically centered. Widths are shrunk proportionally if
 * they do not fit; a trailing button is right-aligned, the rest start at left.
 * `justify: 'center'` groups every part in the middle of the row instead.
 */
function layoutHorizontal(parts: PartKind[], iw: number, hostH: number, spec: ComponentSpec): Draft[] {
  const gaps = Math.max(0, parts.length - 1) * GAP;
  const desired = parts.map((kind) => rowPartWidth(kind, iw));
  const total = desired.reduce((sum, w) => sum + w, 0) + gaps;
  const scale = total > iw ? Math.max(0.1, (iw - gaps) / (total - gaps)) : 1;
  const widths = desired.map((w) => Math.max(1, Math.floor(w * scale)));
  const centered = spec.justify === 'center';
  const used = widths.reduce((sum, w) => sum + w, 0) + gaps;

  const lastIsButton = !centered && parts.length > 1 && parts[parts.length - 1] === 'button';
  const drafts: Draft[] = [];
  let x = centered ? PAD + Math.max(0, (iw - used) / 2) : PAD;
  parts.forEach((kind, i) => {
    const w = widths[i];
    // Centered on the host itself, so short controls keep their content.
    const y = Math.max(0, (hostH - partHeight(kind)) / 2);
    const px = lastIsButton && i === parts.length - 1 ? PAD + iw - w : x;
    drafts.push(...placePart(kind, px, y, w, { fillWidth: true }).drafts);
    x += w + GAP;
  });
  return drafts;
}

/**
 * One row at `y`: a leading part on the left and the remaining parts stacked
 * on its right, both vertically centered on the taller of the two. A leading
 * image is a square of `leadSize` (media object); other leads keep their size.
 */
function placeRow(row: PartKind[], x: number, y: number, w: number, leadSize?: number): PlacedPart {
  const [lead, ...rest] = row;
  if (lead === undefined) return { drafts: [], height: 0 };
  if (rest.length === 0) return placePart(lead, x, y, w);

  const flexLead = isFlexImage(lead) && leadSize !== undefined;
  const leadW = flexLead ? leadSize : Math.min(PART_BARS[lead][0]?.w ?? 32, w);
  const restX = x + leadW + GAP;
  const restW = Math.max(1, w - leadW - GAP);

  const restDrafts: Draft[] = [];
  let cursor = 0;
  rest.forEach((kind) => {
    const placed = placePart(kind, restX, cursor, restW);
    restDrafts.push(...placed.drafts);
    cursor += placed.height + GAP;
  });
  const stackH = Math.max(0, cursor - GAP);
  const leadPlaced = placePart(lead, x, 0, leadW, flexLead ? { flexH: leadSize } : {});
  const rowH = Math.max(stackH, leadPlaced.height);
  return {
    drafts: [
      ...offset(leadPlaced.drafts, 0, y + (flexLead ? 0 : (rowH - leadPlaced.height) / 2)),
      ...offset(restDrafts, 0, y + (flexLead ? 0 : (rowH - stackH) / 2)),
    ],
    height: rowH,
  };
}

/** First part on the left (icon, avatar or a square image), the rest stacked right. */
function layoutLeading(parts: PartKind[], iw: number, hostH: number): Draft[] {
  const leadSize = Math.max(IMAGE_MIN_H, Math.round(Math.min(iw * 0.38, hostH - PAD * 2)));
  return placeRow(parts, PAD, PAD, iw, leadSize).drafts;
}

/** Rows stacked top to bottom (see `placeRow`); `pinLast` drops the last row to the bottom. */
function layoutRows(rows: PartKind[][], iw: number, hostH: number, spec: ComponentSpec): Draft[] {
  const gap = spec.gap ?? GAP;
  const drafts: Draft[] = [];
  let y = PAD;
  rows.forEach((row, i) => {
    const placed = placeRow(row, PAD, 0, iw);
    const pinned = spec.pinLast === true && i === rows.length - 1 && rows.length > 1;
    const top = pinned ? Math.max(y, hostH - PAD - placed.height) : y;
    drafts.push(...offset(placed.drafts, 0, top));
    y = top + placed.height + gap;
  });
  return drafts;
}

/**
 * Main parts stacked on the left (vertically centered), the last part on the
 * right: an image fills the full height, anything else is vertically centered.
 */
function layoutSplit(parts: PartKind[], iw: number, hostH: number): Draft[] {
  const side = parts[parts.length - 1];
  const main = parts.slice(0, -1);
  const innerH = Math.max(1, hostH - PAD * 2);
  const sideW = isFlexImage(side) ? Math.round(iw * 0.42) : Math.round(rowPartWidth(side, iw));
  const sideX = PAD + iw - sideW;
  const sideDrafts = isFlexImage(side)
    ? placePart(side, sideX, PAD, sideW, { flexH: Math.max(IMAGE_MIN_H, innerH) }).drafts
    : placePart(side, sideX, PAD + Math.max(0, (innerH - partHeight(side)) / 2), sideW, {
        fillWidth: true,
      }).drafts;

  const mainW = Math.max(1, iw - sideW - GAP * 2);
  const mainDrafts: Draft[] = [];
  let cursor = 0;
  main.forEach((kind) => {
    const placed = placePart(kind, PAD, cursor, mainW);
    mainDrafts.push(...placed.drafts);
    cursor += placed.height + GAP;
  });
  const stackH = Math.max(0, cursor - GAP);
  return [...offset(mainDrafts, 0, PAD + Math.max(0, (innerH - stackH) / 2)), ...sideDrafts];
}

/** Equal-width tab cells with centered labels and an underline under the first. */
function layoutTabs(parts: PartKind[], iw: number, hostH: number): Draft[] {
  const cellW = iw / Math.max(1, parts.length);
  const indicatorH = partHeight('indicator');
  const drafts: Draft[] = [];
  let labelBottom = 0;
  parts.forEach((kind, i) => {
    const y = Math.max(0, (hostH - partHeight(kind)) / 2);
    labelBottom = Math.max(labelBottom, y + partHeight(kind));
    drafts.push(...placePart(kind, PAD + i * cellW, y, cellW, { align: 'center' }).drafts);
  });
  // Near the bottom edge, below the labels when the bar is tall enough.
  const indicatorY = Math.min(
    hostH - indicatorH,
    Math.max(hostH - indicatorH - Math.round(PAD / 3), labelBottom + 2),
  );
  drafts.push(...placePart('indicator', PAD, indicatorY, cellW, { align: 'center' }).drafts);
  return drafts;
}

/** Repeat `cell` in a grid that fits the host (2-4 columns, 1-3 rows). */
function layoutGrid(cell: PartKind[], iw: number, hostH: number): Draft[] {
  const innerH = Math.max(1, hostH - PAD * 2);
  const cols = clamp(Math.round(iw / 160), 2, 4);
  const cellW = Math.max(1, (iw - (cols - 1) * GAP) / cols);
  const others = cell.reduce((sum, kind) => (isFlexImage(kind) ? sum : sum + partHeight(kind) + BAR_GAP), 0);
  const fitRows = (imageH: number) => Math.floor((innerH + GAP) / (imageH + others + GAP));
  const rows = clamp(fitRows(Math.max(IMAGE_MIN_H, cellW * 0.6)), 1, 3);
  const imageH = Math.round(
    clamp((innerH - (rows - 1) * GAP) / rows - others, IMAGE_MIN_H, IMAGE_MAX_H),
  );

  const drafts: Draft[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = PAD + c * (cellW + GAP);
      let y = PAD + r * (imageH + others + GAP);
      cell.forEach((kind) => {
        const placed = placePart(kind, x, y, cellW, isFlexImage(kind) ? { flexH: imageH } : {});
        drafts.push(...placed.drafts);
        y += placed.height + BAR_GAP;
      });
    }
  }
  return drafts;
}

/**
 * Parts centered on both axes, sized against the host (glyphs scale down for
 * tiny shapes such as a 20px dot); padding shrinks with the host.
 */
function layoutCenter(parts: PartKind[], hostW: number, hostH: number): Draft[] {
  const pad = Math.min(PAD, Math.round(Math.min(hostW, hostH) * 0.15));
  const boxW = Math.max(1, hostW - pad * 2);
  const boxH = Math.max(1, hostH - pad * 2);
  // A part taller than the whole host (label text in a 16px dot) is squashed to fit.
  const placed = parts.map((kind): PlacedPart => {
    const part = placePart(kind, pad, 0, boxW, { align: 'center', boxH });
    if (part.height <= hostH) return part;
    return { drafts: part.drafts.map((d) => ({ ...d, h: Math.min(d.h, hostH) })), height: hostH };
  });
  const total = placed.reduce((sum, p) => sum + p.height, 0) + Math.max(0, placed.length - 1) * BAR_GAP;
  const drafts: Draft[] = [];
  let y = total > boxH ? Math.max(0, (hostH - total) / 2) : pad + (boxH - total) / 2;
  placed.forEach((p) => {
    drafts.push(...offset(p.drafts, 0, y));
    y += p.height + BAR_GAP;
  });
  return drafts;
}

/** Resolve each draft's tone into a fill against whatever is directly behind it. */
function paint(drafts: Draft[], hostBg: RGB): NodeStyle[] {
  const painted: { rect: Rect; fill: RGB | null }[] = [];
  return drafts.map((draft, i) => {
    painted.push({ rect: draft, fill: null });
    const bg = backgroundBehind(painted, i, hostBg);
    const fill = draft.tone === 'input' ? inputFill(bg) : tone(bg, TONE[draft.tone]);
    painted[i].fill = hexToRgb(fill);
    const style: NodeStyle = { fill, borderRadius: draft.radius };
    if (draft.tone === 'input') style.stroke = tone(bg, TONE.inputStroke);
    if (draft.strokeWidth !== undefined) style.strokeWidth = draft.strokeWidth;
    return style;
  });
}

function toNode(host: IRNode, draft: Draft, style: NodeStyle, id: string, order: number): IRNode {
  return {
    id,
    role: draft.role,
    parentId: host.id,
    order,
    tailwind: '',
    layout: { x: draft.x, y: draft.y, w: draft.w, h: draft.h },
    style,
    provenance: { promptClauseId: host.provenance.promptClauseId, source: 'user' },
  };
}

/**
 * Build the grey-wireframe child nodes for a chosen component, laid out INSIDE
 * `host` (an absolutely-positioned shape node). Children are flat IRNodes with
 * parentId = host.id and ABSOLUTE layout relative to the host's top-left
 * (x/y in 0..host.w / 0..host.h). Pure; allocates ids above `existingIds`.
 * `backdrop` is the opaque color behind the host (see `wireframeBackdrop`);
 * part greys are picked relative to the host's fill over it.
 * Returns [] for atomic components with no inner parts (status dot, dividers,
 * progress bar, freeform paths): the host itself represents those.
 */
export function wireframeChildren(
  host: IRNode,
  componentLabel: string,
  existingIds: string[],
  backdrop: string = DEFAULT_BACKDROP,
): IRNode[] {
  const spec = resolveComponent(componentLabel);
  if (spec.layout === 'atomic') return [];

  const hostW = host.layout?.w ?? DEFAULT_HOST_W;
  const hostH = host.layout?.h ?? DEFAULT_HOST_H;
  const iw = Math.max(1, hostW - PAD * 2);

  let drafts: Draft[];
  switch (spec.layout) {
    case 'horizontal':
      drafts = layoutHorizontal(spec.parts, iw, hostH, spec);
      break;
    case 'leading':
      drafts = layoutLeading(spec.parts, iw, hostH);
      break;
    case 'rows':
      drafts = layoutRows(spec.rows ?? [], iw, hostH, spec);
      break;
    case 'split':
      drafts = layoutSplit(spec.parts, iw, hostH);
      break;
    case 'tabs':
      drafts = layoutTabs(spec.parts, iw, hostH);
      break;
    case 'grid':
      drafts = layoutGrid(spec.cell ?? [], iw, hostH);
      break;
    case 'center':
      drafts = layoutCenter(spec.parts, hostW, hostH);
      break;
    default:
      drafts = layoutVertical(spec.parts, PAD, iw, hostH, spec);
      break;
  }
  // Parts that do not fit a short host are dropped rather than spilling out.
  drafts = drafts.filter((d) => d.x >= 0 && d.y >= 0 && d.x + d.w <= hostW && d.y + d.h <= hostH);
  if (drafts.length === 0) return [];

  const styles = paint(drafts, hostBackground(host, backdrop));
  const running = [...existingIds];
  return drafts.map((draft, order) => {
    const id = nextNodeId(running);
    running.push(id);
    return toNode(host, draft, styles[order], id, order);
  });
}

/* -------------------------------------------------------------------------- */
/* Placeholder content                                                        */
/* -------------------------------------------------------------------------- */

const DESCRIPTION_LINES: readonly string[] = [
  'Supporting detail goes here.',
  'A short line of placeholder copy.',
  'More detail.',
];

/** Pick the text kind whose bar height is closest to `h`. */
function textKindForHeight(h: number): TextKind {
  let best: TextKind = 'description';
  let bestDelta = Number.POSITIVE_INFINITY;
  (Object.keys(TEXT_BAR_HEIGHT) as TextKind[]).forEach((kind) => {
    const delta = Math.abs(TEXT_BAR_HEIGHT[kind] - h);
    if (delta < bestDelta) {
      best = kind;
      bestDelta = delta;
    }
  });
  return best;
}

interface TextLook {
  content: string;
  fontSize: number;
  fontWeight: number;
}

/** Sample copy for a text bar; `override` is the component's own wording. */
function textLook(kind: TextKind, descriptionIndex: number, override?: string): TextLook {
  const look = defaultTextLook(kind, descriptionIndex);
  return override !== undefined ? { ...look, content: override } : look;
}

function defaultTextLook(kind: TextKind, descriptionIndex: number): TextLook {
  switch (kind) {
    case 'stat':
      return { content: '1,234', fontSize: 20, fontWeight: 600 };
    case 'subtitle':
      return { content: 'A short supporting line.', fontSize: 12, fontWeight: 400 };
    case 'link':
      return { content: 'Link', fontSize: 12, fontWeight: 500 };
    case 'label':
      return { content: 'Total count', fontSize: 11, fontWeight: 400 };
    default:
      return {
        content: DESCRIPTION_LINES[Math.min(descriptionIndex, DESCRIPTION_LINES.length - 1)],
        fontSize: 11,
        fontWeight: 400,
      };
  }
}

/* ---- Theming ------------------------------------------------------------- */

/** How the host itself is restyled when its parts get filled. */
type HostLook = 'surface' | 'button' | 'field' | 'tint' | 'control';

function hostLookFor(spec: ComponentSpec): HostLook {
  switch (spec.id) {
    case 'button':
      return 'button';
    case 'inputField':
    case 'searchBar':
      return 'field';
    case 'avatar':
    case 'thumbnail':
    case 'illustration':
    case 'badge':
    case 'icon':
      return 'tint';
    case 'iconButton':
    case 'radio':
    case 'progressRing':
      return 'control';
    default:
      return 'surface';
  }
}

/** Glyphs for icon parts, in order (cycled). 'logo' paints an accent brand tile. */
const SPEC_ICONS: Record<string, string[]> = {
  navRail: ['home', 'search', 'bell', 'settings'],
  sidebar: ['home', 'bar-chart', 'users'],
  toolbar: ['pencil', 'copy', 'share-2'],
  header: ['logo'],
  searchBar: ['search'],
  featureList: ['zap', 'shield', 'sparkles'],
  iconButton: ['plus'],
  icon: ['star'],
};

/** Secondary (outlined) buttons; every other button is primary (accent). */
const SECONDARY_BUTTON = new Set(['itemCard', 'sidebar']);

/** Accent depth of a painted area: surface 0, soft tint 1, mid tint 2, accent 3. */
type Level = 0 | 1 | 2 | 3;

/** True while a host still wears the default look of a freshly drawn shape. */
function isDrawnLook(host: IRNode): boolean {
  const fill = host.style?.fill?.trim().toLowerCase();
  const twBg = (host.tailwind ?? '').split(/\s+/).some((c) => /^bg-/.test(c));
  return (fill === undefined || fill === DRAWN_FILL) && !twBg;
}

function hostStyleFor(look: HostLook, host: IRNode, spec: ComponentSpec, p: UIPalette): NodeStyle {
  const w = host.layout?.w ?? DEFAULT_HOST_W;
  const h = host.layout?.h ?? DEFAULT_HOST_H;
  const base: NodeStyle = { ...host.style };
  // Round looks only on (roughly) square shapes; a pill-stretched circle reads wrong.
  const squarish = Math.max(w, h) <= Math.min(w, h) * 1.3;
  if (p.fontFamily) base.fontFamily = p.fontFamily;
  switch (look) {
    case 'button':
      return { ...base, fill: p.accent, strokeWidth: 0, borderRadius: p.controlRadius };
    case 'field':
      return { ...base, fill: p.field, stroke: p.border, strokeWidth: 1, borderRadius: p.controlRadius };
    case 'tint':
      return {
        ...base,
        fill: p.accentSoft,
        strokeWidth: 0,
        borderRadius:
          spec.id === 'badge' || (spec.id === 'avatar' && squarish)
            ? 9999
            : Math.min(p.radius, Math.round(Math.min(w, h) / 4)),
      };
    case 'control':
      return spec.id === 'progressRing'
        ? { ...base, fill: p.surface, stroke: p.accent, strokeWidth: 4, borderRadius: squarish ? 9999 : p.radius }
        : {
            ...base,
            fill: p.surface,
            stroke: p.border,
            strokeWidth: spec.id === 'radio' ? 1.5 : 1,
            borderRadius: spec.id === 'radio' && squarish ? 9999 : p.controlRadius,
          };
    default:
      return {
        ...base,
        fill: p.surface,
        stroke: p.border,
        strokeWidth: 1,
        borderRadius: Math.min(p.radius, Math.round(Math.min(w, h) / 4)),
        shadow: p.dark ? '' : '0 1px 2px rgba(0,0,0,0.05)',
      };
  }
}

function levelFill(p: UIPalette, level: Level): string {
  return level >= 3 ? p.accent : level === 2 ? p.accentMid : level === 1 ? p.accentSoft : p.surface;
}

/* ---- Text measurement ----------------------------------------------------- */

const LINE_HEIGHT = 1.25;
const MIN_FONT = 9;
const TEXT_GAP = 4;

/** Deterministic width estimate of one line of sans-serif text, in px. */
export function estimateTextWidth(text: string, fontSize: number, fontWeight: number | string = 400): number {
  let em = 0;
  for (const ch of text) {
    if (ch === ' ') em += 0.28;
    else if ("il.,:;|!'`".includes(ch)) em += 0.27;
    else if ('fjrt()[]-'.includes(ch)) em += 0.37;
    else if ('mwMW'.includes(ch)) em += 0.86;
    else if (/[A-Z]/.test(ch)) em += 0.67;
    else if (/[0-9$%]/.test(ch)) em += 0.6;
    else em += 0.56;
  }
  const weight = Number(fontWeight) || 400;
  const bold = weight >= 600 ? 1.06 : weight >= 500 ? 1.03 : 1;
  return Math.ceil(em * fontSize * bold * 1.04) + 2;
}

function lineBox(fontSize: number): number {
  return Math.ceil(fontSize * LINE_HEIGHT);
}

/* ---- Fit (no overlap) ----------------------------------------------------- */

/**
 * How a filled part is sized: `line` single-line text (never wraps, may widen,
 * shrink or truncate), `wrap` multi-line copy (line-clamped), `label` a
 * control with centered text (button, badge), `block` fixed-size content.
 */
type FitKind = 'line' | 'wrap' | 'label' | 'block';

interface FitItem {
  node: IRNode;
  kind: FitKind;
  /** Original (wireframe) box. */
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  fontWeight: number | string;
  text: string;
  centered: boolean;
  /** A flexible block (big image) that may give up height. */
  flexImage: boolean;
  /** A round image (avatar) that may shrink as a last resort. */
  roundImage: boolean;
  /** Index of the item this one is pinned inside (badge on a photo). */
  overlayOf: number;
}

interface FitParams {
  maxLines: number;
  /** Scale for flexible image heights, down to `imageFloor` of the original. */
  imageScale: number;
  imageFloor: number;
  fontScale: number;
  shrinkAvatars: boolean;
}

interface FitBox {
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  lines: number;
  truncated: boolean;
}

interface FitOutcome {
  boxes: FitBox[];
  /** Host height needed so every part fits with the original bottom padding. */
  needH: number;
}

function vOverlap(a: { y: number; h: number }, b: { y: number; h: number }): boolean {
  return a.y < b.y + b.h && b.y < a.y + a.h;
}

function hOverlap(a: { x: number; w: number }, b: { x: number; w: number }): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w;
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/**
 * Lay the filled parts out without overlap. Horizontal: single-line text and
 * labels widen into free space beside them (never past a neighbour or the
 * host padding), then shrink their font, then truncate. Vertical: each part
 * keeps its wireframe position unless a part above it (sharing columns) grew,
 * in which case it is pushed down, keeping the original gap (capped). Parts
 * pinned inside another part move with it. Pure and deterministic.
 */
function fitItems(items: FitItem[], hostW: number, hostH: number, params: FitParams, layout: LayoutKind): FitOutcome {
  const boxes: FitBox[] = items.map((it) => ({
    x: it.x,
    y: it.y,
    w: it.w,
    h: it.h,
    fontSize: Math.max(MIN_FONT, Math.round(it.fontSize * params.fontScale)),
    lines: 1,
    truncated: false,
  }));
  const peers = (i: number) =>
    items
      .map((it, j) => ({ it, j }))
      .filter(({ it, j }) => j !== i && it.overlayOf !== i && items[i].overlayOf !== j && !contains(it, items[i]) && !contains(items[i], it));

  // 1. Widths and font sizes.
  items.forEach((it, i) => {
    const box = boxes[i];
    if (it.kind === 'block') {
      if (it.flexImage && params.imageScale < 1) {
        box.h = Math.max(Math.round(it.h * params.imageFloor), IMAGE_MIN_H, Math.round(it.h * params.imageScale));
        box.h = Math.min(box.h, it.h);
      }
      if (it.roundImage && params.shrinkAvatars && it.w > 28) {
        const side = Math.max(24, Math.round(it.w * 0.75));
        box.x = it.x + Math.round((it.w - side) / 2);
        box.w = side;
        box.h = side;
      }
      return;
    }
    // Right edge a part may widen to: the nearest (already widened) neighbour
    // on its right, else the host's inner edge.
    const rightLimit = () =>
      peers(i)
        .filter(({ it: o }) => vOverlap(o, it) && o.x >= it.x + it.w - 0.5)
        .reduce((m, { j }) => Math.min(m, boxes[j].x - TEXT_GAP), hostW - Math.min(PAD, Math.max(0, hostW - it.x - it.w)));
    if (it.kind === 'wrap') {
      const width = estimateTextWidth(it.text, box.fontSize, it.fontWeight);
      // Copy first widens into free room on its right, then wraps.
      if (width > it.w) box.w = Math.round(clamp(width, it.w, Math.max(it.w, rightLimit() - it.x)));
      box.lines = clamp(Math.ceil(width / Math.max(1, box.w)), 1, params.maxLines);
      box.truncated = width > box.w * box.lines;
      box.h = Math.max(it.h, Math.ceil(box.lines * box.fontSize * LINE_HEIGHT));
      return;
    }
    const pad = it.kind === 'label' ? 16 : 0;
    const need = () => estimateTextWidth(it.text, box.fontSize, it.fontWeight) + pad;
    if (need() > it.w) {
      const others = peers(i);
      // Neighbours as already widened (earlier items took their share first).
      const right = rightLimit();
      const left = others
        .filter(({ it: o }) => vOverlap(o, it) && o.x + o.w <= it.x + 0.5)
        .reduce((m, { j }) => Math.max(m, boxes[j].x + boxes[j].w + TEXT_GAP), Math.min(PAD, Math.max(0, it.x)));
      const freeR = Math.max(0, right - (it.x + it.w));
      const freeL = Math.max(0, it.x - left);
      let extra = need() - it.w;
      let growL = 0;
      let growR = 0;
      if (it.centered) {
        const half = Math.ceil(extra / 2);
        growL = Math.min(half, freeL);
        growR = Math.min(half, freeR);
        extra -= growL + growR;
        const moreR = Math.min(extra, freeR - growR);
        growR += Math.max(0, moreR);
        extra -= Math.max(0, moreR);
        growL += Math.max(0, Math.min(extra, freeL - growL));
      } else {
        const rightAnchored = layout === 'horizontal' && it.x + it.w >= hostW - PAD - 1;
        if (rightAnchored) {
          growL = Math.min(extra, freeL);
          growR = Math.min(extra - growL, freeR);
        } else {
          growR = Math.min(extra, freeR);
          growL = Math.min(extra - growR, freeL);
        }
      }
      box.x = Math.round(it.x - growL);
      box.w = Math.round(it.w + growL + growR);
      if (need() > box.w) {
        const textW = estimateTextWidth(it.text, box.fontSize, it.fontWeight);
        const scaled = Math.floor((box.fontSize * (box.w - pad)) / Math.max(1, textW));
        box.fontSize = Math.max(Math.min(MIN_FONT, box.fontSize), Math.min(box.fontSize, scaled));
        box.truncated = need() > box.w;
      }
    }
    if (it.kind === 'label') {
      // Text must sit inside the control with a little vertical breathing room.
      const room = it.h - 4;
      if (lineBox(box.fontSize) > room) {
        box.fontSize = Math.max(Math.min(MIN_FONT, box.fontSize), Math.floor(room / LINE_HEIGHT));
      }
      box.h = Math.max(it.h, lineBox(box.fontSize) + 2);
    } else {
      box.h = Math.max(it.h, lineBox(box.fontSize));
    }
  });

  // Sibling labels of one kind (nav links, tabs, menu items) share one size.
  const groups = new Map<string, number[]>();
  items.forEach((it, i) => {
    if (it.kind !== 'line') return;
    const key = `${it.node.role}|${it.h}|${it.fontSize}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  groups.forEach((members) => {
    if (members.length < 2) return;
    const size = Math.min(...members.map((i) => boxes[i].fontSize));
    members.forEach((i) => {
      const it = items[i];
      const box = boxes[i];
      box.fontSize = size;
      box.truncated = estimateTextWidth(it.text, size, it.fontWeight) > box.w;
      box.h = Math.max(it.h, lineBox(size));
    });
  });

  // 2. Vertical positions, top to bottom.
  const order = items.map((_, i) => i).sort((a, b) => items[a].y - items[b].y || items[a].x - items[b].x);
  const placed: number[] = [];
  order.forEach((i) => {
    const it = items[i];
    const box = boxes[i];
    if (it.overlayOf >= 0) {
      const base = items[it.overlayOf];
      const bb = boxes[it.overlayOf];
      box.x += bb.x - base.x;
      box.y = bb.y + (it.y - base.y);
      // Keep the pinned part inside a base that lost height.
      box.y = Math.min(box.y, bb.y + Math.max(0, bb.h - box.h));
      return;
    }
    const grown = box.h - it.h;
    let y = it.kind === 'line' || it.kind === 'label' ? it.y - Math.floor(grown / 2) : it.y;
    y = Math.max(0, y);
    const above = placed.filter((j) => items[j].y + items[j].h <= it.y + 0.5 && hOverlap(boxes[j], box));
    if (above.length > 0) {
      // Clear every part above (keeping the original gap, capped) ...
      const need = Math.max(
        ...above.map((j) => boxes[j].y + boxes[j].h + clamp(it.y - (items[j].y + items[j].h), 2, 16)),
      );
      // ... and follow them up when they all got shorter (a shrunk image).
      const delta = Math.max(...above.map((j) => boxes[j].y + boxes[j].h - (items[j].y + items[j].h)));
      y = Math.max(need, delta < 0 ? y + delta : y);
    }
    box.y = Math.round(y);
    placed.push(i);
  });

  const origBottom = items.reduce((m, it) => Math.max(m, it.y + it.h), 0);
  const bottom = boxes.reduce((m, b) => Math.max(m, b.y + b.h), 0);
  let padB = clamp(hostH - origBottom, 0, PAD);
  // Growing: give the bottom edge the same padding as the top (up to PAD).
  if (bottom + padB > hostH) {
    const top = items.reduce((m, it) => Math.min(m, it.y), Number.POSITIVE_INFINITY);
    padB = Math.max(padB, clamp(top, 0, PAD));
  }
  return { boxes, needH: Math.ceil(bottom + padB) };
}

/* ---- Fill ----------------------------------------------------------------- */

export interface FillOptions {
  /** Design palette to theme the placeholders with (default: neutral + indigo). */
  palette?: UIPalette;
  /** Largest width / height the host may grow to (its parent's room). */
  maxW?: number;
  maxH?: number;
}

export interface FillResult {
  /** Filled children (parts that cannot fit even after shrinking are left out). */
  children: IRNode[];
  /** Ids of input children that were left out. */
  removed: string[];
  /** The host with its new size and look (undefined when no host was given). */
  host?: IRNode;
}

/**
 * Turn grey-wireframe children into themed placeholder content laid out
 * without overlap. Colours come from `palette` (derived from the UI the shape
 * is drawn into): headings/body in the UI's text colours, primary buttons in
 * the accent, secondary buttons outlined, images and avatars as accent tints,
 * icons as muted glyphs, badges as accent pills, dividers in the border
 * colour. A host still wearing the drawn-shape grey is restyled as a surface,
 * button, field or tint matching the component. Text is measured
 * (estimated); the host grows to fit (up to `maxW` / `maxH`), and when it may
 * not, copy is clamped to one line, images and avatars shrink, fonts shrink
 * and, last, parts that still do not fit are dropped. Pure; ids kept.
 */
export function fillComponent(
  children: IRNode[],
  componentLabel: string,
  host?: IRNode,
  backdrop?: string,
  options: FillOptions = {},
): FillResult {
  const spec = resolveComponent(componentLabel);
  const palette = options.palette ?? derivePalette(undefined, backdrop ?? DEFAULT_BACKDROP);
  const look = hostLookFor(spec);

  // Host look: restyle a still-grey drawn shape to match the UI.
  let hostStyle: NodeStyle | undefined = host?.style;
  if (host && isDrawnLook(host)) hostStyle = hostStyleFor(look, host, spec, palette);
  const styledHost: IRNode | undefined = host ? { ...host, style: hostStyle } : undefined;
  const hostBg = hostBackground(styledHost, backdrop);
  const restyled = host !== undefined && hostStyle !== host.style;
  const hostLevel: Level = restyled ? (look === 'button' ? 3 : look === 'tint' ? 1 : 0) : 0;

  const ordered = [...children].sort((a, b) => a.order - b.order);

  // Index consecutive description bars (in order) so the lines differ.
  const descriptionIndex = new Map<string, number>();
  let run = 0;
  ordered.forEach((node) => {
    const isDescriptionBar = node.role === 'text' && textKindForHeight(node.layout?.h ?? 0) === 'description';
    if (isDescriptionBar) {
      descriptionIndex.set(node.id, run);
      run += 1;
    } else {
      run = 0;
    }
  });

  const rowLike = spec.layout === 'horizontal' || spec.layout === 'tabs' || spec.layout === 'center';
  const icons = SPEC_ICONS[spec.id] ?? [];
  let iconIndex = 0;
  let linkIndex = 0;

  // Paint in stacking order so each part is themed against what is behind it.
  const painted: { rect: Rect; fill: RGB | null; level: Level }[] = [];
  const styledNodes: IRNode[] = [];
  const items: FitItem[] = [];
  ordered.forEach((node, index) => {
    const style: NodeStyle = { ...node.style };
    const next: IRNode = {
      ...node,
      layout: node.layout ? { ...node.layout } : undefined,
      points: node.points ? node.points.map((pt) => ({ ...pt })) : undefined,
      provenance: { ...node.provenance },
      style,
    };
    const l = node.layout;
    const rect: Rect = { x: l?.x ?? 0, y: l?.y ?? 0, w: l?.w ?? 0, h: l?.h ?? 0 };
    painted.push({ rect, fill: null, level: 0 });
    let behind = -1;
    for (let i = index - 1; i >= 0; i -= 1) {
      if (painted[i].fill && overlaps(painted[i].rect, rect)) {
        behind = i;
        break;
      }
    }
    const bgRgb = behind >= 0 ? (painted[behind].fill as RGB) : hostBg;
    const bgLevel: Level = behind >= 0 ? painted[behind].level : hostLevel;
    const bg = toHex(bgRgb);
    const ink =
      bgLevel === 3
        ? { text: palette.onAccent, body: palette.onAccent, muted: palette.onAccent, icon: palette.onAccent }
        : bgLevel >= 1
          ? {
              text: palette.accentSoftText,
              body: palette.accentSoftText,
              muted: palette.accentSoftText,
              icon: palette.accent,
            }
          : inksOn(palette, bg);
    let level: Level = 0;
    let kind: FitKind = 'block';
    const contained = behind >= 0 && contains(painted[behind].rect, rect);
    const text = (fontColor: string) => {
      style.fill = 'transparent';
      style.fontColor = fontColor;
      if (palette.fontFamily) style.fontFamily = palette.fontFamily;
    };

    switch (node.role) {
      case 'heading': {
        next.content = spec.heading ?? 'Section title';
        text(ink.text);
        const caption = spec.layout === 'center';
        style.fontSize = spec.id === 'hero' ? 20 : caption ? 13 : 14;
        style.fontWeight = 600;
        style.textAlign = spec.align ?? 'left';
        kind = 'line';
        break;
      }
      case 'text': {
        const tk = textKindForHeight(node.layout?.h ?? 0);
        const tl = textLook(tk, descriptionIndex.get(node.id) ?? 0, spec.text?.[tk]);
        next.content = tl.content;
        style.fontSize = tl.fontSize;
        style.fontWeight = tl.fontWeight;
        style.textAlign = spec.align ?? 'left';
        let color = tk === 'stat' ? ink.text : tk === 'label' ? ink.muted : ink.body;
        if (tk === 'link') {
          // The first tab is the active one (it carries the indicator).
          if (spec.layout === 'tabs') {
            style.textAlign = 'center';
            if (linkIndex === 0) {
              color = ink.text;
              style.fontWeight = 600;
            }
          }
          linkIndex += 1;
        }
        if (spec.id === 'badge') {
          color = ink.text;
          style.fontWeight = 600;
        }
        text(color);
        kind = (tk === 'description' || tk === 'subtitle') && !rowLike ? 'wrap' : 'line';
        break;
      }
      case 'button': {
        next.content = spec.button ?? 'Action';
        const secondary = SECONDARY_BUTTON.has(spec.id);
        if (secondary) {
          style.fill = 'transparent';
          style.stroke = palette.border;
          style.strokeWidth = 1;
          style.fontColor = ink.text;
        } else {
          style.fill = palette.accent;
          style.strokeWidth = 0;
          style.fontColor = palette.onAccent;
          level = 3;
        }
        style.borderRadius = palette.controlRadius;
        if (palette.fontFamily) style.fontFamily = palette.fontFamily;
        style.fontSize = 12;
        style.fontWeight = 500;
        style.textAlign = 'center';
        kind = 'label';
        break;
      }
      case 'image': {
        delete next.content;
        level = Math.min(3, bgLevel + 1) as Level;
        style.fill = levelFill(palette, level);
        break;
      }
      case 'icon': {
        const round = (style.borderRadius ?? 0) * 2 >= Math.min(rect.w, rect.h) - 1;
        if (spec.id === 'radio') {
          delete next.content;
          style.fill = palette.accent;
          level = 3;
        } else if (contained || (round && bgLevel >= 1)) {
          // A shape inside an image (the picture's "sun"): one tint deeper.
          delete next.content;
          level = Math.min(3, bgLevel + 1) as Level;
          style.fill = levelFill(palette, level);
        } else {
          const glyph = icons.length ? icons[iconIndex % icons.length] : 'circle';
          iconIndex += 1;
          if (glyph === 'logo') {
            delete next.content;
            style.fill = palette.accent;
            style.borderRadius = Math.max(4, Math.round(Math.min(rect.w, rect.h) / 4));
            level = 3;
          } else {
            next.content = glyph;
            style.fill = 'transparent';
            style.fontColor = spec.id === 'icon' ? palette.accent : spec.id === 'iconButton' ? ink.body : ink.icon;
            style.fontSize = Math.max(8, Math.round(Math.min(rect.w, rect.h)));
          }
        }
        break;
      }
      case 'badge': {
        next.content = 'New';
        if (bgLevel >= 1) {
          style.fill = palette.accent;
          style.fontColor = palette.onAccent;
          level = 3;
        } else {
          style.fill = palette.accentSoft;
          style.fontColor = palette.accentSoftText;
          level = 1;
        }
        style.strokeWidth = 0;
        if (palette.fontFamily) style.fontFamily = palette.fontFamily;
        style.fontSize = 10;
        style.fontWeight = 600;
        style.textAlign = 'center';
        kind = 'label';
        break;
      }
      case 'input':
        next.content = 'Type here...';
        style.fill = palette.field;
        style.stroke = palette.border;
        style.strokeWidth = style.strokeWidth ?? 1;
        style.fontColor = palette.textMuted;
        style.fontSize = 12;
        style.textAlign = 'left';
        break;
      case 'divider':
        // A thicker bar is an emphasis line (active-tab underline), not a rule.
        style.fill = (node.layout?.h ?? 1) > 1 ? palette.accent : palette.border;
        level = (node.layout?.h ?? 1) > 1 ? 3 : 0;
        break;
      default:
        // Anything else keeps its wireframe look untouched.
        break;
    }

    const fill = parseColor(style.fill);
    painted[index].fill = fill && fill.alpha > 0 ? composite(fill, bgRgb) : null;
    painted[index].level = painted[index].fill ? level : bgLevel;
    if (next.layout === undefined) delete next.layout;
    if (next.points === undefined) delete next.points;
    styledNodes.push(next);

    const radius = style.borderRadius ?? 0;
    items.push({
      node: next,
      kind,
      ...rect,
      fontSize: style.fontSize ?? 12,
      fontWeight: style.fontWeight ?? 400,
      text: next.content ?? '',
      centered: style.textAlign === 'center',
      flexImage: node.role === 'image' && !contained && rect.h >= 40 && radius * 2 < Math.min(rect.w, rect.h) - 1,
      roundImage: node.role === 'image' && !contained && radius * 2 >= Math.min(rect.w, rect.h) - 1,
      overlayOf: contained ? behind : -1,
    });
  });

  // Fit: try to keep the drawn size, else grow, else shrink content.
  let hostW = host?.layout?.w ?? DEFAULT_HOST_W;
  const hostH = host?.layout?.h ?? DEFAULT_HOST_H;
  const maxW = Math.max(hostW, options.maxW ?? Number.POSITIVE_INFINITY);
  const maxH = Math.max(hostH, options.maxH ?? Number.POSITIVE_INFINITY);

  // A centered single label (button, badge) widens its host rather than truncating.
  if (spec.layout === 'center') {
    const labels = items.filter((it) => it.kind === 'line' || it.kind === 'label');
    if (labels.length === 1) {
      const it = labels[0];
      const pad = Math.min(PAD, Math.round(Math.min(hostW, hostH) * 0.15));
      const want = estimateTextWidth(it.text, it.fontSize, it.fontWeight) + (it.kind === 'label' ? 16 : 0) + pad * 2;
      if (want > hostW) {
        const grownW = Math.min(maxW, want);
        const dx = (grownW - hostW) / 2;
        items.forEach((item) => {
          item.x = Math.round(item.x + dx);
        });
        it.x = pad;
        it.w = Math.round(grownW - pad * 2);
        hostW = Math.round(grownW);
      }
    }
  }

  // Children sit in the host's padding box: a border eats into the room.
  const inset = (hostStyle?.strokeWidth ?? 0) > 0 ? (hostStyle?.strokeWidth as number) : 0;
  const innerW = hostW - inset * 2;
  const innerH = hostH - inset * 2;
  const base: FitParams = { maxLines: 2, imageScale: 1, imageFloor: 0.6, fontScale: 1, shrinkAvatars: false };
  const run1 = (pms: FitParams) => {
    const out = fitItems(items, innerW, innerH, pms, spec.layout);
    return { ...out, needH: out.needH + inset * 2 };
  };
  let chosen: { params: FitParams; out: FitOutcome } | undefined;
  // 1. Keep the drawn height: roomy copy first, then flexible images give up
  //    to 40% of theirs.
  const keep: FitParams[] = [{ ...base, maxLines: 3 }, base];
  for (const s of [0.9, 0.8, 0.7, 0.6]) keep.push({ ...base, imageScale: s });
  for (const pms of keep) {
    const out = run1(pms);
    if (out.needH <= hostH) {
      chosen = { params: pms, out };
      break;
    }
  }
  // 2. Grow the host within its room (no image shrink: growing is preferred).
  if (!chosen) {
    const out = run1(base);
    if (out.needH <= maxH) chosen = { params: base, out };
  }
  // 3. Shrink content: one-line copy, smaller images / avatars, smaller fonts.
  if (!chosen) {
    const shrink: FitParams[] = [
      { ...base, maxLines: 1 },
      { ...base, maxLines: 1, imageScale: 0.6 },
      { ...base, maxLines: 1, imageScale: 0, imageFloor: 0, shrinkAvatars: true },
      { maxLines: 1, imageScale: 0, imageFloor: 0, fontScale: 0.85, shrinkAvatars: true },
    ];
    for (const pms of shrink) {
      const out = run1(pms);
      chosen = { params: pms, out };
      if (out.needH <= maxH) break;
    }
  }
  const { out } = chosen as { params: FitParams; out: FitOutcome };
  let newH = clamp(Math.max(hostH, out.needH), hostH, maxH);

  // Center layouts re-center their content in the (possibly grown) host.
  if (spec.layout === 'center') {
    const top = Math.min(...out.boxes.map((b) => b.y));
    const bottom = Math.max(...out.boxes.map((b) => b.y + b.h));
    newH = clamp(Math.max(hostH, bottom - top + inset * 2), hostH, maxH);
    const dy = Math.round((newH - inset * 2 - (bottom - top)) / 2 - top);
    out.boxes.forEach((b) => {
      b.y += dy;
    });
  }

  // Write boxes back; drop parts that still spill out of the host.
  const removed: string[] = [];
  const result = new Map<string, IRNode>();
  items.forEach((it, i) => {
    const b = out.boxes[i];
    const node = it.node;
    if (b.y < 0 || b.x < 0 || b.y + b.h > newH - inset * 2 + 0.5 || b.x + b.w > innerW + 0.5) {
      removed.push(node.id);
      return;
    }
    node.layout = { ...node.layout, x: b.x, y: b.y, w: b.w, h: b.h };
    const style = node.style as NodeStyle;
    const classes: string[] = [];
    if (it.kind === 'line') {
      style.fontSize = b.fontSize;
      classes.push('truncate', 'leading-tight');
    } else if (it.kind === 'wrap') {
      style.fontSize = b.fontSize;
      classes.push('overflow-hidden', 'leading-tight', b.lines > 1 ? `line-clamp-${b.lines}` : 'truncate');
    } else if (it.kind === 'label') {
      style.fontSize = b.fontSize;
      classes.push('flex', 'items-center', 'justify-center', 'overflow-hidden', 'whitespace-nowrap', 'leading-none');
    } else if (node.role === 'icon' && node.content) {
      style.fontSize = Math.max(8, Math.round(Math.min(b.w, b.h)));
      classes.push('flex', 'items-center', 'justify-center');
    } else if (node.role === 'divider') {
      // An <hr> otherwise paints a top border in the inherited text colour.
      classes.push('border-0');
    } else if (node.role === 'image' && it.roundImage) {
      style.borderRadius = Math.round(Math.min(b.w, b.h) / 2);
    }
    node.tailwind = classes.join(' ');
    result.set(node.id, node);
  });
  // Any child keeps a removed one's slot ids stable; `order` stays as is.
  const filled = children.filter((c) => result.has(c.id)).map((c) => result.get(c.id) as IRNode);

  const nextHost: IRNode | undefined = styledHost
    ? {
        ...styledHost,
        layout: { ...styledHost.layout, w: hostW, h: newH },
      }
    : undefined;
  return { children: filled, removed, host: nextHost };
}

/**
 * Convert grey-wireframe children into themed placeholder content (see
 * `fillComponent`); returns only the children. Kept for callers that do not
 * resize or restyle the host.
 */
export function fillPlaceholders(
  children: IRNode[],
  componentLabel: string,
  host?: IRNode,
  backdrop?: string,
  options: FillOptions = {},
): IRNode[] {
  return fillComponent(children, componentLabel, host, backdrop, options).children;
}
