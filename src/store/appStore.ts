import { create } from 'zustand';
import type {
  Annotation,
  ComponentInference,
  ComposerValue,
  DemoIntent,
  DemoPlanItem,
  IR,
  IRNode,
  IRPatch,
  ManipulationOp,
  NodeRole,
  NodeStyle,
  ParamKind,
  ParamSpan,
  PathPoint,
  PromptClause,
  PromptRef,
  PromptUpdateProposal,
  Recipe,
  StructuredPrompt,
  WireframeFill,
} from '@/ir/types';
import { setAlignment, setUtility } from '@/ir/tailwindEdit';
import { COLOR_NAMES, createManualSpan } from '@/ir/paramLexer';
import { familyFromStack } from '@/lib/fonts';
import { loadGoogleFont } from '@/lib/loadFont';
import {
  composerRefs,
  emptyComposer,
  insertRef,
  insertRefReplacingKeyword,
  nextComposerRefId,
} from '@/lib/composer';
import { applyPatch } from '@/ir/applyPatch';
import { siblingsOf } from '@/ir/tree';
import {
  applyManipulation,
  cloneNodes,
  collectSubtrees,
  createNode,
  toggleHidden,
  updateNodeContent,
  updateNodeLayout,
  updateNodeStyle,
} from '@/ir/manipulate';
import { SAMPLES, emptyIR, emptyPrompt } from '@/ir/samples';
import { inferComponentCandidates } from '@/ir/componentInfer';
import { wireframeChildren, fillPlaceholders, wireframeBackdrop } from '@/ir/wireframe';
import { buildDemoPlan as buildDemoPlanPure } from '@/annot/resolve';
import {
  composeFromInstruction,
  generatePatch,
  proposePromptUpdate,
  NotConnectedError,
} from '@/llm/client';
import { LLMError } from '@/llm/providers';
import {
  logBackChannel,
  logComposeGesture,
  setLastDecision,
  type GestureProvenance,
} from '@/lib/log';
import { useStudyStore } from '@/store/studyStore';
import { nextClauseId, nextRecipeId } from '@/ir/ids';

/** Options for a compose send (DirectGPT scope + reference chips + recipe). */
export interface InstructOptions {
  scopeNodeIds?: string[];
  refs?: PromptRef[];
  /** True when this send was triggered by re-applying a Recipe. */
  viaRecipe?: boolean;
  /** Called once the compose settles (true = applied, false = failed). */
  onSettled?: (ok: boolean) => void;
}

/** Derive the gesture-provenance signals present in a compose send (study log). */
function gestureSignals(opts: InstructOptions): GestureProvenance[] {
  const signals: GestureProvenance[] = [];
  if (opts.viaRecipe) signals.push('recipe');
  for (const ref of opts.refs ?? []) {
    if (ref.kind === 'node') signals.push('dragRef');
    else if (ref.kind === 'attribute') signals.push('attributeRef');
    else if (ref.kind === 'param') signals.push('paramRef');
    else if (ref.kind === 'image') signals.push('image');
  }
  if (opts.scopeNodeIds && opts.scopeNodeIds.length > 0) signals.push('scopedSelection');
  if (signals.length === 0) signals.push('typed');
  return Array.from(new Set(signals));
}

/** The single strongest signal, for at-a-glance grouping. */
const PROVENANCE_RANK: GestureProvenance[] = [
  'recipe', 'image', 'attributeRef', 'paramRef', 'dragRef', 'scopedSelection', 'typed',
];
function primaryProvenance(signals: GestureProvenance[]): GestureProvenance {
  return PROVENANCE_RANK.find((p) => signals.includes(p)) ?? 'typed';
}

/** A short verb-phrase label for a recipe pill (v1: first few words, sentence-cased). */
function deriveRecipeLabel(instruction: string): string {
  const cleaned = instruction.replace(/\{selection\}/g, '').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ').slice(0, 5).join(' ');
  const label = words.length > 32 ? `${words.slice(0, 32).trim()}…` : words;
  return label ? label[0].toUpperCase() + label.slice(1) : 'Saved command';
}

/** Tool palette modes (deterministic drawing + annotation). */
export type Tool =
  | 'pointer'
  | 'rectangle'
  | 'circle'
  | 'line'
  | 'path'
  | 'text'
  | 'comment'
  | 'arrow'
  | 'box'
  | 'scribble';
export const DRAWING_TOOLS: Tool[] = ['rectangle', 'circle', 'line', 'path', 'text'];
/** Annotation ("prompt by demonstration") tools — produce annotations, not IR nodes. */
export const ANNOT_TOOLS: Tool[] = ['comment', 'arrow', 'box', 'scribble'];
export function isAnnotTool(t: Tool): boolean {
  return (ANNOT_TOOLS as string[]).includes(t);
}
export function toolToRole(tool: Tool): NodeRole | null {
  switch (tool) {
    case 'rectangle': return 'rectangle';
    case 'circle': return 'circle';
    case 'line': return 'line';
    case 'text': return 'text';
    // 'path' is multi-click and handled specially by the canvas.
    default: return null;
  }
}

interface Snapshot {
  ir: IR;
  prompt: StructuredPrompt;
  /** Component inferences travel with the scene so undo/restore stay consistent. */
  inferences: Record<string, ComponentInference>;
}

/**
 * A restorable spec+IR snapshot (Malleable Prompting's version tracking,
 * linearized): one entry per meaningful configuration change — a compose send,
 * a spec edit regeneration, a canvas sync, or a param-widget adjustment burst.
 * Unlike the undo stack, versions are user-visible and jump-to-able, so
 * iterations are organized around configurations instead of chat turns.
 */
export interface SpecVersion {
  id: string;
  ts: number;
  label: string;
  ir: IR;
  prompt: StructuredPrompt;
  inferences: Record<string, ComponentInference>;
}

/** Resolved visual style read from the DOM for the Properties panel fallback. */
export interface ComputedNodeStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  borderRadius?: number;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontColor?: string;
  opacity?: number;
}

interface AppState {
  ir: IR;
  prompt: StructuredPrompt;
  pendingProposal: PromptUpdateProposal | null;
  pendingAffectedIds: string[];
  /** Primary selection (first of selectedNodeIds) — kept for existing call sites. */
  selectedNodeId: string | null;
  /** Full multi-selection (DirectGPT selection-scoped prompting). */
  selectedNodeIds: string[];
  /** True while a composer input holds focus — drives the scope-preview outline. */
  composerFocused: boolean;
  /**
   * A focus hand-off request between the canvas and the prompt composer.
   * Bumping `seq` lets the targeted surface pull focus: clicking a canvas
   * element mid-draft drops a chip then returns focus to the prompt; a
   * double-click on the canvas mid-draft hands focus back to the canvas.
   */
  focusRequest: { target: 'composer' | 'canvas'; seq: number } | null;
  /**
   * The live composer value (text + reference chips), lifted into the store so
   * canvas interactions (click-to-refer, here/there location) can feed the
   * single composer. Both PromptPane and HeroComposer bind to it.
   */
  composerValue: ComposerValue;
  /** Saved reusable commands (DirectGPT toolbar). Project-scoped, not persisted. */
  recipes: Recipe[];
  /** The marker-interpolated text of the last successful compose send (for "Save as recipe"). */
  lastSent: string | null;
  hoveredClauseId: string | null;
  /**
   * Nodes bound to the parameter token currently hovered in the spec
   * (Malleable Prompting attribution: widget → output). Canvas outlines them
   * so the user sees exactly which elements a param controls before editing.
   */
  hoveredParamNodeIds: string[] | null;
  recentIds: string[];
  history: Snapshot[];
  /** Restorable configuration versions (newest last, capped). */
  versions: SpecVersion[];
  tool: Tool;
  /** Copied subtree(s) for paste (Cmd/Ctrl+C → V). Project-scoped, not persisted. */
  clipboard: IRNode[] | null;
  /** Whether the slide-up keyboard-shortcuts panel is open. */
  shortcutsOpen: boolean;
  /** Set to a timestamp when an unbound hotkey is pressed (drives the hint banner). */
  unknownShortcutAt: number | null;
  /** Whether canvas edits auto-sync to the prompt (Call B) or wait for a manual trigger. */
  irSyncMode: 'auto' | 'manual';
  /** In manual mode, the held baseline IR + latest op awaiting a manual spec update. */
  pendingSync: { op: ManipulationOp; prevIR: IR } | null;
  /**
   * Computed bounds of the currently selected node, measured from the DOM by
   * Canvas when the selection changes. Used in the Properties panel to show X/Y/W/H
   * for flow nodes that have no stored layout (they're positioned by CSS).
   * Position is relative to the parent element.
   */
  computedBounds: { x: number; y: number; w: number; h: number } | null;
  /**
   * Computed visual style of the selected node, read from the DOM by Canvas.
   * LLM-authored nodes carry their look in `tailwind`, not the structured
   * `style` block, so the Properties panel falls back to these resolved values
   * (fill, stroke, font color/size/family, …) to show meaningful defaults.
   */
  computedStyle: ComputedNodeStyle | null;

