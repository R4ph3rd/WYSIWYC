/**
 * Annotation resolution: the guardrail layer for "prompt by demonstration".
 *
 * Users mark up the canvas with rough annotations (a drawn arrow, a box drawn
 * around elements, a scribble, or a text comment pinned at a point). Before
 * anything is applied to the IR we must
 *
 *   (a) GUESS which existing UI elements each annotation targets, purely from
 *       geometry, together with an honest confidence, and
 *   (b) synthesize a plain-English modification instruction for the LLM.
 *
 * Low confidence is a signal to the UI that it should ask the user to confirm
 * the target instead of applying the change silently.
 *
 * Everything here is PURE: no React, no DOM, no network, no store access. The
 * caller measures node boxes from the DOM (in stage / canvas coordinates, the
 * same space the annotation geometry lives in) and passes them in as
 * `id -> NodeBox`. Raw coordinates are never surfaced in instruction text.
 *
 * Conventions worth knowing:
 *  - At most {@link MAX_TARGETS} ids are returned, deduped, most specific first.
 *  - For arrows the returned ids are ordered `[head, tail?]`: the node under
 *    the arrow head is THE target (and the only one the confidence describes);
 *    the node at the tail is appended only as context when it is clearly there.
 *  - Distances to a node are measured to its nearest edge (0 when inside).
 */

import type { Annotation, DemoIntent, DemoPlanItem, IRNode, ProposalConfidence } from '../ir/types';
import { classifyGesture, type Gesture } from './gesture';

/** A node's box in stage (canvas) coordinates, as measured from the DOM by the caller. */
export interface NodeBox { x: number; y: number; w: number; h: number }

/** A 2D point in stage coordinates (structurally the annotation's point type). */
type Point = NonNullable<Annotation['anchor']>;

/** The closest node to a point, with the distance to its nearest edge (0 = inside). */
export interface NodeHit { id: string; distance: number }

/** Result of {@link resolveTargets}. */
export interface ResolvedTargets { ids: string[]; confidence: ProposalConfidence }

/** Nodes at the two ends of an arrow; either may be null when nothing is close enough. */
export interface ArrowEnds { head: NodeHit | null; tail: NodeHit | null }

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Hard cap on how many node ids one annotation can resolve to. */
const MAX_TARGETS = 6;
/** How close (px) a scribble's path must pass to a node's box to count as touching it. */
const SCRIBBLE_NEAR_PX = 12;
/** Arrow head: within this of a node edge is a "medium" guess. */
const ARROW_NEAR_PX = 40;
/** Arrow head: beyond this there is no guess at all. */
const ARROW_FAR_PX = 80;
/** Comment pin: within this of a node is a "medium" guess. */
const COMMENT_NEAR_PX = 60;
/** Comment pin: beyond this the note is treated as global (no target). */
const COMMENT_FAR_PX = 120;
/** Soft upper bound on a synthesized instruction's length (user text is never cut). */
const MAX_INSTRUCTION_CHARS = 160;
/** Max target labels spelled out in an instruction suffix. */
const MAX_LABELS_IN_SUFFIX = 3;
/** Max characters of any single label in an instruction suffix. */
const MAX_LABEL_CHARS = 40;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** True when the point lies inside (or on the edge of) the box. */
export function pointInBox(p: Point, b: NodeBox): boolean {
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}

/** Center point of a box. */
export function boxCenter(b: NodeBox): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Euclidean distance between two points. */
export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** True when two boxes overlap or touch. */
export function boxesIntersect(a: NodeBox, b: NodeBox): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

/** Distance from a point to the nearest edge of a box; 0 when the point is inside. */
function distanceToBox(p: Point, b: NodeBox): number {
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w));
  const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

function boxArea(b: NodeBox): number {
  return b.w * b.h;
}

/** True when `outer` fully contains `inner` (touching edges allowed). */
function boxContains(outer: NodeBox, inner: NodeBox): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.w >= inner.x + inner.w &&
    outer.y + outer.h >= inner.y + inner.h
  );
}

