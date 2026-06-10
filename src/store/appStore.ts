import { create } from 'zustand';
import type {
  IR,
  IRPatch,
  ManipulationOp,
  NodeRole,
  NodeStyle,
  PathPoint,
  PromptUpdateProposal,
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
import { logBackChannel, setLastDecision } from '@/lib/log';

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
  selectedNodeId: string | null;
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
  hoverClause: (id: string | null) => void;
  setTool: (tool: Tool) => void;

  /** Lovable-style entry point: a freeform NL instruction → spec + IR, one call. */
  instruct: (message: string) => void;
  editClause: (id: string, text: string) => void;
  removeClause: (id: string) => void;
  regenerate: () => void;

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

    selectNode: (selectedNodeId) => set({ selectedNodeId }),
    hoverClause: (hoveredClauseId) => set({ hoveredClauseId }),
    setTool: (tool) => set({ tool }),

    instruct: (message) => {
      const text = message.trim();
      if (!text) return;
      set({ generating: true, error: null });
      void (async () => {
        try {
          const { ir, prompt } = get();
          const result = await composeFromInstruction(ir, prompt, text);
          set((s) => ({
            history: [...s.history, snapshot(s)].slice(-50),
            prompt: mergeClauses(s.prompt, result.updatedClauses, result.removedClauseIds),
            ir: applyPatch(s.ir, { ops: result.ops }),
            recentIds: [
              ...result.updatedClauses.map((c) => c.id),
              ...patchedIds({ ops: result.ops }),
            ],
            generating: false,
          }));
        } catch (err) {
          handleLLMError(set, err, 'generating');
        }
      })();
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
