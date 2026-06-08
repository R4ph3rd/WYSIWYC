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
  | 'line';

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

export interface PromptClause {
  /** Stable id, e.g. "clause_3". */
  id: string;
  text: string;
  category: ClauseCategory;
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

// --- Direct-manipulation ops (deterministic IR writes, no LLM) ---

export type ManipulationOp =
  | { kind: 'move'; id: string; from: NodeLayout; to: NodeLayout }
  | { kind: 'reorder'; id: string; parentId: string | null; from: number; to: number }
  | { kind: 'resize'; id: string; from: NodeLayout; to: NodeLayout }
  | { kind: 'recolor'; id: string; from: string; to: string; token: string }
  | { kind: 'delete'; id: string }
  | { kind: 'align'; ids: string[]; axis: 'left' | 'center' | 'right' };
