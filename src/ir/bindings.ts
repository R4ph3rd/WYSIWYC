/**
 * Clause → node binding resolution for parameter pins.
 *
 * A clause "owns" a set of nodes (provenance). A parameter token inside the
 * clause must NOT simply bind to all of them: "Positive changes are green,
 * negative ones red" owns every change label, but "green" controls only the
 * positive ones. This module narrows each token to the subset of dependent
 * nodes it actually refers to, using
 *   1. the node's CURRENT value for the token's field (a node that is green
 *      now belongs to "green", not to "red"),
 *   2. the token's QUALIFIER sub-phrase ("positive changes" ↔ ▲ / +,
 *      "negative ones" ↔ ▼ / −, plus content-word overlap),
 * and resolves the structured parts a clause can name beyond a flat style
 * field: gradient stops (from / via / to), positions of a subject inside its
 * layout container ("page title on the left"), and icons ("a calendar icon").
 *
 * Pure: no React, no store. The writers (`writeGradientStop`,
 * `writePosition`) return a new IR.
 */
import type { IR, IRNode } from './types';
import { colorSimilarity, twColorHex } from './colors';
import { classList, colorUtilityValue, setUtility } from './tailwindEdit';
import { resolveIconName } from './icons';

// --- Node index ---------------------------------------------------------------

export interface NodeIndex {
  byId: Map<string, IRNode>;
  /** Children per parent id, sorted by `order`. */
  children: Map<string | null, IRNode[]>;
}

const indexCache = new WeakMap<readonly IRNode[], NodeIndex>();

export function indexNodes(nodes: readonly IRNode[]): NodeIndex {
  const hit = indexCache.get(nodes);
  if (hit) return hit;
  const byId = new Map<string, IRNode>();
  const children = new Map<string | null, IRNode[]>();
  for (const n of nodes) {
    byId.set(n.id, n);
    const list = children.get(n.parentId) ?? [];
    list.push(n);
    children.set(n.parentId, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order);
  const idx = { byId, children };
  indexCache.set(nodes, idx);
  return idx;
}

/** Owned nodes plus all their descendants (deduped, owned first). */
export function scopeOf(owned: IRNode[], idx: NodeIndex): IRNode[] {
  const seen = new Set<string>();
  const out: IRNode[] = [];
  const visit = (n: IRNode) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    out.push(n);
    for (const c of idx.children.get(n.id) ?? []) visit(c);
  };
  for (const n of owned) visit(n);
  return out;
}

// --- Current values -----------------------------------------------------------

function isGradientFill(fill: string | undefined): boolean {
  return !!fill && /gradient\(/i.test(fill);
}

/** True when the node paints a gradient (Tailwind bg-gradient-* or an inline CSS gradient). */
export function hasGradient(node: IRNode): boolean {
  if (isGradientFill(node.style?.fill)) return true;
  const cls = classList(node.tailwind);
  return cls.some((u) => /^bg-(?:gradient|linear|radial|conic)-/.test(u)) ||
    (colorUtilityValue(node.tailwind, 'from-') !== null && colorUtilityValue(node.tailwind, 'to-') !== null);
}

/** The colour a node currently shows for a param path (hex), if determinable. */
export function currentColor(node: IRNode, path: string): string | null {
  const s = node.style ?? {};
  const tw = (family: string) => {
    const v = colorUtilityValue(node.tailwind, family);
    return v ? twColorHex(v) : null;
  };
  switch (path) {
    case 'style.fontColor':
      return s.fontColor ?? tw('text-');
    case 'style.stroke':
      return s.stroke ?? tw('border-');
    case 'style.fill':
      if (s.fill && !isGradientFill(s.fill)) return s.fill;
      return tw('bg-') ?? gradientStops(node).from ?? null;
    default:
      if (path.startsWith('tailwind:')) return tw(path.slice('tailwind:'.length));
      if (path.startsWith('gradient:')) return gradientStops(node)[path.slice('gradient:'.length) as GradientStop] ?? null;
      return null;
  }
}

// --- Qualifiers -----------------------------------------------------------------

const POSITIVE_RE = /\b(?:positive|up|upward|increas\w*|gain\w*|growth|growing|ris(?:e|es|ing)|good|success\w*|profit\w*|higher|improv\w*)\b/i;
const NEGATIVE_RE = /\b(?:negative|down|downward|decreas\w*|loss(?:es)?|declin\w*|drop\w*|fall(?:s|ing)?|bad|fail\w*|lower|worse\w*)\b/i;
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'are', 'is', 'be', 'in', 'on', 'of', 'to', 'with', 'ones', 'one', 'each',
  'every', 'all', 'its', 'their', 'that', 'this', 'these', 'those', 'while', 'whereas', 'but', 'use', 'uses',
  'shown', 'show', 'shows', 'colored', 'coloured', 'color', 'colour', 'text', 'items', 'item',
]);

