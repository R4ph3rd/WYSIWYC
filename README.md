# WYSIWYC — What You See Is What You Chat

A bidirectional **prompt ⇄ UI** editor. You describe a UI in plain natural
language; it becomes a polished mockup you can directly draw on, drag, resize,
and restyle with design tools; every manipulation propagates back into a
human-readable, synchronized prompt — with element-level provenance linking both
directions.


## The core idea

Three artifacts and **one source of truth**:

```
PROMPT (natural-language living spec)  ⇄  IR (JSON scene graph = SOURCE OF TRUTH)  ⇄  RENDER (React + Tailwind)
```

- **IR is the single source of truth.** The prompt view and the rendered UI
  are both *projections* of it.
- **Instruction → Spec + IR** (Compose): entry point. You
  just *talk* ("a pricing page with three plans…", "make the button green");
  one LLM call folds the instruction into the living spec (clause upserts) AND
  emits the IR patch realizing it, so provenance lines up clause-by-node.
- **Prompt → IR** (Call A): editing a spec sentence in place makes the LLM
  emit a *patch* (add / update / remove / reorder), never a full regeneration
  unless the IR is empty.
- **IR → Render**: deterministic, pure function — no LLM in the projection.
  The LLM authors *data* (Tailwind classNames + a structured `style` block); the
  renderer projects it to React + Tailwind, emitting plain HTML for flow
  elements and **SVG only for vector primitives** (the `line` and `path` roles).
  No LLM is involved in turning IR into pixels.
- **Render → IR**: direct manipulation (drawing tools, drag-move, resize
  handles, properties panel, drag-to-reorder) writes **deterministically** —
  no LLM in the gesture itself.
- **IR → Prompt** (Call B, the lossy back-channel): the manipulation is applied
  to the IR immediately; a banner then proposes a one-sentence prompt delta the
  user must resolve — **Accept** it, swap in one of **three generated
  alternatives**, or **rephrase** it inline. A substantial change has to be
  described in the spec, so there is no silent "reject"/diverge. This covers
  *every* manipulation: canvas drags, hand-drawn shapes, and (debounced per
  editing burst) Properties-panel changes.

**The asymmetry is intentional and visible in the UX:** prompt→output is
authoritative; output→prompt is a *proposal* applied only once the user
accepts, swaps, or rephrases it.

**The prompt reads like a person, not a config file.** The spec is rendered as
short, categorized sentences and offers two views you can switch between — a
**Structured** view (clauses grouped into Layout / Components / Style / Content
sections) and a **Prose** view (the same clauses as flowing text, each
underlined in its category color). Each clause is hoverable (it traces the UI
nodes it owns), single-click opens alternatives/remove, and double-click edits
it in place. Both LLM directions are instructed to use *semantic* values first
— "place the CTA below the form", "a softer pink" — never raw pixels or hex
codes unless the user typed them.

## Workspace

- **Top bar** — branding, one-click **Examples**, a **Layers** toggle, the
  **Connect** button (provider + key), and global actions (**New / Undo / Log**).
- **Left rail** — the full-height **Spec** panel (the living prompt, with the
  Structured/Prose toggle and the inline composer at the bottom). A toggleable
  **Layers** tree can sit beside it.
- **Center** — the **Canvas**. A floating tool palette sits at the **bottom**
  (Pointer / Rectangle / Circle / Line / Pen / Text — V R O L P T). A
  **sync-mode toggle** sits in the top-left corner (see below). Drawn shapes
  default to a neutral grey.
- **Right rail** — the **Properties** panel: Figma-style controls for the
  selected node (position/size, fill/stroke with opacity, a structured drop/
  inner **shadow** editor, a searchable Google-Fonts family picker, weight,
  alignment, …). Number fields have +/- steppers; colors have a swatch + hex +
  opacity.
- **Bottom** — the **Diff Ribbon**: the proposed prompt delta + confidence,
  resolved by Accept / Alternatives / Rephrase.

## Direct manipulation & shortcuts

Direct edits write the IR deterministically (no LLM in the gesture):

- Draw with the palette; drag to move, corner-handles to resize, drag flow
  elements to reorder.
- **Double-click a text node** to edit its content inline on the canvas.
- **⌘/Ctrl+C / V** copy & paste, **⌘/Ctrl+D** or **Alt-drag** to duplicate,
  **Shift-click** to multi-select, **Delete** to remove, **⌘/Ctrl+Z** to undo.
