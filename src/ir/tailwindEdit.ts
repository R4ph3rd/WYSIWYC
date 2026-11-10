/**
 * Deterministic edits to a node's Tailwind className string. Direct manipulation
 * writes through these — no LLM involved. We treat the className as a set of
 * space-separated utilities and replace utilities in the same "family" (same
 * prefix up to the value) so a recolor swaps `bg-blue-600` → `bg-rose-600`
 * rather than appending a conflicting class.
 */

const COLOR_PREFIXES = ['bg-', 'text-', 'border-', 'from-', 'to-', 'via-', 'ring-', 'fill-', 'stroke-'];

/**
 * True when a utility's value (after the family prefix) names a colour —
 * `blue-600`, `white`, `[#123456]`, `emerald-500/40` — as opposed to a size,
 * alignment or position sharing the prefix (`text-sm`, `text-center`,
 * `border-2`, `from-10%`, `bg-gradient-to-r`).
 */
export function isColorValue(value: string): boolean {
  const v = value.replace(/\/\d+$/, '');
  return (
    /^[a-z]+-\d{2,3}$/.test(v) ||
    /^(?:white|black|transparent|current|inherit)$/.test(v) ||
    /^\[(?:#|rgb|hsl|color:)/i.test(v)
  );
}

/** Split a utility into its variant prefix ("hover:") and its base. */
function splitVariant(util: string): [string, string] {
  const colonIdx = util.lastIndexOf(':');
  return colonIdx >= 0 ? [util.slice(0, colonIdx + 1), util.slice(colonIdx + 1)] : ['', util];
}

function familyOf(util: string): string | null {
  // e.g. "bg-blue-600" → "bg-", "hover:bg-blue-700" → "hover:bg-". Only COLOUR
  // utilities form a family: "text-sm" must survive a "text-rose-600" recolor.
  const [variant, base] = splitVariant(util);
  for (const p of COLOR_PREFIXES) {
    if (base.startsWith(p) && isColorValue(base.slice(p.length))) return variant + p;
  }
  return null;
}

/** The colour value of the first utility in `family` (e.g. "from-") on a className, if any. */
export function colorUtilityValue(tailwind: string, family: string): string | null {
  for (const util of classList(tailwind)) {
    if (familyOf(util) === family) return util.slice(family.length);
  }
  return null;
}

/** Remove every colour utility of `family` (e.g. "via-"). */
export function removeUtilityFamily(tailwind: string, family: string): string {
  return classList(tailwind).filter((u) => familyOf(u) !== family).join(' ');
}

export function classList(tailwind: string | undefined): string[] {
  return (tailwind ?? '').split(/\s+/).filter(Boolean);
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