/** The sub-phrase of `text` containing [start, end) — delimited by , ; : and/while/but/whereas. */
export function segmentAround(text: string, start: number, end: number): string {
  const DELIM = /[,;:()]|\b(?:and|while|whereas|but)\b/gi;
  let segStart = 0;
  let segEnd = text.length;
  for (const m of text.matchAll(DELIM)) {
    const i = m.index ?? 0;
    if (i + m[0].length <= start) segStart = i + m[0].length;
    else if (i >= end) { segEnd = i; break; }
  }
  return text.slice(segStart, start) + ' ' + text.slice(end, segEnd);
}

function polarity(s: string): number {
  const pos = POSITIVE_RE.test(s);
  const neg = NEGATIVE_RE.test(s);
  return pos === neg ? 0 : pos ? 1 : -1;
}

function nodePolarity(node: IRNode): number {
  const c = node.content ?? '';
  if (/[▲↑⬆△⇧]|(?:^|\s)\+\s?\d/.test(c)) return 1;
  if (/[▼↓⬇▽⇩]|(?:^|\s)[-−–]\s?\d/.test(c)) return -1;
  return polarity(c);
}

function contentWords(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/** How well a node matches a token's qualifier phrase: +1 agrees, −1 contradicts, 0 neutral. */
export function qualifierScore(segment: string, node: IRNode): number {
  let score = 0;
  const segPol = polarity(segment);
  const np = nodePolarity(node);
  if (segPol !== 0 && np !== 0) score += segPol === np ? 1 : -1;
  const content = (node.content ?? '').toLowerCase();
  if (content) {
    for (const w of contentWords(segment)) if (content.includes(w)) score += 0.25;
  }
  return score;
}

// --- Colour narrowing -------------------------------------------------------------

export interface ColorToken {
  start: number;
  end: number;
  /** The token's colour as hex. */
  value: string;
  path: string;
  nodeIds: string[];
}

/**
 * Narrow each colour token to the nodes it refers to. Tokens sharing a field
 * (path) compete for the union of their candidate nodes: each node goes to the
 * token(s) whose colour it currently carries (2×similarity) plus the qualifier
 * agreement of the token's sub-phrase. Ties keep the node on every tied token,
 * so a clause that cannot be discriminated degrades to the old broad binding.
 * A lone token only drops nodes its qualifier contradicts.
 */
/** Similarity above which a node counts as currently carrying a token's colour. */
const CARRY_THRESHOLD = 0.7;

export function narrowColorTokens(text: string, tokens: ColorToken[], idx: NodeIndex): void {
  const byPath = new Map<string, ColorToken[]>();
  for (const t of tokens) byPath.set(t.path, [...(byPath.get(t.path) ?? []), t]);

  for (const group of byPath.values()) {
    const segs = group.map((t) => segmentAround(text, t.start, t.end));
    if (group.length === 1) {
      const t = group[0];
      let nodes = t.nodeIds.map((id) => idx.byId.get(id)).filter((n): n is IRNode => !!n);
      const q = nodes.map((n) => qualifierScore(segs[0], n));
      if (q.some((x) => x > 0) && q.some((x) => x < 0)) nodes = nodes.filter((_, i) => q[i] >= 0);
      // Prefer the nodes that currently carry (roughly) this colour.
      const carrying = nodes.filter((n) => {
        const cur = currentColor(n, t.path);
        return cur !== null && colorSimilarity(cur, t.value) >= CARRY_THRESHOLD;
      });
      t.nodeIds = (carrying.length ? carrying : nodes).map((n) => n.id);
      continue;
    }
    const union: string[] = [];
    for (const t of group) for (const id of t.nodeIds) if (!union.includes(id)) union.push(id);
    const assigned = group.map(() => [] as string[]);
    for (const id of union) {
      const node = idx.byId.get(id);
      if (!node) continue;
      const scores = group.map((t, i) => {
        if (!t.nodeIds.includes(id)) return -Infinity;
        const cur = currentColor(node, t.path);
        return 2 * (cur ? colorSimilarity(cur, t.value) : 0) + qualifierScore(segs[i], node);
      });
      const best = Math.max(...scores);
      if (best === -Infinity) continue;
      scores.forEach((s, i) => { if (s >= best - 0.03) assigned[i].push(id); });
    }
    group.forEach((t, i) => {
      // Colourless nodes tie onto every token; drop them where the token found
      // nodes that actually carry a colour.
      const coloured = assigned[i].filter((id) => {
        const n = idx.byId.get(id);
        return !!n && currentColor(n, t.path) !== null;
      });
      t.nodeIds = coloured.length ? coloured : assigned[i];
    });
  }
}

// --- Gradients -------------------------------------------------------------------

export type GradientStop = 'from' | 'via' | 'to';

/** Split on top-level commas (ignoring commas inside parentheses). */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

interface CssGradient { prefix: string; direction: string | null; stops: string[]; suffix: string }

function parseCssGradient(fill: string): CssGradient | null {
  const m = fill.match(/^(.*?(?:linear|radial|conic)-gradient\()(.*)(\).*)$/is);
  if (!m) return null;
  const parts = splitTopLevel(m[2]);
  const isDirection = (p: string) => /^(?:to\s|from\s|at\s|circle|ellipse|-?[\d.]+(?:deg|turn|rad|grad)\b)/i.test(p);
  const direction = parts.length && isDirection(parts[0]) ? parts[0] : null;
  return { prefix: m[1], direction, stops: direction ? parts.slice(1) : parts, suffix: m[3] };
}

function stopColor(stop: string): string {
  const m = stop.match(/^((?:rgba?|hsla?)\([^)]*\)|\S+)/i);
  return m ? m[1] : stop;
}

