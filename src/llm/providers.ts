import type { GenOptions } from '@/types';

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'stability';
export type Role = 'text' | 'image';

export interface ProviderModel {
  id: string;
  label: string;
  roles: Role[];
}

export interface ProviderDef {
  id: ProviderId;
  label: string;
  keyPlaceholder: string;
  keyHint: string;
  models: ProviderModel[];
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    keyPlaceholder: 'sk-ant-...',
    keyHint: 'console.anthropic.com',
    models: [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', roles: ['text'] },
      { id: 'claude-opus-4-20250514', label: 'Claude Opus 4', roles: ['text'] },
      { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', roles: ['text'] },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    keyPlaceholder: 'sk-...',
    keyHint: 'platform.openai.com',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o', roles: ['text'] },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', roles: ['text'] },
      { id: 'gpt-image-1', label: 'GPT Image 1', roles: ['image'] },
      { id: 'dall-e-3', label: 'DALL·E 3', roles: ['image'] },
    ],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    keyPlaceholder: 'AIza...',
    keyHint: 'aistudio.google.com',
    models: [
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', roles: ['text'] },
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', roles: ['text'] },
      { id: 'imagen-3.0-generate-002', label: 'Imagen 3', roles: ['image'] },
    ],
  },
  {
    id: 'stability',
    label: 'Stability AI',
    keyPlaceholder: 'sk-...',
    keyHint: 'platform.stability.ai',
    models: [
      { id: 'core', label: 'Stable Image Core', roles: ['image'] },
      { id: 'sd3.5-large', label: 'Stable Diffusion 3.5', roles: ['image'] },
    ],
  },
];

export function providerOf(id: ProviderId): ProviderDef {
  return PROVIDERS.find((p) => p.id === id)!;
}

export function modelsByRole(role: Role): { provider: ProviderId; model: ProviderModel }[] {
  return PROVIDERS.flatMap((p) =>
    p.models.filter((m) => m.roles.includes(role)).map((model) => ({ provider: p.id, model })),
  );
}

export function modelLabel(provider: ProviderId, modelId: string): string {
  const m = providerOf(provider).models.find((x) => x.id === modelId);
  return m ? `${providerOf(provider).label} · ${m.label}` : modelId;
}

// --- Text generation (used for geometry → prompt sync) ---

export async function generateText(
  provider: ProviderId,
  model: string,
  apiKey: string,
  system: string,
  user: string,
  maxTokens = 300,
): Promise<string> {
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.content?.[0]?.text ?? '';
  }

  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  if (provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  throw new Error(`Provider ${provider} does not support text generation`);
}

// --- Image generation ---

export async function generateImage(
  provider: ProviderId,
  model: string,
  apiKey: string,
  prompt: string,
  options: GenOptions,
): Promise<string> {
  const size = `${options.width ?? 1024}x${options.height ?? 1024}`;

  if (provider === 'openai') {
    const body: Record<string, unknown> = { model, prompt, n: 1, size };
    if (model === 'dall-e-3') body.response_format = 'b64_json';
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`OpenAI image ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI returned no image');
    return `data:image/png;base64,${b64}`;
  }

  if (provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: '1:1' },
      }),
    });
    if (!res.ok) throw new Error(`Imagen ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const b64 = data.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) throw new Error('Imagen returned no image');
    return `data:image/png;base64,${b64}`;
  }

  if (provider === 'stability') {
    const endpoint =
      model === 'core'
        ? 'https://api.stability.ai/v2beta/stable-image/generate/core'
        : 'https://api.stability.ai/v2beta/stable-image/generate/sd3';
    const form = new FormData();
    form.append('prompt', prompt);
    form.append('output_format', 'png');
    if (model !== 'core') form.append('model', model);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      body: form,
    });
    if (!res.ok) throw new Error(`Stability ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.image) throw new Error('Stability returned no image');
    return `data:image/png;base64,${data.image}`;
  }

  throw new Error(`Provider ${provider} does not support image generation`);
}

// --- Lightweight key validation (cheap GET endpoints where possible) ---

export async function testKey(provider: ProviderId, apiKey: string): Promise<boolean> {
  try {
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model: 'claude-3-5-haiku-20241022', max_tokens: 4, messages: [{ role: 'user', content: 'ping' }] }),
      });
      return res.ok;
    }
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return res.ok;
    }
    if (provider === 'gemini') {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      );
      return res.ok;
    }
    if (provider === 'stability') {
      const res = await fetch('https://api.stability.ai/v1/user/account', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return res.ok;
    }
  } catch {
    return false;
  }
  return false;
}