function inflate(b: NodeBox, pad: number): NodeBox {
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}

/** Normalize a rect so w/h are non-negative (rects drawn right-to-left / bottom-to-top). */
function normalizeRect(r: NodeBox): NodeBox {
  return {
    x: r.w < 0 ? r.x + r.w : r.x,
    y: r.h < 0 ? r.y + r.h : r.y,
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  };
}

/**
 * A scribble's strokes: `strokes` when present, else the legacy single-stroke
 * `points` path (annotations saved before scribbles were merged). Empty
 * strokes are dropped.
 */
export function scribbleStrokes(a: Annotation): Point[][] {
  const strokes = a.strokes && a.strokes.length > 0 ? a.strokes : a.points ? [a.points] : [];
  return strokes.filter((s) => s.length > 0);
}

/** Bounding box of a non-empty point list. */
function boundsOf(points: Point[]): NodeBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Measured boxes that are usable (finite, positive size). */
function validEntries(boxes: Record<string, NodeBox>): Array<[string, NodeBox]> {
  const out: Array<[string, NodeBox]> = [];
  for (const id of Object.keys(boxes)) {
    const b = boxes[id];
    if (
      b &&
      Number.isFinite(b.x) && Number.isFinite(b.y) &&
      Number.isFinite(b.w) && Number.isFinite(b.h) &&
      b.w > 0 && b.h > 0
    ) {
      out.push([id, b]);
    }
  }
  return out;
}

/**
 * The node nearest to a point, measured to the node's nearest edge. A node
 * containing the point has distance 0; among equals the smallest (most
 * specific) node wins. Null when there are no usable boxes.
 */
export function nearestNodeToPoint(point: Point, boxes: Record<string, NodeBox>): NodeHit | null {
  let best: NodeHit | null = null;
  let bestArea = Infinity;
  for (const [id, box] of validEntries(boxes)) {
    const distance = distanceToBox(point, box);
    const area = boxArea(box);
    if (best === null || distance < best.distance || (distance === best.distance && area < bestArea)) {
      best = { id, distance };
      bestArea = area;
    }
  }
  return best;
}

/** True when any part of the polyline passes within `pad` px of the box. */
function pathNearBox(points: Point[], box: NodeBox, pad: number): boolean {
  const zone = inflate(box, pad);
  const step = Math.max(pad / 2, 2);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (pointInBox(p, zone)) return true;
    if (i === 0) continue;
    const prev = points[i - 1];
    const len = dist(prev, p);
    const n = Math.ceil(len / step);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      if (pointInBox({ x: prev.x + (p.x - prev.x) * t, y: prev.y + (p.y - prev.y) * t }, zone)) {
        return true;
      }
    }
  }
  return false;
}

/** Drop any hit that fully contains another hit (keep the more specific nodes). */
function dropContainers(hits: Array<[string, NodeBox]>): Array<[string, NodeBox]> {
  if (hits.length < 2) return hits;
  const kept = hits.filter(([id, box]) =>
    !hits.some(([otherId, other]) => otherId !== id && boxContains(box, other) && !boxContains(other, box)),
  );
  return kept.length > 0 ? kept : hits;
}

function result(ids: string[], confidence: ProposalConfidence): ResolvedTargets {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_TARGETS) break;
  }
  return { ids: out, confidence };
}

const NONE: ProposalConfidence = 'low';

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

function resolveBox(a: Annotation, boxes: Record<string, NodeBox>): ResolvedTargets {
  let rect: NodeBox | null = null;
  if (a.rect) rect = normalizeRect(a.rect);
  else if (a.points && a.points.length > 0) rect = boundsOf(a.points);
  if (!rect) return result([], NONE);

  const center = boxCenter(rect);
  let matched = validEntries(boxes).filter(([, b]) => pointInBox(boxCenter(b), rect));
  if (matched.length === 0) return result([], NONE);

  // A box drawn on top of an ancestor (e.g. around part of a card) also catches
  // the ancestor's center sometimes; prefer the nodes the box really encloses.
  const enclosed = matched.filter(([, b]) => !(boxContains(b, rect) && boxArea(b) > boxArea(rect)));
  if (enclosed.length > 0) matched = enclosed;

  // If too many, keep those nearest the rect center, then present in reading order.
  matched = matched
    .sort((p, q) => dist(boxCenter(p[1]), center) - dist(boxCenter(q[1]), center))
    .slice(0, MAX_TARGETS)
    .sort((p, q) => p[1].y - q[1].y || p[1].x - q[1].x);

  return result(matched.map(([id]) => id), 'high');
}

