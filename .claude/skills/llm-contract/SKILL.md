---
name: llm-contract
description: Change the LLM contract safely — JSON schemas (src/llm/schemas.ts), prompts (src/llm/prompts.ts), provider calls/parsing (src/llm/providers.ts, client.ts) or the IR types they produce. Use when adding a node field, a patch op, a clause property, a provider or a model, or when the model's output is being mis-parsed.
---

# Changing the LLM contract

The LLM only works at the edges: it emits clause upserts and IR patches; everything
else is deterministic. A contract change touches several files that must move together.

## Invariants (CLAUDE.md)

- Schemas stay **flat** and every object has `additionalProperties: false`.
- Optional fields are left **out of `required`** (the model pads with nulls otherwise;
  `parseJSON` strips nulls).
- Ops are only `add | update | remove | reorder`. An unknown id is **ignored**, never an
  error — in `applyPatch`, not in the prompt.
- Nodes are flat with `parentId` + `order`; ids `node_N` / `clause_N` are monotonic.
- Anthropic: the patch schema exceeds `output_config.format` limits (24 optional / 16
  union-typed props), so it is embedded in the **system prompt** and parsed client-side.
  Don't move it to structured outputs without re-checking those limits. OpenAI uses
  `response_format` json_schema, **non-strict**.
- Static system + schema prefixes are cached (`cache_control` on Anthropic). Keep
  dynamic content (IR, selection, clauses) **after** the cached prefix, or the cache
  hit rate collapses — check `cachedInputTokens` in the `[LLM …]` console group.

## Checklist for a new field / op

1. `src/ir/types.ts` — add the type (optional unless every producer sets it).
2. `src/llm/schemas.ts` — add the property in every schema that carries it
   (`IR_PATCH_SCHEMA`, `COMPOSE_SCHEMA`…), `additionalProperties: false` preserved,
   not in `required` if optional. Count optional/union props if it's an Anthropic path.
3. `src/llm/prompts.ts` — one short sentence on when to emit it; no examples that
   contradict the schema.
4. `src/ir/applyPatch.ts` (or the relevant pure function) — handle it, ignore unknown ids.
5. **Tests** (`ir-test` skill): `applyPatch` handles the field, no mutation, unknown id no-op.
   Add a schema test that walks every object node and asserts
   `additionalProperties === false` if one doesn't exist yet.
6. `src/render/Renderer.tsx` / `src/ui/PropertiesPanel.tsx` if it's user-visible.
7. Update e2e reply fixtures (`e2e/*.spec.ts`) that would now be invalid.
8. README "How it works" if the contract description changes.
9. `verify` skill with `--e2e`.

## Debugging bad model output

- Reproduce **offline**: copy the raw text from the `[LLM <provider>]` console group into
  a Vitest test for `parseJSON` / `applyPatch`. Never call a real model from tests or
  scripts committed to the repo.
- Fix robustness in `parseJSON` (fences, prose, trailing commas) or in `applyPatch`
  (ignore, don't throw) before reaching for prompt changes.
- Prompt changes: keep them minimal and explain the failure they address in the commit.