/** Current gradient stop colours (hex) of a node. */
export function gradientStops(node: IRNode): Partial<Record<GradientStop, string>> {
  const fill = node.style?.fill;
  if (isGradientFill(fill)) {
    const g = parseCssGradient(fill!);
    if (!g || g.stops.length === 0) return {};
    const first = stopColor(g.stops[0]);
    const last = stopColor(g.stops[g.stops.length - 1]);
    const out: Partial<Record<GradientStop, string>> = { from: first, to: last };
    if (g.stops.length >= 3) out.via = stopColor(g.stops[Math.floor(g.stops.length / 2)]);
    return out;
  }
  const out: Partial<Record<GradientStop, string>> = {};
  for (const stop of ['from', 'via', 'to'] as GradientStop[]) {
    const v = colorUtilityValue(node.tailwind, `${stop}-`);
    const hex = v ? twColorHex(v) : null;
    if (hex) out[stop] = hex;
  }
  return out;
}

// Words allowed between a colour token and the word "gradient" for the colour
// to count as one of the gradient's stops ("a soft indigo-to-violet gradient",
// "gradient from sky to indigo").
const GRADIENT_GLUE = /^(?:[\s,\-–—→>/&]|\b(?:to|from|via|into|through|and|then|soft|subtle|smooth|gentle|faint|light|dark|deep|vivid|bold|bright|warm|cool|pale|muted|rich|linear|radial|diagonal|vertical|horizontal|a|an|the|of|in|colou?red|tones?|shades?)\b)*$/i;

/**
 * Which colour tokens of a clause name gradient stops, and which stop each
 * names. Explicit wording wins ("from X", "to X"/"X-to-Y", "via X"); otherwise
 * stops are positional (first → from, last → to, middle → via). A lone stop
 * colour returns 'auto' (resolved later to the nearest current stop).
 */
