/**
 * Deterministic, no-LLM detection of editable parameter tokens inside a clause's
 * prose, bound to the IR fields of the nodes the token actually refers to.
 *
 * This is a FALLBACK / enrichment for clauses the model didn't annotate with
 * `params`. Binding is two-step: first the token's FIELD and candidate nodes are
 * chosen from the clause's owned nodes (a color token → nodes with a fill or a
 * bg-/text- utility; a weight → text-role nodes; …), then ir/bindings.ts
 * NARROWS the candidates to the subset the token's sub-phrase refers to
 * (current value + qualifier), and resolves structured targets: gradient stops,
 * a subject's position in its layout container, and icons. When nothing
 * matches it still surfaces the widget but binds no nodes (prose-only edit).
 * Model-emitted spans (see `paramsForClause`) win on overlap.
 */
import type { IRNode, ParamKind, ParamSpan, PromptClause } from './types';
import { classList } from './tailwindEdit';
import { GOOGLE_FONTS } from '@/lib/fonts';
import { COLOR_NAMES, twColorHex } from './colors';
import {
  POSITION_RE, gradientStopRoles, hasGradient, iconTargets, indexNodes, isVertical, narrowColorTokens,
  nearestStop, normalizeSide, resolvePositions, scopeOf, type ColorToken, type NodeIndex,
} from './bindings';
import { FALLBACK_ICON, resolveIconName } from './icons';

export { COLOR_NAMES };

/**
 * Extra binding context: the whole node list (so a clause can reach the
 * descendants and layout parents of the nodes it owns) and the text of other
 * clauses (so "page title" can match a heading owned by 'Page title "…"').
 */
export interface LexContext {
  nodes?: readonly IRNode[];
  clauseText?: (clauseId: string) => string | undefined;
}

const WEIGHT_WORDS: Record<string, number> = {
  thin: 100, extralight: 200, light: 300, regular: 400, normal: 400, medium: 500,
  semibold: 600, bold: 700, extrabold: 800, heavy: 800, black: 900,
};

// Compound color phrases like "light grey", "dark blue" — matched BEFORE single
// weight or color words so "light" is not misread as font-weight 300.
const COMPOUND_COLOR_MODIFIERS = ['light', 'dark', 'deep', 'soft', 'bright', 'pale', 'muted', 'warm', 'cool', 'vivid', 'rich', 'dull'];
const COMPOUND_COLOR_RE = new RegExp(
  `\\b(?:${COMPOUND_COLOR_MODIFIERS.join('|')})\\s+(?:${Object.keys(COLOR_NAMES).join('|')})\\b`,
  'gi',
);

const SHADOW_WORDS = ['shadow', 'elevation', 'elevated', 'drop shadow'];
const TEXT_ROLES = new Set<IRNode['role']>(['text', 'heading', 'button', 'badge', 'icon']);

// Shape descriptors: "round avatar", "circular icon", "square card".
// Matched as 'shape' kind; written to style.borderRadius via a word→px mapping.
const SHAPE_WORDS = { round: '9999', circular: '9999', rounded: '8', rectangular: '0', square: '0' } as const;
const SHAPE_RE = new RegExp(`\\b(?:${Object.keys(SHAPE_WORDS).join('|')})\\b`, 'gi');

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface RawMatch { start: number; end: number; text: string; kind: ParamKind; prepStart?: number }

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

// "<noun> icon(s)" — the noun names the glyph ("a calendar icon"). Adjectives /
// determiners before "icon" are not icon names.
const ICON_RE = /\b([A-Za-z][A-Za-z-]*)\s+icons?\b/g;
const NOT_ICON_NOUNS = new Set([
  'a', 'an', 'the', 'one', 'two', 'three', 'each', 'every', 'any', 'some', 'no', 'its', 'their', 'this', 'that',
  'with', 'and', 'or', 'plus', 'small', 'large', 'big', 'tiny', 'little', 'round', 'circular', 'square', 'rounded',
  'outlined', 'outline', 'filled', 'solid', 'colored', 'coloured', 'single', 'simple', 'subtle', 'muted', 'only',
  'leading', 'trailing', 'matching', 'custom', 'same', 'own', 'extra', 'of', 'for', 'as', 'to', 'in', 'on', 'by',
  'your', 'our', 'my', 'more', 'many', 'few', 'several', 'all', 'both', 'other', 'social', 'app', 'text',
  ...Object.keys(COLOR_NAMES),
]);

