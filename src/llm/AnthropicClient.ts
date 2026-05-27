import type { GeometryDelta } from '@/types';

const API_URL = 'https://api.anthropic.com/v1/messages';
const SYNC_MODEL = 'claude-sonnet-4-20250514';

export function describeGeometryDelta(delta: GeometryDelta): string {
  const parts: string[] = [];
  if (delta.rotation) {
    const dir = delta.rotation > 0 ? 'clockwise' : 'counter-clockwise';
    parts.push(`rotated ${Math.abs(Math.round(delta.rotation))} degrees ${dir}`);
  }
  if (delta.scale && delta.scale !== 1) {
    parts.push(delta.scale > 1 ? `scaled up by ${delta.scale.toFixed(2)}x` : `scaled down to ${delta.scale.toFixed(2)}x`);
  }
  if (delta.dx || delta.dy) {
    const h = (delta.dx ?? 0) > 0 ? 'right' : (delta.dx ?? 0) < 0 ? 'left' : '';
    const v = (delta.dy ?? 0) > 0 ? 'down' : (delta.dy ?? 0) < 0 ? 'up' : '';
    parts.push(`moved ${[v, h].filter(Boolean).join(' and ')}`);
  }
  return parts.length ? parts.join(', ') : 'transformed';
}

export async function syncPromptFromGeometry(
  currentPrompt: string,
  delta: GeometryDelta,
  apiKey: string,
  modelId: string = SYNC_MODEL,
): Promise<string> {
  const systemPrompt = `You are a prompt editor for an image generation system.
The user has made a visual transformation to an image.
Update the generation prompt to reflect this change.
Return ONLY the updated prompt text. No explanation.`;

  const userMessage = `Current prompt: "${currentPrompt}"
Transformation applied: ${describeGeometryDelta(delta)}
Updated prompt:`;

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return (data.content?.[0]?.text ?? currentPrompt).trim();
}

export async function testConnection(apiKey: string, modelId: string): Promise<boolean> {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'ping' }],
    }),
  });
  return response.ok;
}
