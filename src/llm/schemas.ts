/**
 * JSON schemas for structured outputs across all four providers.
 *
 * Hard constraint (Anthropic grammar decoder): a schema may contain at most 24
 * *optional* properties (any property not listed in its object's `required`),
 * or grammar compilation is refused with HTTP 400. OpenAI/Mistral strict mode
 * add the mirror-image rule: every property MUST appear in `required`. We honor
 * both at once by making **every** property required and expressing "optional"
 * fields as nullable (`anyOf [T, null]`). The model emits `null` for anything it
 * omits, and `stripNulls` in `providers.ts` folds those nulls back to absent
 * keys so the rest of the app sees the exact shape it always has.
 *
 * Other constraints honored: every object sets `additionalProperties: false`;
 * no numeric/string range constraints; no recursion (the IR is flat, which is
 * exactly why structured output stays reliable here).
 */

/** Wrap a schema so `null` is an accepted value (the nullable idiom). */
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });

const nullableString = nullable({ type: 'string' });
const nullableStringArray = nullable({ type: 'array', items: { type: 'string' } });

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
    fill: nullableString,
    stroke: nullableString,
    strokeWidth: nullable({ type: 'number' }),
    borderRadius: nullable({ type: 'number' }),
    fontFamily: nullableString,
    fontSize: nullable({ type: 'number' }),
    fontWeight: nullable({ type: ['number', 'string'] }),
    fontColor: nullableString,
    italic: nullable({ type: 'boolean' }),
    underline: nullable({ type: 'boolean' }),
    textAlign: nullable({ type: 'string', enum: ['left', 'center', 'right'] }),
    shadow: nullableString,
    opacity: nullable({ type: 'number' }),
  },
  required: [
    'fill',
    'stroke',
    'strokeWidth',
    'borderRadius',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontColor',
    'italic',
    'underline',
    'textAlign',
    'shadow',
    'opacity',
  ],
};

const layoutSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    x: nullable({ type: 'number' }),
    y: nullable({ type: 'number' }),
    w: nullable({ type: 'number' }),
    h: nullable({ type: 'number' }),
  },
  required: ['x', 'y', 'w', 'h'],
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
    content: nullableString,
    tailwind: { type: 'string', description: 'Production-quality Tailwind className authored by you.' },
    layout: nullable(layoutSchema),
    style: nullable(styleSchema),
    points: nullable(pointsSchema),
    provenance: provenanceSchema,
  },
  required: ['id', 'role', 'parentId', 'order', 'content', 'tailwind', 'layout', 'style', 'points', 'provenance'],
};

const partialNodeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    role: nullable(roleEnum),
    parentId: nullableString,
    order: nullable({ type: 'integer' }),
    content: nullableString,
    tailwind: nullableString,
    layout: nullable(layoutSchema),
    style: nullable(styleSchema),
    points: nullable(pointsSchema),
    provenance: nullable(provenanceSchema),
  },
  required: ['role', 'parentId', 'order', 'content', 'tailwind', 'layout', 'style', 'points', 'provenance'],
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

const paramSpanSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', description: 'Unique within the clause, e.g. "param_1".' },
    start: { type: 'integer', description: 'Char offset into clause.text (inclusive).' },
    end: { type: 'integer', description: 'Char offset into clause.text (exclusive).' },
    kind: {
      type: 'string',
      enum: ['color', 'length', 'fontFamily', 'fontWeight', 'shadow', 'radius', 'opacity', 'align', 'enum', 'text'],
    },
    nodeIds: { type: 'array', items: { type: 'string' } },
    path: {
      type: 'string',
      description: 'IR field: "style.<key>", "layout.<key>", "tailwind:<prefix>", "align", or "content".',
    },
    value: { type: 'string', description: 'Current value (e.g. "#4f46e5", "600", "16", "Inter").' },
    options: nullableStringArray,
    unit: nullableString,
  },
  required: ['id', 'start', 'end', 'kind', 'nodeIds', 'path', 'value', 'options', 'unit'],
};

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
    alternatives: nullable({
      type: 'array',
      items: { type: 'string' },
      description: 'Up to 3 plausible alternative values/phrasings the user might prefer.',
    }),
    params: nullable({
      type: 'array',
      items: paramSpanSchema,
      description: 'Optional addressable parameter spans binding a token in `text` to IR field(s).',
    }),
  },
  required: ['id', 'text', 'category', 'origin', 'alternatives', 'params'],
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
