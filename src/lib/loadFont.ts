/**
 * Lazy, deduped Google Fonts loader. NEVER loads the whole catalogue up front —
 * a stylesheet `<link>` is injected the first time a family is actually needed
 * (shown in the picker, or in use by a node's resolved `style.fontFamily`).
 */
import { isGoogleFont } from './fonts';

const loaded = new Set<string>();

export function loadGoogleFont(family: string, weights: number[] = [400, 500, 600, 700]): void {
  if (typeof document === 'undefined') return;
  const fam = family.trim();
  const key = fam.toLowerCase();
  if (!fam || loaded.has(key) || !isGoogleFont(fam)) return;
  loaded.add(key);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${fam.replace(/ /g, '+')}:wght@${weights.join(';')}&display=swap`;
  document.head.appendChild(link);
}