function* scanIcons(text: string): Generator<RawMatch> {
  for (const m of text.matchAll(ICON_RE)) {
    if (m.index === undefined) continue;
    const word = m[1];
    const lw = word.toLowerCase();
    if (NOT_ICON_NOUNS.has(lw)) continue;
    // Unknown short words are more likely grammar than a glyph name.
    if (!resolveIconName(lw) && lw.length < 4) continue;
    yield { start: m.index, end: m.index + word.length, text: word, kind: 'icon' };
  }
}

// After "on the left" a position phrase ends (punctuation, a conjunction, a
// relation word). "in the top bar" / "on the left panel" use the side word as
// an adjective of a noun instead — not a position.
const POSITION_END = /^(?:\s*$|\s*[,.;:)!?]|\s+(?:and|or|of|with|while|whereas|but|plus|then|below|above|beside|near|next|under|over|by|for|in|on|at|edge|side|corner)\b)/i;

function* scanPositions(text: string): Generator<RawMatch> {
  for (const m of text.matchAll(POSITION_RE)) {
    if (m.index === undefined) continue;
    if (!POSITION_END.test(text.slice(m.index + m[0].length))) continue;
    const word = m[1];
    const start = m.index + m[0].search(new RegExp(`\\b${word}\\b`, 'i'));
    yield { start, end: start + word.length, text: word, kind: 'position', prepStart: m.index };
  }
}

function nodesWithFill(owned: IRNode[]): IRNode[] {
  const fillRoles = new Set<IRNode['role']>(['rectangle', 'circle', 'container', 'frame', 'badge', 'button', 'input', 'image']);
  return owned.filter(
    (n) => n.style?.fill !== undefined || classList(n.tailwind).some((u) => /^(?:hover:)?bg-/.test(u)) || fillRoles.has(n.role),
  );
}
function textNodes(owned: IRNode[]): IRNode[] {
  return owned.filter((n) => TEXT_ROLES.has(n.role));
}

/** Colour token text → hex. */
function colorValueOf(tokenText: string): string {
  const lc = tokenText.toLowerCase();
  if (tokenText.startsWith('#') || lc.startsWith('rgb')) return tokenText;
  // For compound phrases like "light grey", resolve the base color name (last
  // word) and shift its shade by the modifier, so "light gray" matches a
  // bg-slate-100 node rather than a mid gray.
  const words = lc.split(/\s+/);
  const baseWord = words.pop() ?? lc;
  const family = baseWord === 'grey' ? 'gray' : baseWord;
  const mod = words[0];
  if (mod && COLOR_NAMES[family] && family !== 'white' && family !== 'black') {
    const shade = /^(?:light|pale|soft|bright)$/.test(mod) ? 200 : /^(?:dark|deep|rich)$/.test(mod) ? 800 : 500;
    if (shade !== 500) return twColorHex(`${family}-${shade}`) ?? COLOR_NAMES[family];
  }
  return COLOR_NAMES[lc] ?? COLOR_NAMES[baseWord] ?? '#4f46e5';
}

/** The gradient-painting nodes a gradient colour word controls: owned first, else their descendants. */
function gradientNodes(owned: IRNode[], scope: IRNode[]): IRNode[] {
  const own = owned.filter(hasGradient);
  return own.length ? own : scope.filter(hasGradient);
}

/** A clause-local view of the context with the clause's own text hidden (it would match everything). */
function contextFor(clause: PromptClause, ownedNodes: IRNode[], ctx: LexContext) {
  const idx: NodeIndex = indexNodes(ctx.nodes ?? ownedNodes);
  const clauseText = ctx.clauseText
    ? (id: string) => (id === clause.id ? undefined : ctx.clauseText!(id))
    : undefined;
  return { idx, clauseText, scope: scopeOf(ownedNodes, idx) };
}

