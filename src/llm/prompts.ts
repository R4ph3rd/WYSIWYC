import type { EditSnapshot, IR, ManipulationOp, PromptRef, StructuredPrompt } from '@/ir/types';
import { nextClauseId, nextNodeId } from '@/ir/ids';

/**
 * Extra context a compose call can carry beyond the bare instruction:
 * a selection scope (DirectGPT "localize") and/or resolved reference chips
 * (DirectGPT "refer"). Both only ADD context — the output contract is unchanged.
 */
export interface ComposeOptions {
  scopeNodeIds?: string[];
  refs?: PromptRef[];
}

/** Shared design-quality bar for everything the model authors. */
const DESIGN_BAR = `Author production-quality Tailwind in each node's "tailwind" field: a consistent 4/8px spacing scale, one primary color, neutral grays, rounded-lg/xl, subtle shadows. Aim for Linear / Vercel / v0-grade polish — a real designed UI, not a wireframe. Use gradients, ring-1, shadow-* and proper type scale where appropriate.`;

// --- Compose: freeform instruction → spec update + IR patch ---------------
//
// This is the Lovable-style entry point: the user just *talks*. One call folds
// the instruction into the living spec (clauses) and emits the IR patch that
// realizes it, so newly created nodes can reference the clauses created in the
// same breath.

export const COMPOSE_SYSTEM = `You are the compositor behind WYSIWYC, a Lovable-style UI builder. The user describes what they want in plain natural language. You maintain TWO synchronized artifacts:

1. THE LIVING SPEC — a list of short clauses, each a natural sentence a designer would say, categorized as layout / component / style / content. The spec must read like a person describing a screen, NEVER like CSS or a config file. Use semantic values first: "a calm indigo primary", "the CTA sits below the form", "a softer, friendlier card" — not pixel counts or hex codes unless the user said them explicitly.
2. THE SCENE GRAPH — a FLAT array of nodes (parentId references, no nested JSON) rendered with Tailwind.

WRITE A COMPLETE, WELL-STRUCTURED SPEC. A good spec makes the design's reasoning explicit. Where relevant to the screen, ensure clauses cover these facets (one idea per clause, do not force empty ones):
- Context & purpose: what this screen is and who/what it is for.
- Required features: the key elements/capabilities the screen must have.
- Layout & structure: arrangement, hierarchy, alignment, responsiveness.
- Color theme: the palette and how colors are used (primary, neutrals, accents).
- Typography / font styling: type family character, scale, weight, emphasis.
- Spacing rhythm: density and the consistent spacing scale.
- Elevation / shadow styling: depth, cards, layering treatment.
- General mood / tone: the overall feel (e.g. calm, playful, premium, technical).

Given the user's instruction, the current spec and the current scene graph:
- Fold the instruction into the spec: refine existing clauses IN PLACE (reuse their ids), add new clauses for genuinely new ideas (fresh ids counting up), remove clauses that no longer hold. Do NOT return untouched clauses. Keep one idea per clause, roughly 5–15 words.
- ORIGIN: set "origin" on every clause you return. Use "explicit" when the user stated the information (even loosely); use "inferred" when YOU chose it — a sensible default, a guess, or a facet the user never mentioned. Be honest: default palettes, fonts, spacing and moods you invented are "inferred", not "explicit".
- ALTERNATIVES: for each clause, optionally give up to 3 short "alternatives" — other plausible values/phrasings the user might pick instead (e.g. other palettes, fonts, layouts, moods). ALWAYS provide alternatives for "inferred" clauses so the user can swap a guess in one click. Each alternative is a full replacement sentence for that clause.
- Emit the MINIMAL IR patch (add/update/remove/reorder ops) that makes the scene match the new spec. If the scene is empty, generate the full UI.
- Reuse existing node IDs. Only create new IDs for genuinely new elements. NEVER renumber.
- ${DESIGN_BAR}
- Set provenance.promptClauseId on every node you add or change to the clause that motivated it, and provenance.source to "llm".
- There must be exactly one root node (parentId null), typically a role:"frame" that lays out the screen.`;