function resolveScribble(a: Annotation, boxes: Record<string, NodeBox>): ResolvedTargets {
  // A merged scribble is several separate strokes: its extent spans all of
  // them, and a node counts as touched when ANY stroke passes near it (never
  // via the gap between one stroke's end and the next one's start).
  const strokes = scribbleStrokes(a);
  if (strokes.length === 0) return result([], NONE);

  const area = inflate(boundsOf(strokes.flat()), SCRIBBLE_NEAR_PX);
  const overlapping = validEntries(boxes).filter(([, b]) => boxesIntersect(area, b));
  const near = overlapping.filter(([, b]) => strokes.some((pts) => pathNearBox(pts, b, SCRIBBLE_NEAR_PX)));

  const bySpecificity = (hits: Array<[string, NodeBox]>): string[] =>
    hits.sort((p, q) => boxArea(p[1]) - boxArea(q[1])).map(([id]) => id);

  if (near.length > 0) {
    const hits = dropContainers(near);
    return result(bySpecificity(hits), hits.length === 1 ? 'high' : 'medium');
  }
  // The path never came close to an edge or interior, but its extent overlaps
  // some nodes (e.g. a loose loop around them): still a rough guess.
  if (overlapping.length > 0) {
    return result(bySpecificity(dropContainers(overlapping)), 'medium');
  }
  return result([], NONE);
}

/**
 * The nodes at the two ends of an arrow: `head` is under/nearest the arrow
 * head (last point), `tail` under/nearest the start (first point). A node is
 * only reported when it is within the far threshold (head) or near threshold
 * (tail); a single-point arrow has no tail.
 */
export function resolveArrowEnds(a: Annotation, boxes: Record<string, NodeBox>): ArrowEnds {
  const pts = a.points ?? [];
  if (pts.length === 0) return { head: null, tail: null };

  const headHit = nearestNodeToPoint(pts[pts.length - 1], boxes);
  const head = headHit && headHit.distance <= ARROW_FAR_PX ? headHit : null;

  let tail: NodeHit | null = null;
  if (pts.length > 1) {
    const tailHit = nearestNodeToPoint(pts[0], boxes);
    if (tailHit && tailHit.distance <= ARROW_NEAR_PX) tail = tailHit;
  }
  return { head, tail };
}

function resolveArrow(a: Annotation, boxes: Record<string, NodeBox>): ResolvedTargets {
  const { head, tail } = resolveArrowEnds(a, boxes);
  if (!head) return result([], NONE);

  const confidence: ProposalConfidence =
    head.distance === 0 ? 'high' : head.distance <= ARROW_NEAR_PX ? 'medium' : 'low';
  const ids = [head.id];
  // The end node wins; the start node rides along as context only.
  if (tail && tail.id !== head.id) ids.push(tail.id);
  return result(ids, confidence);
}

function resolveComment(a: Annotation, boxes: Record<string, NodeBox>): ResolvedTargets {
  const pin = a.anchor ?? a.points?.[0];
  if (!pin) return result([], NONE);

  const hit = nearestNodeToPoint(pin, boxes);
  if (!hit || hit.distance > COMMENT_FAR_PX) return result([], NONE); // global note
  if (hit.distance === 0) return result([hit.id], 'high');
  if (hit.distance <= COMMENT_NEAR_PX) return result([hit.id], 'medium');
  return result([hit.id], 'low');
}

/**
 * Which IR nodes an annotation geometrically targets, with a confidence.
 * Pure: the caller supplies measured node boxes (id -> box).
 */
