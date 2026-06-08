# WYSIWYC — What You See Is What You Chat

A bidirectional **prompt ⇄ UI** editor. A natural-language prompt generates a
polished UI mockup; the UI can be directly manipulated; manipulations propagate
back into a human-readable, synchronized prompt — with element-level provenance
linking both directions.

## The core idea

There are **three artifacts and one source of truth**:

```
PROMPT (structured NL)  ⇄  IR (JSON scene graph = SOURCE OF TRUTH)  ⇄  RENDER (React + Tailwind)
```

- **The IR is the single source of truth.** The prompt view and the rendered UI
  are both *projections* of it.
- **Prompt → IR** (`src/llm` Call A): an LLM emits a **patch** (list of ops)
  against the current IR — never a full regeneration unless the IR is empty.
- **IR → Render** (`src/render`): a pure, deterministic function. No LLM.
- **Render → IR** (`src/ir/manipulate.ts`): drag / resize / recolor / align /
  delete write **deterministically** to the IR. No LLM in the manipulation.
- **IR → Prompt** (Call B, the lossy back-channel): after a manipulation an LLM
  proposes an updated prompt plus a one-sentence description of the delta. This
  direction is **lossy and user-confirmed** (the Diff Ribbon).

**The asymmetry is intentional and visible in the UX:** prompt→output is
authoritative; output→prompt is a *proposal* you accept or reject. Rejecting
keeps the UI change but marks the node *diverged* (dashed amber outline,
`provenance.source = "user"`, `promptClauseId = null`).

Visual richness lives entirely in LLM-authored data: each IR node carries a
free-form `tailwind` className string. The schema constrains *structure and
identity* (flat nodes, stable ids), not *aesthetics*.

## Layout

- **Left — Prompt pane:** the spec as editable, categorized clauses
  (layout / component / style / content). Editing a clause → debounced Call A.
  Hovering a clause highlights the UI nodes it owns (and vice versa).
- **Center — Canvas:** the live, deterministic render. Select a node for a
  floating toolbar (recolor, resize, align, delete); drag siblings to reorder.
- **Bottom — Diff Ribbon:** the honest back-channel. Shows the proposed
  prompt delta + a confidence badge with **Accept / Reject**. Never auto-applies.

## Running locally (with LLM generation)

The Anthropic API key is held **server-side** by a tiny dev/preview proxy
(`server/llmProxy.ts`, mounted at `/api/llm`) — it never reaches client code.

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm run dev        # http://localhost:5173
```

Call A and Call B use `claude-opus-4-8` with **structured outputs**
(`output_config.format`) so the JSON is schema-valid by construction.

## Deployment note (GitHub Pages)

The CI workflow builds and publishes the static app to `gh-pages`. A static host
has **no backend**, so Call A / Call B are unavailable there — the deployed demo
runs the fully-deterministic half (renderer, direct manipulation, provenance
highlighting, undo, and the three seed examples). Prompt⇄UI generation requires
running locally with `ANTHROPIC_API_KEY`, or porting `server/llmProxy.ts` to a
serverless function.

## Tailwind at runtime

Because the LLM authors arbitrary Tailwind classes **at runtime**, build-time
JIT purging cannot know them. This PoC uses the **Tailwind Play CDN** (in-browser
compiler, see `index.html`) so any class compiles on the fly. A production build
would instead compile a constrained design-token subset, or run the Tailwind
compiler server-side per generation.

## Research framing (spec §7)

Every Call B is logged as `{ manipulation, proposal, accepted, confidence }`
(localStorage; **Log** button downloads JSON). The dependent measure for a future
study is the **acceptance rate of inferred prompt deltas by manipulation type and
confidence**. The intellectual contribution is the **IR-mediated bidirectional
sync** and the **studied lossy back-channel** — not direct manipulation alone.

## Project layout

```
src/
  ir/        types, applyPatch, tree, manipulate, tailwindEdit, ids, samples
  render/    Renderer (pure IR → React+Tailwind)
  llm/       schemas, prompts, client (Call A / Call B)
  store/     appStore (Zustand: the one source of truth + actions)
  ui/        PromptPane, Canvas, SelectionToolbar, DiffRibbon, primitives
  lib/       utils, log (research instrumentation)
server/
  llmProxy.ts   dev/preview /api/llm proxy (holds the API key)
```
