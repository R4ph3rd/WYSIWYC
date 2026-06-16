/**
 * JSON schemas for Anthropic structured outputs (`output_config.format`).
 * Constraints honored: every object sets `additionalProperties: false`; no
 * numeric/string range constraints; nullable fields use anyOf string|null; no
 * recursion (the IR is flat, which is exactly why structured output stays
 * reliable here).
 */

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };

const roleEnum = {
  type: 'string',
  enum: [
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
  ],
};

const pointsSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: { x: { type: 'number' }, y: { type: 'number' } },
    required: ['x', 'y'],
  },
};

const styleSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    fill: { type: 'string' },
    stroke: { type: 'string' },
    strokeWidth: { type: 'number' },
    borderRadius: { type: 'number' },
    fontFamily: { type: 'string' },
    fontSize: { type: 'number' },
    fontWeight: { type: ['number', 'string'] },
    fontColor: { type: 'string' },
    italic: { type: 'boolean' },
    underline: { type: 'boolean' },
    textAlign: { type: 'string', enum: ['left', 'center', 'right'] },
    shadow: { type: 'string' },
    opacity: { type: 'number' },
  },
};

const layoutSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    w: { type: 'number' },
    h: { type: 'number' },
  },
};

const provenanceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    promptClauseId: nullableString,
    source: { type: 'string', enum: ['llm', 'user'] },
  },
  required: ['promptClauseId', 'source'],
};

const nodeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', description: 'Stable id like "node_7". Reuse existing ids; never renumber.' },
    role: roleEnum,
    parentId: nullableString,
    order: { type: 'integer' },
    content: { type: 'string' },
    tailwind: { type: 'string', description: 'Production-quality Tailwind className authored by you.' },
    layout: layoutSchema,
    style: styleSchema,
    points: pointsSchema,
    provenance: provenanceSchema,
  },
  required: ['id', 'role', 'parentId', 'order', 'tailwind', 'provenance'],
};

const partialNodeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    role: roleEnum,
    parentId: nullableString,
    order: { type: 'integer' },
    content: { type: 'string' },
    tailwind: { type: 'string' },
    layout: layoutSchema,
    style: styleSchema,
    points: pointsSchema,
    provenance: provenanceSchema,
  },
};

const patchOpsSchema = {
  type: 'array',
  items: {
    anyOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: { type: { type: 'string', enum: ['add'] }, node: nodeSchema },
        required: ['type', 'node'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['update'] },
          id: { type: 'string' },
          props: partialNodeSchema,
        },
        required: ['type', 'id', 'props'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: { type: { type: 'string', enum: ['remove'] }, id: { type: 'string' } },
        required: ['type', 'id'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['reorder'] },
          id: { type: 'string' },
          order: { type: 'integer' },
        },
        required: ['type', 'id', 'order'],
      },
    ],
  },
};

export const IR_PATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { ops: patchOpsSchema },
  required: ['ops'],
} as const;

const clauseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    text: { type: 'string' },
    category: { type: 'string', enum: ['layout', 'component', 'style', 'content'] },
    origin: {
      type: 'string',
      enum: ['explicit', 'inferred'],
      description: "'explicit' if the user stated it; 'inferred' if you guessed/filled it in.",
    },
    alternatives: {
      type: 'array',
      items: { type: 'string' },
      description: 'Up to 3 plausible alternative values/phrasings the user might prefer.',
    },
  },
  required: ['id', 'text', 'category', 'origin'],
};

export const PROMPT_UPDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    updatedClauses: { type: 'array', items: clauseSchema },
    removedClauseIds: { type: 'array', items: { type: 'string' } },
    deltaDescription: { type: 'string', description: 'ONE sentence describing the change.' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['updatedClauses', 'removedClauseIds', 'deltaDescription', 'confidence'],
} as const;

/**
 * The "compose" call (Lovable-style entry point): a freeform instruction is
 * folded into the living spec AND realized as an IR patch in a single call so
 * that new nodes can point their provenance at the clauses created alongside.
 */
export const COMPOSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    updatedClauses: {
      type: 'array',
      items: clauseSchema,
      description: 'Clauses to add or replace (reuse ids when refining an existing clause).',
    },
    removedClauseIds: { type: 'array', items: { type: 'string' } },
    ops: patchOpsSchema,
  },
  required: ['updatedClauses', 'removedClauseIds', 'ops'],
} as const;