export function resolveTargets(a: Annotation, boxes: Record<string, NodeBox>): { ids: string[]; confidence: ProposalConfidence } {
  if (a.targetNodeIds && a.targetNodeIds.length > 0) {
    return result(a.targetNodeIds, 'high');
  }
  switch (a.kind) {
    case 'box':
      return resolveBox(a, boxes);
    case 'scribble':
      return resolveScribble(a, boxes);
    case 'arrow':
      return resolveArrow(a, boxes);
    case 'comment':
      return resolveComment(a, boxes);
    default:
      return result([], NONE);
  }
}

// ---------------------------------------------------------------------------
// Scribble intent (gesture → delete / move / swap / fill)
// ---------------------------------------------------------------------------

/** The IR facts intent resolution needs about each node. */
export type IntentNode = Pick<IRNode, 'id' | 'parentId' | 'order' | 'role' | 'layout'>;

/** A recognised scribble gesture and what it resolves to on the scene. */
export interface ScribbleIntent {
  gesture: Gesture;
  /** Null when the gesture is unclear or its targets could not be found. */
  intent: DemoIntent | null;
}

/** Roles that can hold children (an arrow ending inside one moves INTO it). */
const CONTAINER_ROLES = new Set<IRNode['role']>(['frame', 'container']);
/** A cross/hatch "covers" a node when it spans at least this share of the node's area. */
const COVER_SHARE = 0.5;
/** An arrow end within this distance of a node edge still picks it up. */
const GESTURE_END_PX = 12;
/** A plain line whose ends both lie within this of one node strikes it out. */
const STRIKE_END_PX = 16;

function overlapArea(a: NodeBox, b: NodeBox): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Ids of `id` and every descendant. */
function subtreeIds(nodes: IntentNode[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (n.parentId && out.has(n.parentId) && !out.has(n.id)) { out.add(n.id); grew = true; }
    }
  }
  return out;
}

function isAbsolute(n: IntentNode): boolean {
  return n.layout?.x !== undefined || n.layout?.y !== undefined;
}

/**
 * Recognise what a scribble means (see annot/gesture.ts) and resolve it
 * against the scene: which node(s) a cross-out deletes, where an arrow moves
 * its tail element, which two elements a double arrow swaps. Pure: the caller
 * supplies measured boxes and the IR nodes.
 */
export function resolveScribbleIntent(
  a: Annotation,
  boxes: Record<string, NodeBox>,
  nodes: IntentNode[],
): ScribbleIntent {
  const gesture = classifyGesture(scribbleStrokes(a));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Only nodes that are both in the IR and measured; the root frame is never
  // deleted, moved or swapped by a gesture.
  const entries = validEntries(boxes).filter(([id]) => byId.has(id));
  const editable = entries.filter(([id]) => byId.get(id)!.parentId !== null);
  const none: ScribbleIntent = { gesture, intent: null };

  /** The smallest editable node at (or within `pad` px of) a point. */
  const nodeAt = (p: Point, pad = GESTURE_END_PX, exclude?: Set<string>): string | null => {
    const hit = nearestNodeToPoint(p, Object.fromEntries(editable.filter(([id]) => !exclude?.has(id))));
    return hit && hit.distance <= pad ? hit.id : null;
  };

  const deleteUnder = (center: Point): ScribbleIntent => {
    const g = gesture.bounds;
    const covered = editable.filter(([, b]) => overlapArea(b, g) >= COVER_SHARE * boxArea(b));
    // Keep the outermost covered nodes: crossing out a card deletes the card,
    // not each of its children.
    const outer = covered.filter(([id, b]) =>
      !covered.some(([other, ob]) => other !== id && boxContains(ob, b) && !boxContains(b, ob)),
    );
    let ids = outer.sort((p, q) => p[1].y - q[1].y || p[1].x - q[1].x).map(([id]) => id).slice(0, MAX_TARGETS);
    if (ids.length === 0) {
      const at = nodeAt(center, 0);
      ids = at ? [at] : [];
    }
    return ids.length ? { gesture, intent: { kind: 'delete', ids } } : none;
  };

  switch (gesture.kind) {
    case 'cross':
      return deleteUnder(gesture.center ?? boxCenter(gesture.bounds));
    case 'hatch':
      return deleteUnder(boxCenter(gesture.bounds));
    case 'double-arrow': {
      const one = gesture.from && nodeAt(gesture.from);
      const two = gesture.to && nodeAt(gesture.to);
      if (!one || !two || one === two) return none;
      if (subtreeIds(nodes, one).has(two) || subtreeIds(nodes, two).has(one)) return none;
      return { gesture, intent: { kind: 'swap', ids: [one, two] } };
    }
    case 'arrow': {
      const from = gesture.from!;
      const to = gesture.to!;
      if (gesture.headless) {
        // A bare line drawn across one element is a strike-through.
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        const struck = nodeAt(mid, 0);
        const box = struck ? boxes[struck] : null;
        if (struck && box && distanceToBox(from, box) <= STRIKE_END_PX && distanceToBox(to, box) <= STRIKE_END_PX) {
          return { gesture, intent: { kind: 'delete', ids: [struck] } };
        }
      }
      const moved = nodeAt(from);
      if (!moved) return none;
      return resolveMove(gesture, moved, to, boxes, nodes, entries, byId);
    }
    case 'fill': {
      const { ids } = resolveScribble(a, boxes);
      return ids.length ? { gesture, intent: { kind: 'fill', ids } } : none;
    }
    default:
      return none;
  }
}

