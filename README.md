# WYSIWYC — What You See Is What You Chat

A bidirectional **prompt ⇄ UI** editor. 
You describe a UI in plain natural language; it becomes a UI mockup you can directly draw on, drag, resize, and restyle with design tools.
Every manipulation propagates back into a synchronized prompt with element-level provenance linking both directions.


## The core idea

Three artifacts and **one source of truth**:

```
PROMPT (natural-language living spec)  ⇄  IR (JSON Intermediate Representation scene graph = SOURCE OF TRUTH)  ⇄  RENDER (React + Tailwind)
```

- **IR is the single source of truth.** The prompt view and the rendered UI are both *projections* of it.
- **Instruction → Spec + IR** (Compose): entry point. You just *talk* ("a pricing page with three plans…", "make the button green"); one LLM call folds the instruction into the living spec (clause upserts) AND emits the IR patch realizing it, so provenance lines up clause-by-node.
- **Prompt → IR** (Call A): editing a spec sentence in place makes the LLM emit a *patch* (add / update / remove / reorder), never a full regeneration unless the IR is empty.
- **IR → Render**: deterministic, no LLM in the projection. The LLM authors *data* (Tailwind classNames + a structured `style` block); the renderer projects it to React + Tailwind, emitting plain HTML for flow elements and SVG only for vector primitives.
- **Render → IR**: direct manipulation (drawing tools, drag-move, resize handles, properties panel, drag-to-reorder) writes **deterministically** (no LLM in the gesture itself).
- **IR → Prompt** (Call B, the lossy back-channel): the manipulation is applied to the IR immediately; a banner then proposes a one-sentence prompt delta the user must resolve: **Accept** it, swap in one of **three generated alternatives**, or **rephrase** it inline. A substantial change has to be described in the spec, so there is no silent "reject"/diverge. This covers *every* manipulation: canvas drags, hand-drawn shapes, and (debounced per editing burst) Properties-panel changes.

**The asymmetry is intentional and visible:** prompt→output is authoritative; output→prompt is a *proposal* applied only once the user accepts, swaps, or rephrases it.

**The prompt reads like a person, not a config file.** The spec is rendered as short, categorized sentences and offers two views you can switch between:
- a **Structured** view (clauses grouped into Layout / Components / Style / Content sections) 
- a **Prose** view (the same clauses as flowing text, each underlined in its category color). Each clause is hoverable (it traces the UI nodes it owns), single-click opens alternatives/remove, and double-click edits it in place. Both LLM directions are instructed to use *semantic* values first (e.g."place the CTA below the form", "a softer pink") never raw pixels or hex codes unless the user typed them.

### The IR schema
Nodes are **flat** with `parentId` references (not deeply nested), (deep nesting degrades structured-output reliability). Each node carries:

- `role`: `frame` / `container` / `text` / `heading` / `button` / `input` / `image` / `icon` / `divider` / `badge` / `rectangle` / `circle` / `line` / `path` (pen-tool paths carry a `points` array relative to their bounding box)
- `tailwind`: LLM-authored className
- `style`: structured visual properties written by the Properties panel (fill / stroke / strokeWidth / borderRadius / fontFamily / fontSize /
  fontWeight / fontColor / italic / underline / textAlign / shadow / opacity)
- `layout`: optional absolute `x / y / w / h` (drawn shapes and moved nodes)
- `provenance`: `{ promptClauseId, source: "llm" | "user" }`

We between `tailwind` and `style` because tailwind is what the LLM authors freely; style is what the user dialled in by hand and we don't want to round-trip through tokens. The renderer applies both.

### Inline parameter editing
Style words inside **prompt** clauses (a color, a size, a font, a weight, a shadow, a radius, …) are clickable: clicking one opens a small widget (color picker, slider, font selector, …) that edits the bound IR field **deterministically** (no LLM) and rewrites the word in the prose. Any token the system can't type precisely still opens a plain text input. 
_This is a forward Prompt→IR edit, so it does not run the Call B back-channel._

### Malleable spec (inspired by "From Words to Widgets", arXiv:2604.10925)
The inline parameters were extended with three ideas adapted from the *Malleable Prompting* paper — Zhang et al., ["From Words to Widgets for Controllable LLM Generation"](https://arxiv.org/abs/2604.10925) — which reifies preference expressions in prompts into GUI widgets and links each widget to the output spans it influences:

- **Manual span binding** (paper §4, Fig. 2C — "highlight any text span to bind it to a specific control type"): select any text range inside a spec clause and a **Make editable** menu offers widget kinds (Color / Size / Weight / Corners / Shape / Align / Shadow / free Value). Picking one creates a persistent interactive parameter on the clause — covering preference expressions neither the model nor the deterministic lexer recognized, and replacing an auto-generated widget when the selection overlaps one (`createManualSpan` in `src/ir/paramLexer.ts`, `bindClauseParam` in the store).
- **Bidirectional attribution** (paper DG2 + the "reverse widget" from §7.3): hovering a param token in the spec outlines, in amber, exactly the canvas nodes it controls (finer-grained than the existing whole-clause trace); conversely, selecting a canvas element highlights every spec token bound to it. Because WYSIWYC's param spans already carry `nodeIds`, this attribution is fully deterministic — no Shapley/logit machinery needed, the IR *is* the attribution map.
- **Configuration versions** (paper Fig. 4, linearized): every meaningful configuration change — a compose send, a spec-edit regeneration, a canvas sync, a param-widget adjustment burst — records a restorable spec+IR version. The rail above the spec shows them as chips; clicking one jumps the whole document back to that configuration (the jump itself is undoable). Iterations are organized around *configurations* rather than a linear chat history.

Two of the paper's contributions were deliberately **not** adopted: the token-probability decoding algorithm (requires logit access to a locally deployed model — WYSIWYC calls hosted provider APIs from the browser) and continuous intensity sliders for subjective tone attributes (WYSIWYC's parameters map to concrete CSS dimensions, where discrete widgets are the right fit). The paper's "prompt enrichment" idea already exists here as the model's *inferred* clauses (`origin: "inferred"`, marked with an amber dot in the spec).



