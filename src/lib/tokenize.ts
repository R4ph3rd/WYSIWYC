import type { PromptWord } from '@/types';
import { uid } from './utils';

const DEFAULT_FONT_SIZE = 16;

export function tokenizePrompt(prompt: string): PromptWord[] {
  const tokens = prompt.split(/\s+/).filter(Boolean);
  return tokens.map((text) => ({
    id: uid('w'),
    text,
    fontSize: DEFAULT_FONT_SIZE,
    color: '#171717',
    rotation: 0,
    bold: false,
    italic: false,
    x: 0,
    y: 0,
  }));
}

export function wordsToPrompt(words: PromptWord[]): string {
  return words.map((w) => w.text).join(' ').trim();
}

/**
 * Re-tokenize while preserving per-word styling for words whose text is
 * unchanged at the same index. Lets edits in the overlay keep word styles.
 */
export function retokenizePreservingStyle(prompt: string, prev: PromptWord[]): PromptWord[] {
  const next = tokenizePrompt(prompt);
  return next.map((w, i) => {
    const old = prev[i];
    if (old && old.text === w.text) return { ...old, x: w.x, y: w.y };
    return w;
  });
}
