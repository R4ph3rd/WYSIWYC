# WYSIWYC — What You See Is What You Chat

A bidirectional **prompt ⇄ UI** editor. You describe a UI in plain natural
language; it becomes a polished mockup you can directly draw
on, drag, resize, and restyle with design tools; every manipulation
propagates back into a human-readable, synchronized prompt — with
element-level provenance linking both directions.

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

**The prompt reads like a person, not a config file.** The spec is rendered
as flowing sentences (each one a hoverable, editable span) and both LLM
directions are instructed to use *semantic* values first — "place the CTA
below the form", "a softer pink" — never raw pixels or hex codes unless the
user typed them.


## LLM providers (Connect button)

Browser-direct calls to four providers — no backend, keys stay in
`localStorage`:

| Provider | Default model | Structured output mode |
|---|---|---|
| Anthropic | `claude-opus-4-8` | `output_config.format` (json_schema) |
| OpenAI | `gpt-4o` | `response_format` (json_schema, strict) |
| Mistral | `mistral-large-latest` | `response_format` (json_schema, strict) |
| Groq | `llama-3.3-70b-versatile` | `response_format: {json_object}` + schema-in-prompt + client-side validation |

Switching active provider is a single click in the Connect dialog. Each
provider stores its own key, so you can have all four loaded and switch on the
fly.

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
- `layout` — optional absolute `x / y / w / h` (drawn shapes use this)
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

## Research framing (spec §7)

Every Call B back-channel is logged as `{ manipulation, proposal, accepted,
confidence }` (localStorage; **Log** button downloads JSON). The dependent
measure for a future study is the **acceptance rate of inferred prompt deltas
by manipulation type and confidence**. The intellectual contribution is the
**IR-mediated bidirectional sync** and the **studied lossy back-channel** —
not direct manipulation alone.