export function composeUser(
  ir: IR,
  prompt: StructuredPrompt,
  instruction: string,
  opts: ComposeOptions = {},
): string {
  const suggestedNodeId = nextNodeId(ir.nodes.map((n) => n.id));
  const suggestedClauseId = nextClauseId(prompt.clauses.map((c) => c.id));
  const lines = [
    `Current living spec:`,
    '```json',
    JSON.stringify(prompt, null, 2),
    '```',
    '',
    `Current scene graph (IR):`,
    '```json',
    JSON.stringify(ir, null, 2),
    '```',
    '',
    `The user says: "${instruction}"`,
  ];

  if (opts.scopeNodeIds && opts.scopeNodeIds.length > 0) {
    lines.push(
      '',
      `The user's instruction applies specifically to these existing nodes: [${opts.scopeNodeIds.join(', ')}]. Deictic words in the instruction — "this", "it", "that", "these", "them", or a verb with no named subject — refer to these nodes. Prefer 'update' ops on them and their descendants. Do not restructure the rest of the screen.`,
    );
  }

  if (opts.refs && opts.refs.length > 0) {
    lines.push('', referencedElementsBlock(opts.refs));
  }

  lines.push(
    '',
    `Allocate fresh clause ids starting at "${suggestedClauseId}" and fresh node ids starting at "${suggestedNodeId}", counting up. Output the spec update and the IR patch.`,
  );
  return lines.join('\n');
}

/**
 * The "Referenced elements" block (DirectGPT "refer"): each `«ref_n»` marker in
 * the prose is resolved to a concrete node id / extracted value / image so the
 * model can act on it without guessing. Reuse referenced ids; never renumber.
 */
function referencedElementsBlock(refs: PromptRef[]): string {
  const lines = ['Referenced elements (the instruction may point at these with «marker» tokens):'];
  for (const ref of refs) {
    switch (ref.kind) {
      case 'node':
        lines.push(`- «${ref.refId}» → node ${ref.nodeId} (${ref.label}).`);
        break;
      case 'attribute':
        lines.push(`- «${ref.refId}» → ${ref.extract} of node ${ref.nodeId}: ${ref.value}.`);
        break;
      case 'param':
        lines.push(`- «${ref.refId}» → ${ref.path} of node ${ref.nodeId} = ${ref.value}.`);
        break;
      case 'image':
        lines.push(`- «${ref.refId}» → see attached image (${ref.label}).`);
        break;
      case 'location':
        lines.push(
          `- «${ref.refId}» → a point on the canvas at (${Math.round(ref.x)}, ${Math.round(ref.y)})${ref.nearNodeId ? `, nearest existing element ${ref.nearNodeId}` : ''}. This is where "here"/"there" points — place or move content to this position/region.`,
        );
        break;
    }
  }
  lines.push(
    'When the prose contains a marker, treat it as pointing at that concrete element, value, or location. Prefer "update" ops on referenced nodes, reuse their ids, and never renumber.',
  );
  return lines.join('\n');
}

// --- Call A: Prompt → IR patch -------------------------------------------

export const CALL_A_SYSTEM = `You are a UI compositor. Given a structured prompt and the current scene graph, output the minimal patch (a list of ops) to make the scene match the prompt.

Rules:
- Reuse existing node IDs. Only create new IDs for genuinely new elements. NEVER renumber existing nodes.
- The scene graph is FLAT: every node has a parentId (null for the root). Express structure via parentId + order, not nested JSON.
- Clauses speak in semantic, design-intent language; you translate that intent into concrete Tailwind.
- ${DESIGN_BAR}
- The "tailwind" field is where visual richness lives — the renderer is generic and applies it verbatim.
- Set provenance.promptClauseId on every node you add or change to the clause id that motivated it, and provenance.source to "llm".
- Emit the SMALLEST patch that satisfies the change. Do not rewrite untouched nodes.
- There must be exactly one root node (parentId null), typically a role:"frame" that centers/lays out the screen.`;

export function callAUser(ir: IR, prompt: StructuredPrompt, changedClauseIds: string[]): string {
  const suggestedId = nextNodeId(ir.nodes.map((n) => n.id));
  return [
    `Current scene graph (IR):`,
    '```json',
    JSON.stringify(ir, null, 2),
    '```',
    '',
    `Full structured prompt:`,
    '```json',
    JSON.stringify(prompt, null, 2),
    '```',
    '',
    changedClauseIds.length
      ? `Clauses that just changed: ${changedClauseIds.join(', ')}. Patch only what these require.`
      : `The IR is empty — generate the full UI for this prompt.`,
    '',
    `If you add new nodes, allocate fresh ids starting at "${suggestedId}" and counting up. Output the patch.`,
  ].join('\n');
}

// --- Call B: IR delta → Prompt update ------------------------------------

