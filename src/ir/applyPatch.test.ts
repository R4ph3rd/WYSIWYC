import { describe, it, expect } from 'vitest';
import { applyPatch } from './applyPatch';
import type { IR, IRNode } from './types';

// --- Fixtures (promptable) ---
const mk = (id: string, over: Partial<IRNode> = {}): IRNode => ({
  id,
  role: 'container',
  parentId: null,
  order: 0,
  tailwind: '',
  provenance: { promptClauseId: null, source: 'llm' },
  ...over,
} as IRNode);

const base = (): IR => ({
  canvas: { w: 1280, h: 800, background: '#fff' },
  nodes: [mk('node_1'), mk('node_2', { parentId: 'node_1', order: 1 })],
});

// --- Spec (À ÉCRIRE À LA MAIN : ce sont les règles métier du produit) ---
describe('applyPatch', () => {
  it('ne mute pas son entrée', () => {
    const ir = base();
    const snapshot = structuredClone(ir);
    applyPatch(ir, { ops: [{ type: 'remove', id: 'node_1' }] });
    expect(ir).toEqual(snapshot);
  });

  it('add avec un id existant remplace le noeud (idempotent)', () => {
    const patch = { ops: [{ type: 'add' as const, node: mk('node_2', { tailwind: 'p-4' }) }] };
    const once = applyPatch(base(), patch);
    const twice = applyPatch(once, patch);
    expect(twice).toEqual(once);
    expect(once.nodes.filter((n) => n.id === 'node_2')).toHaveLength(1);
    expect(once.nodes.find((n) => n.id === 'node_2')?.tailwind).toBe('p-4');
  });

  it('update garde l id stable et fusionne les props', () => {
    const out = applyPatch(base(), {
      ops: [{ type: 'update', id: 'node_2', props: { tailwind: 'text-lg' } }],
    });
    const n = out.nodes.find((x) => x.id === 'node_2')!;
    expect(n.tailwind).toBe('text-lg');
    expect(n.parentId).toBe('node_1');
  });

  it('ignore update/reorder sur un id inconnu (un LLM peut halluciner un id)', () => {
    const ir = base();
    const out = applyPatch(ir, {
      ops: [
        { type: 'update', id: 'node_999', props: { tailwind: 'x' } },
        { type: 'reorder', id: 'node_999', order: 3 },
      ],
    });
    expect(out.nodes).toEqual(ir.nodes);
  });

  it('remove détache les enfants (parentId -> null) au lieu de les supprimer', () => {
    const out = applyPatch(base(), { ops: [{ type: 'remove', id: 'node_1' }] });
    expect(out.nodes.map((n) => n.id)).toEqual(['node_2']);
    expect(out.nodes[0].parentId).toBeNull();
  });

  it('reorder change uniquement order', () => {
    const out = applyPatch(base(), { ops: [{ type: 'reorder', id: 'node_2', order: 9 }] });
    expect(out.nodes.find((n) => n.id === 'node_2')?.order).toBe(9);
  });

  it('un patch vide est une identité', () => {
    const ir = base();
    expect(applyPatch(ir, { ops: [] }).nodes).toEqual(ir.nodes);
  });
});
