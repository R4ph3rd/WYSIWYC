/**
 * Semantic component inference for freshly drawn shapes.
 *
 * When a user sketches a rough shape we guess which UI component they most
 * likely mean, and return the three best guesses (most likely first). The
 * guess is purely geometric and deterministic:
 *
 *  1. Roles that carry their own meaning ('circle', 'line', 'path') map
 *     straight to a fixed family of candidates, lightly tuned by size.
 *  2. Everything else ('rectangle', 'text', ...) is classified by
 *       - aspect ratio (w / h),
 *       - absolute size (small shapes are controls, big ones are sections),
 *       - relative area (share of the canvas covered),
 *       - position (a wide shape hugging the top is a header, a tall shape
 *         hugging the left edge is a sidebar).
 *  3. Each family lists its candidates in order of likelihood; if a family
 *     has fewer than three, plausible neighbours are padded in so the result
 *     always has exactly three entries with distinct labels.
 *
 * Labels are real component names a designer would say. `parts` uses a small
 * fixed vocabulary (see `ComponentPart`) so downstream templates can expand a
 * candidate into a wireframe. This module is pure: no React, DOM, network or
 * store access.
 */

import type { ComponentCandidate, IR, IRNode } from './types';

/** The only keywords allowed in `ComponentCandidate.parts`. */
type ComponentPart =
  | 'image'
  | 'icon'
  | 'title'
  | 'subtitle'
  | 'description'
  | 'button'
  | 'input'
  | 'badge'
  | 'avatar'
  | 'divider'
  | 'link'
  | 'stat'
  | 'label';

const DEFAULT_SHAPE_SIZE = 80;
const DEFAULT_CANVAS_W = 1024;
const DEFAULT_CANVAS_H = 768;

/** Geometry derived once from the node and the canvas. */
interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  canvasW: number;
  canvasH: number;
  aspectRatio: number;
  relArea: number;
  /** Shape starts within the top 18% of the canvas. */
  isTopBand: boolean;
  /** Shape starts within the left 18% of the canvas and is tall. */
  isLeftBand: boolean;
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function measure(node: IRNode, ir: IR): Geometry {
  const w = positive(node.layout?.w, DEFAULT_SHAPE_SIZE);
  const h = positive(node.layout?.h, DEFAULT_SHAPE_SIZE);
  const x = finite(node.layout?.x, 0);
  const y = finite(node.layout?.y, 0);
  const canvasW = positive(ir.canvas?.w, DEFAULT_CANVAS_W);
  const canvasH = positive(ir.canvas?.h, DEFAULT_CANVAS_H);

  return {
    x,
    y,
    w,
    h,
    cx: x + w / 2,
    cy: y + h / 2,
    canvasW,
    canvasH,
    aspectRatio: w / h,
    relArea: (w * h) / (canvasW * canvasH),
    isTopBand: y < canvasH * 0.18,
    isLeftBand: x < canvasW * 0.18 && h > w,
  };
}

function candidate(
  label: string,
  description: string,
  parts: ComponentPart[] = [],
): ComponentCandidate {
  return { label, description, parts };
}

