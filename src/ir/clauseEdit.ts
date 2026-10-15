/**
 * Deterministic handling of free-text clause edits.
 *
 * When the user rewrites a clause and the new text differs from the old one
 * ONLY inside parameter tokens ("A calendar icon" → "A notification icon",
 * "… are green, …" → "… are teal, …", "title on the left" → "on the right"),
 * the clause→node binding is already known, so the change can be applied to
 * the IR directly — no LLM round-trip. Anything structural returns null and
 * goes through the LLM (Call A) as before.
 */
import type { IR, IRNode, ParamSpan, PromptClause } from './types';
import { COLOR_NAMES } from './colors';
import { resolveIconName } from './icons';
import { GOOGLE_FONTS } from '@/lib/fonts';
import { lexParams, type LexContext } from './paramLexer';
import { currentSide } from './bindings';

const WEIGHTS: Record<string, number> = {
  thin: 100, extralight: 200, light: 300, regular: 400, normal: 400, medium: 500,
  semibold: 600, bold: 700, extrabold: 800, heavy: 800, black: 900,
};
const SHAPES = new Set(['round', 'circular', 'rounded', 'rectangular', 'square']);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Parse the replacement text typed for a token into that token's widget value, or null. */
export function parseParamValue(span: ParamSpan, typed: string): string | null {
  const t = typed.trim();
  const lc = t.toLowerCase();
  if (!t) return null;
  switch (span.kind) {
    case 'color': {
      if (/^#[0-9a-f]{3,8}$/i.test(t) || /^rgba?\(/i.test(t)) return t;
      const base = lc.split(/\s+/).pop() ?? lc;
      return COLOR_NAMES[lc] ?? COLOR_NAMES[base] ?? null;
    }
    case 'icon':
      return resolveIconName(t);
    case 'position': {
      const m = lc.match(/^(left|right|top|bottom|center|centre|middle)$/);
      return m ? (m[1] === 'centre' || m[1] === 'middle' ? 'center' : m[1]) : null;
    }
    case 'align': {
      const m = lc.match(/^(left|right|center|centre)/);
      return m ? (m[1] === 'centre' ? 'center' : m[1]) : null;
    }
    case 'fontWeight':
      return WEIGHTS[lc] !== undefined ? String(WEIGHTS[lc]) : /^\d{3}$/.test(lc) ? lc : null;
    case 'length':
    case 'radius': {
      const m = lc.match(/^(\d+(?:\.\d+)?)\s*(px|rem|pt)?$/);
      return m ? m[1] : null;
    }
    case 'shape':
      return SHAPES.has(lc) ? lc : null;
    case 'fontFamily': {
      const f = GOOGLE_FONTS.find((g) => g.family.toLowerCase() === lc);
      return f ? f.family : null;
    }
    default:
      return null;
  }
}

export interface ParamChange {
  span: ParamSpan;
  value: string;
  /** The token's new offsets in the edited text. */
  start: number;
  end: number;
}

/**
 * Align the edited text with the old one around the parameter tokens. Returns
 * the per-token changes (possibly empty, with `ok`) when everything outside
 * the tokens is unchanged and every changed token parses to a value its
 * binding can write; otherwise null.
 */
export function diffParamEdit(
  oldText: string,
  newText: string,
  spans: ParamSpan[],
): { changes: ParamChange[]; offsets: Map<string, [number, number]> } | null {
  const strip = (s: string) => s.replace(/[.\s]+$/, '');
  const a = strip(oldText);
  const b = strip(newText);
  const ordered = [...spans].filter((s) => s.end <= a.length).sort((x, y) => x.start - y.start);
  if (ordered.length === 0) return null;
  let pattern = '^';
  let i = 0;
  for (const sp of ordered) {
    if (sp.start < i) return null; // overlapping spans — cannot align
    pattern += escapeRegex(a.slice(i, sp.start)) + '(.+?)';
    i = sp.end;
  }
  pattern += escapeRegex(a.slice(i)) + '$';
  const m = b.match(new RegExp(pattern, 's'));
  if (!m) return null;

  const changes: ParamChange[] = [];
  const offsets = new Map<string, [number, number]>();
  let pos = 0;
  let prevEnd = 0;
  for (let k = 0; k < ordered.length; k++) {
    const sp = ordered[k];
    pos += sp.start - prevEnd; // literal text before the token is unchanged
    const typed = m[k + 1];
    const start = pos;
    const end = pos + typed.length;
    offsets.set(sp.id, [start, end]);
    pos = end;
    prevEnd = sp.end;
    if (typed === a.slice(sp.start, sp.end)) continue;
    const value = parseParamValue(sp, typed);
    const writable = sp.nodeIds.length > 0;
    if (value === null || !writable) return null;
    changes.push({ span: sp, value, start, end });
  }
  return { changes, offsets };
}

/**
 * Make icon nodes agree with the icon nouns of the given clauses ("a calendar
 * icon" → the clause's icon node draws Calendar). Used after free-text edits
 * and LLM patches, so an icon edit never leaves an empty or stale glyph. Only
 * nouns the icon vocabulary knows are applied (unknown words are left to the
 * renderer's fallback). Returns the same IR object when nothing changed.
 */
export function syncIconsToClauses(ir: IR, clauses: PromptClause[], ctx: LexContext = {}): IR {
  let next = ir;
  for (const clause of clauses) {
    const owned = next.nodes.filter((n) => n.provenance.promptClauseId === clause.id);
    if (owned.length === 0) continue;
    const spans = lexParams(clause, owned, { ...ctx, nodes: next.nodes }).filter((s) => s.kind === 'icon');
    for (const sp of spans) {
      if (!resolveIconName(clause.text.slice(sp.start, sp.end))) continue;
      // Several different icons and none shows this one: ambiguous, leave them.
      const current = new Set(sp.nodeIds.map((id) => resolveIconName(next.nodes.find((n) => n.id === id)?.content)));
      if (sp.nodeIds.length > 1 && current.size > 1 && !current.has(sp.value)) continue;
      for (const id of sp.nodeIds) {
        const node = next.nodes.find((n) => n.id === id);
        if (!node || resolveIconName(node.content) === sp.value) continue;
        next = { ...next, nodes: next.nodes.map((n): IRNode => (n.id === id ? { ...n, content: sp.value } : n)) };
      }
    }
  }
  return next;
}

/**
 * After a position change, rewrite the side words of the clause's OTHER
 * position phrases that the move made false ("title on the right, actions on
 * the right" → "… actions on the left" once the title took the right edge).
 */
export function reconcilePositionProse(clause: PromptClause, ir: IR, ctx: LexContext = {}): string {
  const owned = ir.nodes.filter((n) => n.provenance.promptClauseId === clause.id);
  const spans = lexParams(clause, owned, { ...ctx, nodes: ir.nodes })
    .filter((s) => s.kind === 'position' && s.nodeIds.length === 1)
    .sort((x, y) => y.start - x.start);
  let text = clause.text;
  for (const sp of spans) {
    const actual = currentSide(ir, sp.nodeIds[0]);
    if (!actual || actual === sp.value || !(sp.options ?? []).includes(actual)) continue;
    text = text.slice(0, sp.start) + actual + text.slice(sp.end);
  }
  return text;
}
