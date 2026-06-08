import { create } from 'zustand';
import type {
  ClauseCategory,
  IR,
  IRPatch,
  ManipulationOp,
  NodeRole,
  NodeStyle,
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
import { nextClauseId } from '@/ir/ids';
import { SAMPLES, emptyIR, emptyPrompt } from '@/ir/samples';
import { generatePatch, proposePromptUpdate, NotConnectedError } from '@/llm/client';
import { LLMError } from '@/llm/providers';
import { logBackChannel, setLastDecision } from '@/lib/log';

/** Tool palette modes (deterministic drawing). */
export type Tool = 'pointer' | 'rectangle' | 'circle' | 'line' | 'text';
export const DRAWING_TOOLS: Tool[] = ['rectangle', 'circle', 'line', 'text'];
export function toolToRole(tool: Tool): NodeRole | null {
  switch (tool) {
    case 'rectangle': return 'rectangle';
    case 'circle': return 'circle';
    case 'line': return 'line';
    case 'text': return 'text';
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

  generating: boolean; // Call A in flight
  proposing: boolean; // Call B in flight
  error: string | null;
  needsConnect: boolean;

  loadSample: (id: string) => void;
  newBlank: () => void;
  selectNode: (id: string | null) => void;
  hoverClause: (id: string | null) => void;
  setTool: (tool: Tool) => void;

  editClause: (id: string, text: string) => void;
  addClause: (text: string, category: ClauseCategory) => void;
  removeClause: (id: string) => void;
  regenerate: () => void;

  manipulate: (op: ManipulationOp) => void;
  acceptProposal: () => void;
  rejectProposal: () => void;

  // Deterministic editing (no LLM, no back-channel proposal).
  createShape: (params: { role: NodeRole; x: number; y: number; w: number; h: number; parentId?: string | null }) => string;
  updateLayout: (id: string, patch: Partial<{ x: number; y: number; w: number; h: number }>) => void;
  updateStyle: (id: string, patch: Partial<NodeStyle>) => void;
  updateContent: (id: string, content: string) => void;
  toggleHidden: (id: string) => void;

  undo: () => void;
  dismissError: () => void;
}

const DEBOUNCE_MS = 700;
let callATimer: ReturnType<typeof setTimeout> | null = null;

function snapshot(s: AppState): Snapshot {
  return { ir: s.ir, prompt: s.prompt };
}

function patchedIds(patch: IRPatch): string[] {
  return patch.ops.map((op) => (op.type === 'add' ? op.node.id : op.id));
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
        pendingProposal: null,
        pendingAffectedIds: [],
        selectedNodeId: null,
        hoveredClauseId: null,
        recentIds: [],
        history: [],
        error: null,
      });
    },

    newBlank: () =>
      set({
        ir: emptyIR(),
        prompt: emptyPrompt(),
        pendingProposal: null,
        pendingAffectedIds: [],
        selectedNodeId: null,
        hoveredClauseId: null,
        recentIds: [],
        history: [],
        error: null,
      }),

    selectNode: (selectedNodeId) => set({ selectedNodeId }),
    hoverClause: (hoveredClauseId) => set({ hoveredClauseId }),
    setTool: (tool) => set({ tool }),

    editClause: (id, text) => {
      set((s) => ({
        prompt: { clauses: s.prompt.clauses.map((c) => (c.id === id ? { ...c, text } : c)) },
      }));
      scheduleCallA([id]);
    },

    addClause: (text, category) => {
      const id = nextClauseId(get().prompt.clauses.map((c) => c.id));
      set((s) => ({ prompt: { clauses: [...s.prompt.clauses, { id, text, category }] } }));
      scheduleCallA([id]);
    },

    removeClause: (id) => {
      set((s) => ({ prompt: { clauses: s.prompt.clauses.filter((c) => c.id !== id) } }));
      scheduleCallA([id]);
    },

    regenerate: () => void runCallA([]),

    manipulate: (op) => {
      const prev = get();
      const prevIR = prev.ir;
      const { ir: nextIR, affectedIds } = applyManipulation(prevIR, op);

      set((s) => ({
        history: [...s.history, snapshot(s)].slice(-50),
        ir: nextIR,
        recentIds: affectedIds,
        selectedNodeId: op.kind === 'delete' ? null : s.selectedNodeId,
        pendingProposal: null,
        pendingAffectedIds: affectedIds,
        proposing: true,
        error: null,
      }));

      void (async () => {
        try {
          const proposal = await proposePromptUpdate(prevIR, nextIR, prev.prompt, op);
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
    },

    acceptProposal: () => {
      const { pendingProposal } = get();
      if (!pendingProposal) return;
      set((s) => {
        const removed = new Set(pendingProposal.removedClauseIds);
        const updatedById = new Map(pendingProposal.updatedClauses.map((c) => [c.id, c]));
        const merged = s.prompt.clauses
          .filter((c) => !removed.has(c.id))
          .map((c) => updatedById.get(c.id) ?? c);
        for (const c of pendingProposal.updatedClauses) {
          if (!merged.some((m) => m.id === c.id)) merged.push(c);
        }
        return {
          prompt: { clauses: merged },
          pendingProposal: null,
          pendingAffectedIds: [],
          recentIds: pendingProposal.updatedClauses.map((c) => c.id),
        };
      });
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

    createShape: ({ role, x, y, w, h, parentId }) => {
      const parent = parentId !== undefined ? parentId : defaultParentId(get().ir);
      let newId = '';
      set((s) => {
        const result = createNode(s.ir, {
          role,
          parentId: parent,
          layout: { x, y, w: Math.max(2, w), h: Math.max(2, h) },
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

    updateStyle: (id, patch) =>
      set((s) => ({
        history: [...s.history, snapshot(s)].slice(-50),
        ir: updateNodeStyle(s.ir, id, patch),
        recentIds: [id],
      })),

    updateContent: (id, content) =>
      set((s) => ({ ir: updateNodeContent(s.ir, id, content), recentIds: [id] })),

    toggleHidden: (id) =>
      set((s) => ({ ir: toggleHidden(s.ir, id), recentIds: [id] })),

    undo: () =>
      set((s) => {
        const prev = s.history[s.history.length - 1];
        if (!prev) return s;
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