/** Reusable candidate definitions, keyed by the label a designer would use. */
const C = {
  headerBar: () => candidate('Header Bar', 'Top bar with logo and links', ['title', 'link', 'button']),
  navBar: () => candidate('Navigation Bar', 'Row of page links', ['link', 'link', 'link']),
  toolbar: () => candidate('Toolbar', 'Row of quick actions', ['icon', 'icon', 'button']),
  button: () => candidate('Button', 'Clickable call to action', ['button']),
  inputField: () => candidate('Input Field', 'Single-line text entry', ['input']),
  searchBar: () => candidate('Search Bar', 'Search box with icon', ['icon', 'input']),
  banner: () => candidate('Banner', 'Wide promo message with action', ['title', 'description', 'button']),
  section: () => candidate('Content Section', 'Titled block of content', ['title', 'description']),
  listItem: () => candidate('List Item', 'Single row in a list', ['avatar', 'title', 'subtitle']),
  tabBar: () => candidate('Tab Bar', 'Switch between views', ['link', 'link', 'link']),
  sidebar: () => candidate('Sidebar', 'Side navigation with links', ['title', 'link', 'link', 'link']),
  navRail: () => candidate('Navigation Rail', 'Slim column of icons', ['icon', 'icon', 'icon']),
  menu: () => candidate('Menu', 'Vertical list of options', ['link', 'link', 'link']),
  itemCard: () => candidate('Item Card', 'Image, title and action', ['image', 'title', 'description', 'button']),
  productCard: () => candidate('Product Card', 'Product photo, name and price', ['image', 'title', 'description', 'button']),
  profileCard: () => candidate('Profile Card', 'Person with name and bio', ['avatar', 'title', 'subtitle', 'button']),
  mediaObject: () => candidate('Media Object', 'Image beside title and text', ['image', 'title', 'description']),
  card: () => candidate('Card', 'Boxed group of related content', ['image', 'title', 'description']),
  panel: () => candidate('Panel', 'Grouped block with heading', ['title', 'description']),
  statCard: () => candidate('Stat Card', 'Key number with label', ['label', 'stat']),
  avatar: () => candidate('Avatar', 'User profile picture', ['avatar']),
  icon: () => candidate('Icon', 'Small symbolic glyph', ['icon']),
  thumbnail: () => candidate('Thumbnail', 'Small preview image', ['image']),
  badge: () => candidate('Badge', 'Tiny status or count label', ['badge']),
  iconButton: () => candidate('Icon Button', 'Button showing only an icon', ['icon']),
  statusDot: () => candidate('Status Dot', 'Online or alert indicator', []),
  radioButton: () => candidate('Radio Button', 'Single choice selector', []),
  progressRing: () => candidate('Progress Ring', 'Circular progress indicator', ['stat']),
  illustration: () => candidate('Illustration', 'Decorative artwork', ['image']),
  divider: () => candidate('Divider', 'Thin line between sections', ['divider']),
  verticalDivider: () => candidate('Vertical Divider', 'Thin line between columns', ['divider']),
  separator: () => candidate('Separator', 'Visual break between items', ['divider']),
  progressBar: () => candidate('Progress Bar', 'Shows how far along', []),
  scrollbar: () => candidate('Scrollbar', 'Scroll position indicator', []),
  annotation: () => candidate('Freeform Annotation', 'Hand-drawn note or callout', []),
  customShape: () => candidate('Custom Shape', 'Unique decorative shape', []),
  hero: () => candidate('Hero Section', 'Big headline with image and action', ['title', 'description', 'button', 'image']),
  cardGrid: () => candidate('Card Grid', 'Rows of related cards', ['image', 'title', 'description']),
  imageGallery: () => candidate('Image Gallery', 'Grid of photos', ['image', 'image', 'image']),
  featureList: () => candidate('Feature List', 'Highlights with icons', ['icon', 'title', 'description']),
  imageBlock: () => candidate('Image Block', 'Large photo or media', ['image']),
};

type Factory = () => ComponentCandidate;

/** Neighbours used to pad a family that lists fewer than three candidates. */
const FALLBACKS: readonly Factory[] = [C.card, C.panel, C.mediaObject];

/** Pick exactly three candidates with distinct labels, padding if needed. */
function finalize(primary: readonly Factory[]): ComponentCandidate[] {
  const seen = new Set<string>();
  const out: ComponentCandidate[] = [];
  for (const make of [...primary, ...FALLBACKS]) {
    const next = make();
    if (seen.has(next.label)) continue;
    seen.add(next.label);
    out.push(next);
    if (out.length === 3) break;
  }
  return out;
}

function circleFamily(g: Geometry): readonly Factory[] {
  const size = Math.max(g.w, g.h);
  if (size <= 20) return [C.statusDot, C.radioButton, C.badge];
  if (size >= 160) return [C.avatar, C.progressRing, C.illustration];
  return [C.avatar, C.iconButton, C.statusDot];
}

function lineFamily(g: Geometry): readonly Factory[] {
  if (g.h > g.w * 2) return [C.verticalDivider, C.separator, C.scrollbar];
  return [C.divider, C.separator, C.progressBar];
}

function pathFamily(): readonly Factory[] {
  return [C.annotation, C.customShape, C.illustration];
}