export function gradientStopRoles(
  text: string,
  tokens: { start: number; end: number }[],
): Map<number, GradientStop | 'auto'> {
  const roles = new Map<number, GradientStop | 'auto'>();
  const gradWords = [...text.matchAll(/\bgradients?\b/gi)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  if (gradWords.length === 0) return roles;
  const blank = (s: number, e: number) => {
    // The text between two offsets with any colour tokens blanked out.
    let out = text.slice(s, e);
    for (const t of tokens) {
      if (t.start >= s && t.end <= e) {
        const a = t.start - s;
        out = out.slice(0, a) + ' '.repeat(t.end - t.start) + out.slice(a + t.end - t.start);
      }
    }
    return out;
  };
  const connected = tokens
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => gradWords.some((g) => (t.end <= g.start ? GRADIENT_GLUE.test(blank(t.end, g.start)) : GRADIENT_GLUE.test(blank(g.end, t.start)))));
  if (connected.length === 0) return roles;

  const taken = new Set<GradientStop>();
  for (const { t, i } of connected) {
    const before = text.slice(Math.max(0, t.start - 10), t.start).toLowerCase();
    let role: GradientStop | null = null;
    if (/\bfrom\s+$/.test(before)) role = 'from';
    else if (/(?:\bto|\binto|-to-|→|->)\s*$/.test(before)) role = 'to';
    else if (/\b(?:via|through)\s+$/.test(before)) role = 'via';
    if (role && !taken.has(role)) { roles.set(i, role); taken.add(role); }
  }
  const rest = connected.filter(({ i }) => !roles.has(i));
  if (connected.length === 1 && rest.length === 1) {
    roles.set(rest[0].i, 'auto');
    return roles;
  }
  rest.forEach(({ i }, k) => {
    const order: GradientStop[] = k === 0 ? ['from', 'to', 'via'] : k === rest.length - 1 ? ['to', 'via', 'from'] : ['via', 'from', 'to'];
    const role = order.find((r) => !taken.has(r)) ?? 'via';
    roles.set(i, role);
    taken.add(role);
  });
  return roles;
}

/** Nearest existing stop of the node to a colour (for a lone gradient colour word). */
export function nearestStop(node: IRNode, hex: string): GradientStop {
  const stops = gradientStops(node);
  let best: GradientStop = 'from';
  let bestSim = -1;
  for (const stop of ['from', 'via', 'to'] as GradientStop[]) {
    const cur = stops[stop];
    if (!cur) continue;
    const sim = colorSimilarity(cur, hex);
    if (sim > bestSim) { bestSim = sim; best = stop; }
  }
  return best;
}

function twColorValue(value: string): string {
  if (/^#|^rgb/i.test(value)) return `[${value.replace(/\s+/g, '')}]`;
  return value;
}

/**
 * Set ONE gradient stop of a node, keeping the gradient. Inline CSS gradients
 * get the stop colour replaced in place (via inserted when absent); Tailwind
 * gradients get their from-/via-/to- utility swapped. A solid inline fill that
 * was masking a Tailwind gradient is dropped so the gradient shows again.
 */
export function writeGradientStop(ir: IR, nodeId: string, stop: GradientStop, value: string): IR {
  return {
    ...ir,
    nodes: ir.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const fill = n.style?.fill;
      if (isGradientFill(fill)) {
        const g = parseCssGradient(fill!);
        if (g) {
          const stops = [...g.stops];
          const replace = (i: number) => {
            const col = stopColor(stops[i]);
            stops[i] = value + stops[i].slice(col.length);
          };
          if (stop === 'from') replace(0);
          else if (stop === 'to') replace(stops.length - 1);
          else if (stops.length >= 3) replace(Math.floor(stops.length / 2));
          else stops.splice(1, 0, value);
          const args = [...(g.direction ? [g.direction] : []), ...stops].join(', ');
          return { ...n, style: { ...n.style, fill: `${g.prefix}${args}${g.suffix}` } };
        }
      }
      let tw = n.tailwind;
      if (!classList(tw).some((u) => /^bg-(?:gradient|linear|radial|conic)-/.test(u))) tw = `${tw} bg-gradient-to-r`.trim();
      tw = setUtility(tw, `${stop}-${twColorValue(value)}`);
      const next: IRNode = { ...n, tailwind: tw };
      if (n.style?.fill !== undefined) {
        const style = { ...n.style };
        delete style.fill;
        next.style = style;
      }
      return next;
    }),
  };
}