## App
### Workspace

- **Connect** button (provider + key) in Top bar
- **Left panel**: the **Spec** panel (the living prompt, with the Structured/Prose toggle and the inline composer at the bottom). A toggleable
  **Layers** tree can sit beside it.
- in **Canvas**: a floating tool palette sits at the **bottom** (Pointer / Rectangle / Circle / Line / Pen / Text // V R O L P T). A **sync-mode toggle** sits in the top-left corner (to toggle auto/manual calls to LLM providers). **Auto** runs the Call B back-channel immediately after each edit;
**Manual** holds the edits (the IR still updates live) and shows an *Update spec* button to run the back-channel on demand.
- **Right panel**: nodes properties (transforms, fill/stroke with opacity, drop/inner **shadow**, searchable Google-Fonts family picker, weight, alignment).
  

### LLM providers
Browser-direct calls to four providers; no backend, keys stay in `localStorage`:

| Provider | Default model | Structured output mode | Vision |
|---|---|---|---|
| Anthropic | `claude-opus-4-8` | schema-in-prompt + client-side parse (see note) | ✓ |
| OpenAI | `gpt-4o` | `response_format` (json_schema, non-strict) | ✓ |
| Mistral | `mistral-large-latest` | `response_format` (json_schema, non-strict) | — |
| Groq | `llama-3.3-70b-versatile` | `response_format: {json_object}` + schema-in-prompt + client-side parse | — |

Note that Groq models support only text in prompt requests. Every raw provider response (text + token usage) is logged to the browser console under a collapsed `[LLM <provider>]` group, and API/parse errors are logged in full, so a failing call can always be inspected.

**On Anthropic and `output_config.format`:** Anthropic's grammar-constrained structured-output decoder caps a schema at 24 *optional* properties **and** 16 *union-typed* (nullable/`anyOf`) properties. The IR patch schema — a flat node list where each node carries a 13-field `style` block plus `layout`/`points`, referenced by both add and update ops — has ~51 genuinely-omittable fields, which cannot fit inside the combined 24+16 budget under any encoding, so `output_config.format` returns HTTP 400 on it (either "too many optional parameters" or, if you make them nullable to dodge that, "too many parameters with union types"). Anthropic is therefore driven the same way as Groq: the JSON Schema is appended to the system prompt as a hard output constraint and the response is parsed and null-stripped client-side. Claude follows a schema presented this way reliably.

Because those providers see the schema as *guidance* rather than a compiled grammar, the schema is kept **lean** — optional fields are omitted from `required` instead of being forced present-and-nullable. This keeps generated JSON compact (each node emits only the fields it needs); a schema that instead forced all ~20 fields per node to be emitted as `null` bloated the output past `max_tokens` and truncated the JSON mid-string. OpenAI and Mistral consume the same lean schema via **non-strict** `json_schema` (strict mode would require every property in `required`, reintroducing the bloat); non-strict still guides those models reliably.
Because the LLM authors arbitrary Tailwind classes **at runtime**, build-time JIT purging cannot know them. This PoC uses the **Tailwind Play CDN** (in-browser compiler, see `index.html`) so any class, including arbitrary values like `bg-[#4f46e5]` written by inline parameter edits. Compiles on the fly.


### Fonts 
The font controls draw from a bundled, curated catalogue of Google Fonts (`src/lib/fonts.ts`). 
The complete Google Fonts list can be regenerated at build time from `https://www.googleapis.com/webfonts/v1/webfonts?key=$GOOGLE_FONTS_API_KEY&sort=popularity` into the same `{ family, category }[]` shape (the key stays build-time only).


### Direct manipulation & shortcuts
Direct edits write the IR deterministically (no LLM in the gesture). Use common transform handles for resizing, rotation, double-click to select, ctrl+c/v, multi-select, undo, alt+drag to duplicate
Press **?** (or trigger any unbound hotkey) to open a slide-up keyboard shortcuts sheet.



### Running locally

```bash
npm install
npm run dev        # http://localhost:5173
```

Open the app, click **Connect**, paste an API key, pick a model. No backend required, all LLM calls go from the browser directly to the provider. 