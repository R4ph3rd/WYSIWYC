# WYSIWYC — What You See Is What You Chat

**Describe a UI in words, then keep working on it by hand. The prompt keeps up.**

WYSIWYC is a prompt ⇄ UI editor (React + TypeScript + Vite + Zustand). You describe an interface in plain language and get an editable mockup. You can then draw on it, drag it, restyle it or mark it up, and every change shows up again as short, human-readable sentences in a living spec. The spec is written for people to read and edit. It is not a chat log.

## Why WYSIWYC

> - **Text and UI stay in sync through readable clauses.** One JSON scene graph (the IR) is the single source of truth. The spec and the canvas are both projections of it. Prompt → UI is authoritative. UI → prompt comes back as *proposals* (dashed clauses with Accept, Rephrase and alternatives), so the spec never drifts silently.
> - **Inline widgets inside the prose, with zero tokens.** Style words in a clause become controls: colour pickers, gradient stops (from / via / to), positions (left / centre / right), icons with a picker, fonts, sizes, weights, radii, shadows. Each pin is scoped to the nodes its phrase refers to ("positive changes are **green**" recolours only the positive figures). It writes the IR directly, with no LLM call. Retyping only those words in a clause also skips the model.
> - **Prompting by demonstration.** You can comment, draw arrows, box things or scribble directly on the canvas. A cross or a scratch-out deletes, an arrow moves, a double arrow swaps. These recognised gestures become exact, undoable edits without a model call. Everything else goes through a reviewable plan, where you confirm targets and wording before anything is sent.
> - **From low-fi sketch to component.** If you draw a rough rectangle or circle, WYSIWYC infers the three most likely components (card, header bar, avatar…) and suggests one as a pending clause. Pick a candidate to get a contrast-aware grey wireframe. Then you can fill it with placeholder content that takes its colours, font and radius from the surrounding design and is laid out so parts never overlap.
> - **Provenance and brushing & linking.** Hover a clause to outline the nodes it owns. Hover a parameter word to outline exactly the nodes it controls. Select a node to highlight the spec words bound to it.
> - **Deterministic direct manipulation.** Moving, resizing, recolouring, reordering and duplicating are pure IR operations with undo. Drag-and-drop is layout-aware. A drop line shows the slot, and the moved component takes on its new siblings' sizing (flex share, fraction, grid column) while the old container rebalances.
> - **Token-efficient by design.** The LLM sends patches instead of regenerating everything. Many edits never reach a model at all: pins, gestures, arrow moves, wireframes and component swaps. Static system and schema prefixes are cached (Anthropic `cache_control`, OpenAI automatic caching), and the IR is sent as minified JSON.
> - **Configuration history, not chat history.** A version rail records restorable spec+IR snapshots. Recipes turn an accepted instruction into a one-click command for the current selection.
> - **Bring your own model, no backend.** The browser calls Anthropic, OpenAI, Mistral or Groq directly. Keys stay in `localStorage`.
> - **Study kit included.** A `/study` route logs every prompt, LLM call, token count and canvas edit, and has a *chat-only* baseline condition. An `/analysis` page plots the dataset.

## Demo

There are no screenshots in the repo yet. To see the main features in about a minute:

1. Run `npm run dev`, click **Connect** and paste a key.
2. On the empty canvas, pick one of the samples under **Try:**. Each has its own design system: **Login screen** (Medora health sign-in), **Pricing card** (Tally invoicing, Stripe-like), **Dashboard header** (Northwind, dark) and **Analytics dashboard** (Northwind, light).
3. Hover a clause in the spec to see its nodes. Click a colour or position word to edit it in place.
4. Drag a stat card into another row, or switch to **Arrow (A)** and draw from one element to a container.
5. Draw a rectangle with **R** and pick a component from the sparkle bubble. Hover it and choose **Fill placeholders**.

## Getting started

```bash
npm install
npm run dev        # Vite dev server, http://localhost:5173
npm run build      # tsc -b && vite build (relative base, works under a sub-path)
npm run preview    # serve the production build
npm run lint       # tsc --noEmit
```

Open the app and click **Connect** in the top bar. Choose a provider tab, paste an API key and pick a model. Keys and model choices are stored in this browser's `localStorage`, and every call goes straight from the browser to the provider. You don't need a server or `.env` file.

