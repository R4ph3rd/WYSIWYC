/**
 * Grey-wireframe generation and placeholder filling for chosen components.
 *
 * Flow in WYSIWYC: the user draws a rough shape, then picks what UI component
 * it is (e.g. "Item card"). `wireframeChildren` fills that shape with a GREY
 * WIREFRAME of the component's expected parts (image block, title bar,
 * description lines, button, ...). A second action, `fillPlaceholders`, turns
 * the grey blocks into neutral placeholder content (labels, sample copy)
 * while following the overall monochrome design.
 *
 * Everything here is pure: no React, no DOM, no network and no store access.
 * Only `nextNodeId` (id allocation) and the IR types are imported.
 *
 * Layout model: children are flat IRNodes (`parentId = host.id`) with ABSOLUTE
 * layout relative to the host's top-left corner. A component label is resolved
 * (case-insensitive, by keyword) through a small registry to an ordered list
 * of part kinds plus a layout strategy:
 *  - `vertical`   parts stacked top to bottom (cards, hero, sidebar, stat)
 *  - `horizontal` a left-to-right row, last button right-aligned (header bars)
 *  - `leading`    first part on the left, the rest stacked on its right
 *  - `atomic`     the host itself is the component, so there are no children
 *
 * Text bars are told apart again in `fillPlaceholders` by their (distinct)
 * bar heights, see `TEXT_BAR_HEIGHT`, so the wireframe stays free of extra
 * metadata and the placeholder step never changes layout or ids.
 */

import { nextNodeId } from './ids';
import type { IRNode, NodeRole, NodeStyle } from './types';

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

/** Wireframe greys (Tailwind slate scale). */
const GREY = {
  s100: '#f1f5f9',
  s200: '#e2e8f0',
  s300: '#cbd5e1',
} as const;

/** Placeholder greys, one step softer or darker than the wireframe. */
const PLACEHOLDER = {
  image: '#dbe2ea',
  heading: '#94a3b8',
  text: '#64748b',
  button: '#e2e8f0',
  buttonText: '#475569',
  icon: '#94a3b8',
  white: '#ffffff',
} as const;

/* -------------------------------------------------------------------------- */
/* Part kinds                                                                 */
/* -------------------------------------------------------------------------- */

type PartKind =
  | 'image'
  | 'avatar'
  | 'title'
  | 'subtitle'
  | 'description'
  | 'button'
  | 'link'
  | 'stat'
  | 'label'
  | 'icon'
  | 'badge'
  | 'input'
  | 'divider';

/** One grey bar. `radius: 'round'` means min(w, h) / 2 (circular for squares). */
interface Bar {
  role: NodeRole;
  h: number;
  /** Fraction of the available width (default 1). Ignored when `w` is set. */
  wFrac?: number;
  /** Fixed width in px (capped by the available width). */
  w?: number;
  fill: string;
  radius: number | 'round';
  stroke?: string;
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
  image: [{ role: 'image', h: 96, fill: GREY.s200, radius: 8 }],
  avatar: [{ role: 'image', h: 48, w: 48, fill: GREY.s200, radius: 'round' }],
  title: [{ role: 'heading', h: 16, wFrac: 0.7, fill: GREY.s300, radius: 4 }],
  subtitle: [{ role: 'text', h: TEXT_BAR_HEIGHT.subtitle, wFrac: 0.5, fill: GREY.s200, radius: 4 }],
  description: [
    { role: 'text', h: TEXT_BAR_HEIGHT.description, wFrac: 1, fill: GREY.s200, radius: 4 },
    { role: 'text', h: TEXT_BAR_HEIGHT.description, wFrac: 1, fill: GREY.s200, radius: 4 },
    { role: 'text', h: TEXT_BAR_HEIGHT.description, wFrac: 0.6, fill: GREY.s200, radius: 4 },
  ],
  button: [{ role: 'button', h: 28, wFrac: 0.4, fill: GREY.s300, radius: 6 }],
  link: [{ role: 'text', h: TEXT_BAR_HEIGHT.link, wFrac: 0.4, fill: GREY.s200, radius: 4 }],
  stat: [{ role: 'text', h: TEXT_BAR_HEIGHT.stat, wFrac: 0.5, fill: GREY.s200, radius: 4 }],
  label: [{ role: 'text', h: TEXT_BAR_HEIGHT.label, wFrac: 0.35, fill: GREY.s200, radius: 4 }],
  icon: [{ role: 'icon', h: 20, w: 20, fill: GREY.s300, radius: 4 }],
  badge: [{ role: 'badge', h: 18, wFrac: 0.25, fill: GREY.s200, radius: 9999 }],
  input: [
    { role: 'input', h: 32, fill: GREY.s100, radius: 6, stroke: GREY.s300, strokeWidth: 1 },
  ],
  divider: [{ role: 'divider', h: 1, fill: GREY.s200, radius: 0 }],
};

