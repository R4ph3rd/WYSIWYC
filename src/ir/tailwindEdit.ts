/**
 * Deterministic edits to a node's Tailwind className string. Direct manipulation
 * writes through these — no LLM involved. We treat the className as a set of
 * space-separated utilities and replace utilities in the same "family" (same
 * prefix up to the value) so a recolor swaps `bg-blue-600` → `bg-rose-600`
 * rather than appending a conflicting class.
 */

const COLOR_PREFIXES = ['bg-', 'text-', 'border-', 'from-', 'to-', 'via-', 'ring-', 'fill-'];

function familyOf(util: string): string | null {
  // e.g. "bg-blue-600" → "bg-", "hover:bg-blue-700" → "hover:bg-"
  const colonIdx = util.lastIndexOf(':');
  const variant = colonIdx >= 0 ? util.slice(0, colonIdx + 1) : '';
  const base = colonIdx >= 0 ? util.slice(colonIdx + 1) : util;
  for (const p of COLOR_PREFIXES) {
    if (base.startsWith(p)) return variant + p;
  }
  return null;
}

export function classList(tailwind: string): string[] {
  return tailwind.split(/\s+/).filter(Boolean);
}

/** Replace any utility in the same family as `next`, else append `next`. */
export function setUtility(tailwind: string, next: string): string {
  const family = familyOf(next);
  const out: string[] = [];
  let replaced = false;
  for (const util of classList(tailwind)) {
    if (family && familyOf(util) === family) {
      if (!replaced) {
        out.push(next);
        replaced = true;
      }
      // drop other same-family utilities (but keep hover: variants distinct)
      continue;
    }
    out.push(util);
  }
  if (!replaced) out.push(next);
  return out.join(' ');
}

/** Find the current background color utility, if any (for recolor "from"). */
export function currentBackground(tailwind: string): string {
  return classList(tailwind).find((u) => familyOf(u) === 'bg-') ?? '';
}

const ALIGN_UTILS = new Set(['text-left', 'text-center', 'text-right', 'text-justify']);

/** Swap text alignment without touching `text-<color>` utilities. */
export function setAlignment(tailwind: string, next: string): string {
  const out = classList(tailwind).filter((u) => !ALIGN_UTILS.has(u));
  out.push(next);
  return out.join(' ');
}