| Provider | Default model | Other models offered | Structured output | Images in prompts |
|---|---|---|---|---|
| Anthropic | `claude-opus-4-8` | Sonnet 4.6, Haiku 4.5 | schema in system prompt + client-side parse | yes |
| OpenAI | `gpt-4o` | GPT-4o mini, GPT-4 Turbo | `response_format` json_schema (non-strict) | yes |
| Mistral | `mistral-large-latest` | Mistral Small, Codestral | `response_format` json_schema (non-strict) | no |
| Groq | `llama-3.3-70b-versatile` | Llama 3.1 70B, Mixtral 8x7B | JSON mode + schema in prompt + client-side parse | no |

Each raw response (text, token usage, cache hits) is logged to the browser console under a collapsed `[LLM <provider>]` group.

`server/llmProxy.ts` is a Vite dev/preview plugin that serves `/api/llm` with `ANTHROPIC_API_KEY` from the environment. The current client does not call it, so you only need it if you want a server-held key.

## How it works

```
PROMPT (living spec of clauses)  ⇄  IR (flat JSON scene graph — source of truth)  ⇄  RENDER (React + Tailwind)
```

- **IR** (`src/ir/types.ts`). Nodes are stored flat with `parentId` and `order`, which keeps structured output reliable. Each node has a `role` (frame, container, text, heading, button, input, image, icon, badge, divider, rectangle, circle, line, path), an LLM-authored `tailwind` className, a hand-tuned `style` block, an optional absolute `layout`, and `provenance` (`promptClauseId`, `source: llm | user`). Clauses carry a category (Layout / Components / Style / Content), an `origin` (user or inferred), a `status` (pending or accepted) and parameter spans.
- **The LLM only works at the edges** (`src/llm/`):
  - **Compose**: a free-form instruction becomes clause upserts plus an IR patch in a single call, so new nodes point at the clauses created with them. You can scope it to a selection and include reference chips (dragged nodes, extracted properties, here/there location pins, images).
  - **Call A** (spec → IR): editing a clause produces a patch (add / update / remove / reorder), not a regeneration. Edits that change only parameter words are handled deterministically (`src/ir/clauseEdit.ts`).
  - **Call B** (IR → spec): after a manual edit the IR has already changed. Call B proposes clause changes that you accept, rephrase or swap for an alternative. **Auto** runs it after every edit. **Manual** waits for *Update spec*.
- **Everything else is pure and deterministic.** That covers rendering (`src/render/`), patch application, direct manipulation (`src/ir/manipulate.ts`), layout fitting and drop targets (`src/ir/layoutFit.ts`), parameter lexing and node scoping (`paramLexer.ts`, `bindings.ts`), component inference (`componentInfer.ts`), wireframes and themed placeholders (`wireframe.ts`, `uiPalette.ts`), gesture recognition (`src/annot/gesture.ts`) and annotation target resolution (`src/annot/resolve.ts`).
- **Robust JSON.** `parseJSON` in `src/llm/providers.ts` ignores code fences, leading prose, stray objects and trailing commas, and still reports genuinely malformed output. Nulls are removed so optional fields stay absent.
- **Tailwind at runtime.** The model writes arbitrary classes, so `index.html` uses the Tailwind Play CDN to compile them in the browser.

On Anthropic, the IR patch schema has about 50 omittable fields. That is more than `output_config.format` allows (24 optional and 16 union-typed properties), so the schema goes into the system prompt and the response is parsed client-side. The schema is deliberately lean: optional fields are left out of `required` so the model doesn't pad its output with nulls.

## Interaction reference

### Tools

| Key | Tool | What it does |
|---|---|---|
| `V` | Select | Select, move, resize. Drops are layout-aware and show a drop line |
| `R` / `O` | Rectangle / Circle | Draw a shape and get a pending inferred-component clause with a 3-candidate picker |
| `L` / `P` | Line / Pen | Vector primitives. With the pen, `Enter` commits the path and `Esc` cancels it |
| `T` | Text | Text node |
| `C` | Comment | Pinned note that expands on hover and accepts dropped images |
| `A` | Arrow | Move the selected element (or the one under the tail) into the container at the head, at the indicated slot. No LLM |
| `B` | Surround | Box a region to target it with a comment or instruction |
| `S` | Scribble | Freehand marks, classified as gestures (below) |