/** Very wide, short shapes: headers, controls and banners. */
function wideFamily(g: Geometry): readonly Factory[] {
  const spansCanvas = g.w >= g.canvasW * 0.4;

  if (g.isTopBand && spansCanvas && g.h <= g.canvasH * 0.2) {
    return [C.headerBar, C.navBar, C.toolbar];
  }
  // Control-sized: short in absolute terms.
  if (g.h <= 72) {
    if (g.w >= g.canvasW * 0.5) return [C.searchBar, C.inputField, C.tabBar];
    if (g.aspectRatio >= 5) return [C.inputField, C.searchBar, C.button];
    return [C.button, C.inputField, C.searchBar];
  }
  // Wide and noticeably taller than a control.
  if (g.w >= g.canvasW * 0.5) return [C.banner, C.section, C.toolbar];
  return [C.listItem, C.banner, C.section];
}

/** Tall, narrow shapes: sidebars on the left, cards elsewhere. */
function tallFamily(g: Geometry): readonly Factory[] {
  const isTallEnough = g.h >= g.canvasH * 0.4;

  if (g.isLeftBand && isTallEnough) {
    return g.w <= g.canvasW * 0.1 ? [C.navRail, C.sidebar, C.menu] : [C.sidebar, C.navRail, C.menu];
  }
  // Card-ish aspect ratio.
  if (g.aspectRatio >= 0.5) return [C.itemCard, C.productCard, C.profileCard];
  // Very narrow and tall, not at the left edge.
  if (isTallEnough) return [C.menu, C.sidebar, C.itemCard];
  return [C.itemCard, C.profileCard, C.productCard];
}

/** Small, roughly square shapes: avatars, icons and thumbnails. */
function smallSquareFamily(g: Geometry): readonly Factory[] {
  const size = Math.max(g.w, g.h);
  if (size <= 28) return [C.icon, C.badge, C.avatar];
  if (size <= 56) return [C.avatar, C.icon, C.thumbnail];
  return [C.avatar, C.thumbnail, C.icon];
}

/** Large shapes that cover a big share of the canvas. */
function largeFamily(g: Geometry): readonly Factory[] {
  if (g.isTopBand && g.aspectRatio >= 1) return [C.hero, C.section, C.cardGrid];
  if (g.aspectRatio >= 1.2) return [C.hero, C.section, C.cardGrid];
  return [C.section, C.cardGrid, C.imageGallery];
}

/** Medium, balanced shapes: cards, panels and media objects. */
function mediumFamily(g: Geometry): readonly Factory[] {
  // Moderately wide: reads as a media object or stat tile.
  if (g.aspectRatio >= 1.8) return [C.mediaObject, C.card, C.panel];
  // Compact and slightly wide: stat tile or card.
  if (g.w <= 200 && g.h <= 140) return [C.card, C.statCard, C.panel];
  return [C.card, C.panel, C.mediaObject];
}

/**
 * Heuristic: given a freshly drawn shape node and the current scene, return the
 * THREE most likely UI components it represents, most-likely first. Based on the
 * node's geometry (aspect ratio, absolute size, position within the canvas) and
 * its role. Deterministic and pure.
 */
export function inferComponentCandidates(node: IRNode, ir: IR): ComponentCandidate[] {
  const g = measure(node, ir);

  switch (node.role) {
    case 'circle':
      return finalize(circleFamily(g));
    case 'line':
      return finalize(lineFamily(g));
    case 'path':
      return finalize(pathFamily());
    default:
      break;
  }

  const size = Math.max(g.w, g.h);

  if (g.relArea > 0.4) return finalize(largeFamily(g));
  if (g.aspectRatio >= 3) return finalize(wideFamily(g));
  if (g.aspectRatio <= 0.9 && g.aspectRatio < 0.75 && g.h >= 100) return finalize(tallFamily(g));
  if (g.aspectRatio >= 0.75 && g.aspectRatio <= 1.33 && size <= 96) {
    return finalize(smallSquareFamily(g));
  }
  if (g.aspectRatio < 0.75) return finalize(tallFamily(g));
  // Between small squares and big areas: a modest wide strip or a balanced box.
  if (g.aspectRatio >= 1.8 && g.h <= 72) return finalize(wideFamily(g));
  if (g.relArea > 0.2) return finalize(largeFamily(g));
  return finalize(mediumFamily(g));
}
