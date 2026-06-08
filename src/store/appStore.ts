import { create } from 'zustand';
import type {
  ClauseCategory,
  IR,
  IRPatch,
  ManipulationOp,
  PromptUpdateProposal,
  StructuredPrompt,
} from '@/ir/types';
import { applyPatch } from '@/ir/applyPatch';
import { applyManipulation } from '@/ir/manipulate';
import { nextClauseId } from '@/ir/ids';
import { SAMPLES, emptyIR, emptyPrompt } from '@/ir/samples';
import { generatePatch, proposePromptUpdate, LLMUnavailableError } from '@/llm/client';
import { logBackChannel, setLastDecision } from '@/lib/log';

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

  generating: boolean; // Call A in flight
  proposing: boolean; // Call B in flight
  error: string | null;
  needsBackend: boolean;

  loadSample: (id: string) => void;
  newBlank: () => void;
  selectNode: (id: string | null) => void;
  hoverClause: (id: string | null) => void;

  editClause: (id: string, text: string) => void;
  addClause: (text: string, category: ClauseCategory) => void;
  removeClause: (id: string) => void;
  regenerate: () => void;

  manipulate: (op: ManipulationOp) => void;
  acceptProposal: () => void;
  rejectProposal: () => void;

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

export const useAppStore = create<AppState>((set, get) => {
  // Shared Call A runner (debounced by callers that need it).
  async function runCallA(changedClauseIds: string[]): Promise<void> {
    const { ir, prompt } = get();
    if (prompt.clauses.length === 0) {
      // Nothing to generate from — clear the canvas.
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
      if (err instanceof LLMUnavailableError) {
        set({ generating: false, needsBackend: true, error: err.message });
      } else {
        set({ generating: false, error: err instanceof Error ? err.message : 'Generation failed.' });
      }
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
    generating: false,
    proposing: false,
    error: null,
    needsBackend: false,

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

    editClause: (id, text) => {
      set((s) => ({
        prompt: {
          clauses: s.prompt.clauses.map((c) => (c.id === id ? { ...c, text } : c)),
        },
      }));
      scheduleCallA([id]);
    },

    addClause: (text, category) => {
      const id = nextClauseId(get().prompt.clauses.map((c) => c.id));
      set((s) => ({
        prompt: { clauses: [...s.prompt.clauses, { id, text, category }] },
      }));
      scheduleCallA([id]);
    },

    removeClause: (id) => {
      set((s) => ({
        prompt: { clauses: s.prompt.clauses.filter((c) => c.id !== id) },
      }));
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

      // Lossy back-channel: propose a prompt update for the manipulation.
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
          if (err instanceof LLMUnavailableError) {
            set({ proposing: false, needsBackend: true, error: err.message });
          } else {
            set({ proposing: false, error: err instanceof Error ? err.message : 'Back-channel failed.' });
          }
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
        // Append genuinely new clauses (ids not already present).
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
      // Reject semantics (§3): keep the IR change, discard the prompt edit, and
      // mark affected nodes as diverged (source=user, promptClauseId=null).
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

    dismissError: () => set({ error: null }),
  };
});