Tools stay active until you switch. `Esc` goes back to Select. Markup tools create *annotations*, not IR nodes. Once any exist, **Apply N annotations** opens the modification plan, where you can re-pick targets, edit the wording or drop a step.

### Scribble gestures

| Gesture | Meaning | Applied |
|---|---|---|
| Cross (X) or scratch-out / hatch | delete the target | deterministically, undoable |
| Arrow (one-headed or bare line) | move / reparent into the container it points at | deterministically, undoable |
| Double arrow | swap the two elements | deterministically, undoable |
| Dense shading | fill / recolour | through the LLM, after the plan |

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘/Ctrl Z` | Undo (the top bar also has Undo) |
| `⌘/Ctrl C` / `⌘/Ctrl V` | Copy / paste selection |
| `⌘/Ctrl D`, or `Alt`-drag | Duplicate |
| `Delete` / `Backspace` | Delete selection |
| `Shift`-click | Add to selection (marquee also works) |
| Double-click | Edit text |
| `Esc` | Deselect / exit tool |
| `?` | Open the shortcut sheet |

### In the spec

- Toggle between the **Structured** view (grouped by category) and the **Prose** view.
- Hover a clause to see its nodes. Click it for alternatives or to remove it. Double-click to edit it.
- Click a parameter word to open its widget. To bind a widget to any other phrase, select the text and choose a widget kind from the *Make “…” editable* menu.
- Pending clauses (inferred from shapes) and proposed clauses (from Call B) are drawn dashed in the amber AI accent, with **Accept**, **Dismiss** and **Accept all**.
- The version rail restores any earlier configuration, and that restore can itself be undone. The recipes rail re-runs saved instructions on the current selection.

## User study

The study protocol, tasks and analysis plan are in **[docs/STUDY.md](docs/STUDY.md)**.

- **`/study`** (e.g. `http://localhost:5173/study`) turns on study mode. A setup modal asks for participant, condition and task, and the top bar shows a timer, prompt and edit counters, **Done** and **Export logs**. The `chat_only` condition limits the canvas to a read-only preview: Select only, with no drawing, markup, dragging or back-channel.
- **`/analysis`** opens the analysis page. It loads the dataset from `localStorage` or an exported file and plots prompts, tokens and time to target, edits after first render, and back-channel accept rate by condition and task.
- Reference targets for the tasks are in `public/tasks/`.

## Project structure

```
src/
  ir/        IR types, patch application, manipulation, layout fitting, param lexer + bindings,
             clause edits, component inference, wireframes, UI palette, icons, samples
  annot/     scribble gesture classifier, annotation → target/instruction resolution
  llm/       providers (4 vendors), prompts, schemas, client (token + cache logging)
  render/    deterministic IR → React renderer, icon set
  store/     appStore (document, history, versions, sync), settingsStore (keys), studyStore
  ui/        Canvas, ToolPalette, PromptPane, ParamPopover, AnnotationLayer, InferenceOverlay,
             ModificationPlan, DiffRibbon, VersionRail, RecipesRail, RefComposer, panels, AnalysisPage
  lib/       composer serialization, fonts catalogue, logging
server/      optional Vite /api/llm proxy (not used by the client)
public/tasks study reference targets
```

## Limitations

- This is a research prototype. The output is a mockup, not exportable production code, and document state is not saved across reloads. Only the study dataset and connection settings persist.
- Keys live in browser `localStorage`, and calls go directly from the browser. Use personal or limited keys.
- Mistral and Groq don't receive images, so comment images and image chips are ignored there.
- Inference, gesture recognition and target resolution are geometric heuristics. They can guess wrong, so low-confidence targets are flagged for you to verify in the plan.
- Call B is lossy by nature. It proposes wording, and that wording is only as good as the model.
- Anthropic prompt caching is best-effort. Prefixes below the model's minimum cacheable length are not cached.
- Tailwind compiles at runtime through the Play CDN, which is fine for a prototype but not for production.
- The deterministic modules are pure and written to be unit-testable, but the repo does not ship a test suite yet.
