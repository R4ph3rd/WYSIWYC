/**
 * Monotonic id allocators. Node and clause ids must be stable across edits and
 * NEVER reused, so we track the high-water mark seen so far and always allocate
 * above it.
 */

function maxNumericSuffix(ids: string[], prefix: string): number {
  let max = 0;
  for (const id of ids) {
    if (id.startsWith(prefix)) {
      const n = Number.parseInt(id.slice(prefix.length), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max;
}

export function nextNodeId(existing: string[]): string {
  return `node_${maxNumericSuffix(existing, 'node_') + 1}`;
}

export function nextClauseId(existing: string[]): string {
  return `clause_${maxNumericSuffix(existing, 'clause_') + 1}`;
}

export function nextRecipeId(existing: string[]): string {
  return `recipe_${maxNumericSuffix(existing, 'recipe_') + 1}`;
}

/** Local, composer-scoped reference-chip id (ref_1, …). NOT an IR id. */
export function nextRefId(existing: string[]): string {
  return `ref_${maxNumericSuffix(existing, 'ref_') + 1}`;
}
