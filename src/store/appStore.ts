import { create } from 'zustand';
import type {
  IR,
  IRPatch,
  ManipulationOp,
  NodeRole,
  NodeStyle,
  PathPoint,
  PromptRef,
  PromptUpdateProposal,
  Recipe,
  StructuredPrompt,
} from '@/ir/types';
import { applyPatch } from '@/ir/applyPatch';
import {
  applyManipulation,
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
  /** Saved reusable commands (DirectGPT toolbar). Project-scoped, not persisted. */
  recipes: Recipe[];
  /** The marker-interpolated text of the last successful compose send (for "Save as recipe"). */
  lastSent: string | null;
  hoveredClauseId: string | null;
  recentIds: string[];
  history: Snapshot[];
  tool: Tool;

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
  acceptProposal: () => void;
  rejectProposal: () => void;

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
      propose(
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
      recipes: [],
      lastSent: null,
      hoveredClauseId: null,
      recentIds: [],
      history: [],
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
    recipes: [],
    lastSent: null,
    hoveredClauseId: null,
    recentIds: [],
    history: [],
    tool: 'pointer',
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
            lastSent: text,
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
      propose(op, prevIR);
    },

    proposeManipulation: (op, prevIR) => propose(op, prevIR),

    acceptProposal: () => {
      const { pendingProposal } = get();
      if (!pendingProposal) return;
      set((s) => ({
        prompt: mergeClauses(s.prompt, pendingProposal.updatedClauses, pendingProposal.removedClauseIds),
        pendingProposal: null,
        pendingAffectedIds: [],
        recentIds: pendingProposal.updatedClauses.map((c) => c.id),
      }));
      setLastDecision(true);
    },

    rejectProposal: () => {
      const { pendingProposal, pendingAffectedIds } = get();
      if (!pendingProposal) return;
      // Reject semantics: keep the IR change, discard the prompt edit, mark
      // affected nodes diverged (source=user, promptClauseId=null).
      set((s) => ({
        ir: {
          ...s.ir,
          nodes: s.ir.nodes.map((n) =>
            pendingAffectedIds.includes(n.id)
              ? { ...n, provenance: { source: 'user', promptClauseId: null } }
              : n,
          ),
        },
        pendingProposal: null,
        pendingAffectedIds: [],
      }));
      setLastDecision(false);
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
