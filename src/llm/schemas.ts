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
  ],
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
    provenance: provenanceSchema,
  },
};

export const IR_PATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ops: {
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
    },
  },
  required: ['ops'],
} as const;

const clauseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    text: { type: 'string' },
    category: { type: 'string', enum: ['layout', 'component', 'style', 'content'] },
  },
  required: ['id', 'text', 'category'],
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