/* -------------------------------------------------------------------------- */
/* Component registry                                                         */
/* -------------------------------------------------------------------------- */

type LayoutKind = 'vertical' | 'horizontal' | 'leading' | 'atomic';
type ComponentId =
  | 'listItem'
  | 'stat'
  | 'sidebar'
  | 'header'
  | 'hero'
  | 'card'
  | 'atomic'
  | 'default';

interface ComponentSpec {
  id: ComponentId;
  /** Lowercase word phrases; a phrase matches a contiguous run of label words. */
  keywords: string[];
  parts: PartKind[];
  layout: LayoutKind;
  /** Horizontal alignment of parts in a vertical layout. */
  align?: 'left' | 'center';
  /** Vertical gap between parts (default `GAP`). */
  gap?: number;
}

/**
 * Ordered registry: the first entry with a matching keyword wins, so composite
 * components are listed before the atomic catch-all. For example
 * "Navigation rail" resolves to the sidebar before "nav" can match a header.
 */
const REGISTRY: ComponentSpec[] = [
  {
    id: 'listItem',
    keywords: ['list item', 'list row', 'row item'],
    parts: ['icon', 'title', 'description'],
    layout: 'leading',
  },
  {
    id: 'stat',
    keywords: ['stat', 'metric', 'kpi'],
    parts: ['stat', 'label'],
    layout: 'vertical',
  },
  {
    id: 'sidebar',
    keywords: ['sidebar', 'side bar', 'navigation rail', 'nav rail', 'rail', 'menu', 'drawer'],
    parts: ['title', 'link', 'link', 'link'],
    layout: 'vertical',
    gap: 14,
  },
  {
    id: 'header',
    keywords: [
      'header bar',
      'header',
      'navigation bar',
      'nav bar',
      'navbar',
      'nav',
      'toolbar',
      'app bar',
      'top bar',
    ],
    parts: ['icon', 'title', 'link', 'button'],
    layout: 'horizontal',
  },
  {
    id: 'hero',
    keywords: ['hero', 'banner', 'section'],
    parts: ['title', 'subtitle', 'button'],
    layout: 'vertical',
    align: 'center',
  },
  {
    id: 'card',
    keywords: ['item card', 'product card', 'profile card', 'card', 'media object', 'tile'],
    parts: ['image', 'title', 'description', 'button'],
    layout: 'vertical',
  },
  {
    // The host itself IS the component; there is nothing to put inside.
    id: 'atomic',
    keywords: [
      'button',
      'avatar',
      'badge',
      'tag',
      'chip',
      'input field',
      'input',
      'search bar',
      'search',
      'text field',
      'divider',
      'icon',
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
  fill: string;
  radius: number;
  stroke?: string;
  strokeWidth?: number;
}

interface PlacedPart {
  drafts: Draft[];
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function barsHeight(bars: Bar[]): number {
  return bars.reduce((sum, bar) => sum + bar.h, 0) + Math.max(0, bars.length - 1) * BAR_GAP;
}

function partHeight(kind: PartKind): number {
  return barsHeight(PART_BARS[kind]);
}

/**
 * Place the bars of one part inside the box `x..x+availW` starting at `y`.
 * `flexH` overrides the height of a single-bar part (used for flexible images);
 * `fillWidth` makes every bar use the full available width.
 */
function placePart(
  kind: PartKind,
  x: number,
  y: number,
  availW: number,
  options: { flexH?: number; fillWidth?: boolean; align?: 'left' | 'center' } = {},
): PlacedPart {
  const bars = PART_BARS[kind];
  const drafts: Draft[] = [];
  let cursor = y;
  bars.forEach((bar, index) => {
    const h = index === 0 && options.flexH !== undefined ? options.flexH : bar.h;
    const rawW =
      bar.w !== undefined
        ? Math.min(bar.w, availW)
        : availW * (options.fillWidth ? 1 : (bar.wFrac ?? 1));
    const w = Math.max(1, Math.round(rawW));
    const dx = options.align === 'center' ? (availW - w) / 2 : 0;
    drafts.push({
      role: bar.role,
      x: Math.round(x + dx),
      y: Math.round(cursor),
      w,
      h,
      fill: bar.fill,
      radius: bar.radius === 'round' ? Math.round(Math.min(w, h) / 2) : bar.radius,
      stroke: bar.stroke,
      strokeWidth: bar.strokeWidth,
    });
    cursor += h + BAR_GAP;
  });
  const height =
    options.flexH !== undefined && bars.length === 1 ? options.flexH : barsHeight(bars);
  return { drafts, height };
}

/** Stack parts top to bottom; an image part absorbs the remaining height. */
function layoutVertical(
  parts: PartKind[],
  x: number,
  availW: number,
  hostH: number,
  spec: ComponentSpec,
): Draft[] {
  const gap = spec.gap ?? GAP;
  const imageIndex = parts.indexOf('image');
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
    const placed = placePart(kind, x, y, availW, {
      flexH: i === imageIndex ? imageH : undefined,
      align: spec.align,
    });
    drafts.push(...placed.drafts);
    y += placed.height + gap;
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
    default:
      return Math.min(iw * 0.2, 96);
  }
}

/**
 * Left-to-right row, vertically centered. Widths are shrunk proportionally if
 * they do not fit; a trailing button is right-aligned, the rest start at left.
 */
function layoutHorizontal(parts: PartKind[], iw: number, hostH: number): Draft[] {
  const desired = parts.map((kind) => rowPartWidth(kind, iw));
  const total = desired.reduce((sum, w) => sum + w, 0) + Math.max(0, parts.length - 1) * GAP;
  const scale = total > iw ? Math.max(0.1, (iw - Math.max(0, parts.length - 1) * GAP) / (total - Math.max(0, parts.length - 1) * GAP)) : 1;
  const widths = desired.map((w) => Math.max(1, Math.floor(w * scale)));
  const innerH = hostH - PAD * 2;

  const lastIsButton = parts.length > 1 && parts[parts.length - 1] === 'button';
  const drafts: Draft[] = [];
  let x = PAD;
  parts.forEach((kind, i) => {
    const w = widths[i];
    const h = partHeight(kind);
    const y = PAD + Math.max(0, (innerH - h) / 2);
    const px = lastIsButton && i === parts.length - 1 ? PAD + iw - w : x;
    drafts.push(...placePart(kind, px, y, w, { fillWidth: true }).drafts);
    x += w + GAP;
  });
  return drafts;
}

/** First part (a leading icon) on the left, the remaining parts stacked right. */
function layoutLeading(parts: PartKind[], iw: number): Draft[] {
  const [lead, ...rest] = parts;
  if (lead === undefined) return [];
  const leadBar = PART_BARS[lead][0];
  const leadW = Math.min(leadBar?.w ?? 32, iw);
  const restX = PAD + leadW + GAP;
  const restW = Math.max(1, iw - leadW - GAP);

  const restDrafts: Draft[] = [];
  let y = PAD;
  rest.forEach((kind) => {
    const placed = placePart(kind, restX, y, restW);
    restDrafts.push(...placed.drafts);
    y += placed.height + GAP;
  });
  const stackH = Math.max(0, y - GAP - PAD);

  const leadH = partHeight(lead);
  const leadY = PAD + Math.max(0, (stackH - leadH) / 2);
  const leadDrafts = placePart(lead, PAD, leadY, leadW).drafts;
  return [...leadDrafts, ...restDrafts];
}

function toNode(host: IRNode, draft: Draft, id: string, order: number): IRNode {
  const style: NodeStyle = { fill: draft.fill, borderRadius: draft.radius };
  if (draft.stroke !== undefined) style.stroke = draft.stroke;
  if (draft.strokeWidth !== undefined) style.strokeWidth = draft.strokeWidth;
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
 * Returns [] for atomic components with no inner parts (button, avatar, badge,
 * input, divider, icon): the host itself represents those.
 */
export function wireframeChildren(
  host: IRNode,
  componentLabel: string,
  existingIds: string[],
): IRNode[] {
  const spec = resolveComponent(componentLabel);
  if (spec.layout === 'atomic' || spec.parts.length === 0) return [];

  const hostW = host.layout?.w ?? DEFAULT_HOST_W;
  const hostH = host.layout?.h ?? DEFAULT_HOST_H;
  const iw = Math.max(1, hostW - PAD * 2);

  let drafts: Draft[];
  switch (spec.layout) {
    case 'horizontal':
      drafts = layoutHorizontal(spec.parts, iw, hostH);
      break;
    case 'leading':
      drafts = layoutLeading(spec.parts, iw);
      break;
    default:
      drafts = layoutVertical(spec.parts, PAD, iw, hostH, spec);
      break;
  }

  const running = [...existingIds];
  return drafts.map((draft, order) => {
    const id = nextNodeId(running);
    running.push(id);
    return toNode(host, draft, id, order);
  });
}

/* -------------------------------------------------------------------------- */
/* Placeholder content                                                        */
/* -------------------------------------------------------------------------- */

const HEADING_TEXT: Record<ComponentId, string> = {
  listItem: 'List item title',
  stat: 'Metric',
  sidebar: 'Menu',
  header: 'Brand',
  hero: 'Section title',
  card: 'Card title',
  atomic: 'Title',
  default: 'Section title',
};

const BUTTON_TEXT: Record<ComponentId, string> = {
  listItem: 'Action',
  stat: 'Action',
  sidebar: 'Action',
  header: 'Sign in',
  hero: 'Get started',
  card: 'Learn more',
  atomic: 'Action',
  default: 'Action',
};

const DESCRIPTION_LINES: readonly string[] = [
  'Supporting detail goes here.',
  'A short line of neutral placeholder copy.',
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

function textLook(kind: TextKind, descriptionIndex: number): TextLook {
  switch (kind) {
    case 'stat':
      return { content: '1,234', fontSize: 20, fontWeight: 600 };
    case 'subtitle':
      return { content: 'A short supporting line for this section.', fontSize: 12, fontWeight: 400 };
    case 'link':
      return { content: 'Link', fontSize: 11, fontWeight: 500 };
    case 'label':
      return { content: 'Total count', fontSize: 10, fontWeight: 400 };
    default:
      return {
        content: DESCRIPTION_LINES[Math.min(descriptionIndex, DESCRIPTION_LINES.length - 1)],
        fontSize: 10,
        fontWeight: 400,
      };
  }
}

/**
 * Convert grey-wireframe children into placeholder content: titles/descriptions
 * get sample text, images keep a neutral fill, buttons get a label. Returns NEW
 * nodes (inputs are not mutated). Keeps every node's id and layout; only
 * changes content/style/tailwind so it reads as real but still monochrome data.
 */
export function fillPlaceholders(children: IRNode[], componentLabel: string): IRNode[] {
  const spec = resolveComponent(componentLabel);

  // Index consecutive description bars (in order) so the lines differ.
  const descriptionIndex = new Map<string, number>();
  let run = 0;
  [...children]
    .sort((a, b) => a.order - b.order)
    .forEach((node) => {
      const isDescriptionBar =
        node.role === 'text' &&
        textKindForHeight(node.layout?.h ?? 0) === 'description';
      if (isDescriptionBar) {
        descriptionIndex.set(node.id, run);
        run += 1;
      } else {
        run = 0;
      }
    });

  return children.map((node): IRNode => {
    const style: NodeStyle = { ...node.style };
    const next: IRNode = {
      ...node,
      layout: node.layout ? { ...node.layout } : undefined,
      points: node.points ? node.points.map((p) => ({ ...p })) : undefined,
      provenance: { ...node.provenance },
      style,
    };

    switch (node.role) {
      case 'heading':
        next.content = HEADING_TEXT[spec.id];
        style.fill = 'transparent';
        style.fontColor = PLACEHOLDER.heading;
        style.fontSize = 14;
        style.fontWeight = 600;
        style.textAlign = spec.align ?? 'left';
        break;
      case 'text': {
        const look = textLook(
          textKindForHeight(node.layout?.h ?? 0),
          descriptionIndex.get(node.id) ?? 0,
        );
        next.content = look.content;
        style.fill = 'transparent';
        style.fontColor = PLACEHOLDER.text;
        style.fontSize = look.fontSize;
        style.fontWeight = look.fontWeight;
        style.textAlign = spec.align ?? 'left';
        break;
      }
      case 'button':
        next.content = BUTTON_TEXT[spec.id];
        style.fill = PLACEHOLDER.button;
        style.fontColor = PLACEHOLDER.buttonText;
        style.fontSize = 12;
        style.fontWeight = 500;
        style.textAlign = 'center';
        break;
      case 'image':
        // Keep the block neutral; just a slightly different grey, no content.
        delete next.content;
        style.fill = PLACEHOLDER.image;
        break;
      case 'icon':
        delete next.content;
        style.fill = PLACEHOLDER.icon;
        break;
      case 'badge':
        next.content = 'New';
        style.fill = GREY.s200;
        style.fontColor = PLACEHOLDER.buttonText;
        style.fontSize = 11;
        style.fontWeight = 500;
        style.textAlign = 'center';
        break;
      case 'input':
        next.content = 'Type here...';
        style.fill = PLACEHOLDER.white;
        style.fontColor = PLACEHOLDER.heading;
        style.fontSize = 12;
        style.textAlign = 'left';
        break;
      default:
        // Dividers and anything else keep their wireframe look untouched.
        break;
    }

    if (next.layout === undefined) delete next.layout;
    if (next.points === undefined) delete next.points;
    return next;
  });
}
