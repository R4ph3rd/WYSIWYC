import type { IR, IRNode, IRPatch } from './types';

/**
 * Apply an LLM-emitted patch to the IR deterministically. Pure — returns a new
 * IR, never mutates the input. Unknown-id updates/removes are ignored (the model
 * occasionally references a node that no longer exists); add ops with a
 * colliding id replace the existing node so re-running a prompt is idempotent.
 */
export function applyPatch(ir: IR, patch: IRPatch): IR {
  const byId = new Map<string, IRNode>(ir.nodes.map((n) => [n.id, n]));

  for (const op of patch.ops) {
    switch (op.type) {
      case 'add': {
        byId.set(op.node.id, normalizeNode(op.node));
        break;
      }
      case 'update': {
        const existing = byId.get(op.id);
        if (!existing) break;
        byId.set(op.id, mergeNode(existing, op.props));
        break;
      }
      case 'remove': {
        byId.delete(op.id);
        // Re-parent or drop orphans whose parent just disappeared.
        for (const [id, node] of byId) {
          if (node.parentId === op.id) {
            byId.set(id, { ...node, parentId: null });
          }
        }
        break;
      }
      case 'reorder': {
        const existing = byId.get(op.id);
        if (!existing) break;
        byId.set(op.id, { ...existing, order: op.order });
        break;
      }
    }
  }

  return { ...ir, nodes: Array.from(byId.values()) };
}

function normalizeNode(node: IRNode): IRNode {
  return {
    ...node,
    parentId: node.parentId ?? null,
    order: node.order ?? 0,
    tailwind: node.tailwind ?? '',
    provenance: node.provenance ?? { promptClauseId: null, source: 'llm' },
  };
}

function mergeNode(existing: IRNode, props: Partial<IRNode>): IRNode {
  return {
    ...existing,
    ...props,
    // Keep id stable no matter what the patch says.
    id: existing.id,
    layout: props.layout ? { ...existing.layout, ...props.layout } : existing.layout,
    provenance: props.provenance
      ? { ...existing.provenance, ...props.provenance }
      : existing.provenance,
  };
}