/** Where an arrow drop point lands: inside a container, or before/after a sibling. */
function resolveMove(
  gesture: Gesture,
  movedId: string,
  to: Point,
  boxes: Record<string, NodeBox>,
  nodes: IntentNode[],
  entries: Array<[string, NodeBox]>,
  byId: Map<string, IntentNode>,
): ScribbleIntent {
  const none: ScribbleIntent = { gesture, intent: null };
  const moved = byId.get(movedId)!;
  const movedBox = boxes[movedId];
  const banned = subtreeIds(nodes, movedId);
  const at = entries
    .filter(([id, b]) => !banned.has(id) && pointInBox(to, b))
    .sort((p, q) => boxArea(p[1]) - boxArea(q[1]));
  if (at.length === 0) return none;

  const container = at.find(([id]) => CONTAINER_ROLES.has(byId.get(id)!.role));
  const leaf = at.find(([id]) => !CONTAINER_ROLES.has(byId.get(id)!.role) && byId.get(id)!.parentId !== null);

  /** Siblings under `parentId` (in order, without the moved node) and whether they flow in a row. */
  const siblings = (parentId: string) => {
    const kids = nodes
      .filter((n) => n.parentId === parentId && n.id !== movedId)
      .sort((p, q) => p.order - q.order);
    const centers = kids.map((k) => boxes[k.id]).filter(Boolean).map(boxCenter);
    const spanX = centers.length ? Math.max(...centers.map((c) => c.x)) - Math.min(...centers.map((c) => c.x)) : 0;
    const spanY = centers.length ? Math.max(...centers.map((c) => c.y)) - Math.min(...centers.map((c) => c.y)) : 0;
    return { kids, row: spanX > spanY };
  };
  const isBefore = (b: NodeBox, row: boolean) => (row ? boxCenter(b).x < to.x : boxCenter(b).y < to.y);

  let toParentId: string;
  let toIndex: number;
  let nextToId: string | undefined;
  let placement: 'before' | 'after' | 'inside';
  if (leaf && (!container || boxContains(container[1], leaf[1]))) {
    // Dropped on an element: take its place in its parent, before or after it.
    const target = byId.get(leaf[0])!;
    toParentId = target.parentId!;
    const { kids, row } = siblings(toParentId);
    const after = isBefore(leaf[1], row);
    toIndex = kids.findIndex((k) => k.id === target.id) + (after ? 1 : 0);
    nextToId = target.id;
    placement = after ? 'after' : 'before';
  } else if (container) {
    // Dropped inside a container: insert among its children at the drop point.
    toParentId = container[0];
    const { kids, row } = siblings(toParentId);
    toIndex = kids.filter((k) => boxes[k.id] && isBefore(boxes[k.id], row)).length;
    placement = 'inside';
  } else {
    return none;
  }

  let layout: { x: number; y: number } | undefined;
  if (isAbsolute(moved) && movedBox) {
    // Absolutely positioned: keep it absolute, centred on the drop point and
    // expressed relative to the (new) parent's box.
    const parentBox = boxes[toParentId] ?? { x: 0, y: 0, w: 0, h: 0 };
    layout = {
      x: Math.round(to.x - parentBox.x - movedBox.w / 2),
      y: Math.round(to.y - parentBox.y - movedBox.h / 2),
    };
  }
  const intent: DemoIntent = { kind: 'move', id: movedId, toParentId, toIndex, placement };
  if (nextToId) intent.nextToId = nextToId;
  if (layout) intent.layout = layout;
  return { gesture, intent };
}

