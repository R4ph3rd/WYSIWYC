/**
 * WYSIWYC core data model.
 *
 * The IR (scene graph) is the SINGLE SOURCE OF TRUTH. The prompt view and the
 * rendered UI are both projections of it:
 *
 *   PROMPT (structured NL) ⇄ IR (this file) ⇄ RENDER (React + Tailwind)
 *
 * Prompt → IR is authoritative (LLM emits a patch). IR → Prompt is a *proposed*,
 * lossy back-channel the user confirms. See store/appStore.ts.
 *
 * Nodes are stored FLAT with parentId references (not deeply nested) — deep
 * nesting degrades structured-output reliability. The tree is derived at render
 * time (see ir/tree.ts).
 */

export type NodeRole =
  | 'frame'
  | 'container'
  | 'text'
  | 'heading'
  | 'button'
  | 'input'
  | 'image'
  | 'icon'
  | 'divider'
  | 'badge'
  // Figma-style drawing primitives. These are produced by the tool palette
  // (deterministic, no LLM) and rendered with absolute positioning + the
  // `style` block below.
  | 'rectangle'
  | 'circle'
  | 'line'
  | 'path';

export const NODE_ROLES: NodeRole[] = [
  'frame',
  'container',
  'text',
  'heading',
  'button',
  'input',
  'image',
  'icon',
  'divider',
  'badge',
  'rectangle',
  'circle',
  'line',
  'path',
];

export type ProvenanceSource = 'llm' | 'user';

export interface NodeProvenance {
  /** Which prompt clause produced/owns this node. null = not described by prompt. */
  promptClauseId: string | null;
  /** Who last set this node. */
  source: ProvenanceSource;
}

export interface NodeLayout {
  /** Absolute-positioning hints. When x/y are set the renderer uses absolute mode. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

/**
 * Structured visual style. Written by the Properties panel (Figma-style
 * controls) and applied as inline CSS on top of `tailwind`. The split is
 * intentional: `tailwind` is what the LLM authors freely; `style` is what the
 * user dialled in by hand and we don't want to round-trip through tokens.
 */
export interface NodeStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  borderRadius?: number;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  fontColor?: string;
  italic?: boolean;
  underline?: boolean;
  textAlign?: 'left' | 'center' | 'right';
  /** CSS box-shadow value (or '' for none). */
  shadow?: string;
  opacity?: number;
}

/** An anchor point of a pen-tool path, relative to the node's bounding box. */
export interface PathPoint {
  x: number;
  y: number;
}

export interface IRNode {
  /** Stable id, e.g. "node_7" — NEVER reused or renumbered. */
  id: string;
  role: NodeRole;
  /** null = root. */
  parentId: string | null;
  /** Sibling ordering within a parent. */
  order: number;
  /** Text / label / placeholder where relevant. */
  content?: string;
  /** LLM-authored className — the source of visual richness. */
  tailwind: string;
  layout?: NodeLayout;
  style?: NodeStyle;
  /** Pen-tool anchors (role "path"), relative to layout x/y. */
  points?: PathPoint[];
  provenance: NodeProvenance;
}

export interface IRCanvas {
  w: number;
  h: number;
  background: string;
}

export interface IR {
  nodes: IRNode[];
  canvas: IRCanvas;
}

// --- Structured prompt (span-addressable provenance) ---

export type ClauseCategory = 'layout' | 'component' | 'style' | 'content';

export const CLAUSE_CATEGORIES: ClauseCategory[] = ['layout', 'component', 'style', 'content'];

/**
 * Where a clause's information came from: the user stated it ('explicit') or the
 * model filled it in / guessed a sensible default ('inferred'). Inferred clauses
 * are flagged in the UI so the user can confirm or swap the guess.
 */
export type ClauseOrigin = 'explicit' | 'inferred';

export interface PromptClause {
  /** Stable id, e.g. "clause_3". */
  id: string;
  text: string;
  category: ClauseCategory;
  /** Provenance of the information (default 'explicit' when absent, e.g. samples). */
  origin?: ClauseOrigin;
  /** Up to 3 plausible alternative values/phrasings the user can swap in. */
  alternatives?: string[];
}

export interface StructuredPrompt {
  clauses: PromptClause[];
}

// --- Prompt → IR patch (Call A output) ---

export type IRPatchOp =
  | { type: 'add'; node: IRNode }
  | { type: 'update'; id: string; props: Partial<IRNode> }
  | { type: 'remove'; id: string }
  | { type: 'reorder'; id: string; order: number };

export interface IRPatch {
  ops: IRPatchOp[];
}

// --- IR → Prompt update (Call B output, the lossy back-channel) ---

