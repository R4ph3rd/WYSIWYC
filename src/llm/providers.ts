/**
 * Four-provider LLM abstraction. All calls run client-side (browser → provider
 * directly), so the API key lives only in the user's localStorage — no proxy.
 *
 * Each provider exposes one entry point — `callJSON` — which takes a system
 * prompt, user prompt, and JSON Schema, and returns the parsed JSON. We use the
 * provider's native structured-output mode where available; Groq falls back to
 * JSON mode + prompt-conditioning + client-side validation.
 */

export type ProviderId = 'anthropic' | 'openai' | 'mistral' | 'groq';

export interface ProviderModel {
  id: string;
  label: string;
}

export interface ProviderDef {
  id: ProviderId;
  label: string;
  keyPlaceholder: string;
  keyHint: string;
  defaultModel: string;
  models: ProviderModel[];
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    keyPlaceholder: 'sk-ant-...',
    keyHint: 'console.anthropic.com',
    defaultModel: 'claude-opus-4-8',
    models: [
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    keyPlaceholder: 'sk-...',
    keyHint: 'platform.openai.com',
    defaultModel: 'gpt-4o',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
      { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    ],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    keyPlaceholder: 'mistral-...',
    keyHint: 'console.mistral.ai',
    defaultModel: 'mistral-large-latest',
    models: [
      { id: 'mistral-large-latest', label: 'Mistral Large' },
      { id: 'mistral-small-latest', label: 'Mistral Small' },
      { id: 'codestral-latest', label: 'Codestral' },
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    keyPlaceholder: 'gsk_...',
    keyHint: 'console.groq.com',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
      { id: 'llama-3.1-70b-versatile', label: 'Llama 3.1 70B' },
      { id: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
    ],
  },
];

export function providerOf(id: ProviderId): ProviderDef {
  return PROVIDERS.find((p) => p.id === id)!;
}

export interface CallJSONOptions {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  schema: unknown;
  schemaName: string;
  maxTokens: number;
  /** Optional image data URLs (from composer image chips) sent as vision blocks. */
  images?: string[];
}

export class LLMError extends Error {}

export interface CallJSONResult {
  data: unknown;
  inputTokens: number;
  outputTokens: number;
}

/** Split a `data:<mime>;base64,<data>` URL into its parts (for Anthropic blocks). */
function parseDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  return { mediaType: m[1], data: m[2] };
}

/**
 * Fold `null` back to "absent". Our schemas mark every field `required` and make
 * the optional ones nullable (so Anthropic's grammar decoder and OpenAI/Mistral
 * strict mode both accept the schema); the model therefore emits `null` for
 * anything it omits. Stripping those nulls deeply restores the exact optional-key
 * shape the rest of the app already expects (`node.style?`, `clause.params?`, …).
 * Nulls that are semantically meaningful (a root node's `parentId`, a clause-less
 * `promptClauseId`) are re-materialized downstream by `normalizeNode`.
 */
function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((v) => v !== null).map(stripNulls);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null) continue;
      out[k] = stripNulls(v);
    }
    return out;
  }
  return value;
}

/**
 * Append the JSON Schema to a system prompt as a hard output constraint. Used
 * for providers where native grammar-constrained decoding is unavailable or
 * refuses the schema — Groq (JSON mode only) and Anthropic (its structured-output
 * grammar decoder caps optional/union parameters far below what this IR schema
 * needs, so `output_config.format` 400s on any variant). Claude and Llama both
 * honor a schema presented this way reliably; `parseJSON` + client-side use guard
 * the rest.
 */
function schemaConditionedSystem(system: string, schema: unknown): string {
  return `${system}

You MUST output a single JSON object that conforms to this JSON Schema. Do not include any text outside the JSON object. Do not wrap it in markdown fences. For any field you have no value for, emit null (every property is listed as required, with null allowed).

Schema:
${JSON.stringify(schema)}`;
}

function parseJSON(text: string): unknown {
  // Strip fenced ```json blocks if a model added them despite instructions.
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    return stripNulls(JSON.parse(stripped));
  } catch (err) {
    throw new LLMError(`Model returned non-JSON output: ${(err as Error).message}`);
  }
}