  generating: boolean; // Compose / Call A in flight
  proposing: boolean; // Call B in flight
  error: string | null;
  needsConnect: boolean;

  // --- Prompt-by-demonstration ---
  /** Component guesses for drawn shapes, keyed by node id. */
  inferences: Record<string, ComponentInference>;
  /** Canvas annotations (comments + draft drawings) awaiting a demo send. */
  annotations: Annotation[];
  /** The reviewable modification plan built from annotations (guardrail), or null. */
  demoPlan: DemoPlanItem[] | null;
  /** True while a demo plan is being built or applied. */
  demoBusy: boolean;

  loadSample: (id: string) => void;
  newBlank: () => void;
  selectNode: (id: string | null) => void;
  /** Shift-click: toggle a node in/out of the multi-selection. */
  toggleSelection: (id: string) => void;
  /** Replace the whole selection (used by marquee/rubber-band selection). */
  setSelection: (ids: string[]) => void;
  /**
   * Promote a flow (LLM-authored) node to an absolutely-positioned one so it can
   * be freely moved and resized on the canvas, like a drawn shape. Reparents it
   * to the root frame with the given stage-relative bounds.
   */
  promoteToAbsolute: (id: string, bounds: { x: number; y: number; w: number; h: number }) => void;
  setComposerFocused: (focused: boolean) => void;
  setComposerValue: (v: ComposerValue) => void;
  /** Ask a surface (the prompt composer or the canvas) to take focus. */
  requestFocus: (target: 'composer' | 'canvas') => void;
  /** Append a node reference chip to the composer (click-to-refer); dedupes by node. */
  addComposerNodeRef: (nodeId: string) => void;
  /** Append a canvas-location chip to the composer (DirectGPT here/there). */
  addComposerLocationRef: (x: number, y: number, nearNodeId?: string) => void;
  /** Replace a clause's text with one of its model-proposed alternatives. */
  chooseAlternative: (clauseId: string, text: string) => void;
  hoverClause: (id: string | null) => void;
  /** Hover a spec param token: outline its bound nodes on the canvas. */
  hoverParam: (nodeIds: string[] | null) => void;
  /** Jump the spec+IR back to a recorded configuration version. */
  restoreVersion: (id: string) => void;
  setTool: (tool: Tool) => void;

  /**
   * Lovable-style entry point: a freeform NL instruction → spec + IR, one call.
   * `opts` carries the DirectGPT additions — a selection scope, resolved
   * reference chips, and whether the send came from a Recipe.
   */
  instruct: (message: string, opts?: InstructOptions) => void;
  editClause: (id: string, text: string) => void;
  removeClause: (id: string) => void;
  regenerate: () => void;

  /** Save the last sent (or a given) instruction as a reusable Recipe. */
  addRecipe: (fromInstruction: string, label?: string) => void;
  /** Re-apply a Recipe to the current selection (requires a non-empty selection). */
  applyRecipe: (recipeId: string) => void;

  manipulate: (op: ManipulationOp) => void;
  /**
   * Run the Call B back-channel for a manipulation whose IR writes already
   * happened incrementally (canvas drags, drawing). `prevIR` is the snapshot
   * from before the gesture started.
   */
  proposeManipulation: (op: ManipulationOp, prevIR: IR) => void;
  /**
   * Resolve the pending back-channel proposal by folding it into the prompt.
   * `overrideText` replaces the primary edited clause's text (used when the
   * user rephrases it or picks one of the proposed alternatives). There is no
   * "reject" — a substantial IR change must be described in the spec.
   */
  acceptProposal: (overrideText?: string) => void;
  /** Discard a pending proposal's spec wording without folding it in. */
  discardProposal: () => void;

  /** Copy the current selection's subtree(s) to the clipboard. */
  copySelection: () => void;
  /** Paste the clipboard back into the scene, offset and re-selected. */
  pasteClipboard: () => void;
  /** Duplicate a node's subtree in place (alt-drag / Cmd+D); returns the new root id. */
  duplicateNode: (id: string) => string | null;
  setShortcutsOpen: (open: boolean) => void;
  /** Flag an unbound hotkey so the canvas shows the "see all shortcuts" hint. */
  flagUnknownShortcut: () => void;
  /** Switch canvas→prompt syncing between automatic and manual. */
  setIrSyncMode: (mode: 'auto' | 'manual') => void;
  /** Manually run the held back-channel (manual sync mode). */
  syncNow: () => void;
  /** Update the computed DOM bounds of the selected node (called by Canvas). */
  setComputedBounds: (bounds: { x: number; y: number; w: number; h: number } | null) => void;
  /** Update the computed DOM style of the selected node (called by Canvas). */
  setComputedStyle: (style: ComputedNodeStyle | null) => void;

  /**
   * Forward edit (Prompt → IR): set a clause parameter token's value. Writes the
   * bound IR field(s) deterministically (NO LLM, NO Call A/B), rewrites the
   * token in the clause prose, keeps the node prompt-linked (not diverged), and
   * adds ONE coalesced undo step per drag burst. `original` is the clause's
   * text+params snapshot at popover-open, so live drags splice from a stable base.
   */
  setClauseParam: (
    clauseId: string,
    span: ParamSpan,
    value: string,
    original?: { text: string; params?: ParamSpan[] },
  ) => void;

  /**
   * Manual span binding (Malleable Prompting): turn a user-selected text range
   * of a clause into a persistent interactive parameter of the chosen kind.
   * Overlapping model-emitted spans are replaced (the paper's "replace the
   * auto-generated widget" gesture); overlapping lexer spans yield automatically.
   */
  bindClauseParam: (clauseId: string, start: number, end: number, kind: ParamKind) => void;

  // Deterministic editing. The edit* variants write the IR immediately AND
  // queue a debounced Call B proposal once the editing burst settles; the
  // update* variants are silent (used mid-gesture by the canvas).
  createShape: (params: {
    role: NodeRole;
    x: number;
    y: number;
    w: number;
    h: number;
    parentId?: string | null;
    points?: PathPoint[];
  }) => string;
  updateLayout: (id: string, patch: Partial<{ x: number; y: number; w: number; h: number }>) => void;
  editStyle: (id: string, patch: Partial<NodeStyle>) => void;
  editLayout: (id: string, patch: Partial<{ x: number; y: number; w: number; h: number }>) => void;
  editContent: (id: string, content: string) => void;
  toggleHidden: (id: string) => void;

  // --- Component inference (draw a shape → semantic component + wireframe) ---
  /** Run component inference on a freshly drawn shape and add its inferred clause. */
  inferDrawnShape: (nodeId: string, prevIR: IR) => void;
  /**
   * Pick one of the candidate components: writes the clause and rebuilds the
   * host's generated children. Switching variations keeps the current fill mode
   * (wireframe / placeholders / empty) unless `fill` is given explicitly.
   */
  chooseComponent: (nodeId: string, label: string, fill?: WireframeFill) => void;
  /** Strip the generated wireframe children, leaving the host empty. */
  revertWireframe: (nodeId: string) => void;
  /** Convert the grey wireframe into neutral placeholder content/images. */
  fillWireframePlaceholders: (nodeId: string) => void;
  /** Hide the suggestion (icon + canvas bubble) without changing the scene. */
  dismissInference: (nodeId: string) => void;
  /** Confirm pending (auto-inferred) clauses: they become regular clauses. One undo step. */
  acceptClauses: (ids: string[]) => void;
  /**
   * Reject pending clauses: removes them from the spec, unlinks the nodes they
   * described and drops their canvas suggestion. Drawn shapes stay. One undo step.
   */
  dismissClauses: (ids: string[]) => void;

