import { create } from 'zustand';
import type {
  ComposerValue,
  IR,
  IRNode,
  IRPatch,
  ManipulationOp,
  NodeRole,
  NodeStyle,
  ParamSpan,
  PathPoint,
  PromptRef,
  PromptUpdateProposal,
  Recipe,
  StructuredPrompt,
} from '@/ir/types';
import { setAlignment, setUtility } from '@/ir/tailwindEdit';
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
import { nextRecipeId } from '@/ir/ids';

/** Options for a compose send (DirectGPT scope + reference chips + recipe). */
export interface InstructOptions {
  scopeNodeIds?: string[];
  refs?: PromptRef[];
  /** True when this send was triggered by re-applying a Recipe. */
  viaRecipe?: boolean;
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

/** Tool palette modes (deterministic drawing). */
export type Tool = 'pointer' | 'rectangle' | 'circle' | 'line' | 'path' | 'text';
export const DRAWING_TOOLS: Tool[] = ['rectangle', 'circle', 'line', 'path', 'text'];
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
  recentIds: string[];
  history: Snapshot[];
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

  loadSample: (id: string) => void;
  newBlank: () => void;
  selectNode: (id: string | null) => void;
  /** Shift-click: toggle a node in/out of the multi-selection. */
  toggleSelection: (id: string) => void;
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

function snapshot(s: AppState): Snapshot {
  return { ir: s.ir, prompt: s.prompt };
}

function patchedIds(patch: IRPatch): string[] {
  return patch.ops.map((op) => (op.type === 'add' ? op.node.id : op.id));
}

function affectedIdsOf(op: ManipulationOp): string[] {
  return op.kind === 'align' ? op.ids : [op.id];
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

/** The human-readable prose form of a value (null = leave the clause token unchanged). */
function humanParamValue(span: ParamSpan, value: string): string | null {
  switch (span.kind) {
    case 'shadow':
      return null; // a CSS box-shadow string would be unreadable in prose
    case 'length':
    case 'radius':
      return `${value}${span.unit ?? 'px'}`;
    case 'shape':
      return value; // the shape word itself ("round", "square", etc.)
    default:
      return value; // color hex, font family, weight, align word, enum, free text
  }
}

export const useAppStore = create<AppState>((set, get) => {
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
      recentIds: [],
      history: [],
      clipboard: null,
      shortcutsOpen: false,
      unknownShortcutAt: null,
      pendingSync: null,
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
    recentIds: [],
    history: [],
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
      set((s) => ({
        prompt: {
          clauses: s.prompt.clauses.map((c) =>
            c.id === clauseId ? { ...c, text, origin: 'explicit' } : c,
          ),
        },
      }));
      scheduleCallA([clauseId]);
    },

    hoverClause: (hoveredClauseId) => set({ hoveredClauseId }),
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
        } catch (err) {
          handleLLMError(set, err, 'generating');
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
        prompt: { clauses: s.prompt.clauses.map((c) => (c.id === id ? { ...c, text } : c)) },
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
      set((s) => ({
        history: [...s.history, snapshot(s)].slice(-50),
        ir: nextIR,
        recentIds: affectedIds,
        selectedNodeId: op.kind === 'delete' ? null : s.selectedNodeId,
        selectedNodeIds:
          op.kind === 'delete'
            ? s.selectedNodeIds.filter((id) => !affectedIds.includes(id))
            : s.selectedNodeIds,
      }));
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
      for (const nodeId of span.nodeIds) {
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
      paramBurstTimer = setTimeout(() => { paramBurstKey = null; }, 800);

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

    undo: () =>
      set((s) => {
        const prev = s.history[s.history.length - 1];
        if (!prev) return s;
        pendingEdits.forEach((p) => clearTimeout(p.timer));
        pendingEdits.clear();
        return {
          ir: prev.ir,
          prompt: prev.prompt,
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
