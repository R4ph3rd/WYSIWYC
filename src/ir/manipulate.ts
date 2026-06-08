import type { IR, IRNode, ManipulationOp } from './types';
import { siblingsOf } from './tree';
import { setUtility, setAlignment } from './tailwindEdit';

export interface ManipulationResult {
  ir: IR;
  affectedIds: string[];
}

/**
 * Apply a direct-manipulation op to the IR. Pure and deterministic — NO LLM.
 * Every touched node is marked `provenance.source = "user"` (it was last set by
 * the user); whether it stays linked to the prompt is decided later by
 * accept/reject of the Call B proposal (see store/appStore.ts).
 */
export function applyManipulation(ir: IR, op: ManipulationOp): ManipulationResult {
  switch (op.kind) {
    case 'delete':
      return removeSubtree(ir, op.id);

    case 'recolor':
      return patchNodes(ir, [op.id], (n) => ({
        ...n,
        tailwind: setUtility(n.tailwind, op.token),
      }));

    case 'resize':
      return patchNodes(ir, [op.id], (n) => ({
        ...n,
        layout: { ...n.layout, ...op.to },
      }));

    case 'move':
      return patchNodes(ir, [op.id], (n) => ({
        ...n,
        layout: { ...n.layout, ...op.to },
      }));

    case 'reorder':
      return reorder(ir, op.id, op.to);

    case 'align':
      return align(ir, op.ids, op.axis);
  }
}

function markUser(node: IRNode): IRNode {
  return { ...node, provenance: { ...node.provenance, source: 'user' } };
}

function patchNodes(
  ir: IR,
  ids: string[],
  fn: (n: IRNode) => IRNode,
): ManipulationResult {
  const set = new Set(ids);
  const nodes = ir.nodes.map((n) => (set.has(n.id) ? markUser(fn(n)) : n));
  return { ir: { ...ir, nodes }, affectedIds: ids };
}

function removeSubtree(ir: IR, rootId: string): ManipulationResult {
  const toRemove = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of ir.nodes) {
      if (n.parentId && toRemove.has(n.parentId) && !toRemove.has(n.id)) {
        toRemove.add(n.id);
        grew = true;
      }
    }
  }
  const nodes = ir.nodes.filter((n) => !toRemove.has(n.id));
  return { ir: { ...ir, nodes }, affectedIds: Array.from(toRemove) };
}

/** Move a node to a new index among its siblings; renumber orders compactly. */
function reorder(ir: IR, id: string, toIndex: number): ManipulationResult {
  const sibs = siblingsOf(ir, id);
  const fromIndex = sibs.findIndex((n) => n.id === id);
  if (fromIndex === -1) return { ir, affectedIds: [] };

  const ordered = [...sibs];
  const [moved] = ordered.splice(fromIndex, 1);
  const clamped = Math.max(0, Math.min(ordered.length, toIndex));
  ordered.splice(clamped, 0, moved);

  const orderById = new Map(ordered.map((n, i) => [n.id, i]));
  const affected = ordered.map((n) => n.id);
  const nodes = ir.nodes.map((n) => {
    if (!orderById.has(n.id)) return n;
    const next = { ...n, order: orderById.get(n.id)! };
    return n.id === id ? markUser(next) : next;
  });
  return { ir: { ...ir, nodes }, affectedIds: [id, ...affected.filter((x) => x !== id)] };
}

function align(ir: IR, ids: string[], axis: 'left' | 'center' | 'right'): ManipulationResult {
  const cls = axis === 'left' ? 'text-left' : axis === 'right' ? 'text-right' : 'text-center';
  return patchNodes(ir, ids, (n) => ({ ...n, tailwind: setAlignment(n.tailwind, cls) }));
}