- Press **?** (or trigger any unbound hotkey) to open a slide-up keyboard
  shortcuts sheet.

**Sync mode (canvas → spec).** A corner toggle controls how canvas edits update
the spec: **Auto** runs the Call B back-channel immediately after each edit;
**Manual** holds the edits (the IR still updates live) and shows an *Update
spec* button to run the back-channel on demand. Switching back to Auto flushes
anything held.


## LLM providers (Connect button)

Browser-direct calls to four providers — no backend, keys stay in
`localStorage`:

| Provider | Default model | Structured output mode | Vision |
|---|---|---|---|
| Anthropic | `claude-opus-4-8` | `output_config.format` (json_schema) | ✓ |
| OpenAI | `gpt-4o` | `response_format` (json_schema, strict) | ✓ |
| Mistral | `mistral-large-latest` | `response_format` (json_schema, strict) | — |
| Groq | `llama-3.3-70b-versatile` | `response_format: {json_object}` + schema-in-prompt + client-side validation | — |

Switching active provider is a single click in the Connect dialog. Each
provider stores its own key and model choice independently.


## The IR schema

Nodes are **flat** with `parentId` references (not deeply nested) — deep
nesting degrades structured-output reliability. Each node carries:

- `role` — `frame` / `container` / `text` / `heading` / `button` / `input` /
  `image` / `icon` / `divider` / `badge` / `rectangle` / `circle` / `line` /
  `path` (pen-tool paths carry a `points` array relative to their bounding box)
- `tailwind` — LLM-authored className (where visual richness lives)
- `style` — structured visual properties written by the Properties panel
  (fill / stroke / strokeWidth / borderRadius / fontFamily / fontSize /
  fontWeight / fontColor / italic / underline / textAlign / shadow / opacity)
- `layout` — optional absolute `x / y / w / h` (drawn shapes and moved nodes)
- `provenance` — `{ promptClauseId, source: "llm" | "user" }`

The split between `tailwind` and `style` is intentional: tailwind is what the
LLM authors freely; style is what the user dialled in by hand and we don't
want to round-trip through tokens. The renderer applies both.

## Fonts & inline parameter editing

The font controls draw from a bundled, curated catalogue of popular Google
Fonts (`src/lib/fonts.ts`); families load **lazily** (`src/lib/loadFont.ts`) —
only when shown in the picker or actually used by a node — never the whole
catalogue up front. The complete Google Fonts list can be regenerated at build
time from
`https://www.googleapis.com/webfonts/v1/webfonts?key=$GOOGLE_FONTS_API_KEY&sort=popularity`
into the same `{ family, category }[]` shape (the key stays build-time only).

Style words inside spec clauses (a color, a size, a font, a weight, a shadow,
a radius, …) are clickable: clicking one opens a small widget (color picker,
slider, font selector, …) that edits the bound IR field **deterministically**
(no LLM) and rewrites the word in the prose. Any token the system can't type
precisely still opens a plain text input. This is a forward Prompt→IR edit, so
it does not run the Call B back-channel.

## Running locally

```bash
npm install
npm run dev        # http://localhost:5173
```

Open the app, click **Connect**, paste an API key, pick a model. No backend
required — all LLM calls go from the browser directly to the provider.

## Tailwind at runtime

Because the LLM authors arbitrary Tailwind classes **at runtime**, build-time
JIT purging cannot know them. This PoC uses the **Tailwind Play CDN** (in-browser
compiler, see `index.html`) so any class — including arbitrary values like
`bg-[#4f46e5]` written by inline parameter edits — compiles on the fly.

## Deploying

CI builds and publishes `dist/` to the `gh-pages` branch on **every push**
(`.github/workflows/deploy.yml`). The deployed demo is fully functional: bring
your own key on the live site.

## Research framing (spec §7)

## Research framing

Every Call B back-channel event is logged as
`{ manipulation, proposal, accepted, confidence }` and every compose gesture is
logged as `{ provenance, signals, chipCount, scoped, promptLength }` — all in
`localStorage`. The **Log** button in the top bar downloads the full JSON log.

The primary study measure is the **acceptance rate of inferred prompt deltas by
manipulation type and confidence**. Secondary measures include the distribution
of DirectGPT gesture signals (typed / dragRef / attributeRef / paramRef /
image / scopedSelection / recipe). The intellectual contribution is the
**IR-mediated bidirectional sync**, the **studied lossy back-channel**, and the
**DirectGPT-enriched composer** on top of a living spec.