async function fetchJSON(url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new LLMError(`Network error: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new LLMError(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

// --- Anthropic Claude ---

async function callAnthropic(opts: CallJSONOptions): Promise<CallJSONResult> {
  // Vision: when image chips are present, send a content-block array (images
  // first, then the text) instead of a bare string.
  const imageBlocks = (opts.images ?? [])
    .map(parseDataUrl)
    .filter((p): p is { mediaType: string; data: string } => p !== null)
    .map((p) => ({
      type: 'image',
      source: { type: 'base64', media_type: p.mediaType, data: p.data },
    }));
  const content = imageBlocks.length
    ? [...imageBlocks, { type: 'text', text: opts.user }]
    : opts.user;

  // The IR schema exceeds Anthropic's structured-output grammar limits (both the
  // 24 optional-parameter and 16 union-parameter caps), so native
  // `output_config.format` 400s on any encoding of it. Condition the model with
  // the schema in the system prompt instead; Claude follows it reliably.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await fetchJSON('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: schemaConditionedSystem(opts.system, opts.schema),
      messages: [{ role: 'user', content }],
    }),
  });
  const text = (data.content ?? []).find((b: { type: string }) => b.type === 'text')?.text;
  if (!text) throw new LLMError('Anthropic returned no text block.');
  return {
    data: parseJSON(text),
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}

// --- OpenAI (Chat Completions, json_schema strict) ---

async function callOpenAI(opts: CallJSONOptions): Promise<CallJSONResult> {
  // Vision: OpenAI takes image_url parts (data URLs allowed) in the user turn.
  const userContent = (opts.images ?? []).length
    ? [
        { type: 'text', text: opts.user },
        ...(opts.images ?? []).map((url) => ({ type: 'image_url', image_url: { url } })),
      ]
    : opts.user;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await fetchJSON('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: userContent },
      ],
      max_tokens: opts.maxTokens,
      response_format: {
        type: 'json_schema',
        json_schema: { name: opts.schemaName, schema: opts.schema, strict: true },
      },
    }),
  });
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new LLMError('OpenAI returned no message content.');
  return {
    data: parseJSON(text),
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

// --- Mistral (Chat Completions, json_schema) ---

async function callMistral(opts: CallJSONOptions): Promise<CallJSONResult> {
  if (opts.images?.length) {
    throw new LLMError('The Mistral connection here does not support image references. Remove the image chip or switch to Anthropic / OpenAI.');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await fetchJSON('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      max_tokens: opts.maxTokens,
      response_format: {
        type: 'json_schema',
        json_schema: { name: opts.schemaName, schema: opts.schema, strict: true },
      },
    }),
  });
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new LLMError('Mistral returned no message content.');
  return {
    data: parseJSON(text),
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

// --- Groq (json_object mode + prompt-conditioning; validate client-side) ---

async function callGroq(opts: CallJSONOptions): Promise<CallJSONResult> {
  if (opts.images?.length) {
    throw new LLMError('The Groq connection here does not support image references. Remove the image chip or switch to Anthropic / OpenAI.');
  }
  // Groq supports JSON mode, not full json_schema for most models. Inject the
  // schema as a tail constraint and rely on the model to honour it.
  const reinforcedSystem = schemaConditionedSystem(opts.system, opts.schema);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await fetchJSON('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: 'system', content: reinforcedSystem },
        { role: 'user', content: opts.user },
      ],
      max_tokens: opts.maxTokens,
      response_format: { type: 'json_object' },
    }),
  });
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new LLMError('Groq returned no message content.');
  return {
    data: parseJSON(text),
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

export async function callJSON(
  provider: ProviderId,
  opts: CallJSONOptions,
): Promise<CallJSONResult> {
  switch (provider) {
    case 'anthropic':
      return callAnthropic(opts);
    case 'openai':
      return callOpenAI(opts);
    case 'mistral':
      return callMistral(opts);
    case 'groq':
      return callGroq(opts);
  }
}