export type ProposalConfidence = 'high' | 'medium' | 'low';

export interface PromptUpdateProposal {
  /** Clauses to add or replace (stable ids). */
  updatedClauses: PromptClause[];
  removedClauseIds: string[];
  /** ONE sentence shown to the user for confirm/reject. */
  deltaDescription: string;
  confidence: ProposalConfidence;
}

// --- Instruction → spec + IR (the Lovable-style entry point) ---

/**
 * Output of the "compose" call: a freeform natural-language instruction is
 * folded into the living spec (clause upserts/removals) AND realized as a
 * minimal IR patch in one shot, so provenance clause ids stay consistent.
 */
export interface ComposeResult {
  updatedClauses: PromptClause[];
  removedClauseIds: string[];
  ops: IRPatchOp[];
}

// --- Direct-manipulation ops (deterministic IR writes, no LLM) ---

/** The before/after view of a Properties-panel editing burst. */
export interface EditSnapshot {
  style?: NodeStyle;
  layout?: NodeLayout;
  content?: string;
}

export type ManipulationOp =
  | { kind: 'move'; id: string; from: NodeLayout; to: NodeLayout }
  | { kind: 'reorder'; id: string; parentId: string | null; from: number; to: number }
  | { kind: 'resize'; id: string; from: NodeLayout; to: NodeLayout }
  | { kind: 'recolor'; id: string; from: string; to: string; token: string }
  | { kind: 'delete'; id: string }
  | { kind: 'align'; ids: string[]; axis: 'left' | 'center' | 'right' }
  /** A burst of structured style/layout/content edits from the Properties panel. */
  | { kind: 'restyle'; id: string; before: EditSnapshot; after: EditSnapshot }
  /** A shape/text/path hand-drawn on the canvas with the tool palette. */
  | { kind: 'draw'; id: string; role: NodeRole; layout: NodeLayout }
  /** Re-applying a saved Recipe (an abstracted prior instruction) to a selection. */
  | { kind: 'recipe'; id: string; recipeId: string; instruction: string };

// --- DirectGPT interaction layer (CHI 2024, Masson et al.) ----------------
//
// Direct-manipulation additions on top of the prompt⇄IR⇄render pipeline. The
// composer becomes a RICH value (text + reference chips), selections scope a
// prompt's effect, and accepted instructions can be saved as one-click Recipes.

/** A category of property that can be extracted from a node or image. */
export type ExtractKind =
  | 'layout'        // position, size, spacing, flex/grid arrangement
  | 'hierarchy'     // parent/child + sibling order, structural role
  | 'colorScheme'   // fill/stroke/background palette
  | 'fontStyling'   // family, size, weight, color, italic/underline, align
  | 'componentStyle'// borders, radius, shadow/elevation, fills together
  | 'interaction'   // role-implied behavior (button→click, input→entry)
  | 'content';      // the text/label/placeholder

export const EXTRACT_KINDS: ExtractKind[] = [
  'layout', 'hierarchy', 'colorScheme', 'fontStyling', 'componentStyle', 'interaction', 'content',
];

/** A chip embedded in the composer input. */
export type PromptRef =
  | { kind: 'node'; refId: string; nodeId: string; label: string }
  // ^ a bare object reference (DirectGPT "drag object into prompt")
  | { kind: 'attribute'; refId: string; nodeId: string; extract: ExtractKind; label: string; value: string }
  // ^ a semantic value extracted from a node on drop
  | { kind: 'param'; refId: string; nodeId: string; path: string; label: string; value: string }
  // ^ a single numeric/string parameter dragged from the inspector (e.g. "x", "fontSize")
  | { kind: 'image'; refId: string; label: string; dataUrl: string }
  // ^ an image pasted/dropped into the prompt (thumbnail inline)
  | { kind: 'location'; refId: string; x: number; y: number; label: string; nearNodeId?: string };
  // ^ a point on the canvas (DirectGPT "here"/"there"), captured by clicking

/** The composer value: interleaved text and chips, in document order. */
export type ComposerSegment =
  | { type: 'text'; text: string }
  | { type: 'ref'; ref: PromptRef };

export type ComposerValue = ComposerSegment[];

/**
 * A reusable, re-applicable command abstracted from an accepted instruction
 * (DirectGPT principle d). Lives in the store, NOT in the IR.
 */
export interface Recipe {
  id: string;            // recipe_1, …
  label: string;         // short verb phrase, e.g. "Make rounder & softer"
  instruction: string;   // the natural-language instruction, with {selection} placeholder
  createdFrom: string;   // the clause id or compose instruction it was abstracted from
  uses: number;          // times re-applied (study metric)
}
