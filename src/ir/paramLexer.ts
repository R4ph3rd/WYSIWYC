/**
 * Deterministic, no-LLM detection of editable parameter tokens inside a clause's
 * prose, bound best-effort to the IR fields of the nodes the clause owns.
 *
 * This is a FALLBACK / enrichment for clauses the model didn't annotate with
 * `params`. Its reach is limited: it binds a token to owned nodes whose current
 * state plausibly matches the field (a color token → nodes with a fill or a
 * bg-/text- utility; a weight → text-role nodes; …). When nothing matches it
 * still surfaces the widget but binds no nodes (`kind:'text'`, prose-only edit)
 * — honest about the limitation, acceptable for v1. Model-emitted spans (see
 * `paramsForClause`) always win on overlap.
 */
import type { IRNode, ParamKind, ParamSpan, PromptClause } from './types';
import { classList } from './tailwindEdit';
import { GOOGLE_FONTS } from '@/lib/fonts';

/** Tailwind/CSS color family names → a representative hex (widget seed). */
export const COLOR_NAMES: Record<string, string> = {
  slate: '#64748b', gray: '#6b7280', grey: '#6b7280', zinc: '#71717a', neutral: '#737373', stone: '#78716c',
  red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308', lime: '#84cc16',
  green: '#22c55e', emerald: '#10b981', teal: '#14b8a6', cyan: '#06b6d4', sky: '#0ea5e9',
  blue: '#3b82f6', indigo: '#6366f1', violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef',
  pink: '#ec4899', rose: '#f43f5e', black: '#000000', white: '#ffffff',
};

const WEIGHT_WORDS: Record<string, number> = {
  thin: 100, extralight: 200, light: 300, regular: 400, normal: 400, medium: 500,
  semibold: 600, bold: 700, extrabold: 800, heavy: 800, black: 900,
};

const SHADOW_WORDS = ['shadow', 'elevation', 'elevated', 'drop shadow'];
const TEXT_ROLES = new Set<IRNode['role']>(['text', 'heading', 'button', 'badge', 'icon']);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface RawMatch { start: number; end: number; text: string; kind: ParamKind; }

function* scan(text: string, re: RegExp, kind: ParamKind): Generator<RawMatch> {
  for (const m of text.matchAll(re)) {
    if (m.index === undefined) continue;
    yield { start: m.index, end: m.index + m[0].length, text: m[0], kind };
  }
}

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const RGB_RE = /\brgba?\([^)]*\)/gi;
const COLOR_NAME_RE = new RegExp(`\\b(?:${Object.keys(COLOR_NAMES).join('|')})\\b`, 'gi');
const NUMBER_RE = /\b\d+(?:\.\d+)?(?:px|rem|pt)\b/gi;
const WEIGHT_RE = new RegExp(`\\b(?:${Object.keys(WEIGHT_WORDS).join('|')})\\b`, 'gi');
const RADIUS_RE = /\brounded(?:-\w+)?\b/gi;
const ALIGN_RE = /\b(?:left|center|centre|right)(?:-aligned|-align|\s+aligned)?\b/gi;
const SHADOW_RE = new RegExp(`\\b(?:${SHADOW_WORDS.map(escapeRegex).join('|')})\\b`, 'gi');
const FONT_RES = GOOGLE_FONTS.map((f) => new RegExp(`\\b${escapeRegex(f.family)}\\b`, 'gi'));

function nodesWithFill(owned: IRNode[]): IRNode[] {
  const fillRoles = new Set<IRNode['role']>(['rectangle', 'circle', 'container', 'frame', 'badge', 'button', 'input', 'image']);
  return owned.filter(
    (n) => n.style?.fill !== undefined || classList(n.tailwind).some((u) => /^(?:hover:)?bg-/.test(u)) || fillRoles.has(n.role),
  );
}
function textNodes(owned: IRNode[]): IRNode[] {
  return owned.filter((n) => TEXT_ROLES.has(n.role));
}

