/**
 * Layout fitting for moved components. Pure and deterministic — NO LLM.
 *
 * Moving a flow (LLM-authored) node into another container should make it read
 * as one of that container's items, not a foreign block dropped in: it takes
 * the siblings' sizing (flex-1, an equal fraction, a shared fixed width, a grid
 * cell), loses positioning that only made sense where it came from, and the
 * containers on both ends are re-balanced (fractions re-distributed, a single-row
 * grid gains/loses a column, an emptied layout-only wrapper is removed).
 *
 * The same module picks WHERE a drop lands (`pickDropTarget`) so canvas drags
 * and arrow gestures resolve the target container and insertion index the
 * same way, and draws the insertion line shown while dragging.
 */
import type { IR, IRNode, NodeLayout } from './types';
import { classList } from './tailwindEdit';

export type FlowKind = 'row' | 'col' | 'grid' | 'block';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Extra facts the caller measured; all optional. */
export interface FitHints {
  /** Rendered width (px) of the target container, for the overflow check. */
  containerWidth?: number;
}

/** The IR facts drop-target picking needs about each node. */
export type FitNode = Pick<IRNode, 'id' | 'parentId' | 'order' | 'role'> & {
  tailwind?: string;
  content?: string;
  layout?: NodeLayout;
};

// ---------------------------------------------------------------------------
// Class helpers
// ---------------------------------------------------------------------------

const BREAKPOINTS = ['sm', 'md', 'lg', 'xl', '2xl'];

/** Split "md:hover:w-1/3" into ["md:hover:", "w-1/3"]. */
function splitVariant(util: string): [string, string] {
  // Ignore colons inside arbitrary values (`bg-[url(a:b)]`).
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < util.length; i++) {
    const ch = util[i];
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    else if (ch === ':' && depth === 0) cut = i;
  }
  return cut >= 0 ? [util.slice(0, cut + 1), util.slice(cut + 1)] : ['', util];
}

/**
 * The utilities that apply on the (wide, desktop) canvas, in cascade order:
 * base first, then sm → 2xl overrides. State variants (hover:, focus:) and
 * anything else are ignored.
 */
function effectiveBases(tailwind: string | undefined): string[] {
  const buckets: string[][] = [[], ...BREAKPOINTS.map(() => [])];
  for (const util of classList(tailwind)) {
    const [variant, base] = splitVariant(util);
    if (!variant) buckets[0].push(base);
    else {
      const bp = BREAKPOINTS.indexOf(variant.slice(0, -1));
      if (bp >= 0) buckets[bp + 1].push(base);
    }
  }
  return buckets.flat();
}

const DISPLAY = new Set(['block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'inline-grid', 'hidden', 'contents', 'table']);

/** How a container lays out its children. */
export function flowKind(tailwind: string | undefined): FlowKind {
  let display = 'block';
  let dir: 'row' | 'col' = 'row';
  for (const b of effectiveBases(tailwind)) {
    if (DISPLAY.has(b)) display = b;
    else if (b === 'flex-col' || b === 'flex-col-reverse') dir = 'col';
    else if (b === 'flex-row' || b === 'flex-row-reverse') dir = 'row';
  }
  if (display === 'grid' || display === 'inline-grid') return 'grid';
  if (display === 'flex' || display === 'inline-flex') return dir;
  return 'block';
}

function wraps(tailwind: string | undefined): boolean {
  let w = false;
  for (const b of effectiveBases(tailwind)) {
    if (b === 'flex-wrap' || b === 'flex-wrap-reverse') w = true;
    else if (b === 'flex-nowrap') w = false;
  }
  return w;
}

/** Horizontal sizing utilities a flex item / grid cell carries. */
const FLEX_SIZING = /^(?:flex-(?:1|auto|initial|none|\[[^\]]+\])|grow(?:-0|-\[[^\]]+\])?|shrink(?:-0|-\[[^\]]+\])?|basis-.+)$/;
const WIDTH = /^(?:min-|max-)?w-.+$/;
const FRACTION = /^(w|basis)-(\d+)\/(\d+)$/;
const GRID_PLACEMENT = /^(?:col|row)-(?:span|start|end)-.+$|^(?:col|row)-auto$/;
/** Positioning that only made sense in the old container. */
const POSITIONING = /^(?:absolute|fixed|sticky|-?(?:inset|inset-x|inset-y|top|left|right|bottom|start|end)-.+|order-.+|self-.+|m[tblrse]-auto)$/;
const TRANSLATE = /^-?translate-[xy]-.+$/;
/** Utilities that make a container visible on its own (not a pure layout wrapper). */
const VISUAL = /^(?:bg-|border|shadow|ring|rounded|outline|from-|via-|to-|p[xytblrse]?-\S|divide|backdrop)/;

/** Roles that read as blocks (their width is a layout decision, not intrinsic). */
const BLOCK_ROLES = new Set<IRNode['role']>(['container', 'frame', 'heading', 'text']);