/** Detect + bind parameter spans for a clause given the nodes it owns. */
export function lexParams(clause: PromptClause, ownedNodes: IRNode[], ctx: LexContext = {}): ParamSpan[] {
  const text = clause.text;
  const raw: RawMatch[] = [];
  // Icon nouns and position phrases first: at an equal start they win the
  // overlap tie ("on the LEFT" is a position, not a text alignment).
  for (const m of scanIcons(text)) raw.push(m);
  for (const m of scanPositions(text)) raw.push(m);
  for (const re of FONT_RES) for (const m of scan(text, re, 'fontFamily')) raw.push(m);
  for (const m of scan(text, HEX_RE, 'color')) raw.push(m);
  for (const m of scan(text, RGB_RE, 'color')) raw.push(m);
  // Compound color phrases ("light grey", "dark blue") must come BEFORE both the
  // single color-name scan and the font-weight scan, so "light grey" is treated
  // as one color token instead of "light" (weight 300) + "grey" (color).
  for (const m of scan(text, COMPOUND_COLOR_RE, 'color')) raw.push(m);
  for (const m of scan(text, COLOR_NAME_RE, 'color')) raw.push(m);
  for (const m of scan(text, RADIUS_RE, 'radius')) raw.push(m);
  for (const m of scan(text, NUMBER_RE, 'length')) raw.push(m);
  for (const m of scan(text, WEIGHT_RE, 'fontWeight')) raw.push(m);
  for (const m of scan(text, SHADOW_RE, 'shadow')) raw.push(m);
  for (const m of scan(text, ALIGN_RE, 'align')) raw.push(m);
  for (const m of scan(text, SHAPE_RE, 'shape' as ParamKind)) raw.push(m);

  // Resolve overlaps: earliest first, longest at a tie (stable: scan order breaks exact ties).
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const picked: RawMatch[] = [];
  let lastEnd = -1;
  for (const m of raw) {
    if (m.start >= lastEnd) { picked.push(m); lastEnd = m.end; }
  }

  const fill = nodesWithFill(ownedNodes);
  const texts = textNodes(ownedNodes);
  const { idx, clauseText, scope } = contextFor(clause, ownedNodes, ctx);

  // Structured, clause-wide resolutions (they depend on the other tokens).
  const colorMatches = picked.filter((m) => m.kind === 'color');
  const stopRoles = gradientStopRoles(text, colorMatches);
  const gradTargets = stopRoles.size ? gradientNodes(ownedNodes, scope) : [];
  const positionMatches = picked.filter((m) => m.kind === 'position');
  const positions = resolvePositions(
    text,
    positionMatches.map((m) => ({ prepStart: m.prepStart ?? m.start, word: m.text })),
    ownedNodes,
    idx,
    clauseText,
  );
  const iconCount = picked.filter((m) => m.kind === 'icon').length;

  const spans = picked.map((m, i): ParamSpan => {
    const base = { id: `lex_${i + 1}`, start: m.start, end: m.end };
    switch (m.kind) {
      case 'color': {
        const value = colorValueOf(m.text);
        const role = stopRoles.get(colorMatches.indexOf(m));
        if (role && gradTargets.length) {
          const stop = role === 'auto' ? nearestStop(gradTargets[0], value) : role;
          return { ...base, kind: 'color', nodeIds: gradTargets.map((n) => n.id), path: `gradient:${stop}`, value };
        }
        const path = resolveColorPath(text, fill, texts);
        const targets = path === 'style.fontColor'
          ? (texts.length ? texts : fill)
          : path === 'style.stroke'
            ? fill
            : (fill.length ? fill : texts);
        return { ...base, kind: 'color', nodeIds: targets.map((n) => n.id), path, value };
      }
      case 'icon': {
        const value = resolveIconName(m.text) ?? FALLBACK_ICON;
        return { ...base, kind: 'icon', nodeIds: iconTargets(scope, value, iconCount).map((n) => n.id), path: 'icon', value };
      }
      case 'position': {
        const bound = positions[positionMatches.indexOf(m)];
        const side = normalizeSide(m.text);
        const container = bound ? idx.byId.get(bound.containerId) : undefined;
        const vertical = side === 'top' || side === 'bottom' || (side === 'center' && !!container && isVertical(container));
        return {
          ...base,
          kind: 'position',
          nodeIds: bound ? [bound.childId] : [],
          path: bound ? `position:${bound.containerId}` : 'position',
          value: side,
          options: vertical ? ['top', 'center', 'bottom'] : ['left', 'center', 'right'],
        };
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
      case 'shape': {
        const key = m.text.toLowerCase() as keyof typeof SHAPE_WORDS;
        const shapedNodes = [...new Set([...fill, ...ownedNodes.filter((n) => n.role === 'circle' || n.role === 'image' || n.role === 'badge')])];
        const targets = shapedNodes.length ? shapedNodes : ownedNodes;
        return {
          ...base,
          kind: 'shape',
          nodeIds: targets.map((n) => n.id),
          path: 'style.borderRadius',
          value: SHAPE_WORDS[key] ?? '0',
          options: Object.keys(SHAPE_WORDS),
        };
      }
      default:
        return { ...base, kind: 'text', nodeIds: [], path: 'content', value: m.text };
    }
  });
  narrowSpans(text, spans, idx);
  return spans;
}

/**
 * Narrow flat colour spans (not gradient stops) to the nodes their sub-phrase
 * refers to — see `narrowColorTokens`. Mutates the given span objects, so only
 * pass freshly built (or copied) spans.
 */
function narrowSpans(text: string, spans: ParamSpan[], idx: NodeIndex): void {
  const tokens: (ColorToken & { span: ParamSpan })[] = spans
    .filter((s) => s.kind === 'color' && !s.path.startsWith('gradient:'))
    .map((s) => ({ start: s.start, end: s.end, value: s.value, path: s.path, nodeIds: [...s.nodeIds], span: s }));
  if (tokens.length === 0) return;
  narrowColorTokens(text, tokens, idx);
  for (const t of tokens) t.span.nodeIds = t.nodeIds;
}

/**
 * Choose the CSS property a color token in a clause maps to.
 *
 * Priority:
 *  1. Clause phrasing — explicit words like "background" / "border" /
 *     "highlighted" / "text color" are unambiguous.
 *  2. Existing Tailwind utilities on the owned nodes — `text-<color>`
 *     means font color; `bg-<color>` means fill; `border-<color>` means stroke.
 *  3. Node role — pure text-role nodes default to fontColor; everything
 *     else defaults to fill.
 */
// Precompiled Tailwind-class matchers for color dimension detection.
// Anchored to a preceding space (or start) so "text-sm" doesn't match "text-blue".
const _colorFamilies = Object.keys(COLOR_NAMES).join('|');
const TW_TEXT_COLOR = new RegExp(`(?:^|\\s)(?:hover:)?text-(?:${_colorFamilies}|\\[)`);
const TW_BG_COLOR   = new RegExp(`(?:^|\\s)(?:hover:)?bg-(?:${_colorFamilies}|\\[)`);
const TW_BORDER_COLOR = new RegExp(`(?:^|\\s)(?:hover:)?border-(?:${_colorFamilies}|\\[)`);

/**
 * Choose the CSS property a color token in a clause maps to.
 *
 * Priority:
 *  1. Clause phrasing — explicit words like "background" / "border" /
 *     "highlighted" / "text color" are unambiguous.
 *  2. Existing Tailwind utilities on the owned nodes — `text-<color>`
 *     means font color; `bg-<color>` means fill; `border-<color>` means stroke.
 *  3. Node role — pure text-role nodes default to fontColor; everything
 *     else defaults to fill.
 */
function resolveColorPath(clauseText: string, fill: IRNode[], texts: IRNode[]): string {
  const lower = clauseText.toLowerCase();

  // Explicit background/fill phrasing → fill
  if (/\b(?:background|fill|backdrop|surface)\b/.test(lower)) return 'style.fill';
  // Explicit border/stroke phrasing → stroke
  if (/\b(?:border(?:\s+colou?r)?|outline(?:\s+colou?r)?|stroke)\b/.test(lower)) return 'style.stroke';
  // Explicit text-color phrasing → fontColor
  if (/\b(?:highlighted?|text\s+colou?r|font\s+colou?r|colou?r(?:ed)?\s+(?:text|link|label))\b/.test(lower)) return 'style.fontColor';

  // Check existing Tailwind classes (prepend space so anchor works on first class too).
  const allNodes = [...fill, ...texts];
  const hasTwText   = allNodes.some((n) => TW_TEXT_COLOR.test(' ' + n.tailwind));
  const hasTwBg     = allNodes.some((n) => TW_BG_COLOR.test(' ' + n.tailwind));
  const hasTwBorder = allNodes.some((n) => TW_BORDER_COLOR.test(' ' + n.tailwind));

  if (hasTwText && !hasTwBg) return 'style.fontColor';
  if (hasTwBg && !hasTwText) return 'style.fill';
  if (hasTwBorder && !hasTwText && !hasTwBg) return 'style.stroke';

  // Fall back by node role: pure text nodes → fontColor; anything with a
  // fill-role node present → fill (the background is more salient there).
  if (texts.length > 0 && fill.length === 0) return 'style.fontColor';
  return 'style.fill';
}

function normalizeAlign(text: string): string {
  const t = text.toLowerCase();
  if (t.startsWith('left')) return 'left';
  if (t.startsWith('right')) return 'right';
  return 'center';
}

// --- Manual span binding (Malleable Prompting: user-selected text → widget) --

let manualSeq = 0;

/**
 * Build a ParamSpan for a USER-SELECTED text range bound to a chosen widget
 * kind — the manual counterpart of `lexParams`. The lexer only reifies
 * phrases it recognizes; this lets the user highlight any span of a clause
 * ("compact", "12px", "navy") and turn it into a persistent, interactive
 * control. Values are inferred from the selected text where possible and
 * fall back to sensible seeds.
 */
export function createManualSpan(
  clause: PromptClause,
  ownedNodes: IRNode[],
  start: number,
  end: number,
  kind: ParamKind,
  ctx: LexContext = {},
): ParamSpan {
  const label = clause.text.slice(start, end);
  const lc = label.toLowerCase().trim();
  const fill = nodesWithFill(ownedNodes);
  const texts = textNodes(ownedNodes);
  const base = { id: `man_${++manualSeq}`, start, end };
  switch (kind) {
    case 'color': {
      const baseWord = lc.split(/\s+/).pop() ?? lc;
      const value = /^#|^rgb/.test(lc) ? label : (COLOR_NAMES[lc] ?? COLOR_NAMES[baseWord] ?? '#4f46e5');
      const path = resolveColorPath(clause.text, fill, texts);
      const targets = path === 'style.fontColor'
        ? (texts.length ? texts : fill)
        : path === 'style.stroke'
          ? fill
          : (fill.length ? fill : texts);
      return { ...base, kind, nodeIds: targets.map((n) => n.id), path, value };
    }
    case 'fontFamily':
      return { ...base, kind, nodeIds: texts.map((n) => n.id), path: 'style.fontFamily', value: label };
    case 'fontWeight': {
      const num = WEIGHT_WORDS[lc] ?? (Number.isFinite(Number(lc)) ? Number(lc) : 400);
      return { ...base, kind, nodeIds: texts.map((n) => n.id), path: 'style.fontWeight', value: String(num) };
    }
    case 'radius':
      return { ...base, kind, nodeIds: ownedNodes.map((n) => n.id), path: 'style.borderRadius', value: '', unit: 'px' };
    case 'length': {
      const m = lc.match(/(\d+(?:\.\d+)?)\s*(px|rem|pt|%)?/);
      return { ...base, kind, nodeIds: texts.map((n) => n.id), path: 'style.fontSize', value: m?.[1] ?? '16', unit: m?.[2] ?? 'px' };
    }
    case 'shadow':
      return { ...base, kind, nodeIds: fill.map((n) => n.id), path: 'style.shadow', value: '' };
    case 'align':
      return { ...base, kind, nodeIds: texts.map((n) => n.id), path: 'align', value: normalizeAlign(lc) };
    case 'shape': {
      const shaped = [...fill, ...ownedNodes.filter((n) => n.role === 'circle' || n.role === 'image' || n.role === 'badge')];
      const targets = shaped.length ? shaped : ownedNodes;
      return {
        ...base,
        kind,
        nodeIds: targets.map((n) => n.id),
        path: 'style.borderRadius',
        value: SHAPE_WORDS[lc as keyof typeof SHAPE_WORDS] ?? '8',
        options: Object.keys(SHAPE_WORDS),
      };
    }
    case 'icon': {
      const { scope } = contextFor(clause, ownedNodes, ctx);
      const value = resolveIconName(lc) ?? FALLBACK_ICON;
      return { ...base, kind, nodeIds: iconTargets(scope, value, 1).map((n) => n.id), path: 'icon', value };
    }
    case 'position': {
      const { idx, clauseText } = contextFor(clause, ownedNodes, ctx);
      const [bound] = resolvePositions(clause.text, [{ prepStart: start, word: lc }], ownedNodes, idx, clauseText);
      const side = normalizeSide(lc);
      const vertical = side === 'top' || side === 'bottom';
      return {
        ...base,
        kind,
        nodeIds: bound ? [bound.childId] : [],
        path: bound ? `position:${bound.containerId}` : 'position',
        value: side,
        options: vertical ? ['top', 'center', 'bottom'] : ['left', 'center', 'right'],
      };
    }
    default:
      return { ...base, kind: 'text', nodeIds: [], path: 'content', value: label };
  }
}

// --- Merge of model-emitted + lexer spans (lexed on read, memoized) --------

const cache = new WeakMap<PromptClause, { sig: string; spans: ParamSpan[] }>();

/** Characters that count as part of a token when snapping to word edges. */
const WORD_CHAR = /[A-Za-z0-9#%.-]/;

/**
 * The model often emits param offsets that slice through the middle of a word
 * ("typef|ace|", "s|hadow eleva|tion"). Snap [start, end) outward to whole-word
 * boundaries so the highlighted token covers the entire word(s), trimming any
 * leading/trailing punctuation or whitespace first. Interior spaces already
 * inside the span are preserved, so a bound phrase stays intact.
 */
function snapToWords(text: string, start: number, end: number): [number, number] {
  let s = Math.max(0, Math.min(start, text.length));
  let e = Math.max(s, Math.min(end, text.length));
  while (s < e && !WORD_CHAR.test(text[s])) s++;
  while (e > s && !WORD_CHAR.test(text[e - 1])) e--;
  while (s > 0 && WORD_CHAR.test(text[s - 1])) s--;
  while (e < text.length && WORD_CHAR.test(text[e])) e++;
  return [s, e];
}

/** A cheap fingerprint of the node state a clause's bindings depend on. */
function scopeSig(clause: PromptClause, ownedNodes: IRNode[], ctx: LexContext): string {
  const { idx, scope } = contextFor(clause, ownedNodes, ctx);
  const parents = ownedNodes.map((n) => (n.parentId ? idx.byId.get(n.parentId) : undefined)).filter((n): n is IRNode => !!n);
  const siblings = parents.flatMap((p) => idx.children.get(p.id) ?? []);
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const n of [...scope, ...parents, ...siblings]) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    parts.push(`${n.id}:${n.role}:${n.parentId}:${n.order}:${n.tailwind}:${n.content ?? ''}:${n.style ? JSON.stringify(n.style) : ''}:${n.layout?.x ?? ''}`);
  }
  return parts.join('|');
}

