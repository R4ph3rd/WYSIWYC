/**
 * Scribble gesture recognition: what did the user MEAN by a freehand mark?
 *
 * A scribble used to be read as "colour this", which is rarely the intent.
 * This classifier turns the raw strokes of one scribble annotation into one of
 * a few editing gestures that designers draw on paper:
 *
 *  - `cross`        two roughly straight strokes crossing near their middles (X)
 *  - `hatch`        a scratch-out: a zig-zag or several parallel passes, sparse
 *  - `arrow`        a near-straight shaft, optionally with barbs at ONE end
 *                   (a bare line counts too; `headless` says so)
 *  - `double-arrow` a shaft with barbs at BOTH ends
 *  - `fill`         dense shading that covers an area (a dense back-and-forth
 *                   over something thin, like a text line, is a scratch-out)
 *  - `unknown`      none of the above (a loop, a squiggle, a dot)
 *
 * It is deliberately small, deterministic and PURE (no DOM, no store): strokes
 * are resampled at a fixed spacing, simplified with Ramer–Douglas–Peucker,
 * and near-collinear segments are merged into "runs". Every rule below works
 * on those runs, with thresholds relative to the gesture's size so the same
 * mark drawn small or large classifies the same way.
 */

import type { PathPoint } from '../ir/types';

type Point = PathPoint;

/** An axis-aligned box in stage coordinates. */
export interface GestureBox { x: number; y: number; w: number; h: number }

export type GestureKind = 'cross' | 'hatch' | 'arrow' | 'double-arrow' | 'fill' | 'unknown';

export interface Gesture {
  kind: GestureKind;
  /** Bounds of all the ink. */
  bounds: GestureBox;
  /** arrow: shaft tail; double-arrow: the shaft end drawn first. */
  from?: Point;
  /** arrow: the tip (where it points); double-arrow: the other end. */
  to?: Point;
  /** arrow: true when no barbs were drawn (a plain line, direction = drawing order). */
  headless?: boolean;
  /** cross: where the two strokes intersect. */
  center?: Point;
}

// ---------------------------------------------------------------------------
// Tunables (fractions are of the gesture's bounding-box diagonal unless noted)
// ---------------------------------------------------------------------------

/** Strokes shorter than this (px) are dots / jitter and are ignored. */
const MIN_STROKE_PX = 4;
/** Below this diagonal (px) a mark is too small to read as a gesture. */
const MIN_GESTURE_PX = 12;
/** RDP tolerance as a fraction of the diagonal (floored at 2.5px): small enough to keep arrow barbs. */
const SIMPLIFY_FRAC = 0.02;
/** Consecutive segments turning less than this are merged into one run. */
const RUN_MERGE_DEG = 25;
/** A turn sharper than this between runs is a back-and-forth reversal. */
const REVERSAL_DEG = 80;
/** Chord/length ratio for a stroke to count as "roughly straight". */
const STRAIGHT_RATIO = 0.8;
/** Cross: the intersection must lie within this middle band of both strokes. */
const CROSS_MID_BAND: [number, number] = [0.15, 0.85];
/** Cross: minimum angle between the two strokes. */
const CROSS_MIN_DEG = 30;
/** Arrow: the shaft must span at least this much of the diagonal. */
const SHAFT_MIN_FRAC = 0.7;
/** Arrow: minimum absolute shaft length (px). */
const SHAFT_MIN_PX = 30;
/** Arrow: a barb is at most this long relative to the shaft. */
const BARB_MAX_FRAC = 0.6;
/** Arrow: a barb starts within this distance of a shaft end (fraction of shaft, floored at 14px). */
const BARB_REACH_FRAC = 0.3;
/** Arrow: total ink is at most this multiple of the shaft (shaft + a few barbs). */
const ARROW_MAX_INK = 2.5;
/** Arrow: barbs make at least this angle with the shaft. */
const BARB_MIN_DEG = 15;
/** Hatch: parallel passes must share an orientation within ±this. */
const PARALLEL_DEG = 22;
/** Hatch: share of pass length that must be parallel. */
const PARALLEL_SHARE = 0.6;
/** Effective reach of the pen (px) when estimating how much area ink covers. */
const INK_REACH_PX = 6;
/** Back-and-forth ink denser than this is shading (fill), sparser is a scratch-out. */
const FILL_DENSITY = 1.1;
/** Shading must "cover an area": both sides at least this long (px). Thinner is a scratch-out. */
const FILL_MIN_SIDE_PX = 24;
/** A non-patterned scribble at least this dense is a fill; sparser is unknown. */
const FILL_MIN_DENSITY = 0.5;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pathLength(pts: Point[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len;
}

function boundsOf(points: Point[]): GestureBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Resample a polyline at a fixed arc-length spacing (keeps both endpoints). */
function resample(pts: Point[], step: number): Point[] {
  const out: Point[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let seg = dist(a, b);
    while (carry + seg >= step) {
      const t = (step - carry) / seg;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      out.push(p);
      a = p;
      seg = dist(a, b);
      carry = 0;
    }
    carry += seg;
  }
  const last = pts[pts.length - 1];
  if (dist(out[out.length - 1], last) > 0) out.push(last);
  return out;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return dist(p, { x: a.x + dx * t, y: a.y + dy * t });
}

/** Ramer–Douglas–Peucker simplification. */
function simplify(pts: Point[], eps: number): Point[] {
  if (pts.length <= 2) return pts.slice();
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  const left = simplify(pts.slice(0, idx + 1), eps);
  const right = simplify(pts.slice(idx), eps);
  return [...left.slice(0, -1), ...right];
}

/** Direction of a→b in degrees, [0, 360). */
function heading(a: Point, b: Point): number {
  const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Absolute turn between two directions, [0, 180]. */
function turn(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2) % 360;
  return d > 180 ? 360 - d : d;
}

/** Angle between two undirected lines, [0, 90]. */
function lineAngle(h1: number, h2: number): number {
  const t = turn(h1, h2);
  return t > 90 ? 180 - t : t;
}

/** Segment intersection as parameters along each segment, or null. */
function intersect(a1: Point, a2: Point, b1: Point, b2: Point): { t: number; u: number; p: Point } | null {
  const rx = a2.x - a1.x;
  const ry = a2.y - a1.y;
  const sx = b2.x - b1.x;
  const sy = b2.y - b1.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qx = b1.x - a1.x;
  const qy = b1.y - a1.y;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, p: { x: a1.x + rx * t, y: a1.y + ry * t } };
}

