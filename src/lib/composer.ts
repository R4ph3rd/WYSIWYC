/**
 * Pure helpers for the rich composer value (text segments + reference chips).
 * No React, no LLM — kept separate so serialization stays unit-testable.
 *
 * The on-send serialization interpolates a stable `«ref_n»` marker per chip so
 * the model sees prose with explicit reference points that correlate with the
 * resolved `refs` array (see llm/prompts.ts → referencedElementsBlock).
 */
import type { ComposerValue, PromptRef } from '@/ir/types';
import { nextRefId } from '@/ir/ids';

export function emptyComposer(): ComposerValue {
  return [{ type: 'text', text: '' }];
}

export function composerIsEmpty(value: ComposerValue): boolean {
  return value.every((seg) => (seg.type === 'text' ? seg.text.trim() === '' : false));
}

export function composerRefs(value: ComposerValue): PromptRef[] {
  return value.flatMap((seg) => (seg.type === 'ref' ? [seg.ref] : []));
}

/**
 * Canonicalize a composer value so the editor can render it as a strict
 * alternation text, ref, text, ref, …, text (a text segment at both ends and
 * between any two chips). Adjacent text segments are merged.
 */
export function normalizeComposer(value: ComposerValue): ComposerValue {
  const out: ComposerValue = [];
  const pushText = (text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === 'text') last.text += text;
    else out.push({ type: 'text', text });
  };
  // Leading text segment.
  if (value.length === 0 || value[0].type !== 'text') out.push({ type: 'text', text: '' });
  for (const seg of value) {
    if (seg.type === 'text') pushText(seg.text);
    else {
      // Guarantee a text segment before each chip.
      if (out.length === 0 || out[out.length - 1].type !== 'text') out.push({ type: 'text', text: '' });
      out.push(seg);
    }
  }
  // Trailing text segment.
  if (out.length === 0 || out[out.length - 1].type !== 'text') out.push({ type: 'text', text: '' });
  return out;
}

/** Allocate the next ref id given an existing composer value. */
export function nextComposerRefId(value: ComposerValue): string {
  const ids = composerRefs(value).map((r) => r.refId);
  return nextRefId(ids);
}

/**
 * Insert a chip into a text segment, splitting it at `caret`. Returns the new
 * (normalized) value. When `segIndex`/`caret` are omitted, the chip is appended.
 */
export function insertRef(
  value: ComposerValue,
  ref: PromptRef,
  segIndex?: number,
  caret?: number,
): ComposerValue {
  const norm = normalizeComposer(value);
  if (segIndex === undefined || norm[segIndex]?.type !== 'text') {
    return normalizeComposer([...norm, { type: 'ref', ref }, { type: 'text', text: '' }]);
  }
  const seg = norm[segIndex] as { type: 'text'; text: string };
  const c = Math.max(0, Math.min(seg.text.length, caret ?? seg.text.length));
  const before = seg.text.slice(0, c);
  const after = seg.text.slice(c);
  const next: ComposerValue = [
    ...norm.slice(0, segIndex),
    { type: 'text', text: before },
    { type: 'ref', ref },
    { type: 'text', text: after },
    ...norm.slice(segIndex + 1),
  ];
  return normalizeComposer(next);
}

/**
 * Insert a chip in place of the first text occurrence matching `keywordRe`
 * (e.g. the word "here"/"there"), consuming that word. Returns null when no
 * occurrence is found so the caller can fall back to appending.
 */
export function insertRefReplacingKeyword(
  value: ComposerValue,
  ref: PromptRef,
  keywordRe: RegExp,
): ComposerValue | null {
  const norm = normalizeComposer(value);
  for (let i = 0; i < norm.length; i++) {
    const seg = norm[i];
    if (seg.type !== 'text') continue;
    const m = seg.text.match(keywordRe);
    if (!m || m.index === undefined) continue;
    const before = seg.text.slice(0, m.index);
    const after = seg.text.slice(m.index + m[0].length);
    const next: ComposerValue = [
      ...norm.slice(0, i),
      { type: 'text', text: before },
      { type: 'ref', ref },
      { type: 'text', text: after },
      ...norm.slice(i + 1),
    ];
    return normalizeComposer(next);
  }
  return null;
}

/** Remove the chip with the given refId. */
export function removeRef(value: ComposerValue, refId: string): ComposerValue {
  return normalizeComposer(
    value.filter((seg) => !(seg.type === 'ref' && seg.ref.refId === refId)),
  );
}

/**
 * Serialize to `{ text, refs }` for the compose call. Chips become `«ref_n»`
 * tokens embedded in the prose, padded with spaces so they read as words.
 */
export function serializeComposer(value: ComposerValue): { text: string; refs: PromptRef[] } {
  const parts: string[] = [];
  const refs: PromptRef[] = [];
  for (const seg of value) {
    if (seg.type === 'text') parts.push(seg.text);
    else {
      parts.push(` «${seg.ref.refId}» `);
      refs.push(seg.ref);
    }
  }
  const text = parts.join('').replace(/[ \t]{2,}/g, ' ').trim();
  return { text, refs };
}