// --- Positions ---------------------------------------------------------------------

export type Side = 'left' | 'center' | 'right' | 'top' | 'bottom';

export const POSITION_RE =
  /\b(?:on|to|at|in|along|towards?)\s+(?:the\s+)?(?:far\s+|very\s+)?(left|right|top|bottom|center|centre|middle)(?:[\s-]+(?:hand\s+)?(?:side|edge|corner))?\b/gi;

export function normalizeSide(word: string): Side {
  const w = word.toLowerCase();
  if (w.startsWith('left')) return 'left';
  if (w.startsWith('right')) return 'right';
  if (w.startsWith('top')) return 'top';
  if (w.startsWith('bottom')) return 'bottom';
  return 'center';
}

/** Does the container stack its children vertically? */
export function isVertical(container: IRNode): boolean {
  const cls = classList(container.tailwind);
  return cls.includes('flex-col') || cls.includes('flex-col-reverse');
}

function isReversed(container: IRNode): boolean {
  const cls = classList(container.tailwind);
  return cls.includes('flex-row-reverse') || cls.includes('flex-col-reverse');
}

/** The subject phrase that a position word describes: "page title" in "A top bar: page title on the left". */
export function positionSubject(text: string, prepStart: number): string {
  const head = text.slice(0, prepStart);
  const DELIM = /[:;,()]|\b(?:and|while|whereas|but|with|plus)\b/gi;
  let from = 0;
  for (const m of head.matchAll(DELIM)) from = (m.index ?? 0) + m[0].length;
  return head.slice(from).replace(/^\s*(?:the|a|an|its|their)\s+/i, '').trim();
}

const ROLE_WORDS: Partial<Record<IRNode['role'], string[]>> = {
  heading: ['title', 'heading', 'headline', 'name', 'brand', 'wordmark', 'header'],
  text: ['text', 'label', 'caption', 'copy', 'name', 'subtitle', 'description', 'link'],
  button: ['button', 'action', 'cta', 'control', 'primary'],
  input: ['search', 'field', 'input', 'box', 'searchbar'],
  icon: ['icon', 'glyph', 'action', 'notification', 'bell'],
  image: ['image', 'avatar', 'logo', 'photo', 'picture', 'mark', 'thumbnail'],
  badge: ['badge', 'pill', 'tag', 'chip'],
  container: ['group', 'section', 'row', 'panel', 'card'],
};