/** A chain of near-collinear simplified segments within one stroke. */
interface Run {
  stroke: number;
  a: Point;
  b: Point;
  /** Arc length along the simplified path. */
  len: number;
  /** Direction a→b in degrees. */
  dir: number;
}

function runsOf(simplified: Point[], stroke: number): Run[] {
  const runs: Run[] = [];
  for (let i = 1; i < simplified.length; i++) {
    const a = simplified[i - 1];
    const b = simplified[i];
    const len = dist(a, b);
    if (len === 0) continue;
    const dir = heading(a, b);
    const prev = runs[runs.length - 1];
    if (prev && turn(prev.dir, dir) < RUN_MERGE_DEG) {
      prev.b = b;
      prev.len += len;
      prev.dir = heading(prev.a, prev.b);
    } else {
      runs.push({ stroke, a, b, len, dir });
    }
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Recognisers
// ---------------------------------------------------------------------------

function detectCross(strokes: Point[][]): Point | null {
  if (strokes.length !== 2) return null;
  const [s1, s2] = strokes;
  const l1 = pathLength(s1);
  const l2 = pathLength(s2);
  const a1 = s1[0], a2 = s1[s1.length - 1];
  const b1 = s2[0], b2 = s2[s2.length - 1];
  if (dist(a1, a2) / l1 < STRAIGHT_RATIO || dist(b1, b2) / l2 < STRAIGHT_RATIO) return null;
  if (Math.min(l1, l2) / Math.max(l1, l2) < 0.35) return null;
  if (lineAngle(heading(a1, a2), heading(b1, b2)) < CROSS_MIN_DEG) return null;
  const hit = intersect(a1, a2, b1, b2);
  if (!hit) return null;
  const [lo, hi] = CROSS_MID_BAND;
  if (hit.t < lo || hit.t > hi || hit.u < lo || hit.u > hi) return null;
  return hit.p;
}

function detectArrow(runs: Run[], diag: number, inkLength: number): Pick<Gesture, 'kind' | 'from' | 'to' | 'headless'> | null {
  if (runs.length === 0) return null;
  const shaft = runs.reduce((best, r) => (r.len > best.len ? r : best));
  const L = dist(shaft.a, shaft.b);
  if (L < SHAFT_MIN_PX || L < SHAFT_MIN_FRAC * diag || L / shaft.len < 0.85) return null;
  if (inkLength > ARROW_MAX_INK * L) return null;

  const reach = Math.max(14, BARB_REACH_FRAC * L);
  const back = { a: heading(shaft.a, shaft.b), b: heading(shaft.b, shaft.a) };
  const barbs = { a: 0, b: 0 };
  for (const r of runs) {
    if (r === shaft) continue;
    if (r.len > BARB_MAX_FRAC * L) return null;
    // Which shaft end is this piece attached to, and which of its ends is the root?
    const options = [
      { end: 'a' as const, root: r.a, tip: r.b, d: dist(r.a, shaft.a) },
      { end: 'a' as const, root: r.b, tip: r.a, d: dist(r.b, shaft.a) },
      { end: 'b' as const, root: r.a, tip: r.b, d: dist(r.a, shaft.b) },
      { end: 'b' as const, root: r.b, tip: r.a, d: dist(r.b, shaft.b) },
    ];
    const at = options.reduce((best, o) => (o.d < best.d ? o : best));
    if (at.d > reach) return null; // ink away from both ends: not an arrow
    const angle = lineAngle(r.dir, shaft.dir);
    if (angle < BARB_MIN_DEG) continue; // a retrace along the shaft: neutral
    // A barb points BACK along the shaft from the tip (an L or T does not).
    const backDir = at.end === 'b' ? back.b : back.a;
    if (turn(heading(at.root, at.tip), backDir) >= 90) return null;
    barbs[at.end] += r.len;
  }
  const minBarb = Math.max(6, 0.08 * L);
  const headA = barbs.a >= minBarb;
  const headB = barbs.b >= minBarb;
  if (headA && headB) return { kind: 'double-arrow', from: shaft.a, to: shaft.b };
  if (headA) return { kind: 'arrow', from: shaft.b, to: shaft.a };
  if (headB) return { kind: 'arrow', from: shaft.a, to: shaft.b };
  return { kind: 'arrow', from: shaft.a, to: shaft.b, headless: true };
}

function detectHatchOrFill(runs: Run[], strokeCount: number, inkLength: number, bounds: GestureBox, diag: number): GestureKind {
  const area = Math.max(bounds.w, 8) * Math.max(bounds.h, 8);
  const density = (inkLength * INK_REACH_PX) / area;

  const passes = runs.filter((r) => r.len >= Math.max(10, 0.2 * diag));
  let reversals = 0;
  for (let i = 1; i < runs.length; i++) {
    if (runs[i].stroke === runs[i - 1].stroke && turn(runs[i - 1].dir, runs[i].dir) > REVERSAL_DEG) reversals++;
  }
  const total = passes.reduce((s, r) => s + r.len, 0);
  let parallelShare = 0;
  for (const p of passes) {
    const share = passes
      .filter((q) => lineAngle(p.dir, q.dir) <= PARALLEL_DEG)
      .reduce((s, q) => s + q.len, 0) / (total || 1);
    parallelShare = Math.max(parallelShare, share);
  }
  const zigzag = passes.length >= 4 && reversals >= 3;
  const parallel = passes.length >= 3 && strokeCount >= 3 && parallelShare >= PARALLEL_SHARE;
  const coversArea = Math.min(bounds.w, bounds.h) >= FILL_MIN_SIDE_PX;
  if (zigzag || parallel) return density >= FILL_DENSITY && coversArea ? 'fill' : 'hatch';
  return density >= FILL_MIN_DENSITY ? 'fill' : 'unknown';
}

/**
 * Classify the strokes of one scribble annotation. Deterministic: the same
 * strokes always give the same gesture.
 */
export function classifyGesture(rawStrokes: Point[][]): Gesture {
  const strokes = rawStrokes.filter((s) => s.length >= 2 && pathLength(s) >= MIN_STROKE_PX);
  const all = (strokes.length > 0 ? strokes : rawStrokes).flat();
  const bounds = all.length > 0 ? boundsOf(all) : { x: 0, y: 0, w: 0, h: 0 };
  const diag = Math.hypot(bounds.w, bounds.h);
  if (strokes.length === 0 || diag < MIN_GESTURE_PX) return { kind: 'unknown', bounds };

  const step = Math.max(2, diag / 64);
  const sampled = strokes.map((s) => resample(s, step));

  const center = detectCross(sampled);
  if (center) return { kind: 'cross', bounds, center };

  const eps = Math.max(2.5, SIMPLIFY_FRAC * diag);
  const runs = sampled.flatMap((s, i) => runsOf(simplify(s, eps), i));
  const inkLength = sampled.reduce((s, pts) => s + pathLength(pts), 0);

  const arrow = detectArrow(runs, diag, inkLength);
  if (arrow) return { ...arrow, bounds };

  return { kind: detectHatchOrFill(runs, strokes.length, inkLength, bounds, diag), bounds };
}

/** Max gap (px) between a new stroke and a scribble for the stroke to join it. */
const JOIN_GAP_PX = 32;

/**
 * Whether a freshly drawn stroke belongs to an existing scribble (so an X's
 * second stroke or an arrow's barbs merge into one gesture) rather than
 * starting a new annotation elsewhere on the canvas.
 */
export function strokeJoinsScribble(existing: Point[][], stroke: Point[]): boolean {
  const pts = existing.flat();
  if (pts.length === 0 || stroke.length === 0) return false;
  const a = boundsOf(pts);
  const b = boundsOf(stroke);
  const dx = Math.max(a.x - (b.x + b.w), 0, b.x - (a.x + a.w));
  const dy = Math.max(a.y - (b.y + b.h), 0, b.y - (a.y + a.h));
  return Math.hypot(dx, dy) <= JOIN_GAP_PX;
}
