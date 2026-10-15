/**
 * Shared UI colour tokens.
 *
 * The app has ONE accent for "the AI / your markup": the amber of the Sparkles
 * icon on inferred clauses. It marks everything the model reads or proposes —
 * canvas annotations, the prompt send button, the Composing… halo, suggested
 * and proposed clauses, location pins and gesture chips. Plain selection and
 * app chrome stay neutral (slate) so the accent keeps its meaning.
 *
 * Hex values are for JS (SVG attributes, inline styles); `AI` holds the
 * matching Tailwind class bundles so every surface pairs fill and text the same
 * way. Text never sits white-on-yellow: fills carry amber-950 text, tints carry
 * amber-800, both well above WCAG AA (4.5:1).
 */

/** amber-500: the accent ink (strokes, icons, halo glow). */
export const AI_ACCENT = '#f59e0b';
/** amber-400: the accent fill behind dark text (buttons, pins, chips). */
export const AI_ACCENT_FILL = '#fbbf24';
/** amber-700: accent text on white / tinted surfaces. */
export const AI_ACCENT_TEXT = '#b45309';
/** amber-950: text and icons sitting on an accent fill. */
export const AI_ACCENT_ON = '#451a03';

/** Annotation ink: markup on the canvas reads in the AI accent. */
export const ANNOTATION_INK = AI_ACCENT;

/** Tailwind class bundles for the AI accent. */
export const AI = {
  /** Solid filled control (send, apply, accept). */
  fill: 'bg-amber-400 text-amber-950 hover:bg-amber-500',
  /** Focus ring for accent controls. */
  focus: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1',
  /** Low-opacity tint with a dashed border: a suggestion awaiting review. */
  tint: 'border-dashed border-amber-400/70 bg-amber-500/[0.07]',
  /** Soft chip on white (gesture intents, location chips). */
  chip: 'border-amber-300 bg-amber-50 text-amber-800',
  /** Text field focus in accent-owned panels. */
  fieldFocus: 'focus:border-amber-400 focus:ring-2 focus:ring-amber-100',
} as const;
