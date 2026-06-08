import type { IR, IRNode } from './types';

export interface IRTreeNode {
  node: IRNode;
  children: IRTreeNode[];
}

/**
 * Derive a render tree from the flat node array. Roots are nodes with
 * parentId === null (or a parentId that doesn't resolve). Siblings are sorted by
 * `order`, then by id for stability.
 */
export function buildTree(ir: IR): IRTreeNode[] {
  const byId = new Map<string, IRNode>(ir.nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string | null, IRNode[]>();

  for (const node of ir.nodes) {
    const parent = node.parentId && byId.has(node.parentId) ? node.parentId : null;
    const bucket = childrenOf.get(parent) ?? [];
    bucket.push(node);
    childrenOf.set(parent, bucket);
  }

  const sortSiblings = (nodes: IRNode[]) =>
    [...nodes].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const build = (parentId: string | null): IRTreeNode[] =>
    sortSiblings(childrenOf.get(parentId) ?? []).map((node) => ({
      node,
      children: build(node.id),
    }));

  return build(null);
}

/** Siblings of a node (same parent), sorted by order. Includes the node itself. */
export function siblingsOf(ir: IR, id: string): IRNode[] {
  const node = ir.nodes.find((n) => n.id === id);
  if (!node) return [];
  return ir.nodes
    .filter((n) => n.parentId === node.parentId)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
