/**
 * A broad set of Google Fonts the app can use for the typography controls and
 * the clause font-parameter widget. They are loaded lazily at runtime via a
 * single stylesheet link (the Tailwind Play CDN handles the rest of styling).
 */

export const GOOGLE_FONTS: string[] = [
  // Sans
  'Inter',
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Poppins',
  'Raleway',
  'Nunito',
  'Nunito Sans',
  'Work Sans',
  'Rubik',
  'Mulish',
  'Manrope',
  'DM Sans',
  'Space Grotesk',
  'Sora',
  'Outfit',
  'Plus Jakarta Sans',
  'Figtree',
  'Albert Sans',
  'Onest',
  'Schibsted Grotesk',
  'IBM Plex Sans',
  'Libre Franklin',
  'Archivo',
  'Cabin',
  'Karla',
  'Heebo',
  'Quicksand',
  'Josefin Sans',
  'Oswald',
  'Bebas Neue',
  // Serif
  'Playfair Display',
  'Merriweather',
  'Lora',
  'PT Serif',
  'Bitter',
  'Source Serif 4',
  'Fraunces',
  'Crimson Pro',
  'Libre Baskerville',
  // Mono
  'IBM Plex Mono',
  'JetBrains Mono',
  'Fira Code',
  'Source Code Pro',
  'Roboto Mono',
  'Space Mono',
];

let injected = false;

/** Inject the Google Fonts stylesheet once (idempotent, browser-only). */
export function ensureGoogleFonts(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const families = GOOGLE_FONTS.map(
    (f) => `family=${f.replace(/ /g, '+')}:wght@300;400;500;600;700;800`,
  ).join('&');
  // Preconnect for faster fetches.
  for (const [href, crossorigin] of [
    ['https://fonts.googleapis.com', false],
    ['https://fonts.gstatic.com', true],
  ] as const) {
    const pre = document.createElement('link');
    pre.rel = 'preconnect';
    pre.href = href as string;
    if (crossorigin) pre.crossOrigin = 'anonymous';
    document.head.appendChild(pre);
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
  document.head.appendChild(link);
}

/** A CSS font-family value with a sensible generic fallback for a Google font. */
export function fontStack(name: string): string {
  const mono = /Mono|Code/.test(name);
  const serif = /Serif|Playfair|Merriweather|Lora|Bitter|Fraunces|Crimson|Baskerville|PT Serif/.test(name);
  const generic = mono ? 'monospace' : serif ? 'serif' : 'sans-serif';
  return `'${name}', ${generic}`;
}
