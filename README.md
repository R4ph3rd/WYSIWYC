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

- **IR is the single source of truth.** The prompt view and the rendered UI are
  both *projections* of it.
- **Instruction → Spec + IR** (Compose): entry point. You just *talk* ("a
  pricing page with three plans…", "make the button green"); one LLM call folds
  the instruction into the living spec (clause upserts) AND emits the IR patch
  realizing it, so provenance lines up clause-by-node.
- **Prompt → IR** (Call A): editing a spec sentence in place makes the LLM emit
  a *patch* (add / update / remove / reorder), never a full regeneration unless
  the IR is empty.
- **IR → Render**: deterministic, pure function — no LLM, no SVG generation;
  the LLM authors *data* (Tailwind classNames), the renderer projects it.
- **Render → IR**: direct manipulation (drawing tools, drag-move, resize
  handles, properties panel, drag-to-reorder) writes **deterministically** — no
  LLM in the gesture itself.
- **IR → Prompt** (Call B, the lossy back-channel): after a manipulation the
  LLM proposes a one-sentence prompt delta the user **accepts or rejects** (the
  Diff Ribbon). Rejecting keeps the IR change but marks the node *diverged*.
  This covers *every* manipulation: canvas drags, hand-drawn shapes, and
  (debounced per editing burst) Properties-panel changes.

**The asymmetry is intentional and visible in the UX:** prompt→output is
authoritative; output→prompt is a *proposal*, never auto-applied.

**The prompt reads like a person, not a config file.** The spec is rendered as
flowing sentences (each one a hoverable, editable span) and both LLM directions
are instructed to use *semantic* values first — "place the CTA below the form",
"a softer pink" — never raw pixels or hex codes unless the user typed them.


## UI layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Top bar: WYSIWYC  Examples: [...]  │  Connect  Layers  New  Undo  Log   │
├──────────────┬──────────────┬──────────────────────┬────────────────────┤
│ Prompt pane  │ Layers panel │      Canvas           │  Properties panel  │
│ (living spec)│ (toggleable) │  (tool palette + IR)  │  (style / layout)  │
│              │              │                       │                    │
│ [clauses…]   │ [tree…]      │                       │ [fill, stroke,…]   │
│              │              │                       │                    │
│ [Recipes]    │              │                       │                    │
│ [Composer ↵] │              │                       │                    │
└──────────────┴──────────────┴──────────────────────┴────────────────────┘
│                        Diff Ribbon (accept / reject)                    │
└─────────────────────────────────────────────────────────────────────────┘
```


## Tool palette & keyboard shortcuts

| Key | Tool | Effect |
|-----|------|--------|
| `V` | Pointer | Select, move, resize |
| `R` | Rectangle | Draw rectangle |
| `O` | Circle | Draw circle |
| `L` | Line | Draw line |
| `P` | Path | Pen tool (click anchors, double-click to close) |
| `T` | Text | Place a text node |
| `⌘Z` / `Ctrl+Z` | — | Undo (50-step history) |
| `Delete` / `Backspace` | — | Delete selected node (triggers back-channel) |
| `Escape` | — | Deselect |


## DirectGPT interaction layer

The composer is a **rich text + chip field** implementing the four DirectGPT
principles (CHI 2024, Masson et al.) on top of the prompt⇄IR⇄render pipeline:

| Principle | Implementation |
|-----------|----------------|
| **a — Object references** | Click an element on the canvas or in the Layers panel while typing to drop a node-reference chip (`«ref_n»`) into the composer; the chip is serialized as a stable marker before the LLM call |
| **b — Attribute extraction** | Right-drag a node chip to open the Extract menu and promote it to a semantic value chip (layout / colorScheme / fontStyling / componentStyle / …) |
| **c — Parameter references** | Drag a numeric/string field from the Properties panel to drop a `#param` chip carrying the live value |
| **d — Reusable recipes** | Any accepted instruction can be saved as a one-click Recipe pill; clicking a recipe re-applies its instruction scoped to the current selection |

Additional composer features:
- **Image chips**: paste or drop an image into the composer; it is sent as a
  vision block to Anthropic or OpenAI (Mistral / Groq reject image chips with a
  clear error).
- **Location pins**: typing "here" or "there" then clicking the canvas converts
  the word into a `📍(x, y)` chip; repeated clicks move the pin rather than
  stacking new ones.
- **Selection-scoped prompting**: when the composer is focused and nodes are
  selected, the instruction is scoped to those nodes; the scope indicator shows
  "Editing N selected elements".
- **Multi-selection**: `Shift`-click to toggle nodes in/out of selection.


## Prompt pane — clause features

Each sentence of the living spec is a `PromptClause` with:

- **Category** colour-coded with an underline: sky (layout), violet (component),
  amber (style), emerald (content).
- **Origin**: `explicit` (user stated it) or `inferred` (model filled in a
  sensible default, flagged with an amber dot). Inferred clauses are offered as
  alternatives via a context menu.
- **Alternatives**: single-click opens a menu with up to 3 model-proposed
  phrasings; picking one triggers a debounced Call A patch.
- **Inline edit**: double-click to edit the clause text in place; blur or Enter
  commits, Escape cancels.
- **Remove**: hover → ×  button removes the clause and triggers a Call A patch.


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


## Running locally

```bash
npm install
npm run dev        # http://localhost:5173
```

Open the app, click **Connect**, paste an API key, pick a model. No backend
required — all LLM calls go from the browser directly to the provider.


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
