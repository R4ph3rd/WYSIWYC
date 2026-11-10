import { describe, it, expect } from 'vitest';
import { buildTree, siblingsOf } from './tree';
import type { IR, IRNode } from './types';

const mk = (id: string, parentId: string | null, order: number): IRNode =>
  ({ id, role: 'container', parentId, order, tailwind: '',
     provenance: { promptClauseId: null, source: 'llm' } }) as IRNode;

const ir = (nodes: IRNode[]): IR => ({ canvas: { w: 1, h: 1, background: '#fff' }, nodes });

describe('buildTree', () => {
  it('trie les frères par order puis id', () => {
    const t = buildTree(ir([mk('b', null, 1), mk('a', null, 1), mk('c', null, 0)]));
    expect(t.map((x) => x.node.id)).toEqual(['c', 'a', 'b']);
  });
  it('traite un parent introuvable comme une racine (pas de noeud perdu)', () => {
    const t = buildTree(ir([mk('x', 'ghost', 0)]));
    expect(t).toHaveLength(1);
  });
  it('imbrique les enfants', () => {
    const t = buildTree(ir([mk('p', null, 0), mk('k', 'p', 0)]));
    expect(t[0].children[0].node.id).toBe('k');
  });
  it('siblingsOf inclut le noeud lui-même, [] si inconnu', () => {
    const g = ir([mk('p', null, 0), mk('k1', 'p', 0), mk('k2', 'p', 1)]);
    expect(siblingsOf(g, 'k1').map((n) => n.id)).toEqual(['k1', 'k2']);
    expect(siblingsOf(g, 'nope')).toEqual([]);
  });
});
