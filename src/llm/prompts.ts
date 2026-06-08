import type { IR, ManipulationOp, StructuredPrompt } from '@/ir/types';
import { nextNodeId } from '@/ir/ids';

// --- Call A: Prompt → IR patch -------------------------------------------

export const CALL_A_SYSTEM = `You are a UI compositor. Given a structured prompt and the current scene graph, output the minimal patch (a list of ops) to make the scene match the prompt.

Rules:
- Reuse existing node IDs. Only create new IDs for genuinely new elements. NEVER renumber existing nodes.
- The scene graph is FLAT: every node has a parentId (null for the root). Express structure via parentId + order, not nested JSON.
- Author production-quality Tailwind in each node's "tailwind" field: a consistent 4/8px spacing scale, one primary color, neutral grays, rounded-lg/xl, subtle shadows. Aim for Linear / Vercel / v0-grade polish — a real designed UI, not a wireframe. Use gradients, ring-1, shadow-* and proper type scale where appropriate.
- The "tailwind" field is where visual richness lives — the renderer is generic and applies it verbatim.
- Set provenance.promptClauseId on every node you add or change to the clause id that motivated it, and provenance.source to "llm".
- Emit the SMALLEST patch that satisfies the change. Do not rewrite untouched nodes.
- There must be exactly one root node (parentId null), typically a role:"frame" that centers/lays out the screen.`;

export function callAUser(ir: IR, prompt: StructuredPrompt, changedClauseIds: string[]): string {
  const suggestedId = nextNodeId(ir.nodes.map((n) => n.id));
  return [
    `Current scene graph (IR):`,
    '```json',
    JSON.stringify(ir, null, 2),
    '```',
    '',
    `Full structured prompt:`,
    '```json',
    JSON.stringify(prompt, null, 2),
    '```',
    '',
    changedClauseIds.length
      ? `Clauses that just changed: ${changedClauseIds.join(', ')}. Patch only what these require.`
      : `The IR is empty — generate the full UI for this prompt.`,
    '',
    `If you add new nodes, allocate fresh ids starting at "${suggestedId}" and counting up. Output the patch.`,
  ].join('\n');
}

// --- Call B: IR delta → Prompt update ------------------------------------

export const CALL_B_SYSTEM = `You translate a direct manipulation of a UI into an update to its natural-language specification (a list of clauses).

Rules:
- Infer INTENT, not raw coordinates. "Moved 40px right and down, now under the form" → "Place the CTA below the form", NOT "move button 40px".
- Only touch clauses affected by this manipulation. Preserve all others verbatim (do not return them).
- Return updatedClauses (clauses to add or replace, keyed by stable id — reuse the existing clause id when editing one) and removedClauseIds.
- deltaDescription is ONE plain sentence shown to the user for confirm/reject.
- If intent is ambiguous, set confidence "low" and pick the most likely semantic reading.`;

export function describeManipulation(op: ManipulationOp): string {
  switch (op.kind) {
    case 'recolor':
      return `Recolored node ${op.id}: applied Tailwind class "${op.token}" (was "${op.from || 'default'}").`;
    case 'resize':
      return `Resized node ${op.id} to ${JSON.stringify(op.to)} (from ${JSON.stringify(op.from)}).`;
    case 'move':
      return `Moved node ${op.id} to ${JSON.stringify(op.to)} (from ${JSON.stringify(op.from)}).`;
    case 'reorder':
      return `Reordered node ${op.id} among its siblings from index ${op.from} to ${op.to}.`;
    case 'delete':
      return `Deleted node ${op.id} and its descendants.`;
    case 'align':
      return `Aligned nodes ${op.ids.join(', ')} to ${op.axis}.`;
  }
}

export function callBUser(
  prevIR: IR,
  nextIR: IR,
  prevPrompt: StructuredPrompt,
  op: ManipulationOp,
): string {
  return [
    `Previous prompt clauses:`,
    '```json',
    JSON.stringify(prevPrompt, null, 2),
    '```',
    '',
    `Raw manipulation: ${describeManipulation(op)}`,
    '',
    `Previous IR (excerpt of relevant nodes is fine to reason over):`,
    '```json',
    JSON.stringify(prevIR.nodes.filter((n) => relevant(op, n.id)), null, 2),
    '```',
    '',
    `New IR (same nodes after the manipulation):`,
    '```json',
    JSON.stringify(nextIR.nodes.filter((n) => relevant(op, n.id)), null, 2),
    '```',
    '',
    `Produce the prompt update proposal.`,
  ].join('\n');
}

function relevant(op: ManipulationOp, id: string): boolean {
  if (op.kind === 'align') return op.ids.includes(id);
  return op.id === id;
}
