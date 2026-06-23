import type { IR, IRNode, ManipulationOp, NodeRole, NodeStyle, PathPoint } from './types';
import { siblingsOf } from './tree';
import { setUtility, setAlignment } from './tailwindEdit';
import { nextNodeId } from './ids';

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

    // restyle / draw are applied incrementally as the user works (the panel
    // and the canvas write through editStyle/createShape); re-applying the
    // "after" state here keeps the op idempotent for undo/replay.
    case 'restyle':
      return patchNodes(ir, [op.id], (n) => ({
        ...n,
        content: op.after.content !== undefined ? op.after.content : n.content,
        layout: op.after.layout ? { ...n.layout, ...op.after.layout } : n.layout,
        style: op.after.style ? { ...n.style, ...op.after.style } : n.style,
      }));

    case 'draw':
      return { ir, affectedIds: [op.id] };

    // A recipe re-applies a saved instruction through the compose path (not a
    // deterministic IR write), so there is nothing to apply here — it exists as
    // a ManipulationOp purely so the re-application is logged like any other.
    case 'recipe':
      return { ir, affectedIds: [] };
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

// --- Creation / structural edits (called by the tool palette + panels) ---

const DEFAULT_STYLE: Record<NodeRole, NodeStyle> = {
  frame: {},
  container: {},
  text: { fontSize: 16, fontColor: '#0f172a' },
  heading: { fontSize: 24, fontWeight: 600, fontColor: '#0f172a' },
  button: { fill: '#4f46e5', fontColor: '#ffffff', borderRadius: 8 },
  input: { fill: '#ffffff', stroke: '#cbd5e1', strokeWidth: 1, borderRadius: 6 },
  image: { fill: '#e2e8f0', borderRadius: 4 },
  icon: { fontSize: 20 },
  divider: { stroke: '#e2e8f0', strokeWidth: 1 },
  badge: { fill: '#eef2ff', fontColor: '#4338ca', borderRadius: 9999, fontSize: 12 },
  // Drawn primitives default to a neutral grey, not a brand color, so a fresh
  // shape reads as "unstyled" until the user (or the prompt) colors it.
  rectangle: { fill: '#e2e8f0', stroke: '#94a3b8', strokeWidth: 1, borderRadius: 4 },
  circle: { fill: '#e2e8f0', stroke: '#94a3b8', strokeWidth: 1 },
  line: { stroke: '#94a3b8', strokeWidth: 2 },
  path: { stroke: '#94a3b8', strokeWidth: 2 },
};

const DEFAULT_CONTENT: Partial<Record<NodeRole, string>> = {
  text: 'Text',
  heading: 'Heading',
  button: 'Button',
};

/**
 * Create a new node and append it (deterministically, no LLM). Used by the
 * drawing tool palette. Returns the IR with the node added and the new id.
 */
export function createNode(
  ir: IR,
  params: {
    role: NodeRole;
    parentId: string | null;
    layout: { x: number; y: number; w: number; h: number };
    content?: string;
    points?: PathPoint[];
  },
): { ir: IR; id: string } {
  const id = nextNodeId(ir.nodes.map((n) => n.id));
  const order =
    ir.nodes.filter((n) => n.parentId === params.parentId).reduce((m, n) => Math.max(m, n.order), -1) + 1;

  const node: IRNode = {
    id,
    role: params.role,
    parentId: params.parentId,
    order,
    content: params.content ?? DEFAULT_CONTENT[params.role],
    tailwind: '',
    layout: params.layout,
    style: { ...DEFAULT_STYLE[params.role] },
    points: params.points,
    provenance: { promptClauseId: null, source: 'user' },
  };
  return { ir: { ...ir, nodes: [...ir.nodes, node] }, id };
}

/** All descendant ids of a node (excluding the node itself). */
export function descendantIds(ir: IR, rootId: string): string[] {
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const n of ir.nodes) {
      if (n.parentId === id) {
        out.push(n.id);
        stack.push(n.id);
      }
    }
  }
  return out;
}

/** The subtree (root + descendants) of each given root, flattened and de-duped. */
export function collectSubtrees(ir: IR, rootIds: string[]): IRNode[] {
  const ids = new Set<string>();
  for (const r of rootIds) {
    ids.add(r);
    for (const d of descendantIds(ir, r)) ids.add(d);
  }
  return ir.nodes.filter((n) => ids.has(n.id));
}

