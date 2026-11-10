---
name: ir-test
description: Write or extend Vitest tests for a pure function in src/ir/ (applyPatch, ids, tree, manipulate, layoutFit, clauseEdit, bindings…) or src/annot/. Use whenever a function in src/ir/ is added or changed — CLAUDE.md requires every src/ir/ change to ship with a test.
---

# Testing an IR function

The IR is the source of truth, so its tests encode the product rules. Write them
from the rules below, not from whatever the current code happens to return.

## Steps

1. Read the function, `src/ir/types.ts`, and any existing `*.test.ts` next to it
   (`applyPatch.test.ts`, `ids.test.ts`, `tree.test.ts` show the house style).
2. Put the test next to the source: `src/ir/<file>.test.ts`. Vitest only picks up
   `src/**/*.test.ts`, runs in `node` (no DOM), and resolves `@/`.
3. Build fixtures with small local helpers, never pasted JSON blobs:
   ```ts
   const mk = (id: string, over: Partial<IRNode> = {}): IRNode => ({
     id, role: 'container', parentId: null, order: 0, tailwind: '',
     provenance: { promptClauseId: null, source: 'llm' }, ...over,
   } as IRNode);
   const base = (): IR => ({ canvas: { w: 1280, h: 800, background: '#fff' }, nodes: [mk('node_1')] });
   ```
   Return a fresh object from `base()` each time so tests can't leak state.
4. Cover every rule that applies:

   | Rule (from CLAUDE.md) | How to assert it |
   |---|---|
   | Pure, never mutates input | `const snap = structuredClone(ir); fn(ir, …); expect(ir).toEqual(snap)`. For stronger checks, deep-freeze the input and assert no throw. |
   | Flat nodes, `parentId` only | Output nodes have no `children` arrays; every `parentId` is `null` or an existing id. |
   | Unknown id is ignored, no error | `update`/`remove`/`reorder` on `node_999` returns an IR equal to the input and does not throw. |
   | Ids are monotonic, never reused | After removing `node_3`, the next allocated id is `node_4`+, never `node_3`. Same for `clause_N`. |
   | Idempotence where it applies | `fn(fn(x)) ` equals `fn(x)` (e.g. `add` with an existing id replaces it). |
   | Removal cascades | Removing a parent removes its descendants; no orphans left. |
   | Empty input | Empty `nodes`, empty `ops`, `null` selection. |

   Known gap: `src/ir/ids.ts` computes the next id from the ids *currently
   present*, so deleting the highest `node_N` and allocating again yields
   `node_N` a second time. A test of the "never reused" rule across a remove
   is expected to fail today — report it, don't weaken it.

5. Run only your file first: `npx vitest run src/ir/<file>.test.ts`.
6. **If a test fails, do not change the assertion to match the output** without
   asking the user — the bug may be in the code. Report the failing rule and the
   observed value. Never `.skip` a test to get green (CLAUDE.md, Forbidden).
7. Finish with `npm run lint` and `npm test`.

## Don'ts

- No real LLM calls, no network, no `fetch` mocks of provider endpoints here —
  IR tests are pure. LLM-shaped inputs are typed literals.
- Don't snapshot whole IRs (`toMatchSnapshot`): they hide which rule broke.
  Assert the specific fields that the rule is about.
- Test names describe the rule (`'remove of an unknown id is a no-op'`), not the
  implementation.