/** Detect + bind parameter spans for a clause given the nodes it owns. */
export function lexParams(clause: PromptClause, ownedNodes: IRNode[]): ParamSpan[] {
  const text = clause.text;
  const raw: RawMatch[] = [];
  for (const re of FONT_RES) for (const m of scan(text, re, 'fontFamily')) raw.push(m);
  for (const m of scan(text, HEX_RE, 'color')) raw.push(m);
  for (const m of scan(text, RGB_RE, 'color')) raw.push(m);
  for (const m of scan(text, COLOR_NAME_RE, 'color')) raw.push(m);
  for (const m of scan(text, RADIUS_RE, 'radius')) raw.push(m);
  for (const m of scan(text, NUMBER_RE, 'length')) raw.push(m);
  for (const m of scan(text, WEIGHT_RE, 'fontWeight')) raw.push(m);
  for (const m of scan(text, SHADOW_RE, 'shadow')) raw.push(m);
  for (const m of scan(text, ALIGN_RE, 'align')) raw.push(m);

  // Resolve overlaps: earliest first, longest at a tie.
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const picked: RawMatch[] = [];
  let lastEnd = -1;
  for (const m of raw) {
    if (m.start >= lastEnd) { picked.push(m); lastEnd = m.end; }
  }

  const fill = nodesWithFill(ownedNodes);
  const texts = textNodes(ownedNodes);

  return picked.map((m, i): ParamSpan => {
    const base = { id: `lex_${i + 1}`, start: m.start, end: m.end };
    switch (m.kind) {
      case 'color': {
        const targets = fill.length ? fill : texts;
        const path = fill.length ? 'style.fill' : texts.length ? 'style.fontColor' : 'style.fill';
        const lc = m.text.toLowerCase();
        const value = m.text.startsWith('#') || lc.startsWith('rgb') ? m.text : (COLOR_NAMES[lc] ?? '#4f46e5');
        return { ...base, kind: 'color', nodeIds: targets.map((n) => n.id), path, value };
      }
      case 'fontFamily':
        return { ...base, kind: 'fontFamily', nodeIds: texts.map((n) => n.id), path: 'style.fontFamily', value: m.text };
      case 'fontWeight': {
        const num = WEIGHT_WORDS[m.text.toLowerCase()] ?? Number(m.text) ?? 400;
        return { ...base, kind: 'fontWeight', nodeIds: texts.map((n) => n.id), path: 'style.fontWeight', value: String(num) };
      }
      case 'radius':
        return { ...base, kind: 'radius', nodeIds: ownedNodes.map((n) => n.id), path: 'style.borderRadius', value: '', unit: 'px' };
      case 'length':
        return { ...base, kind: 'length', nodeIds: texts.map((n) => n.id), path: 'style.fontSize', value: m.text.replace(/[a-z]+$/i, ''), unit: (m.text.match(/[a-z]+$/i)?.[0] ?? 'px') };
      case 'shadow':
        return { ...base, kind: 'shadow', nodeIds: fill.map((n) => n.id), path: 'style.shadow', value: '' };
      case 'align':
        return { ...base, kind: 'align', nodeIds: texts.map((n) => n.id), path: 'align', value: normalizeAlign(m.text) };
      default:
        return { ...base, kind: 'text', nodeIds: [], path: 'content', value: m.text };
    }
  });
}

function normalizeAlign(text: string): string {
  const t = text.toLowerCase();
  if (t.startsWith('left')) return 'left';
  if (t.startsWith('right')) return 'right';
  return 'center';
}

// --- Merge of model-emitted + lexer spans (lexed on read, memoized) --------

const cache = new WeakMap<PromptClause, { sig: string; spans: ParamSpan[] }>();

/**
 * Merged parameter spans for a clause: model-emitted `clause.params` win on
 * overlap; lexer spans fill the gaps. Memoized per clause object + owned-node
 * signature so re-renders don't re-lex. Does NOT mutate the stored clause.
 */
export function paramsForClause(clause: PromptClause, ownedNodes: IRNode[]): ParamSpan[] {
  const sig =
    clause.text +
    '|' + (clause.params?.map((p) => `${p.id}:${p.start}:${p.end}:${p.value}`).join(',') ?? '') +
    '|' + ownedNodes.map((n) => `${n.id}:${n.role}`).join(',');
  const hit = cache.get(clause);
  if (hit && hit.sig === sig) return hit.spans;

  const model = clause.params ?? [];
  const occupied = (s: number, e: number) => model.some((p) => s < p.end && e > p.start);
  const lex = lexParams(clause, ownedNodes).filter((p) => !occupied(p.start, p.end));
  const spans = [...model, ...lex].sort((a, b) => a.start - b.start);

  cache.set(clause, { sig, spans });
  return spans;
}