/**
 * A short chip label for an intent ("Delete", "Move into container", "Swap"),
 * shown on the canvas and in the plan so the user sees what will happen.
 */
export function intentLabel(intent: DemoIntent | null, labelOf: (id: string) => string): string {
  if (!intent) return 'Edit';
  switch (intent.kind) {
    case 'delete':
      return intent.ids.length > 1 ? `Delete ${intent.ids.length}` : 'Delete';
    case 'move':
      return intent.placement === 'inside'
        ? `Move into ${truncate(labelOf(intent.toParentId), 24)}`
        : `Move ${intent.placement} ${truncate(labelOf(intent.nextToId ?? intent.toParentId), 24)}`;
    case 'swap':
      return 'Swap';
    case 'fill':
      return 'Fill';
  }
}

/** The plain-English instruction for an intent (plan row text and model fallback). */
function intentInstruction(intent: DemoIntent, labelOf: (id: string) => string): string {
  const the = (id: string) => `the ${labelOf(id)}`;
  switch (intent.kind) {
    case 'delete':
      return compose(`Delete the crossed-out element${intent.ids.length > 1 ? 's' : ''}.`, [targetSuffix(intent.ids.map(labelOf))]);
    case 'move': {
      const where = intent.placement === 'inside'
        ? `into ${the(intent.toParentId)}`
        : `${intent.placement} ${the(intent.nextToId ?? intent.toParentId)}`;
      return `Move ${the(intent.id)} ${where}.`;
    }
    case 'swap':
      return `Swap the positions of ${the(intent.ids[0])} and ${the(intent.ids[1])}.`;
    case 'fill':
      return compose('Fill the shaded element(s) with a solid background colour.', [targetSuffix(intent.ids.map(labelOf))]);
  }
}

// ---------------------------------------------------------------------------
// Instruction synthesis
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Does the user's text already name one of the targets (by label, type word or quoted content)? */
function textNamesTarget(text: string, labels: string[]): boolean {
  const hay = text.toLowerCase();
  return labels.some((label) => {
    const l = label.toLowerCase();
    if (hay.includes(l)) return true;
    const type = l.split(/\s+/)[0];
    if (type.length >= 3 && hay.includes(type)) return true;
    const quoted = /"([^"]+)"/.exec(l);
    return quoted !== null && quoted[1].length >= 3 && hay.includes(quoted[1]);
  });
}

function targetSuffix(labels: string[]): string {
  const shown = labels.slice(0, MAX_LABELS_IN_SUFFIX).map((l) => truncate(l, MAX_LABEL_CHARS));
  const more = labels.length - shown.length;
  return ` — target: ${shown.join(', ')}${more > 0 ? ` +${more} more` : ''}`;
}

/** Append optional suffixes, dropping them from the end until the sentence fits. */
function compose(base: string, suffixes: string[]): string {
  const parts = suffixes.slice();
  while (parts.length > 0 && base.length + parts.join('').length > MAX_INSTRUCTION_CHARS) parts.pop();
  return base + parts.join('');
}