  // --- Annotations / prompt-by-demonstration ---
  addAnnotation: (a: Annotation) => void;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  removeAnnotation: (id: string) => void;
  clearAnnotations: () => void;
  /** Build the reviewable plan from the current annotations (boxes = DOM-measured node rects). */
  buildDemoPlan: (boxes: Record<string, { x: number; y: number; w: number; h: number }>) => void;
  updateDemoPlanItem: (id: string, patch: Partial<DemoPlanItem>) => void;
  removeDemoPlanItem: (id: string) => void;
  cancelDemoPlan: () => void;
  /** Apply the confirmed plan: synthesize an instruction and run compose, then clear. */
  confirmDemoPlan: () => void;

  undo: () => void;
  dismissError: () => void;
}

const DEBOUNCE_MS = 700;
/** How long a Properties-panel editing burst must be idle before Call B fires. */
const EDIT_SETTLE_MS = 1200;

let callATimer: ReturnType<typeof setTimeout> | null = null;
// One undo step per param-edit "burst" (e.g. a slider drag): a new history
// snapshot is pushed only when the active (clause, span) changes or after idle.
let paramBurstKey: string | null = null;
let paramBurstTimer: ReturnType<typeof setTimeout> | null = null;
let versionSeq = 0;
const MAX_VERSIONS = 24;

function snapshot(s: AppState): Snapshot {
  return { ir: s.ir, prompt: s.prompt, inferences: s.inferences };
}

function patchedIds(patch: IRPatch): string[] {
  return patch.ops.map((op) => (op.type === 'add' ? op.node.id : op.id));
}

/**
 * The deterministic IR ops that realise a recognised scribble intent (delete,
 * move, swap) on the current IR; [] for intents that need the model (fill) or
 * whose nodes are gone. A same-parent move is a plain reorder (or an x/y move
 * for an absolutely positioned node); anything else is a reparent.
 */
function intentOps(intent: DemoIntent, ir: IR): ManipulationOp[] {
  const byId = new Map(ir.nodes.map((n) => [n.id, n]));
  switch (intent.kind) {
    case 'delete': {
      const ids = new Set(intent.ids.filter((id) => byId.get(id)?.parentId));
      // Skip ids inside another deleted subtree: removing the ancestor covers them.
      const covered = (id: string): boolean => {
        for (let p = byId.get(id)?.parentId ?? null; p; p = byId.get(p)?.parentId ?? null) {
          if (ids.has(p)) return true;
        }
        return false;
      };
      return [...ids].filter((id) => !covered(id)).map((id) => ({ kind: 'delete' as const, id }));
    }
    case 'move': {
      const node = byId.get(intent.id);
      if (!node || !byId.has(intent.toParentId)) return [];
      if (node.parentId !== intent.toParentId) {
        return [{
          kind: 'reparent', id: node.id, fromParentId: node.parentId,
          toParentId: intent.toParentId, toIndex: intent.toIndex, layout: intent.layout,
        }];
      }
      if (intent.layout) {
        return [{ kind: 'move', id: node.id, from: { ...node.layout }, to: { ...node.layout, ...intent.layout } }];
      }
      const from = siblingsOf(ir, node.id).findIndex((n) => n.id === node.id);
      return from === intent.toIndex
        ? []
        : [{ kind: 'reorder', id: node.id, parentId: node.parentId, from, to: intent.toIndex }];
    }
    case 'swap':
      return intent.ids.every((id) => byId.has(id)) ? [{ kind: 'swap', id: intent.ids[0], otherId: intent.ids[1] }] : [];
    case 'fill':
      return [];
  }
}

/**
 * Apply a user edit to a plan row. Rewording the instruction drops the
 * recognised intent (the user's text now goes to the model). Re-picking the
 * targets keeps a delete / fill intent pointed at the new nodes; a move or swap
 * is only exact for the nodes it was resolved on, so it is dropped too.
 */
function withEditedIntent(item: DemoPlanItem, patch: Partial<DemoPlanItem>): DemoPlanItem {
  const next = { ...item, ...patch };
  const intent = item.intent;
  if (!intent || 'intent' in patch) return next;
  if (patch.instruction !== undefined && patch.instruction !== item.instruction) return { ...next, intent: undefined };
  if (patch.targetNodeIds) {
    if (intent.kind === 'delete' || intent.kind === 'fill') return { ...next, intent: { ...intent, ids: patch.targetNodeIds } };
    return { ...next, intent: undefined };
  }
  return next;
}

function affectedIdsOf(op: ManipulationOp): string[] {
  if (op.kind === 'align') return op.ids;
  if (op.kind === 'swap') return [op.id, op.otherId];
  return [op.id];
}

/** Frame nodes get drawn-shape children; falls back to root-level. */
function defaultParentId(ir: IR): string | null {
  const frame = ir.nodes.find((n) => n.role === 'frame' && n.parentId === null);
  return frame?.id ?? null;
}

// --- Forward param edit (Prompt → IR, deterministic, no LLM) --------------

const NUMERIC_STYLE = new Set(['fontSize', 'fontWeight', 'strokeWidth', 'borderRadius', 'opacity']);

function setNodeTailwindOnly(ir: IR, id: string, tailwind: string): IR {
  return { ...ir, nodes: ir.nodes.map((n) => (n.id === id ? { ...n, tailwind } : n)) };
}

