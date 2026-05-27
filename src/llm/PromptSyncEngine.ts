import type { GeometryDelta, PromptAreaData, PromptWord, WordStyle } from '@/types';
import { syncPromptFromGeometry } from './AnthropicClient';
import { imageGenClient } from './ImageGenClient';
import { tintImage } from '@/canvas/imageFilters';
import { wordsToPrompt } from '@/lib/tokenize';

export interface VisualTransform {
  type: 'tint' | 'rotate' | 'scale' | 'none';
  value?: string | number;
  imageDataURL?: string;
}

/** Visual → Text: ask the LLM to rewrite the prompt for a geometry change. */
export async function applyGeometryDelta(
  area: PromptAreaData,
  delta: GeometryDelta,
  apiKey: string,
  modelId: string,
): Promise<string> {
  return syncPromptFromGeometry(area.rawPrompt, delta, apiKey, modelId);
}

const COLOR_NAMES: Record<string, string> = {
  '#ef4444': 'red',
  '#f97316': 'orange',
  '#eab308': 'yellow',
  '#22c55e': 'green',
  '#2563eb': 'blue',
  '#3b82f6': 'blue',
  '#8b5cf6': 'purple',
  '#ec4899': 'pink',
  '#171717': 'black',
  '#ffffff': 'white',
};

function nearestColorName(hex: string): string | null {
  return COLOR_NAMES[hex.toLowerCase()] ?? null;
}

/**
 * Text → Visual: deterministic mapping from a word style change to a visual
 * transform (no LLM needed).
 */
export async function applyWordStyleDelta(
  area: PromptAreaData,
  word: PromptWord,
  oldStyle: WordStyle,
): Promise<VisualTransform> {
  if (word.color !== oldStyle.color) {
    if (area.generatedImageDataURL) {
      const tinted = await tintImage(area.generatedImageDataURL, word.color);
      return { type: 'tint', value: word.color, imageDataURL: tinted };
    }
    return { type: 'tint', value: word.color };
  }
  if (word.rotation !== oldStyle.rotation) {
    return { type: 'rotate', value: word.rotation };
  }
  if (word.fontSize !== oldStyle.fontSize) {
    return { type: 'scale', value: word.fontSize / oldStyle.fontSize };
  }
  return { type: 'none' };
}

/** Deterministic color-word replacement for the raw prompt. */
export function rewritePromptForWordColor(words: PromptWord[], changed: PromptWord): string {
  const name = nearestColorName(changed.color);
  if (!name) return wordsToPrompt(words);
  const updated = words.map((w) =>
    w.id === changed.id ? { ...w, text: w.text } : w,
  );
  // Prefix a color qualifier if not already present.
  const prompt = wordsToPrompt(updated);
  return prompt.toLowerCase().includes(name) ? prompt : `${name} ${prompt}`;
}

/** Full (re)generation for a prompt area. */
export async function regenerate(
  area: PromptAreaData,
  onChunk?: (partial: string) => void,
): Promise<{ dataURL: string; seed: number }> {
  const seed = area.generationSeed ?? Math.floor(Math.random() * 1_000_000);
  const opts = { seed, width: 512, height: 512 };
  let dataURL: string;
  if (onChunk && imageGenClient.generateStream) {
    dataURL = await imageGenClient.generateStream(area.rawPrompt, opts, onChunk);
  } else {
    dataURL = await imageGenClient.generate(area.rawPrompt, opts);
  }
  return { dataURL, seed };
}