/**
 * Merged parameter spans for a clause: model-emitted `clause.params` win on
 * overlap; lexer spans fill the gaps. Lexer spans are always re-derived from
 * the current text + IR (any stored `lex_*` copies are ignored), so bindings
 * follow the nodes' current values. Model colour spans are narrowed the same
 * way as lexed ones. Memoized per clause object + a signature of the node
 * state the bindings read. Does NOT mutate the stored clause.
 */
export function paramsForClause(clause: PromptClause, ownedNodes: IRNode[], ctx: LexContext = {}): ParamSpan[] {
  const stored = (clause.params ?? []).filter((p) => !p.id.startsWith('lex_'));
  const sig =
    clause.text +
    '|' + stored.map((p) => `${p.id}:${p.start}:${p.end}:${p.value}:${p.nodeIds.join('+')}`).join(',') +
    '|' + ownedNodes.map((n) => n.id).join(',') +
    '|' + scopeSig(clause, ownedNodes, ctx);
  const hit = cache.get(clause);
  if (hit && hit.sig === sig) return hit.spans;

  const model = stored.map((p) => {
    const [s, e] = snapToWords(clause.text, p.start, p.end);
    return { ...p, start: s, end: e, nodeIds: [...p.nodeIds] };
  });
  const occupied = (s: number, e: number) => model.some((p) => s < p.end && e > p.start);
  const lex = lexParams(clause, ownedNodes, ctx).filter((p) => !occupied(p.start, p.end));
  const spans = [...model, ...lex].sort((a, b) => a.start - b.start);
  // Model and lexed colour tokens compete for nodes together.
  if (model.length) narrowSpans(clause.text, spans, indexNodes(ctx.nodes ?? ownedNodes));

  cache.set(clause, { sig, spans });
  return spans;
}