/**
 * A plain-English modification instruction synthesized from one annotation
 * and its target labels. The user's own text is used verbatim (trimmed, never
 * truncated); only the generated suffixes are dropped when the sentence would
 * exceed ~160 characters. For arrows, `targetLabels` is expected in the order
 * `[head, tail?]` as produced by {@link resolveTargets}.
 */
export function synthesizeInstruction(a: Annotation, targetLabels: string[]): string {
  const text = (a.text ?? '').trim();
  const labels = Array.from(new Set(targetLabels.map((l) => l.trim()).filter((l) => l.length > 0)));
  const wantsTargetSuffix = labels.length > 0 && !(text && textNamesTarget(text, labels));
  const targets = wantsTargetSuffix ? [targetSuffix(labels)] : [];

  switch (a.kind) {
    case 'comment':
      // The note's text is the instruction; targets are displayed separately.
      return text || compose('Revise this element.', targets);
    case 'arrow': {
      if (text) return compose(text, targets);
      // Labels are [head, tail]: the element at the tail is the one that moves.
      if (labels.length >= 2) return `Move the ${labels[1]} to where the arrow points, next to the ${labels[0]}.`;
      return compose('Point this toward the indicated spot.', targets);
    }
    case 'box':
      return text
        ? compose(text, [' (applied to the grouped elements)', ...targets])
        : compose('Group or align the surrounded elements.', targets);
    case 'scribble':
      return compose(text || 'Adjust the marked element(s).', targets);
    default:
      return compose(text || 'Revise this element.', targets);
  }
}

// ---------------------------------------------------------------------------
// Plan building
// ---------------------------------------------------------------------------

/** The nodes a plan row pins for an intent, most important first. */
export function intentTargets(intent: DemoIntent): string[] {
  switch (intent.kind) {
    case 'delete':
    case 'fill':
      return intent.ids;
    case 'move':
      return [intent.id, intent.nextToId ?? intent.toParentId];
    case 'swap':
      return [...intent.ids];
  }
}

const SOURCE_LABEL: Record<Annotation['kind'], string> = {
  comment: 'Note',
  arrow: 'Arrow',
  box: 'Group',
  scribble: 'Scribble',
};

/**
 * Build the full reviewable plan from all annotations, in annotation order.
 * `labelOf(id)` returns a short human label for a node (e.g. `button`,
 * `heading "Sign in"`); `nextId()` returns a fresh unique plan-item id per
 * call. A comment with no text and no resolved targets (a truly empty note)
 * produces no plan item.
 */
export function buildDemoPlan(
  annotations: Annotation[],
  boxes: Record<string, NodeBox>,
  labelOf: (nodeId: string) => string,
  nextId: () => string,
  nodes: IntentNode[] = [],
): DemoPlanItem[] {
  const plan: DemoPlanItem[] = [];
  for (const a of annotations) {
    // A recognised scribble gesture becomes a precise, deterministic step.
    const recognised = a.kind === 'scribble' && !a.text?.trim() && nodes.length > 0
      ? resolveScribbleIntent(a, boxes, nodes).intent
      : null;
    if (recognised) {
      plan.push({
        id: nextId(),
        annotationId: a.id,
        source: SOURCE_LABEL[a.kind],
        targetNodeIds: intentTargets(recognised),
        instruction: intentInstruction(recognised, labelOf),
        confidence: 'high',
        intent: recognised,
      });
      continue;
    }
    const { ids, confidence } = resolveTargets(a, boxes);
    if (a.kind === 'comment' && (a.text ?? '').trim().length === 0 && ids.length === 0) continue;

    const item: DemoPlanItem = {
      id: nextId(),
      annotationId: a.id,
      source: SOURCE_LABEL[a.kind],
      targetNodeIds: ids,
      instruction: synthesizeInstruction(a, ids.map(labelOf)),
      confidence,
    };
    if (a.images && a.images.length > 0) item.images = [...a.images];
    plan.push(item);
  }
  return plan;
}
