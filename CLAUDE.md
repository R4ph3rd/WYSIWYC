# WYSIWYC — What You See Is What You Chat

Prompt ⇄ UI editor. The user describes a UI; an LLM emits **patches** to a flat JSON
scene graph (the IR); the canvas renders from the IR. Manual edits on the canvas flow
back as proposed spec clauses. Browser-only app: users paste their own API key, calls
go straight from the browser to the provider. No backend in production.

Stack: React 18, TypeScript (strict), Vite 5, Zustand, Radix primitives, Tailwind via
the **Play CDN at runtime** (`index.html`, no tailwind.config.js), Vitest, Playwright.
Dev machine is Windows; scripts and hooks are Node (`.mjs`), not shell.

## Commands
| Command | What |
|---|---|
| `npm run dev` | Vite on http://localhost:5173 (`/` editor, `/study`, `/analysis`) |
| `npm run lint` | `tsc --noEmit` |
| `npm test` | Vitest, `src/**/*.test.ts`, node env |
| `npm run e2e` | Playwright (Chromium, starts Vite itself) |
| `npm run build` / `preview` | `tsc -b && vite build` (base `./`) / serve `dist/` |
| `node .claude/skills/verify/verify.mjs [--e2e\|--build\|--all]` | all gates + summary |

**Before claiming a task is finished: lint + test pass.** UI changes: e2e too.

## Code map
| Path | Role | Rules |
|---|---|---|
| `src/ir/` | IR types and **pure** functions: `applyPatch`, `ids`, `tree`, `manipulate`, `layoutFit`, `clauseEdit`, `paramLexer`, `bindings`, `componentInfer`, `wireframe`, `uiPalette`, `samples` | Pure, no React/store/DOM. Every change ships with a Vitest test. |
| `src/annot/` | Gesture recognition, annotation target resolution | Pure, tested like `src/ir/`. |
| `src/llm/` | `schemas.ts` (JSON schemas), `prompts.ts`, `providers.ts` (fetch + `parseJSON`), `client.ts` (compose / Call A / Call B) | The only place that talks to a model. |
| `src/store/` | Zustand: `appStore` (IR, clauses, history), `settingsStore` (keys in localStorage `wysiwyc.settings.v1`), `studyStore` | Store actions call pure IR functions; no IR logic inline. |
| `src/render/` | Renders IR nodes (user-designed UI, arbitrary Tailwind) | Not subject to the app design system. |
| `src/ui/` | Editor chrome: panels, canvas, popovers; `primitives/`, `tokens.ts` | Follows the `design-system` skill. |
| `src/study/`, `src/ui/study/` | User-study kit (sessions, metrics, stats, CSV) — see `docs/STUDY.md` | Bump `SCHEMA_VERSION` when a column changes meaning. |
| `server/llmProxy.ts` | Optional Vite dev proxy, unused by the client | |
| `scripts/` | Offline study simulation/export (`.ts` + compiled `.mjs`) | Never call a real model. |
| `e2e/` | Playwright specs, LLM mocked with `page.route` | |

## Architecture invariants (do not break)
- **IR is the single source of truth.** Spec and canvas are projections of it.
- Nodes are **flat** with `parentId` + `order`. Never a nested `children` tree.
- `applyPatch` and all of `src/ir/` are **pure** and **never mutate their input**.
- Ids `node_N`, `clause_N`, `recipe_N` are **monotonic and never reused**
  (`src/ir/ids.ts`). Known gap: allocation is derived from current ids, so deleting
  the highest id lets it be reused — don't rely on it, don't hide it.
- LLM ops are only `add | update | remove | reorder`. An **unknown id is ignored**, no error.
- Schemas in `src/llm/schemas.ts` stay **flat**, every object `additionalProperties: false`,
  optional fields not in `required`. On Anthropic the patch schema lives in the system
  prompt (too many optional props for structured outputs) and is parsed client-side.
- Cached prompt prefix (system + schema) comes first; dynamic content (IR, selection)
  after it.
- Deterministic paths must stay LLM-free: param pins, gestures, arrow moves,
  wireframes, component swaps, samples.
- UI → prompt changes are **proposals** (pending clauses), never silent rewrites.

## Conventions
- TypeScript strict, `@/` alias for `src/`. No `any` or `@ts-ignore` to silence errors.
- Tests select by role / label / text. **No new `data-testid`** in prod code unless
  there is no accessible alternative.
- App chrome: slate neutrals, amber only for "AI / your markup" via `AI.*` from
  `src/ui/tokens.ts`, primitives from `src/ui/primitives/`.
- Small focused commits; don't reformat unrelated code.

## Deploy
`.github/workflows/deploy.yml` publishes `dist/` to GitHub Pages on **every push to
any branch**, with no tests. A push = a production deploy. Use the `deploy` skill.
`ci.yml` (lint + unit + e2e) runs on PRs.

## Working with agents (.claude/)
Subagents can't spawn subagents, so the **main session orchestrates** (`build-feature` skill):
1. `architect` (Opus) — reads the code, writes the plan and one brief per work package. No edits.
2. Builders, dispatched by the main session with the architect's briefs:
   `backend-builder` (Sonnet) for `src/ir|annot|llm|store|study|lib`, `server`, `scripts`;
   `ui-builder` (Sonnet) for `src/ui`, `src/render`, `index.css`;
   `ui-tweaker` (Haiku) for one-file cosmetic edits (copy, classes, aria-labels).
3. `test-engineer` (Sonnet) — Vitest + Playwright for the packages; never edits prod code.
4. `reviewer` (Opus) — adversarial read-only review of the diff.
5. `verify` skill, then report.
Skip the pipeline for small tasks: do them directly.

Skills: `build-feature`, `verify`, `ir-test`, `e2e-test`, `llm-contract`,
`design-system`, `fix-design`, `deploy` (user-invoked only).
Hook: typecheck after each `.ts`/`.tsx` edit (`.claude/hooks/typecheck.mjs`).

## Forbidden
- Committing API keys or reading/editing `.env*`.
- Editing `.github/workflows/` without asking first.
- Skipping, deleting or loosening a test to get green.
- Real LLM calls in tests, e2e or scripts.
- Force-push; pushing without confirmation (it deploys).