function singular(w: string): string {
  if (w.length > 3 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function wordsFor(node: IRNode, clauseText?: (id: string) => string | undefined): Set<string> {
  const words = new Set<string>([node.role, ...(ROLE_WORDS[node.role] ?? [])]);
  for (const w of contentWords(node.content ?? '')) words.add(singular(w));
  const ct = node.provenance.promptClauseId ? clauseText?.(node.provenance.promptClauseId) : undefined;
  if (ct) for (const w of contentWords(ct)) words.add(singular(w));
  return words;
}

/** How well a child (and, at half weight, its subtree) matches a subject phrase. */
function subjectScore(
  subject: string,
  child: IRNode,
  idx: NodeIndex,
  clauseText?: (id: string) => string | undefined,
): number {
  const subj = contentWords(subject).map(singular);
  if (subj.length === 0) return 0;
  const direct = wordsFor(child, clauseText);
  const deep = new Set<string>();
  const visit = (n: IRNode) => {
    for (const c of idx.children.get(n.id) ?? []) {
      for (const w of wordsFor(c, clauseText)) deep.add(w);
      visit(c);
    }
  };
  visit(child);
  let score = 0;
  for (const w of subj) {
    if (direct.has(w)) score += 1;
    else if (deep.has(w)) score += 0.5;
  }
  return score;
}

export interface PositionBinding {
  containerId: string;
  childId: string;
  side: Side;
}

/**
 * Bind every position phrase of a clause ("<subject> on the <side>") to a
 * (layout container, child) pair. Candidate containers are the clause's owned
 * nodes and their parents that hold ≥2 children; the container whose children
 * best explain ALL subjects of the clause wins (so "page title … actions"
 * picks the top bar, not the actions group that merely contains a button).
 */
export function resolvePositions(
  text: string,
  phrases: { prepStart: number; word: string }[],
  owned: IRNode[],
  idx: NodeIndex,
  clauseText?: (id: string) => string | undefined,
): (PositionBinding | null)[] {
  if (phrases.length === 0) return [];
  const candidates: IRNode[] = [];
  const add = (n: IRNode | undefined) => {
    if (n && !candidates.includes(n) && (idx.children.get(n.id)?.length ?? 0) >= 2) candidates.push(n);
  };
  for (const n of owned) add(n);
  for (const n of owned) add(n.parentId ? idx.byId.get(n.parentId) : undefined);

  const ownedIds = new Set(owned.map((n) => n.id));
  const subjects = phrases.map((p) => positionSubject(text, p.prepStart));
  let best: { total: number; picks: (string | null)[]; container: IRNode } | null = null;
  for (const c of candidates) {
    const kids = idx.children.get(c.id) ?? [];
    const used = new Set<string>();
    let total = 0;
    const picks = subjects.map((subj) => {
      let pick: IRNode | null = null;
      let pickScore = 0;
      for (const k of kids) {
        if (used.has(k.id)) continue;
        // A child the clause itself owns, inside a container it does not own,
        // is the clause's own subject placed in the surrounding layout
        // ('Product name "Northwind" on the left' → the brand group in the bar).
        // Strong for a single-subject clause, a weak hint otherwise.
        const selfBonus = ownedIds.has(k.id) && !ownedIds.has(c.id) ? (subjects.length === 1 ? 1.2 : 0.4) : 0;
        const s = subjectScore(subj, k, idx, clauseText) + selfBonus;
        if (s > pickScore) { pick = k; pickScore = s; }
      }
      if (pick) used.add(pick.id);
      total += pickScore;
      return pick ? (pick as IRNode).id : null;
    });
    if (total > 0 && (!best || total > best.total + 1e-6 || (Math.abs(total - best.total) < 1e-6 && ownedIds.has(c.id) && !ownedIds.has(best.container.id)))) {
      best = { total, picks, container: c };
    }
  }
  if (!best) return phrases.map(() => null);
  const b = best;
  return phrases.map((p, i) => (b.picks[i] ? { containerId: b.container.id, childId: b.picks[i]!, side: normalizeSide(p.word) } : null));
}

/** Where a child currently sits inside its container (left/center/right or top/center/bottom). */
export function currentSide(ir: IR | { nodes: readonly IRNode[] }, childId: string): Side | null {
  const idx = indexNodes(ir.nodes);
  const child = idx.byId.get(childId);
  if (!child || !child.parentId) return null;
  const parent = idx.byId.get(child.parentId);
  if (!parent) return null;
  const vertical = isVertical(parent);
  if (child.layout?.x !== undefined && !vertical) {
    const pw = parent.layout?.w;
    const w = child.layout.w ?? 0;
    if (pw) {
      const mid = child.layout.x + w / 2;
      return mid < pw / 3 ? 'left' : mid > (2 * pw) / 3 ? 'right' : 'center';
    }
  }
  const sibs = idx.children.get(parent.id) ?? [];
  let i = sibs.findIndex((s) => s.id === childId);
  if (isReversed(parent)) i = sibs.length - 1 - i;
  const cls = classList(child.tailwind);
  if (cls.includes('mx-auto') || cls.includes('my-auto')) return 'center';
  const start: Side = vertical ? 'top' : 'left';
  const end: Side = vertical ? 'bottom' : 'right';
  if (sibs.length === 1) return start;
  if (i === 0) return start;
  if (i === sibs.length - 1) return end;
  return 'center';
}

const SPREAD = /^justify-(?:between|around|evenly|end)$/;

/**
 * Move a child to a side of its layout container. Flow layouts reorder the
 * siblings (IR order is the source of truth), adding an auto margin when the
 * container does not already spread its items; absolute layouts move x/y.
 */
export function writePosition(ir: IR, childId: string, sideWord: string): IR {
  const side = normalizeSide(sideWord);
  const idx = indexNodes(ir.nodes);
  const child = idx.byId.get(childId);
  if (!child || !child.parentId) return ir;
  const parent = idx.byId.get(child.parentId);
  if (!parent) return ir;
  const vertical = isVertical(parent);

  // Absolute-positioned child: move its box.
  if (child.layout?.x !== undefined || child.layout?.y !== undefined) {
    const pw = parent.layout?.w ?? (parent.parentId === null ? ir.canvas.w : undefined);
    const ph = parent.layout?.h ?? (parent.parentId === null ? ir.canvas.h : undefined);
    const w = child.layout.w ?? 0;
    const h = child.layout.h ?? 0;
    const pad = 16;
    const layout = { ...child.layout };
    if ((side === 'left' || side === 'right' || (side === 'center' && !vertical)) && pw) {
      layout.x = side === 'left' ? pad : side === 'right' ? pw - w - pad : (pw - w) / 2;
    } else if (ph) {
      layout.y = side === 'top' ? pad : side === 'bottom' ? ph - h - pad : (ph - h) / 2;
    }
    return { ...ir, nodes: ir.nodes.map((n) => (n.id === childId ? { ...n, layout } : n)) };
  }

  // Flow layout: reorder siblings.
  const sibs = (idx.children.get(parent.id) ?? []).filter((s) => s.id !== childId);
  const reversed = isReversed(parent);
  const toStart = side === 'left' || side === 'top';
  const toEnd = side === 'right' || side === 'bottom';
  let at = toStart ? 0 : toEnd ? sibs.length : Math.ceil(sibs.length / 2);
  if (reversed && (toStart || toEnd)) at = sibs.length - at;
  sibs.splice(at, 0, child);
  const newOrder = new Map(sibs.map((s, i) => [s.id, i]));

  const spreads = classList(parent.tailwind).some((u) => SPREAD.test(u));
  const autoEnd = vertical ? 'mt-auto' : 'ml-auto';
  const autoStart = vertical ? 'mb-auto' : 'mr-auto';
  const autoCenter = vertical ? 'my-auto' : 'mx-auto';
  const AUTO = new Set(['ml-auto', 'mr-auto', 'mx-auto', 'mt-auto', 'mb-auto', 'my-auto']);
  // Auto margins on the siblings would fight the move; the moved child gets its own below.
  const stripAuto = (tw: string) => classList(tw).filter((u) => !AUTO.has(u)).join(' ');
  return {
    ...ir,
    nodes: ir.nodes.map((n) => {
      const o = newOrder.get(n.id);
      if (o === undefined) return n;
      if (n.id !== childId) {
        const tw = spreads ? n.tailwind : stripAuto(n.tailwind);
        return o === n.order && tw === n.tailwind ? n : { ...n, order: o, tailwind: tw };
      }
      const kept = classList(n.tailwind).filter((u) => !AUTO.has(u));
      if (side === 'center' && sibs.length > 1) kept.push(autoCenter);
      else if (toEnd && !spreads) kept.push(autoEnd);
      else if (toStart && reversed && !spreads) kept.push(autoStart);
      return { ...n, order: o, tailwind: kept.join(' ') };
    }),
  };
}

// --- Icons ------------------------------------------------------------------------

/** Icon-role nodes in a clause's scope that a token naming `iconName` controls. */
export function iconTargets(scope: IRNode[], iconName: string, tokenCount: number): IRNode[] {
  const icons = scope.filter((n) => n.role === 'icon');
  if (icons.length <= 1) return icons;
  const same = icons.filter((n) => resolveIconName(n.content) === iconName);
  if (same.length > 0) return same;
  // Several icons, none showing this one yet: with several icon words in the
  // clause we cannot tell which is meant — bind none rather than all.
  return tokenCount > 1 ? [] : icons;
}