function bases(tailwind: string | undefined): string[] {
  return classList(tailwind).map((u) => splitVariant(u)[1]);
}

/** Drop every utility (any variant) whose base matches `re`. */
function without(tailwind: string, re: RegExp): string {
  return classList(tailwind).filter((u) => !re.test(splitVariant(u)[1])).join(' ');
}

function withClass(tailwind: string, cls: string): string {
  const list = classList(tailwind);
  return list.includes(cls) ? tailwind : [...list, cls].join(' ');
}

function hasBase(tailwind: string | undefined, re: RegExp): boolean {
  return bases(tailwind).some((b) => re.test(b));
}

// ---------------------------------------------------------------------------
// Sibling sizing analysis
// ---------------------------------------------------------------------------

type Sizing =
  | { kind: 'fraction'; value: number }
  | { kind: 'grow'; cls: string; weight: number }
  | { kind: 'fixed'; cls: string }
  | { kind: 'none' };

function growWeight(cls: string): number {
  if (cls === 'flex-1' || cls === 'flex-auto' || cls === 'grow') return 1;
  const m = cls.match(/^flex-\[(\d*\.?\d+)/) ?? cls.match(/^grow-\[(\d*\.?\d+)/);
  return m ? Number(m[1]) : 0;
}

/** How a row item claims its width (largest breakpoint wins). */
function rowSizing(tailwind: string | undefined): Sizing {
  let out: Sizing = { kind: 'none' };
  for (const b of effectiveBases(tailwind)) {
    const f = b.match(FRACTION);
    if (f) { out = { kind: 'fraction', value: Number(f[2]) / Number(f[3]) }; continue; }
    if (FLEX_SIZING.test(b) && growWeight(b) > 0) { out = { kind: 'grow', cls: b, weight: growWeight(b) }; continue; }
    if (/^w-(?:\d|\[|px$)/.test(b) || /^basis-(?:\d|\[|px$)/.test(b)) {
      if (out.kind !== 'grow') out = { kind: 'fixed', cls: b };
    }
  }
  return out;
}

/** The most common value by key; ties go to `tieBreak` order. */
function mode<T>(items: T[], key: (t: T) => string, better?: (a: T, b: T) => boolean): T | undefined {
  const counts = new Map<string, { item: T; n: number }>();
  for (const it of items) {
    const k = key(it);
    const c = counts.get(k);
    if (c) c.n++;
    else counts.set(k, { item: it, n: 1 });
  }
  let best: { item: T; n: number } | undefined;
  for (const c of counts.values()) {
    if (!best || c.n > best.n || (c.n === best.n && better?.(c.item, best.item))) best = c;
  }
  return best?.item;
}

/** Replace the fraction value in each `w-a/b` / `basis-a/b` (any variant) with `next`. */
function setFraction(tailwind: string, next: string): string {
  return classList(tailwind)
    .map((u) => {
      const [v, b] = splitVariant(u);
      const m = b.match(FRACTION);
      if (!m) return u;
      return next === 'full' ? `${v}${m[1] === 'w' ? 'w-full' : 'basis-full'}` : `${v}${m[1]}-${next}`;
    })
    .join(' ');
}

/** Rough px width of a fixed Tailwind width class, for the overflow check. */
function fixedPx(cls: string): number | null {
  const v = cls.replace(/^(?:w|basis)-/, '');
  if (v === 'px') return 1;
  if (/^\d*\.?\d+$/.test(v)) return Number(v) * 4;
  const arb = v.match(/^\[(\d*\.?\d+)(px|rem)\]$/);
  if (arb) return Number(arb[1]) * (arb[2] === 'rem' ? 16 : 1);
  return null;
}

function spacingPx(tailwind: string, re: RegExp): number {
  let px = 0;
  for (const b of effectiveBases(tailwind)) {
    const m = b.match(re);
    if (m) px = /^\d*\.?\d+$/.test(m[1]) ? Number(m[1]) * 4 : Number(m[1].match(/\[(\d+)px\]/)?.[1] ?? 0);
  }
  return px;
}

// ---------------------------------------------------------------------------
// Fitting
// ---------------------------------------------------------------------------

function childrenOf(ir: IR, parentId: string | null): IRNode[] {
  return ir.nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.order - b.order);
}

function isAbsolute(n: Pick<IRNode, 'layout'>): boolean {
  return n.layout?.x !== undefined || n.layout?.y !== undefined;
}

function isHidden(n: Pick<IRNode, 'tailwind'>): boolean {
  return classList(n.tailwind).includes('hidden');
}

/** In-flow children of a container (absolute / hidden ones don't take part in its layout). */
function flowChildren(ir: IR, parentId: string): IRNode[] {
  return childrenOf(ir, parentId).filter((n) => !isAbsolute(n) && !isHidden(n));
}

const FRACTION_DENOMS = [1, 2, 3, 4, 5, 6];

/**
 * Re-balance `kids` (the in-flow children of a row, ALREADY including any
 * moved node) when they share an equal fraction width: `w-1/3` ×3 + one more
 * → `w-1/4` ×4. Unequal fractions become proportional flex weights so they
 * still fill the row. Returns the patched tailwind per id.
 */
function redistributeFractions(kids: IRNode[], patch: Map<string, string>): void {
  const tw = (n: IRNode) => patch.get(n.id) ?? n.tailwind;
  const sizings = kids.map((k) => rowSizing(tw(k)));
  const fracs = sizings.filter((s): s is Extract<Sizing, { kind: 'fraction' }> => s.kind === 'fraction');
  if (fracs.length === 0) return;
  const n = kids.length;
  const equal = fracs.every((f) => Math.abs(f.value - fracs[0].value) < 1e-6);
  if (equal && FRACTION_DENOMS.includes(n)) {
    const next = n === 1 ? 'full' : `1/${n}`;
    for (const k of kids) {
      if (rowSizing(tw(k)).kind === 'fraction') patch.set(k.id, setFraction(tw(k), next));
    }
    return;
  }
  // Unequal (or too many for a Tailwind fraction): proportional flex weights.
  const weights = fracs.map((f) => Math.max(1, Math.round(f.value * 12)));
  const median = [...weights].sort((a, b) => a - b)[Math.floor(weights.length / 2)];
  for (const k of kids) {
    const s = rowSizing(tw(k));
    if (s.kind === 'grow') continue;
    const w = s.kind === 'fraction' ? Math.max(1, Math.round(s.value * 12)) : median;
    let next = without(tw(k), /^(?:w-\d+\/\d+|basis-.+|flex-(?:1|auto|initial|none|\[[^\]]+\]))$/);
    next = withClass(next, `flex-[${w}_1_0%]`);
    patch.set(k.id, withClass(next, 'min-w-0'));
  }
}

/** Max `grid-cols-N` (any breakpoint) on a grid container, or null. */
function gridCols(tailwind: string): number | null {
  let max: number | null = null;
  for (const b of bases(tailwind)) {
    const m = b.match(/^grid-cols-(\d+)$/);
    if (m) max = Math.max(max ?? 0, Number(m[1]));
  }
  return max;
}

function setGridCols(tailwind: string, from: number, to: number): string {
  return classList(tailwind)
    .map((u) => {
      const [v, b] = splitVariant(u);
      return b === `grid-cols-${from}` ? `${v}grid-cols-${to}` : u;
    })
    .join(' ');
}

/**
 * A container that only arranges its children: no content, no visual styling
 * of its own (background, border, padding…), in flow. Such wrappers are an
 * implementation detail of a layout (e.g. cards paired up so a row reflows
 * 4 → 2×2), not something the user sees as a separate element.
 */
export function isLayoutWrapper(n: Pick<IRNode, 'role' | 'content' | 'layout'> & { tailwind?: string }): boolean {
  return n.role === 'container' && !n.content?.trim() && !isAbsolute(n)
    && !isHidden({ tailwind: n.tailwind ?? '' }) && !hasBase(n.tailwind, VISUAL);
}

/** A container with visual styling of its own (a card, a pill, a panel) — reads as a component. */
export function isVisualContainer(n: Pick<IRNode, 'role'> & { tailwind?: string }): boolean {
  return n.role === 'container' && hasBase(n.tailwind, VISUAL);
}

const GROW_BASIS = /^flex-\[(\d*\.?\d+)_(\d*\.?\d+)_(\d*\.?\d+)px\]$/;

/**
 * When every in-flow child of the row `g` is a layout-only row wrapper that
 * grows (`flex-1`, `flex-[1_1_260px]`…), re-weight the wrappers by how many
 * items each holds: grow = n, basis = n·unit + (n−1)·gap. Free space is then
 * shared per item, so items in a 3-item wrapper are exactly as wide as those
 * in a 2-item one. `patch` is updated in place.
 */
function rebalanceWrapperRow(
  ir: IR,
  g: IRNode,
  patch: Map<string, string>,
  removed: Set<string>,
  fromParentId: string | null,
  toParentId: string,
): void {
  if (flowKind(g.tailwind) !== 'row') return;
  const tw = (n: IRNode) => patch.get(n.id) ?? n.tailwind;
  const wrappers = flowChildren(ir, g.id).filter((w) => !removed.has(w.id));
  if (wrappers.length < 2) return;
  if (!wrappers.every((w) => isLayoutWrapper(w) && flowKind(tw(w)) === 'row' && rowSizing(tw(w)).kind === 'grow')) return;
  const counts = wrappers.map((w) => flowChildren(ir, w.id).length);
  if (counts.some((c) => c === 0)) return;
  // Before the move, to recover the per-item basis the author intended.
  const before = wrappers.map((w, i) => counts[i] - (w.id === toParentId ? 1 : 0) + (w.id === fromParentId ? 1 : 0));
  let unit = 0;
  for (let i = 0; i < wrappers.length && !unit; i++) {
    const m = classList(tw(wrappers[i])).map((u) => splitVariant(u)[1].match(GROW_BASIS)).find(Boolean);
    const gap = spacingPx(tw(wrappers[i]), /^gap(?:-x)?-(.+)$/);
    if (m && before[i] > 0) unit = Math.max(0, (Number(m[3]) - (before[i] - 1) * gap) / before[i]);
  }
  if (counts.every((c, i) => c === before[i])) return; // nothing changed in this row
  wrappers.forEach((w, i) => {
    const n = counts[i];
    const gap = spacingPx(tw(w), /^gap(?:-x)?-(.+)$/);
    const basis = Math.round(n * unit + (n - 1) * gap);
    let next = without(tw(w), FLEX_SIZING);
    next = withClass(withClass(next, `flex-[${n}_1_${basis}px]`), 'min-w-0');
    if (next !== tw(w)) patch.set(w.id, next);
  });
}

/**
 * Make a node that was just moved under a new parent fit that parent's
 * layout, and re-balance the container it left. `ir` is the IR AFTER the
 * reparent; `fromParentId` is where the node came from. Returns the patched IR
 * plus every node it touched.
 */
export function fitMovedNode(
  ir: IR,
  id: string,
  fromParentId: string | null,
  hints: FitHints = {},
): { ir: IR; affectedIds: string[] } {
  const byId = new Map(ir.nodes.map((n) => [n.id, n]));
  const moved = byId.get(id);
  const parent = moved?.parentId ? byId.get(moved.parentId) : undefined;
  if (!moved || !parent) return { ir, affectedIds: [id] };

  const patch = new Map<string, string>(); // id → new tailwind
  const removed = new Set<string>();
  const tw = (n: IRNode) => patch.get(n.id) ?? n.tailwind;
  const kind = flowKind(parent.tailwind);
  const blocky = BLOCK_ROLES.has(moved.role);

  // 1. Strip what only made sense where it came from: absolute coordinates,
  //    auto margins / self-alignment / order, an old grid placement.
  let m = moved.tailwind;
  const wasAbsolute = hasBase(m, /^(?:absolute|fixed)$/);
  m = without(m, POSITIONING);
  if (wasAbsolute) m = without(m, TRANSLATE);
  if (kind !== 'grid') m = without(m, GRID_PLACEMENT);

  const kids = flowChildren(ir, parent.id);
  const sibs = kids.filter((k) => k.id !== id);

  // 2. Take the siblings' sizing.
  if (kind === 'row') {
    const sizings = sibs.map((s) => rowSizing(s.tailwind));
    const fam = mode(sizings, (s) => s.kind);
    if (fam?.kind === 'fraction') {
      // Copy a sibling's width utilities (incl. responsive ones) then re-balance all.
      const donor = sibs.find((s) => rowSizing(s.tailwind).kind === 'fraction')!;
      m = without(m, FLEX_SIZING);
      m = without(m, WIDTH);
      for (const u of classList(donor.tailwind)) {
        if (WIDTH.test(splitVariant(u)[1]) || FRACTION.test(splitVariant(u)[1])) m = withClass(m, u);
      }
      patch.set(id, m);
      redistributeFractions(kids, patch);
      m = patch.get(id)!;
    } else if (fam?.kind === 'grow') {
      const grows = sizings.filter((s): s is Extract<Sizing, { kind: 'grow' }> => s.kind === 'grow');
      // Most common grow class; on a tie the lightest (a newcomer shouldn't dominate).
      const pick = mode(grows, (g) => g.cls, (a, b) => a.weight < b.weight)!;
      m = without(m, FLEX_SIZING);
      m = without(m, WIDTH);
      m = withClass(withClass(m, pick.cls), 'min-w-0');
      // Every fluid sibling must be allowed to shrink below its content.
      for (const s of sibs) {
        if (rowSizing(tw(s)).kind === 'grow' && !hasBase(tw(s), /^min-w-/)) patch.set(s.id, withClass(tw(s), 'min-w-0'));
      }
      // In a wrapping row the items' flex-basis decides whether they share a
      // line: when the bases (+ gaps) no longer fit, scale them down together
      // so the newcomer joins the row instead of wrapping onto its own line.
      if (hints.containerWidth && wraps(parent.tailwind)) {
        const BASIS = /^flex-\[(\d*\.?\d+)_(\d*\.?\d+)_(\d*\.?\d+)px\]$/;
        const items = kids.map((k) => ({ k, cls: k.id === id ? m : tw(k) }));
        const basisOf = (cls: string) => {
          for (const b of classList(cls)) {
            const mm = b.match(BASIS);
            if (mm) return Number(mm[3]);
          }
          return 0;
        };
        const sum = items.reduce((acc, it) => acc + basisOf(it.cls), 0);
        const gap = spacingPx(parent.tailwind, /^gap(?:-x)?-(.+)$/);
        const pad = 2 * spacingPx(parent.tailwind, /^p(?:x)?-(.+)$/);
        const room = hints.containerWidth - pad - gap * (kids.length - 1);
        if (room > 0 && sum > room) {
          const f = room / sum;
          for (const it of items) {
            const next = classList(it.cls)
              .map((u) => {
                const mm = u.match(BASIS);
                return mm ? `flex-[${mm[1]}_${mm[2]}_${Math.floor(Number(mm[3]) * f)}px]` : u;
              })
              .join(' ');
            if (it.k.id === id) m = next;
            else if (next !== it.cls) patch.set(it.k.id, next);
          }
        }
      }
    } else if (fam?.kind === 'fixed') {
      const fixed = sizings.filter((s): s is Extract<Sizing, { kind: 'fixed' }> => s.kind === 'fixed');
      const pick = mode(fixed, (f) => f.cls)!;
      m = without(m, FLEX_SIZING);
      m = without(m, /^w-.+$/);
      m = withClass(m, pick.cls);
      if (sibs.some((s) => hasBase(s.tailwind, /^shrink-0$/))) m = withClass(m, 'shrink-0');
      // Overflow check: fixed items that no longer fit a non-wrapping row wrap.
      const px = fixedPx(pick.cls);
      if (px && hints.containerWidth && !wraps(parent.tailwind)) {
        const gap = spacingPx(parent.tailwind, /^gap(?:-x)?-(.+)$/);
        const pad = 2 * spacingPx(parent.tailwind, /^p(?:x)?-(.+)$/);
        const widthOf = (k: IRNode) => {
          const s = rowSizing(k.id === id ? m : tw(k));
          return s.kind === 'fixed' ? fixedPx(s.cls) ?? 0 : 0;
        };
        const total = kids.reduce((sum, k) => sum + widthOf(k), 0) + gap * (kids.length - 1) + pad;
        if (total > hints.containerWidth) patch.set(parent.id, withClass(parent.tailwind, 'flex-wrap'));
      }
    } else {
      // Intrinsic items (toolbar buttons, chips): keep fixed sizes, drop fluid ones.
      m = without(m, /^(?:flex-(?:1|auto|initial|\[[^\]]+\])|grow(?:-\[[^\]]+\])?|basis-.+|w-full|w-screen|w-auto|w-\d+\/\d+)$/);
      if (blocky) {
        m = without(m, /^shrink-0$/);
        if (!hasBase(m, /^min-w-/)) m = withClass(m, 'min-w-0');
      }
    }
  } else if (kind === 'col' || kind === 'block') {
    // Stacked: a block item spans the column like its siblings.
    m = without(m, /^(?:flex-(?:1|auto|initial|none|\[[^\]]+\])|grow(?:-\d+|-\[[^\]]+\])?|basis-.+|shrink-0)$/);
    if (blocky) {
      m = without(m, /^(?:max-)?w-.+$/);
      const fullSibs = sibs.filter((s) => hasBase(s.tailwind, /^w-full$/)).length;
      const stretches = kind === 'block' || !hasBase(parent.tailwind, /^items-(?:start|center|end|baseline)$/);
      if (fullSibs * 2 > sibs.length || !stretches) m = withClass(m, 'w-full');
    }
  } else {
    // Grid: one cell like its siblings (shared col-span kept), no own width.
    m = without(m, FLEX_SIZING);
    m = without(m, GRID_PLACEMENT);
    if (blocky) m = without(m, /^w-.+$/);
    const spans = sibs.map((s) => bases(s.tailwind).find((b) => /^col-span-/.test(b)) ?? '');
    const span = mode(spans, (s) => s);
    if (span) m = withClass(m, span);
    // A grid showing exactly one full row grows a column instead of wrapping one item.
    const cols = gridCols(parent.tailwind);
    if (cols && sibs.length === cols && cols < 12) {
      patch.set(parent.id, setGridCols(tw(parent), cols, cols + 1));
    }
  }
  patch.set(id, m);

  // 3. Re-balance the container it left.
  const from = fromParentId && fromParentId !== parent.id ? byId.get(fromParentId) : undefined;
  /** The ancestor whose child list changed when emptied wrappers were removed. */
  let compactParentId: string | null = null;
  if (from) {
    const left = flowChildren(ir, from.id);
    const fromKind = flowKind(from.tailwind);
    const emptyWrapper = (w: IRNode) => w.parentId && isLayoutWrapper(w) && w.id !== parent.id
      && childrenOf(ir, w.id).filter((c) => !removed.has(c.id)).length === 0;
    if (left.length === 0 && emptyWrapper(from)) {
      // An emptied layout-only wrapper would leave a hole in its row: remove
      // it — and any wrapper above it that this leaves empty in turn.
      let w: IRNode | undefined = from;
      while (w && emptyWrapper(w)) {
        removed.add(w.id);
        compactParentId = w.parentId;
        w = w.parentId ? byId.get(w.parentId) : undefined;
      }
    } else if (fromKind === 'row') {
      redistributeFractions(left, patch);
    } else if (fromKind === 'grid') {
      const cols = gridCols(tw(from));
      if (cols && cols > 1 && left.length === cols - 1) patch.set(from.id, setGridCols(tw(from), cols, cols - 1));
    }
  }

  // 3b. A visual row built from wrappers (e.g. cards paired up for a 2×2
  //     reflow): weight each wrapper by its item count so every item keeps
  //     the same width after one wrapper gains or loses an item.
  const touched = new Set<string>();
  if (parent.parentId) touched.add(parent.parentId);
  if (from && !removed.has(from.id) && from.parentId) touched.add(from.parentId);
  for (const gid of touched) {
    const g = byId.get(gid);
    if (g) rebalanceWrapperRow(ir, g, patch, removed, fromParentId, parent.id);
  }

  // 4. Drop absolute coordinates and a stored width on the moved node.
  const affected = new Set<string>([id, ...patch.keys(), ...removed]);
  const nodes = ir.nodes
    .filter((n) => !removed.has(n.id))
    .map((n) => {
      if (!affected.has(n.id)) return n;
      let next: IRNode = { ...n, tailwind: patch.get(n.id) ?? n.tailwind };
      if (n.id === id) {
        const layout: NodeLayout = { ...n.layout };
        delete layout.x;
        delete layout.y;
        delete layout.w;
        next = { ...next, layout: Object.keys(layout).length ? layout : undefined };
      }
      if (next.tailwind !== n.tailwind || n.id === id) {
        next = { ...next, provenance: { ...next.provenance, source: 'user' } };
      }
      return next;
    });
  // Keep the emptied wrapper's former siblings compactly ordered.
  if (removed.size && compactParentId) {
    const order = new Map(
      nodes.filter((n) => n.parentId === compactParentId).sort((a, b) => a.order - b.order).map((n, i) => [n.id, i]),
    );
    for (let i = 0; i < nodes.length; i++) {
      const o = order.get(nodes[i].id);
      if (o !== undefined && nodes[i].order !== o) nodes[i] = { ...nodes[i], order: o };
    }
  }
  return { ir: { ...ir, nodes }, affectedIds: [...affected] };
}