/**
 * Clone a self-contained set of subtree nodes into fresh ids (copy/paste,
 * alt-duplicate). parentIds pointing inside the set are remapped; root nodes
 * (parent outside the set) are re-parented via `resolveParent` and offset.
 * Every clone is user-authored and unlinked from any prompt clause.
 */
export function cloneNodes(
  ir: IR,
  nodes: IRNode[],
  resolveParent: (oldParentId: string | null) => string | null,
  offset: { dx: number; dy: number },
): { ir: IR; rootIds: string[] } {
  const inSet = new Set(nodes.map((n) => n.id));
  const idMap = new Map<string, string>();
  let idx = Number.parseInt(nextNodeId(ir.nodes.map((n) => n.id)).slice('node_'.length), 10);
  for (const n of nodes) idMap.set(n.id, `node_${idx++}`);

  // Append roots after the current max order under their resolved parent.
  const orderBase = new Map<string | null, number>();
  const nextOrder = (parentId: string | null): number => {
    if (!orderBase.has(parentId)) {
      const max = ir.nodes
        .filter((n) => n.parentId === parentId)
        .reduce((m, n) => Math.max(m, n.order), -1);
      orderBase.set(parentId, max);
    }
    const next = orderBase.get(parentId)! + 1;
    orderBase.set(parentId, next);
    return next;
  };

  const rootIds: string[] = [];
  const cloned: IRNode[] = nodes.map((n) => {
    const isRoot = !(n.parentId && inSet.has(n.parentId));
    const newId = idMap.get(n.id)!;
    const parentId = isRoot ? resolveParent(n.parentId) : idMap.get(n.parentId!)!;
    if (isRoot) rootIds.push(newId);
    const offsetLayout =
      isRoot && n.layout && (n.layout.x !== undefined || n.layout.y !== undefined)
        ? { ...n.layout, x: (n.layout.x ?? 0) + offset.dx, y: (n.layout.y ?? 0) + offset.dy }
        : n.layout;
    return {
      ...n,
      id: newId,
      parentId,
      order: isRoot ? nextOrder(parentId) : n.order,
      layout: offsetLayout,
      provenance: { promptClauseId: null, source: 'user' as const },
    };
  });

  return { ir: { ...ir, nodes: [...ir.nodes, ...cloned] }, rootIds };
}

/** Patch a node's structured style block. Marks it user-authored. */
export function updateNodeStyle(ir: IR, id: string, patch: Partial<NodeStyle>): IR {
  return {
    ...ir,
    nodes: ir.nodes.map((n) =>
      n.id === id
        ? {
            ...n,
            style: { ...n.style, ...patch },
            provenance: { ...n.provenance, source: 'user' },
          }
        : n,
    ),
  };
}

/** Patch a node's layout (absolute x/y/w/h). Marks it user-authored. */
export function updateNodeLayout(
  ir: IR,
  id: string,
  patch: Partial<{ x: number; y: number; w: number; h: number }>,
): IR {
  return {
    ...ir,
    nodes: ir.nodes.map((n) =>
      n.id === id
        ? {
            ...n,
            layout: { ...n.layout, ...patch },
            provenance: { ...n.provenance, source: 'user' },
          }
        : n,
    ),
  };
}

/** Update a node's text content. */
export function updateNodeContent(ir: IR, id: string, content: string): IR {
  return {
    ...ir,
    nodes: ir.nodes.map((n) =>
      n.id === id
        ? { ...n, content, provenance: { ...n.provenance, source: 'user' } }
        : n,
    ),
  };
}

/**
 * Toggle visibility (rendered as a tailwind `hidden`). The layers panel uses
 * this so users can hide a node without deleting it.
 */
export function toggleHidden(ir: IR, id: string): IR {
  return {
    ...ir,
    nodes: ir.nodes.map((n) => {
      if (n.id !== id) return n;
      const has = n.tailwind.split(/\s+/).includes('hidden');
      const tailwind = has
        ? n.tailwind.split(/\s+/).filter((u) => u !== 'hidden').join(' ')
        : `${n.tailwind} hidden`.trim();
      return { ...n, tailwind };
    }),
  };
}
