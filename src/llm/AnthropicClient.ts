import type { GeometryDelta } from '@/types';
import type { ResolvedConfig } from '@/state/modelStore';
import { generateText } from './providers';

export function describeGeometryDelta(delta: GeometryDelta): string {
  const parts: string[] = [];
  if (delta.rotation) {
    const dir = delta.rotation > 0 ? 'clockwise' : 'counter-clockwise';
    parts.push(`rotated ${Math.abs(Math.round(delta.rotation))} degrees ${dir}`);
  }
  if (delta.scale && delta.scale !== 1) {
    parts.push(
      delta.scale > 1 ? `scaled up by ${delta.scale.toFixed(2)}x` : `scaled down to ${delta.scale.toFixed(2)}x`,
    );
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
  cfg: ResolvedConfig,
): Promise<string> {
  const system = `You are a prompt editor for an image generation system.
The user has made a visual transformation to an image.
Update the generation prompt to reflect this change.
Return ONLY the updated prompt text. No explanation.`;

  const user = `Current prompt: "${currentPrompt}"
Transformation applied: ${describeGeometryDelta(delta)}
Updated prompt:`;

  const out = await generateText(cfg.provider, cfg.model, cfg.apiKey, system, user, 300);
  return out.trim() || currentPrompt;
}