// ---------------------------------------------------------------------------
// Drop target picking (shared by canvas drag and arrow gestures)
// ---------------------------------------------------------------------------

export interface DropTarget {
  parentId: string;
  /** Index among ALL the parent's children (minus the moved node), as `reparent`/`reorder` take it. */
  index: number;
  kind: FlowKind;
  /** The sibling the pointer is over, when not a bare container area. */
  nextToId?: string;
  placement: 'before' | 'after' | 'inside';
  /** The container's box and the insertion line, in the caller's coordinates. */
  container: Box;
  line: Box;
}

function center(b: Box) {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/**
 * Where among `boxes` (in-flow siblings, in order) a point inserts. Stacked
 * layouts compare vertical midpoints; rows and grids use reading order so a
 * wrapped row / multi-row grid inserts on the line under the pointer.
 */
export function insertionIndex(kind: FlowKind, boxes: Box[], p: { x: number; y: number }): number {
  let i = 0;
  for (const b of boxes) {
    const c = center(b);
    const before = kind === 'col' || kind === 'block'
      ? c.y < p.y
      : b.y + b.h < p.y || (p.y >= b.y && c.x < p.x);
    if (!before) break;
    i++;
  }
  return i;
}

/** The insertion line between flow siblings `index - 1` and `index`. */
function insertionLine(kind: FlowKind, boxes: Box[], index: number, container: Box): Box {
  const T = 3;
  const prev = boxes[index - 1];
  const next = boxes[index];
  if (kind === 'col' || kind === 'block') {
    const ref = next ?? prev;
    if (!ref) return { x: container.x + 8, y: container.y + 8, w: Math.max(8, container.w - 16), h: T };
    const y = prev && next ? (prev.y + prev.h + next.y) / 2 : next ? next.y - 4 : prev.y + prev.h + 4;
    return { x: ref.x, y: y - T / 2, w: ref.w, h: T };
  }
  if (!prev && !next) return { x: container.x + 8, y: container.y + 8, w: T, h: Math.max(8, container.h - 16) };
  const sameLine = prev && next && Math.abs(center(prev).y - center(next).y) < Math.min(prev.h, next.h) / 2;
  if (sameLine) {
    const x = (prev.x + prev.w + next.x) / 2;
    const top = Math.min(prev.y, next.y);
    return { x: x - T / 2, y: top, w: T, h: Math.max(prev.y + prev.h, next.y + next.h) - top };
  }
  if (next) return { x: next.x - 4 - T / 2, y: next.y, w: T, h: next.h };
  return { x: prev.x + prev.w + 4 - T / 2, y: prev.y, w: T, h: prev.h };
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

const DROP_CONTAINERS = new Set<IRNode['role']>(['container', 'frame']);
/** Pointing at a container's own area (gap / padding / empty) favours dropping into it. */
const OWN_AREA_SCORE = 0.5;

/**
 * Pick the container and index a dragged node should be inserted at, given
 * the innermost node under the pointer (`hitId`, outside the dragged subtree).
 *
 * Every container on the path from the hit up to (not incl.) the root frame
 * is a candidate; each is scored by how much the dragged node resembles the
 * child of that container the pointer is over (shared classes, role, size), so
 * a card dropped on another card's label joins the card's row instead of
 * nesting inside the card. Null when nothing fits (bare root frame).
 */
export function pickDropTarget(args: {
  nodes: FitNode[];
  draggedId: string;
  hitId: string | null;
  point: { x: number; y: number };
  boxOf: (id: string) => Box | undefined;
}): DropTarget | null {
  const { nodes, draggedId, hitId, point, boxOf } = args;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const dragged = byId.get(draggedId);
  if (!dragged || !hitId) return null;

  const banned = new Set([draggedId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (n.parentId && banned.has(n.parentId) && !banned.has(n.id)) { banned.add(n.id); grew = true; }
    }
  }
  if (banned.has(hitId)) return null;

  const dragBox = boxOf(draggedId);
  const dragClasses = bases(dragged.tailwind);
  const similarity = (c: FitNode): number => {
    let s = jaccard(dragClasses, bases(c.tailwind));
    if (c.role === dragged.role) s += c.role === 'container' ? 0.1 : 0.15;
    const cb = boxOf(c.id);
    if (dragBox && cb && dragBox.w * dragBox.h > 0 && cb.w * cb.h > 0) {
      // Peers are of a comparable size: a button that shares a card's border
      // classes is still no peer of a chart card 50× its area.
      const ratio = Math.abs(Math.log((dragBox.w * dragBox.h) / (cb.w * cb.h)));
      const size = Math.max(0, 1 - ratio / Math.log(16));
      s = s * Math.min(1, 0.25 + 1.5 * size) + 0.3 * size;
    }
    return s;
  };
  /**
   * Pointing at a container's own area. In the gap BETWEEN its items (not its
   * outer padding) that means "in here, next to these" — the more so the more
   * the dragged node looks like those items.
   */
  const ownAreaScore = (c: FitNode): number => {
    const items = nodes.filter((n) => n.parentId === c.id && !banned.has(n.id) && !isAbsolute(n)
      && !isHidden({ tailwind: n.tailwind ?? '' }) && boxOf(n.id));
    if (items.length < 2) return OWN_AREA_SCORE;
    const bs = items.map((n) => boxOf(n.id)!);
    const inside = point.x >= Math.min(...bs.map((b) => b.x)) && point.x <= Math.max(...bs.map((b) => b.x + b.w))
      && point.y >= Math.min(...bs.map((b) => b.y)) && point.y <= Math.max(...bs.map((b) => b.y + b.h));
    if (!inside) return OWN_AREA_SCORE;
    return OWN_AREA_SCORE + 0.5 * Math.min(1, Math.max(...items.map(similarity)));
  };

  let best: { parent: FitNode; child: FitNode | null; score: number } | null = null;
  let child: FitNode | null = null;
  for (let cur = byId.get(hitId); cur; child = cur, cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    if (!cur.parentId) break; // the root frame is free canvas, not a drop container
    if (!DROP_CONTAINERS.has(cur.role) || isHidden({ tailwind: cur.tailwind ?? '' })) continue;
    const score = child ? similarity(child) : ownAreaScore(cur);
    if (!best || score > best.score + 1e-6) best = { parent: cur, child, score };
  }
  if (!best) return null;

  // A visual row made of layout-only wrappers (cards paired up for a 2×2
  // reflow, a toolbar split into groups) is ONE row to the user: resolve the
  // insertion against its items, then pick the wrapper that slot belongs to.
  const flat = flattenedRowTarget(nodes, byId, best.parent, draggedId, point, boxOf);
  if (flat) {
    if (best.child) {
      const leafIdx = flat.leaves.findIndex((l) => l.id === best!.child!.id);
      if (leafIdx >= 0) {
        flat.target.nextToId = best.child.id;
        flat.target.placement = flat.k <= leafIdx ? 'before' : 'after';
      }
    }
    return flat.target;
  }

  const parent = best.parent;
  const container = boxOf(parent.id);
  if (!container) return null;
  const kind = flowKind(parent.tailwind);
  const all = nodes
    .filter((n) => n.parentId === parent.id && n.id !== draggedId)
    .sort((a, b) => a.order - b.order);
  const flow = all.filter((n) => !isAbsolute(n) && !isHidden({ tailwind: n.tailwind ?? '' }) && boxOf(n.id));
  const boxes = flow.map((n) => boxOf(n.id)!);
  const k = insertionIndex(kind, boxes, point);
  const index = k < flow.length ? all.indexOf(flow[k]) : flow.length ? all.indexOf(flow[flow.length - 1]) + 1 : all.length;
  const line = insertionLine(kind, boxes, k, container);

  const target: DropTarget = { parentId: parent.id, index, kind, placement: 'inside', container, line };
  if (best.child) {
    const at = flow.findIndex((n) => n.id === best!.child!.id);
    if (at >= 0) {
      target.nextToId = best.child.id;
      target.placement = k <= at ? 'before' : 'after';
    }
  }
  return target;
}


interface RowLeaf { id: string; parentId: string; box: Box }

/**
 * Resolve a drop against a row whose items sit in layout-only row wrappers.
 * `picked` is the container the scoring chose: when it is such a wrapper
 * nested in a row, the outermost enclosing wrapper row is used instead (the
 * user aims at "the row of 4 cards", not at one pair of it). Returns null when
 * `picked` is not part of a wrapper row, so the plain path handles it.
 *
 * The insertion slot is computed among the row's items (wrappers expanded
 * recursively). A slot strictly inside one wrapper goes there; a slot on the
 * boundary between two wrappers goes to the one the point is inside, else to
 * the one holding fewer items (ties → the earlier one) so the groups stay
 * balanced.
 */
function flattenedRowTarget(
  nodes: FitNode[],
  byId: Map<string, FitNode>,
  picked: FitNode,
  draggedId: string,
  point: { x: number; y: number },
  boxOf: (id: string) => Box | undefined,
): { target: DropTarget; leaves: RowLeaf[]; k: number } | null {
  const kidsOf = (pid: string) => nodes
    .filter((n) => n.parentId === pid && n.id !== draggedId)
    .sort((a, b) => a.order - b.order);
  const flowOf = (pid: string) => kidsOf(pid).filter((n) => !isAbsolute(n) && !isHidden({ tailwind: n.tailwind ?? '' }) && boxOf(n.id));
  const rowWrapper = (n: FitNode) => isLayoutWrapper(n)
    && flowKind(n.tailwind) === 'row' && flowOf(n.id).length > 0;

  // Climb from a picked wrapper to the outermost row it is an item of.
  let root = picked;
  while (rowWrapper(root) && root.parentId) {
    const up = byId.get(root.parentId);
    if (!up || !up.parentId || !DROP_CONTAINERS.has(up.role) || flowKind(up.tailwind) !== 'row') break;
    root = up;
  }
  if (flowKind(root.tailwind) !== 'row') return null;

  const leaves: RowLeaf[] = [];
  let expanded = false;
  const walk = (pid: string) => {
    for (const c of flowOf(pid)) {
      if (rowWrapper(c)) { expanded = true; walk(c.id); }
      else if (isLayoutWrapper(c) && kidsOf(c.id).length === 0 && nodes.some((n) => n.parentId === c.id)) continue; // holds only the dragged node
      else leaves.push({ id: c.id, parentId: pid, box: boxOf(c.id)! });
    }
  };
  walk(root.id);
  if (!expanded || leaves.length === 0) return null;

  const k = insertionIndex('row', leaves.map((l) => l.box), point);
  const prev = leaves[k - 1];
  const next = leaves[k];
  let parentId: string;
  if (!prev) parentId = next.parentId;
  else if (!next) parentId = prev.parentId;
  else if (prev.parentId === next.parentId) parentId = prev.parentId;
  else {
    const inside = (pid: string) => { const b = boxOf(pid); return !!b && pid !== root.id && point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h; };
    const count = (pid: string) => flowOf(pid).length;
    if (inside(next.parentId) && !inside(prev.parentId)) parentId = next.parentId;
    else if (inside(prev.parentId) && !inside(next.parentId)) parentId = prev.parentId;
    else parentId = count(next.parentId) < count(prev.parentId) ? next.parentId : prev.parentId;
  }
  const flow = flowOf(parentId);
  const all = kidsOf(parentId);
  let local: number;
  if (prev && prev.parentId === parentId) local = flow.findIndex((n) => n.id === prev.id) + 1;
  else if (next && next.parentId === parentId) local = flow.findIndex((n) => n.id === next.id);
  else local = flow.length;
  const index = local < flow.length ? all.indexOf(flow[local]) : flow.length ? all.indexOf(flow[flow.length - 1]) + 1 : all.length;
  const container = boxOf(parentId);
  const rootBox = boxOf(root.id);
  if (!container || !rootBox) return null;
  return {
    target: {
      parentId, index, kind: 'row', placement: 'inside', container,
      line: insertionLine('row', leaves.map((l) => l.box), k, rootBox),
    },
    leaves,
    k,
  };
}