/** Map a chosen value to a Tailwind utility value (arbitrary value for colors). */
function tailwindValueFor(value: string): string {
  if (/^#/.test(value)) return `[${value}]`;
  if (/^rgb/i.test(value)) return `[${value.replace(/\s+/g, '')}]`;
  return value;
}

/** Shape word → borderRadius px value. */
const SHAPE_RADIUS: Record<string, number> = { round: 9999, circular: 9999, rounded: 8, rectangular: 0, square: 0 };

/** Write one parameter's value onto a node by its ParamSpan path. Deterministic. */
function writeParam(ir: IR, node: IRNode, span: ParamSpan, value: string): IR {
  if (span.kind === 'align' || span.path === 'align') {
    const cls = value === 'left' ? 'text-left' : value === 'right' ? 'text-right' : 'text-center';
    return setNodeTailwindOnly(ir, node.id, setAlignment(node.tailwind, cls));
  }
  // Shape words map to a borderRadius number.
  if (span.kind === 'shape') {
    const r = SHAPE_RADIUS[value.toLowerCase()] ?? Number(value);
    return updateNodeStyle(ir, node.id, { borderRadius: Number.isFinite(r) ? r : 0 });
  }
  const { path } = span;
  if (path.startsWith('style.')) {
    const key = path.slice('style.'.length);
    const v = NUMERIC_STYLE.has(key) ? Number(value) : value;
    return updateNodeStyle(ir, node.id, { [key]: v } as Partial<NodeStyle>);
  }
  if (path.startsWith('layout.')) {
    const key = path.slice('layout.'.length);
    return updateNodeLayout(ir, node.id, { [key]: Number(value) });
  }
  if (path.startsWith('tailwind:')) {
    const prefix = path.slice('tailwind:'.length);
    return setNodeTailwindOnly(ir, node.id, setUtility(node.tailwind, prefix + tailwindValueFor(value)));
  }
  if (path === 'content') return updateNodeContent(ir, node.id, value);
  return ir;
}

/** The deictic word ("here"/"there") a location chip's label starts with. */
function keywordOf(label: string): string {
  const m = label.match(/^(here|there)/i);
  return m ? m[1].toLowerCase() : 'here';
}

/** Map a borderRadius number back to the closest semantic shape word. */
function nearestShapeWord(borderRadius: number): string {
  if (borderRadius >= 9000) return 'round';
  if (borderRadius > 0) return 'rounded';
  return 'square';
}

/** Map a 6-digit hex color back to the closest named color in the lexer palette. */
function nearestColorName(hex: string): string {
  const lc = hex.toLowerCase();
  // Exact match: avoid a distance search when the picker lands on a palette color.
  const exact = Object.keys(COLOR_NAMES).find((name) => COLOR_NAMES[name].toLowerCase() === lc);
  if (exact) return exact;
  // Nearest by RGB Euclidean distance.
  if (!/^#[0-9a-f]{6}$/.test(lc)) return hex; // not a 6-char hex — return as-is
  const r1 = parseInt(lc.slice(1, 3), 16);
  const g1 = parseInt(lc.slice(3, 5), 16);
  const b1 = parseInt(lc.slice(5, 7), 16);
  let best = 'blue';
  let bestDist = Infinity;
  for (const [name, namedHex] of Object.entries(COLOR_NAMES)) {
    const r2 = parseInt(namedHex.slice(1, 3), 16);
    const g2 = parseInt(namedHex.slice(3, 5), 16);
    const b2 = parseInt(namedHex.slice(5, 7), 16);
    const dist = (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
    if (dist < bestDist) { bestDist = dist; best = name; }
  }
  return best;
}

/** The human-readable prose form of a value (null = leave the clause token unchanged). */
function humanParamValue(span: ParamSpan, value: string): string | null {
  switch (span.kind) {
    case 'shadow':
      return null; // a CSS box-shadow string would be unreadable in prose
    case 'length':
    case 'radius':
      return `${value}${span.unit ?? 'px'}`;
    case 'shape':
      // The widget sends numeric borderRadius values (9999, 8, 0); convert back
      // to a shape word so the prose stays "round/rounded/square", not "9999".
      return nearestShapeWord(Number(value));
    case 'color':
      // Color picker emits hex; keep the prose readable with a named color.
      return value.startsWith('#') ? nearestColorName(value) : value;
    default:
      return value; // font family, weight, align word, enum, free text
  }
}

export const useAppStore = create<AppState>((set, get) => {
  /** Record the CURRENT spec+IR as a named, restorable configuration version. */
  function recordVersion(label: string): void {
    set((s) => ({
      versions: [
        ...s.versions,
        { id: `ver_${++versionSeq}`, ts: Date.now(), label, ir: s.ir, prompt: s.prompt, inferences: s.inferences },
      ].slice(-MAX_VERSIONS),
    }));
  }

  async function runCallA(changedClauseIds: string[]): Promise<void> {
    const { ir, prompt } = get();
    if (prompt.clauses.length === 0) {
      set({ ir: emptyIR(), generating: false });
      return;
    }
    set({ generating: true, error: null });
    try {
      const patch = await generatePatch(ir, prompt, changedClauseIds);
      set((s) => ({
        history: [...s.history, snapshot(s)].slice(-50),
        ir: applyPatch(s.ir, patch),
        recentIds: patchedIds(patch),
        generating: false,
      }));
      recordVersion('Spec edit');
    } catch (err) {
      handleLLMError(set, err, 'generating');
    }
  }

  function scheduleCallA(changedClauseIds: string[]): void {
    if (callATimer) clearTimeout(callATimer);
    callATimer = setTimeout(() => void runCallA(changedClauseIds), DEBOUNCE_MS);
  }

  /** Merge clause upserts/removals into the current prompt (stable ids). */
  function mergeClauses(
    prompt: StructuredPrompt,
    updated: StructuredPrompt['clauses'],
    removedIds: string[],
  ): StructuredPrompt {
    const removed = new Set(removedIds);
    const updatedById = new Map(updated.map((c) => [c.id, c]));
    const merged = prompt.clauses
      .filter((c) => !removed.has(c.id))
      .map((c) => updatedById.get(c.id) ?? c);
    for (const c of updated) {
      if (!merged.some((m) => m.id === c.id)) merged.push(c);
    }
    return { clauses: merged };
  }

  /**
   * The Call B back-channel: ask the LLM to fold an already-applied
   * manipulation back into the prompt, and park the result as a pending
   * proposal for the user to accept/reject. NEVER auto-applies.
   */
  function propose(op: ManipulationOp, prevIR: IR): void {
    const affectedIds = affectedIdsOf(op);
    set({
      pendingProposal: null,
      pendingAffectedIds: affectedIds,
      proposing: true,
      error: null,
    });
    void (async () => {
      try {
        const { ir, prompt } = get();
        const proposal = await proposePromptUpdate(prevIR, ir, prompt, op);
        logBackChannel({
          timestamp: Date.now(),
          manipulationKind: op.kind,
          manipulation: op,
          proposal,
          accepted: null,
          confidence: proposal.confidence,
        });
        useStudyStore.getState().logEvent('backchannel', { kind: op.kind, confidence: proposal.confidence });
        set({ pendingProposal: proposal, proposing: false });
      } catch (err) {
        logBackChannel({
          timestamp: Date.now(),
          manipulationKind: op.kind,
          manipulation: op,
          proposal: null,
          accepted: null,
          confidence: null,
        });
        handleLLMError(set, err, 'proposing');
      }
    })();
  }

  /**
   * Route a canvas/panel manipulation's back-channel: run it now in "auto" sync
   * mode, or hold it (baseline IR + latest op) for a manual "Update spec" click.
   */
  function maybePropose(op: ManipulationOp, prevIR: IR): void {
    if (get().irSyncMode === 'auto') {
      propose(op, prevIR);
      return;
    }
    set((s) => ({ pendingSync: { op, prevIR: s.pendingSync?.prevIR ?? prevIR } }));
  }

  // --- Debounced Properties-panel back-channel ----------------------------
  // Each keystroke / slider tick writes the IR immediately (deterministic);
  // once the burst settles we diff the node against its pre-burst state and
  // run ONE Call B for the whole gesture.
  const pendingEdits = new Map<string, { beforeIR: IR; timer: ReturnType<typeof setTimeout> }>();

  function beginEdit(id: string): void {
    if (pendingEdits.has(id)) return;
    // First touch of a burst: remember the world before it and add ONE undo step.
    const beforeIR = get().ir;
    set((s) => ({ history: [...s.history, snapshot(s)].slice(-50) }));
    pendingEdits.set(id, { beforeIR, timer: setTimeout(() => undefined, 0) });
  }

  function settleEdit(id: string): void {
    const pending = pendingEdits.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      pendingEdits.delete(id);
      const before = pending.beforeIR.nodes.find((n) => n.id === id);
      const after = get().ir.nodes.find((n) => n.id === id);
      if (!before || !after) return;
      // A burst that ended where it started (typed and reverted) is a no-op.
      if (
        JSON.stringify([before.style, before.layout, before.content]) ===
        JSON.stringify([after.style, after.layout, after.content])
      ) {
        return;
      }
      maybePropose(
        {
          kind: 'restyle',
          id,
          before: { style: before.style, layout: before.layout, content: before.content },
          after: { style: after.style, layout: after.layout, content: after.content },
        },
        pending.beforeIR,
      );
    }, EDIT_SETTLE_MS);
  }

  function resetTransients(): Partial<AppState> {
    pendingEdits.forEach((p) => clearTimeout(p.timer));
    pendingEdits.clear();
    return {
      pendingProposal: null,
      pendingAffectedIds: [],
      selectedNodeId: null,
      selectedNodeIds: [],
      composerFocused: false,
      focusRequest: null,
      composerValue: emptyComposer(),
      recipes: [],
      lastSent: null,
      hoveredClauseId: null,
      hoveredParamNodeIds: null,
      recentIds: [],
      history: [],
      versions: [],
      clipboard: null,
      shortcutsOpen: false,
      unknownShortcutAt: null,
      pendingSync: null,
      inferences: {},
      annotations: [],
      demoPlan: null,
      demoBusy: false,
      error: null,
    };
  }

  return {
    ir: emptyIR(),
    prompt: emptyPrompt(),
    pendingProposal: null,
    pendingAffectedIds: [],
    selectedNodeId: null,
    selectedNodeIds: [],
    composerFocused: false,
    focusRequest: null,
    composerValue: emptyComposer(),
    recipes: [],
    lastSent: null,
    hoveredClauseId: null,
    hoveredParamNodeIds: null,
    recentIds: [],
    history: [],
    versions: [],
    tool: 'pointer',
    clipboard: null,
    shortcutsOpen: false,
    unknownShortcutAt: null,
    irSyncMode: 'auto',
    pendingSync: null,
    computedBounds: null,
    computedStyle: null,
    generating: false,
    proposing: false,
    error: null,
    needsConnect: false,

    inferences: {},
    annotations: [],
    demoPlan: null,
    demoBusy: false,

    loadSample: (id) => {
      const sample = SAMPLES.find((s) => s.id === id);
      if (!sample) return;
      set({
        ir: structuredClone(sample.ir),
        prompt: structuredClone(sample.prompt),
        ...resetTransients(),
      });
    },

    newBlank: () =>
      set({
        ir: emptyIR(),
        prompt: emptyPrompt(),
        ...resetTransients(),
      }),

    selectNode: (selectedNodeId) =>
      set({ selectedNodeId, selectedNodeIds: selectedNodeId ? [selectedNodeId] : [] }),

    toggleSelection: (id) =>
      set((s) => {
        const has = s.selectedNodeIds.includes(id);
        const selectedNodeIds = has
          ? s.selectedNodeIds.filter((x) => x !== id)
          : [...s.selectedNodeIds, id];
        return { selectedNodeIds, selectedNodeId: selectedNodeIds[selectedNodeIds.length - 1] ?? null };
      }),

    setSelection: (ids) =>
      set({ selectedNodeIds: ids, selectedNodeId: ids[ids.length - 1] ?? null }),

    promoteToAbsolute: (id, bounds) =>
      set((s) => {
        const node = s.ir.nodes.find((n) => n.id === id);
        const rootId = defaultParentId(s.ir);
        if (!node || id === rootId) return {};
        const order =
          s.ir.nodes.filter((n) => n.parentId === rootId).reduce((m, n) => Math.max(m, n.order), -1) + 1;
        return {
          history: [...s.history, snapshot(s)].slice(-50),
          ir: {
            ...s.ir,
            nodes: s.ir.nodes.map((n) =>
              n.id === id
                ? {
                    ...n,
                    parentId: rootId,
                    order,
                    layout: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
                    provenance: { ...n.provenance, source: 'user' },
                  }
                : n,
            ),
          },
          recentIds: [id],
        };
      }),

    setComposerFocused: (composerFocused) => set({ composerFocused }),
    setComposerValue: (composerValue) => set({ composerValue }),

    requestFocus: (target) =>
      set((s) => ({ focusRequest: { target, seq: (s.focusRequest?.seq ?? 0) + 1 } })),

    addComposerNodeRef: (nodeId) =>
      set((s) => {
        // Dedupe against existing NODE chips only (attribute/param chips also
        // carry a nodeId but represent a different reference).
        if (composerRefs(s.composerValue).some((r) => r.kind === 'node' && r.nodeId === nodeId)) {
          return {};
        }
        const node = s.ir.nodes.find((n) => n.id === nodeId);
        const snip = node?.content?.trim().slice(0, 16);
        const label = node ? (snip ? `${node.role} “${snip}”` : node.role) : nodeId;
        const ref: PromptRef = {
          kind: 'node',
          refId: nextComposerRefId(s.composerValue),
          nodeId,
          label,
        };
        return { composerValue: insertRef(s.composerValue, ref) };
      }),

    addComposerLocationRef: (x, y, nearNodeId) =>
      set((s) => {
        const coords = `(${Math.round(x)}, ${Math.round(y)})`;
        // A draft has a single "here/there" pin — repeated clicks MOVE it rather
        // than stacking new chips (which the word "here" in the draft would spam).
        if (composerRefs(s.composerValue).some((r) => r.kind === 'location')) {
          const composerValue = s.composerValue.map((seg) =>
            seg.type === 'ref' && seg.ref.kind === 'location'
              ? { ...seg, ref: { ...seg.ref, x, y, nearNodeId, label: `${keywordOf(seg.ref.label)} ${coords}` } }
              : seg,
          );
          return { composerValue };
        }
        // If the draft says "here"/"there", the pin REPLACES that word so the
        // sentence reads naturally with the chip standing in for the deixis. The
        // chip still shows the word plus the picked coordinates.
        const KEYWORD = /\b(here|there)\b/i;
        const match = s.composerValue
          .filter((seg): seg is { type: 'text'; text: string } => seg.type === 'text')
          .map((seg) => seg.text.match(KEYWORD)?.[0])
          .find(Boolean);
        const word = (match ?? 'here').toLowerCase();
        const ref: PromptRef = {
          kind: 'location',
          refId: nextComposerRefId(s.composerValue),
          x,
          y,
          nearNodeId,
          label: `${word} ${coords}`,
        };
        const replaced = match
          ? insertRefReplacingKeyword(s.composerValue, ref, KEYWORD)
          : null;
        return { composerValue: replaced ?? insertRef(s.composerValue, ref) };
      }),

    chooseAlternative: (clauseId, text) => {
      // A clause that describes a live component inference: picking one of the
      // other candidates is a deterministic component swap (wireframe rebuild),
      // not a re-realization through Call A.
      const s0 = get();
      const inf = Object.values(s0.inferences).find(
        (i) => i.clauseId === clauseId && i.status !== 'dismissed' && s0.ir.nodes.some((n) => n.id === i.nodeId),
      );
      const cand = inf?.candidates.find((c) => c.label.trim().toLowerCase() === text.trim().toLowerCase());
      if (inf && cand) {
        get().chooseComponent(inf.nodeId, cand.label);
        return;
      }
      set((s) => ({
        prompt: {
          clauses: s.prompt.clauses.map((c) =>
            c.id === clauseId ? { ...c, text, origin: 'explicit', status: undefined } : c,
          ),
        },
      }));
      scheduleCallA([clauseId]);
    },

    hoverClause: (hoveredClauseId) => set({ hoveredClauseId }),
    hoverParam: (nodeIds) => set({ hoveredParamNodeIds: nodeIds && nodeIds.length ? nodeIds : null }),

    restoreVersion: (id) => {
      const v = get().versions.find((entry) => entry.id === id);
      if (!v) return;
      set((s) => ({
        history: [...s.history, snapshot(s)].slice(-50),
        ir: v.ir,
        prompt: v.prompt,
        inferences: v.inferences ?? {},
        pendingProposal: null,
        pendingAffectedIds: [],
        pendingSync: null,
        selectedNodeId: null,
        selectedNodeIds: [],
        recentIds: [],
      }));
    },
    setTool: (tool) => set({ tool }),

    instruct: (message, opts = {}) => {
      const text = message.trim();
      if (!text) return;
      const scopeNodeIds = opts.scopeNodeIds?.filter(Boolean) ?? [];
      const refs = opts.refs ?? [];

      // Study log: one compose-gesture row per send, recording how it was
      // composed (typed vs. dragged/extracted/scoped/recipe). Logged up front so
      // even an errored send is counted as an attempted gesture.
      const signals = gestureSignals({ scopeNodeIds, refs, viaRecipe: opts.viaRecipe });
      logComposeGesture({
        timestamp: Date.now(),
        provenance: primaryProvenance(signals),
        signals,
        chipCount: refs.length,
        scoped: scopeNodeIds.length > 0,
        promptLength: text.length,
      });

      set({ generating: true, error: null });
      void (async () => {
        try {
          const { ir, prompt } = get();
          const result = await composeFromInstruction(ir, prompt, text, { scopeNodeIds, refs });
          set((s) => ({
            history: [...s.history, snapshot(s)].slice(-50),
            prompt: mergeClauses(s.prompt, result.updatedClauses, result.removedClauseIds),
            ir: applyPatch(s.ir, { ops: result.ops }),
            recentIds: [
              ...result.updatedClauses.map((c) => c.id),
              ...patchedIds({ ops: result.ops }),
            ],
            // A recipe re-application must not overwrite the user's last typed
            // instruction — otherwise "Save as recipe" would offer the already
            // expanded recipe text (with {selection} collapsed to literal prose).
            lastSent: opts.viaRecipe ? s.lastSent : text,
            generating: false,
          }));
          recordVersion(text.length > 40 ? `${text.slice(0, 40).trim()}…` : text);
          opts.onSettled?.(true);
        } catch (err) {
          handleLLMError(set, err, 'generating');
          opts.onSettled?.(false);
        }
      })();
    },

    addRecipe: (fromInstruction, label) => {
      const instruction = fromInstruction.trim();
      if (!instruction) return;
      // v1 abstraction (no LLM): store verbatim, with chip markers collapsed to a
      // {selection} slot so the command re-targets whatever is selected later.
      const templated = instruction.replace(/«ref_\d+»/g, '{selection}');
      set((s) => {
        const id = nextRecipeId(s.recipes.map((r) => r.id));
        const recipe: Recipe = {
          id,
          label: label?.trim() || deriveRecipeLabel(templated),
          instruction: templated,
          createdFrom: instruction,
          uses: 0,
        };
        return { recipes: [...s.recipes, recipe] };
      });
    },

    applyRecipe: (recipeId) => {
      const { recipes, selectedNodeIds } = get();
      const recipe = recipes.find((r) => r.id === recipeId);
      if (!recipe || selectedNodeIds.length === 0) return;
      // Re-applying a recipe IS a logged manipulation (study metric), even though
      // its realization goes through the prompt-authoritative compose path.
      logBackChannel({
        timestamp: Date.now(),
        manipulationKind: 'recipe',
        manipulation: { kind: 'recipe', id: `recipe_apply_${Date.now()}`, recipeId, instruction: recipe.instruction },
        proposal: null,
        accepted: null,
        confidence: null,
      });
      set((s) => ({
        recipes: s.recipes.map((r) => (r.id === recipeId ? { ...r, uses: r.uses + 1 } : r)),
      }));
      const text = recipe.instruction.replace(/\{selection\}/g, 'the selection');
      get().instruct(text, { scopeNodeIds: selectedNodeIds, viaRecipe: true });
    },

    editClause: (id, text) => {
      set((s) => ({
        // Editing a pending clause's wording also confirms it.
        prompt: { clauses: s.prompt.clauses.map((c) => (c.id === id ? { ...c, text, status: undefined } : c)) },
      }));
      scheduleCallA([id]);
    },

    removeClause: (id) => {
      set((s) => ({ prompt: { clauses: s.prompt.clauses.filter((c) => c.id !== id) } }));
      scheduleCallA([id]);
    },

    regenerate: () => void runCallA([]),

    manipulate: (op) => {
      const prevIR = get().ir;
      const { ir: nextIR, affectedIds } = applyManipulation(prevIR, op);
      set((s) => {
        // Drop inferences whose host node was deleted (keep the map bounded).
        let inferences = s.inferences;
        if (op.kind === 'delete') {
          const live = new Set(nextIR.nodes.map((n) => n.id));
          const pruned = Object.fromEntries(
            Object.entries(s.inferences).filter(([nodeId]) => live.has(nodeId)),
          );
          if (Object.keys(pruned).length !== Object.keys(s.inferences).length) inferences = pruned;
        }
        return {
          history: [...s.history, snapshot(s)].slice(-50),
          ir: nextIR,
          inferences,
          recentIds: affectedIds,
          selectedNodeId: op.kind === 'delete' ? null : s.selectedNodeId,
          selectedNodeIds:
            op.kind === 'delete'
              ? s.selectedNodeIds.filter((id) => !affectedIds.includes(id))
              : s.selectedNodeIds,
        };
      });
      useStudyStore.getState().logEvent('manipulation', { kind: op.kind });
      maybePropose(op, prevIR);
    },

    proposeManipulation: (op, prevIR) => maybePropose(op, prevIR),

    acceptProposal: (overrideText) => {
      const { pendingProposal } = get();
      if (!pendingProposal) return;
      // When the user rephrases or picks an alternative, the new wording lands on
      // the FIRST updated clause (the one the manipulation primarily changed).
      let clauses = pendingProposal.updatedClauses;
      if (overrideText && overrideText.trim() && clauses.length > 0) {
        clauses = clauses.map((c, i) => (i === 0 ? { ...c, text: overrideText.trim() } : c));
      }
      set((s) => ({
        prompt: mergeClauses(s.prompt, clauses, pendingProposal.removedClauseIds),
        pendingProposal: null,
        pendingAffectedIds: [],
        recentIds: clauses.map((c) => c.id),
      }));
      setLastDecision(true);
      recordVersion('Canvas sync');
    },

    discardProposal: () => {
      if (!get().pendingProposal) return;
      // Drop the proposed spec wording without folding it in. The IR edit it
      // describes is already applied; the user chose not to record it now.
      set({ pendingProposal: null, pendingAffectedIds: [] });
      setLastDecision(true);
    },

    copySelection: () =>
      set((s) => {
        if (s.selectedNodeIds.length === 0) return {};
        // Keep only top-level selected roots (a selected descendant is already
        // carried by its selected ancestor's subtree).
        const selected = new Set(s.selectedNodeIds);
        const roots = s.selectedNodeIds.filter((id) => {
          let p = s.ir.nodes.find((n) => n.id === id)?.parentId ?? null;
          while (p) {
            if (selected.has(p)) return false;
            p = s.ir.nodes.find((n) => n.id === p)?.parentId ?? null;
          }
          return true;
        });
        return { clipboard: collectSubtrees(s.ir, roots) };
      }),

    pasteClipboard: () => {
      const { clipboard } = get();
      if (!clipboard || clipboard.length === 0) return;
      set((s) => {
        const present = new Set(s.ir.nodes.map((n) => n.id));
        // Re-parent roots to their original parent if it still exists, else the
        // default frame; offset so the paste is visible.
        const resolveParent = (oldParentId: string | null): string | null =>
          oldParentId && present.has(oldParentId) ? oldParentId : defaultParentId(s.ir);
        const { ir, rootIds } = cloneNodes(s.ir, clipboard, resolveParent, { dx: 24, dy: 24 });
        return {
          history: [...s.history, snapshot(s)].slice(-50),
          ir,
          selectedNodeId: rootIds[rootIds.length - 1] ?? null,
          selectedNodeIds: rootIds,
          recentIds: rootIds,
        };
      });
    },

    duplicateNode: (id) => {
      const subtree = collectSubtrees(get().ir, [id]);
      if (subtree.length === 0) return null;
      let newId: string | null = null;
      set((s) => {
        const node = s.ir.nodes.find((n) => n.id === id);
        const resolveParent = () => node?.parentId ?? defaultParentId(s.ir);
        const { ir, rootIds } = cloneNodes(s.ir, subtree, resolveParent, { dx: 24, dy: 24 });
        newId = rootIds[0] ?? null;
        return {
          history: [...s.history, snapshot(s)].slice(-50),
          ir,
          selectedNodeId: newId,
          selectedNodeIds: newId ? [newId] : [],
          recentIds: rootIds,
        };
      });
      return newId;
    },

    setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen, unknownShortcutAt: null }),
    flagUnknownShortcut: () => set({ unknownShortcutAt: Date.now() }),

    setIrSyncMode: (mode) => {
      set({ irSyncMode: mode });
      // Switching back to auto flushes any change held while in manual mode.
      if (mode === 'auto') {
        const ps = get().pendingSync;
        if (ps) { set({ pendingSync: null }); propose(ps.op, ps.prevIR); }
      }
    },
    syncNow: () => {
      const ps = get().pendingSync;
      if (!ps) return;
      set({ pendingSync: null });
      propose(ps.op, ps.prevIR);
    },

    setComputedBounds: (bounds) => set({ computedBounds: bounds }),
    setComputedStyle: (style) => set({ computedStyle: style }),

    setClauseParam: (clauseId, span, value, original) => {
      const state = get();
      const clause = state.prompt.clauses.find((c) => c.id === clauseId);
      if (!clause) return;

      // 1. Deterministic IR write, preserving provenance (NOT diverged: a forward
      //    param edit keeps the node described by — linked to — its clause).
      let ir = state.ir;
      // A size/spacing slider the model left "prose only" (no bound nodes) still
      // ought to move the UI: fall back to the nodes this clause describes so the
      // change is visible on the canvas, not just in the sentence.
      const targetIds =
        span.nodeIds.length > 0
          ? span.nodeIds
          : span.kind === 'length' || span.kind === 'radius'
            ? ir.nodes.filter((n) => n.provenance.promptClauseId === clauseId).map((n) => n.id)
            : [];
      for (const nodeId of targetIds) {
        const before = ir.nodes.find((n) => n.id === nodeId);
        if (!before) continue;
        const prov = before.provenance;
        ir = writeParam(ir, before, span, value);
        ir = { ...ir, nodes: ir.nodes.map((n) => (n.id === nodeId ? { ...n, provenance: prov } : n)) };
      }
      if (span.kind === 'fontFamily') loadGoogleFont(familyFromStack(value) || value);

      // 2. Rewrite the parameter token in the clause prose; shift later spans.
      const baseText = original?.text ?? clause.text;
      const baseParams = original?.params ?? clause.params;
      const human = humanParamValue(span, value);
      let newText = clause.text;
      let newParams = clause.params;
      if (human !== null) {
        newText = baseText.slice(0, span.start) + human + baseText.slice(span.end);
        const delta = human.length - (span.end - span.start);
        if (baseParams) {
          newParams = baseParams.map((p) => {
            if (p.id === span.id) return { ...p, value, end: p.start + human.length };
            if (p.start >= span.end) return { ...p, start: p.start + delta, end: p.end + delta };
            return p;
          });
        }
      } else if (baseParams) {
        newParams = baseParams.map((p) => (p.id === span.id ? { ...p, value } : p));
      }

      // 3. One undo step per burst; flash; NO scheduleCallA, NO propose.
      const key = `${clauseId}:${span.id}`;
      const pushHistory = paramBurstKey !== key;
      paramBurstKey = key;
      if (paramBurstTimer) clearTimeout(paramBurstTimer);
      paramBurstTimer = setTimeout(() => {
        paramBurstKey = null;
        // One version per adjustment burst (a slider drag = one version).
        recordVersion(`Adjust ${span.kind}`);
      }, 800);

      set((s) => ({
        history: pushHistory ? [...s.history, snapshot(s)].slice(-50) : s.history,
        ir,
        prompt: {
          clauses: s.prompt.clauses.map((c) =>
            c.id === clauseId ? { ...c, text: newText, params: newParams } : c,
          ),
        },
        recentIds: span.nodeIds,
      }));
    },

    bindClauseParam: (clauseId, start, end, kind) => {
      set((s) => {
        const clause = s.prompt.clauses.find((c) => c.id === clauseId);
        if (!clause || start >= end || end > clause.text.length) return {};
        const owned = s.ir.nodes.filter((n) => n.provenance.promptClauseId === clauseId);
        const span = createManualSpan(clause, owned, start, end, kind);
        // Replace any model-emitted spans the new range overlaps — rebinding a
        // token to a different widget type is an explicit user gesture.
        const kept = (clause.params ?? []).filter((p) => p.end <= start || p.start >= end);
        return {
          history: [...s.history, snapshot(s)].slice(-50),
          prompt: {
            clauses: s.prompt.clauses.map((c) =>
              c.id === clauseId ? { ...c, params: [...kept, span] } : c,
            ),
          },
          recentIds: span.nodeIds,
        };
      });
    },

    createShape: ({ role, x, y, w, h, parentId, points }) => {
      const parent = parentId !== undefined ? parentId : defaultParentId(get().ir);
      let newId = '';
      set((s) => {
        const result = createNode(s.ir, {
          role,
          parentId: parent,
          layout: { x, y, w: Math.max(2, w), h: Math.max(2, h) },
          points,
        });
        newId = result.id;
        return {
          history: [...s.history, snapshot(s)].slice(-50),
          ir: result.ir,
          selectedNodeId: newId,
          selectedNodeIds: [newId],
          recentIds: [newId],
        };
      });
      return newId;
    },

    updateLayout: (id, patch) =>
      set((s) => ({ ir: updateNodeLayout(s.ir, id, patch), recentIds: [id] })),

    editStyle: (id, patch) => {
      beginEdit(id);
      set((s) => ({ ir: updateNodeStyle(s.ir, id, patch), recentIds: [id] }));
      settleEdit(id);
    },

    editLayout: (id, patch) => {
      beginEdit(id);
      set((s) => ({ ir: updateNodeLayout(s.ir, id, patch), recentIds: [id] }));
      settleEdit(id);
    },

    editContent: (id, content) => {
      beginEdit(id);
      set((s) => ({ ir: updateNodeContent(s.ir, id, content), recentIds: [id] }));
      settleEdit(id);
    },

    toggleHidden: (id) =>
      set((s) => ({ ir: toggleHidden(s.ir, id), recentIds: [id] })),

    // --- Component inference (draw a shape → semantic component + wireframe) ---

    inferDrawnShape: (nodeId, _prevIR) => {
      const s = get();
      const node = s.ir.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const candidates = inferComponentCandidates(node, s.ir);
      if (candidates.length === 0) return;
      const clauseId = nextClauseId(s.prompt.clauses.map((c) => c.id));
      const top = candidates[0];
      const clause: PromptClause = {
        id: clauseId,
        text: top.label,
        category: 'component',
        origin: 'inferred',
        alternatives: candidates.slice(1).map((c) => c.label),
        // Shown as a suggestion until the user accepts it (or picks a component).
        status: 'pending',
      };
      set((st) => ({
        // No history push here: createShape already snapshotted the pre-draw
        // state on mousedown, so the shape + its inferred clause undo as one step.
        prompt: { clauses: [...st.prompt.clauses, clause] },
        ir: {
          ...st.ir,
          nodes: st.ir.nodes.map((n) =>
            n.id === nodeId
              ? { ...n, provenance: { ...n.provenance, promptClauseId: clauseId } }
              : n,
          ),
        },
        inferences: {
          ...st.inferences,
          [nodeId]: { nodeId, clauseId, candidates, status: 'suggested', fill: 'empty' },
        },
        selectedNodeId: nodeId,
        selectedNodeIds: [nodeId],
        recentIds: [nodeId],
      }));
    },

    chooseComponent: (nodeId, label, fillArg) => {
      set((st) => {
        const inf = st.inferences[nodeId];
        const host = st.ir.nodes.find((n) => n.id === nodeId);
        if (!inf || !host) return {};
        // First pick → grey wireframe; switching variation → keep the user's fill
        // mode. An atomic component (no inner parts) reads as 'empty' without the
        // user asking for it, so that doesn't carry over to the next variation.
        const ids = st.ir.nodes.map((n) => n.id);
        const forcedEmpty =
          inf.fill === 'empty' && !!inf.chosen && wireframeChildren(host, inf.chosen, ids).length === 0;
        const want: WireframeFill =
          fillArg ?? (inf.status === 'chosen' && !forcedEmpty ? inf.fill : 'wireframe');
        let children =
          want === 'empty' ? [] : wireframeChildren(host, label, ids, wireframeBackdrop(st.ir, host));
        if (want === 'placeholder' && children.length)
          children = fillPlaceholders(children, label, host, wireframeBackdrop(st.ir, host));
        // Replace any previously-generated children of the host with the new ones.
        const removed = new Set(st.ir.nodes.filter((n) => n.parentId === nodeId).map((n) => n.id));
        const others = st.ir.nodes.filter((n) => !removed.has(n.id));
        // Keep the AlternativesMenu offering the other variations.
        const alternatives = inf.candidates.map((c) => c.label).filter((l) => l !== label);
        const selectionGone =
          st.selectedNodeIds.some((id) => removed.has(id)) ||
          (st.selectedNodeId != null && removed.has(st.selectedNodeId));
        return {
          history: [...st.history, snapshot(st)].slice(-50),
          ir: { ...st.ir, nodes: [...others, ...children] },
          prompt: {
            clauses: st.prompt.clauses.map((c) =>
              // Picking a component is an explicit confirmation of its clause.
              c.id === inf.clauseId
                ? { ...c, text: label, origin: 'inferred' as const, alternatives, status: undefined }
                : c,
            ),
          },
          inferences: {
            ...st.inferences,
            [nodeId]: { ...inf, chosen: label, status: 'chosen', fill: children.length ? want : 'empty' },
          },
          ...(selectionGone ? { selectedNodeId: nodeId, selectedNodeIds: [nodeId] } : {}),
          recentIds: children.length ? children.map((c) => c.id) : [nodeId],
        };
      });
    },

    revertWireframe: (nodeId) => {
      set((st) => {
        const inf = st.inferences[nodeId];
        if (!inf) return {};
        return {
          history: [...st.history, snapshot(st)].slice(-50),
          ir: { ...st.ir, nodes: st.ir.nodes.filter((n) => n.parentId !== nodeId) },
          inferences: { ...st.inferences, [nodeId]: { ...inf, fill: 'empty' } },
        };
      });
    },

    fillWireframePlaceholders: (nodeId) => {
      set((st) => {
        const inf = st.inferences[nodeId];
        if (!inf || !inf.chosen) return {};
        const children = st.ir.nodes.filter((n) => n.parentId === nodeId);
        if (children.length === 0) return {};
        const host = st.ir.nodes.find((n) => n.id === nodeId);
        const backdrop = host ? wireframeBackdrop(st.ir, host) : undefined;
        const byId = new Map(
          fillPlaceholders(children, inf.chosen, host, backdrop).map((n) => [n.id, n]),
        );
        return {
          history: [...st.history, snapshot(st)].slice(-50),
          ir: { ...st.ir, nodes: st.ir.nodes.map((n) => byId.get(n.id) ?? n) },
          inferences: { ...st.inferences, [nodeId]: { ...inf, fill: 'placeholder' } },
          recentIds: [...byId.keys()],
        };
      });
    },

    dismissInference: (nodeId) =>
      set((st) => {
        const inf = st.inferences[nodeId];
        if (!inf) return {};
        return { inferences: { ...st.inferences, [nodeId]: { ...inf, status: 'dismissed' } } };
      }),

    acceptClauses: (ids) =>
      set((st) => {
        const want = new Set(ids);
        if (!st.prompt.clauses.some((c) => want.has(c.id) && c.status === 'pending')) return {};
        return {
          history: [...st.history, snapshot(st)].slice(-50),
          prompt: {
            clauses: st.prompt.clauses.map((c) =>
              want.has(c.id) && c.status === 'pending' ? { ...c, status: undefined } : c,
            ),
          },
          recentIds: ids,
        };
      }),

    dismissClauses: (ids) =>
      set((st) => {
        const gone = new Set(
          st.prompt.clauses.filter((c) => ids.includes(c.id) && c.status === 'pending').map((c) => c.id),
        );
        if (gone.size === 0) return {};
        const inferences = { ...st.inferences };
        for (const inf of Object.values(st.inferences))
          if (gone.has(inf.clauseId)) inferences[inf.nodeId] = { ...inf, status: 'dismissed' };
        return {
          history: [...st.history, snapshot(st)].slice(-50),
          prompt: { clauses: st.prompt.clauses.filter((c) => !gone.has(c.id)) },
          ir: {
            ...st.ir,
            nodes: st.ir.nodes.map((n) =>
              n.provenance.promptClauseId && gone.has(n.provenance.promptClauseId)
                ? { ...n, provenance: { ...n.provenance, promptClauseId: null } }
                : n,
            ),
          },
          inferences,
          hoveredClauseId: st.hoveredClauseId && gone.has(st.hoveredClauseId) ? null : st.hoveredClauseId,
        };
      }),

    // --- Annotations / prompt-by-demonstration ---

    addAnnotation: (a) => set((st) => ({ annotations: [...st.annotations, a] })),
    updateAnnotation: (id, patch) =>
      set((st) => ({ annotations: st.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
    removeAnnotation: (id) =>
      set((st) => ({ annotations: st.annotations.filter((a) => a.id !== id) })),
    clearAnnotations: () => set({ annotations: [], demoPlan: null }),

    buildDemoPlan: (boxes) => {
      const s = get();
      const labelOf = (id: string) => {
        const n = s.ir.nodes.find((x) => x.id === id);
        if (!n) return id;
        const txt = n.content?.trim();
        return txt ? `${n.role} "${txt.slice(0, 24)}"` : n.role;
      };
      let seq = 0;
      const plan = buildDemoPlanPure(s.annotations, boxes, labelOf, () => `plan_${++seq}`, s.ir.nodes);
      set({ demoPlan: plan });
    },

    updateDemoPlanItem: (id, patch) =>
      set((st) => ({
        demoPlan: st.demoPlan
          ? st.demoPlan.map((p) => (p.id === id ? withEditedIntent(p, patch) : p))
          : st.demoPlan,
      })),
    removeDemoPlanItem: (id) =>
      set((st) => ({ demoPlan: st.demoPlan ? st.demoPlan.filter((p) => p.id !== id) : st.demoPlan })),
    cancelDemoPlan: () => set({ demoPlan: null }),

    confirmDemoPlan: () => {
      const s = get();
      const plan = s.demoPlan;
      if (!plan || plan.length === 0) {
        set({ demoPlan: null });
        return;
      }
      // Recognised gestures (cross-out, arrow, swap) are applied right here on
      // the IR, one undoable manipulation each, and their markup is cleared so
      // a later retry of the model part can never re-apply them.
      const local = plan.filter((p) => p.intent && intentOps(p.intent, get().ir).length > 0);
      for (const item of local) {
        for (const op of intentOps(item.intent!, get().ir)) get().manipulate(op);
      }
      const applied = new Set(local.map((p) => p.annotationId));
      const remote = plan.filter((p) => !local.includes(p));
      if (remote.length === 0) {
        set({ demoPlan: null, annotations: [] });
        return;
      }
      if (applied.size > 0) {
        set((st) => ({ annotations: st.annotations.filter((a) => !applied.has(a.id)) }));
      }

      const labelOf = (id: string) => {
        const n = s.ir.nodes.find((x) => x.id === id);
        if (!n) return id;
        const t = n.content?.trim();
        return t ? `the ${n.role} "${t.slice(0, 24)}"` : `the ${n.role}`;
      };
      let refSeq = 0;
      const refs: PromptRef[] = [];
      const lines = remote.map((p) => {
        const tgt = p.targetNodeIds.length
          ? ` (${p.targetNodeIds.map(labelOf).join(', ')})`
          : '';
        // An arrow's head is a concrete destination: hand it over as a location
        // reference instead of leaving the model to guess "where it points".
        const a = s.annotations.find((x) => x.id === p.annotationId);
        const head = a?.kind === 'arrow' && a.points && a.points.length > 1 ? a.points[a.points.length - 1] : null;
        let where = '';
        if (head) {
          const refId = `ref_${++refSeq}`;
          refs.push({
            kind: 'location', refId, x: head.x, y: head.y, label: 'arrow head',
            nearNodeId: p.targetNodeIds[0],
          });
          where = ` [arrow points at «${refId}»]`;
        }
        return `- ${p.instruction}${tgt}${where}`;
      });
      const message = `Apply these changes I marked up on the canvas:\n${lines.join('\n')}`;
      const scopeNodeIds = Array.from(new Set(remote.flatMap((p) => p.targetNodeIds)));
      for (const p of remote) {
        for (const dataUrl of p.images ?? []) {
          refs.push({ kind: 'image', refId: `ref_${++refSeq}`, label: 'comment image', dataUrl });
        }
      }
      // Close the plan and mark busy, but KEEP the annotations until the compose
      // actually succeeds, so markup (and dropped images) isn't lost if the call
      // fails (not connected, rate-limited, network). demoBusy hides the re-send
      // button so the same annotations can't be dispatched twice concurrently.
      set({ demoPlan: null, demoBusy: true });
      get().instruct(message, {
        scopeNodeIds: scopeNodeIds.length ? scopeNodeIds : undefined,
        refs: refs.length ? refs : undefined,
        onSettled: (ok) => set(ok ? { annotations: [], demoBusy: false } : { demoBusy: false }),
      });
    },

    undo: () =>
      set((s) => {
        const prev = s.history[s.history.length - 1];
        if (!prev) return s;
        pendingEdits.forEach((p) => clearTimeout(p.timer));
        pendingEdits.clear();
        return {
          ir: prev.ir,
          prompt: prev.prompt,
          inferences: prev.inferences,
          history: s.history.slice(0, -1),
          pendingProposal: null,
          pendingAffectedIds: [],
          pendingSync: null,
          recentIds: [],
        };
      }),

    dismissError: () => set({ error: null, needsConnect: false }),
  };
});

type Setter = (
  state: Partial<AppState> | ((s: AppState) => Partial<AppState>),
) => void;

function handleLLMError(set: Setter, err: unknown, flag: 'generating' | 'proposing'): void {
  if (err instanceof NotConnectedError) {
    set({ [flag]: false, needsConnect: true, error: err.message } as Partial<AppState>);
  } else if (err instanceof LLMError) {
    set({ [flag]: false, error: err.message } as Partial<AppState>);
  } else {
    set({ [flag]: false, error: err instanceof Error ? err.message : 'Unknown LLM error.' } as Partial<AppState>);
  }
}