export const CALL_B_SYSTEM = `You translate a direct manipulation of a UI into an update to its natural-language specification (a list of clauses).

Rules:
- Infer INTENT, not raw coordinates. "Moved 40px right and down, now under the form" → "Place the CTA below the form", NOT "move button 40px".
- Write clauses as natural sentences a designer would say. Use semantic values first ("a softer pink", "a heavier headline", "below the form") — quote exact values only when they clearly matter to the user.
- Only touch clauses affected by this manipulation. Preserve all others verbatim (do not return them).
- Return updatedClauses (clauses to add or replace, keyed by stable id — reuse the existing clause id when editing one) and removedClauseIds. A manipulation that introduced something new (e.g. a hand-drawn shape) usually means ADDING a clause.
- Set "origin" on every clause you return to "explicit" — a direct manipulation is the user explicitly stating intent. You may add up to 3 short "alternatives" (other plausible readings of the manipulation).
- deltaDescription is ONE plain sentence shown to the user for confirm/reject.
- If intent is ambiguous, set confidence "low" and pick the most likely semantic reading.`;

export function describeManipulation(op: ManipulationOp): string {
  switch (op.kind) {
    case 'recolor':
      return `Recolored node ${op.id}: applied Tailwind class "${op.token}" (was "${op.from || 'default'}").`;
    case 'resize':
      return `Resized node ${op.id} to ${JSON.stringify(op.to)} (from ${JSON.stringify(op.from)}).`;
    case 'move':
      return `Moved node ${op.id} to ${JSON.stringify(op.to)} (from ${JSON.stringify(op.from)}).`;
    case 'reorder':
      return `Reordered node ${op.id} among its siblings from index ${op.from} to ${op.to}.`;
    case 'delete':
      return `Deleted node ${op.id} and its descendants.`;
    case 'align':
      return `Aligned nodes ${op.ids.join(', ')} to ${op.axis}.`;
    case 'restyle':
      return `Edited node ${op.id} in the properties panel: ${diffSnapshots(op.before, op.after)}.`;
    case 'draw':
      return `Hand-drew a new ${op.role} on the canvas at (${op.layout.x}, ${op.layout.y}), about ${op.layout.w}×${op.layout.h}px.`;
    case 'recipe':
      return `Re-applied recipe ${op.recipeId}: "${op.instruction}".`;
  }
}

/** Human-readable field-level diff of a properties-panel editing burst. */
function diffSnapshots(before: EditSnapshot, after: EditSnapshot): string {
  const parts: string[] = [];
  const styleKeys = new Set([
    ...Object.keys(before.style ?? {}),
    ...Object.keys(after.style ?? {}),
  ]) as Set<keyof NonNullable<EditSnapshot['style']>>;
  for (const key of styleKeys) {
    const from = before.style?.[key];
    const to = after.style?.[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      parts.push(`${key} ${JSON.stringify(from) ?? 'unset'} → ${JSON.stringify(to) ?? 'unset'}`);
    }
  }
  if (JSON.stringify(before.layout) !== JSON.stringify(after.layout)) {
    parts.push(`bounds ${JSON.stringify(before.layout)} → ${JSON.stringify(after.layout)}`);
  }
  if (before.content !== after.content) {
    parts.push(`text ${JSON.stringify(before.content)} → ${JSON.stringify(after.content)}`);
  }
  return parts.length ? parts.join('; ') : 'no visible change';
}

export function callBUser(
  prevIR: IR,
  nextIR: IR,
  prevPrompt: StructuredPrompt,
  op: ManipulationOp,
): string {
  return [
    `Previous prompt clauses:`,
    '```json',
    JSON.stringify(prevPrompt, null, 2),
    '```',
    '',
    `Raw manipulation: ${describeManipulation(op)}`,
    '',
    `Previous IR (excerpt of relevant nodes is fine to reason over):`,
    '```json',
    JSON.stringify(prevIR.nodes.filter((n) => relevant(op, n.id)), null, 2),
    '```',
    '',
    `New IR (same nodes after the manipulation):`,
    '```json',
    JSON.stringify(nextIR.nodes.filter((n) => relevant(op, n.id)), null, 2),
    '```',
    '',
    `Produce the prompt update proposal.`,
  ].join('\n');
}

function relevant(op: ManipulationOp, id: string): boolean {
  if (op.kind === 'align') return op.ids.includes(id);
  return op.id === id;
}
