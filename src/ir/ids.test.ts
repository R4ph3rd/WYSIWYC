import { describe, it, expect } from 'vitest';
import { nextNodeId, nextClauseId } from './ids';

describe('ids monotones', () => {
  it('démarre à 1 sur liste vide', () => {
    expect(nextNodeId([])).toBe('node_1');
  });
  it('alloue au-dessus du max, même avec des trous (jamais de réutilisation)', () => {
    expect(nextNodeId(['node_1', 'node_7'])).toBe('node_8');
  });
  it('ignore les ids mal formés ou d un autre préfixe', () => {
    expect(nextNodeId(['node_abc', 'clause_50', 'node_3'])).toBe('node_4');
    expect(nextClauseId(['node_9'])).toBe('clause_1');
  });
});
