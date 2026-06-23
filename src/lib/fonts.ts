/**
 * A bundled, curated catalogue of popular Google Fonts (no runtime fetch).
 *
 * The complete Google Fonts list can be regenerated at build time from
 *   https://www.googleapis.com/webfonts/v1/webfonts?key=$GOOGLE_FONTS_API_KEY&sort=popularity
 * into this same `{ family, category }[]` shape via `scripts/fetch-fonts.ts`
 * (gated on the env var; falls back to this list when the key is absent). The
 * API key stays build-time only and never enters the bundle.
 */

export type FontCategory = 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace';

export interface GoogleFont {
  family: string;
  category: FontCategory;
}

export const GOOGLE_FONTS: GoogleFont[] = [
  // Sans-serif
  { family: 'Inter', category: 'sans-serif' },
  { family: 'Roboto', category: 'sans-serif' },
  { family: 'Open Sans', category: 'sans-serif' },
  { family: 'Lato', category: 'sans-serif' },
  { family: 'Montserrat', category: 'sans-serif' },
  { family: 'Poppins', category: 'sans-serif' },
  { family: 'Source Sans 3', category: 'sans-serif' },
  { family: 'Raleway', category: 'sans-serif' },
  { family: 'Nunito', category: 'sans-serif' },
  { family: 'Nunito Sans', category: 'sans-serif' },
  { family: 'Work Sans', category: 'sans-serif' },
  { family: 'Rubik', category: 'sans-serif' },
  { family: 'Mulish', category: 'sans-serif' },
  { family: 'Manrope', category: 'sans-serif' },
  { family: 'DM Sans', category: 'sans-serif' },
  { family: 'Space Grotesk', category: 'sans-serif' },
  { family: 'Sora', category: 'sans-serif' },
  { family: 'Outfit', category: 'sans-serif' },
  { family: 'Plus Jakarta Sans', category: 'sans-serif' },
  { family: 'Figtree', category: 'sans-serif' },
  { family: 'Albert Sans', category: 'sans-serif' },
  { family: 'Onest', category: 'sans-serif' },
  { family: 'Schibsted Grotesk', category: 'sans-serif' },
  { family: 'IBM Plex Sans', category: 'sans-serif' },
  { family: 'Libre Franklin', category: 'sans-serif' },
  { family: 'Archivo', category: 'sans-serif' },
  { family: 'Cabin', category: 'sans-serif' },
  { family: 'Karla', category: 'sans-serif' },
  { family: 'Heebo', category: 'sans-serif' },
  { family: 'Quicksand', category: 'sans-serif' },
  { family: 'Josefin Sans', category: 'sans-serif' },
  { family: 'Hind', category: 'sans-serif' },
  { family: 'Barlow', category: 'sans-serif' },
  { family: 'Barlow Condensed', category: 'sans-serif' },
  { family: 'Kanit', category: 'sans-serif' },
  { family: 'PT Sans', category: 'sans-serif' },
  { family: 'Mukta', category: 'sans-serif' },
  { family: 'Titillium Web', category: 'sans-serif' },
  { family: 'Fira Sans', category: 'sans-serif' },
  { family: 'Dosis', category: 'sans-serif' },
  { family: 'Catamaran', category: 'sans-serif' },
  { family: 'Assistant', category: 'sans-serif' },
  { family: 'Exo 2', category: 'sans-serif' },
  { family: 'Maven Pro', category: 'sans-serif' },
  { family: 'Signika', category: 'sans-serif' },
  { family: 'Saira', category: 'sans-serif' },
  { family: 'Red Hat Display', category: 'sans-serif' },
  { family: 'Lexend', category: 'sans-serif' },
  { family: 'Epilogue', category: 'sans-serif' },
  { family: 'Urbanist', category: 'sans-serif' },
  { family: 'Be Vietnam Pro', category: 'sans-serif' },
  { family: 'Inter Tight', category: 'sans-serif' },
  { family: 'Geologica', category: 'sans-serif' },
  { family: 'Wix Madefor Text', category: 'sans-serif' },
  { family: 'Hanken Grotesk', category: 'sans-serif' },
  { family: 'Instrument Sans', category: 'sans-serif' },
  { family: 'Overpass', category: 'sans-serif' },
  { family: 'Chivo', category: 'sans-serif' },
  { family: 'Public Sans', category: 'sans-serif' },
  { family: 'Spline Sans', category: 'sans-serif' },
  { family: 'Oxygen', category: 'sans-serif' },
  { family: 'Cabinet Grotesk', category: 'sans-serif' },
  { family: 'Tajawal', category: 'sans-serif' },
  { family: 'Jost', category: 'sans-serif' },
  { family: 'Comfortaa', category: 'sans-serif' },
  { family: 'Prompt', category: 'sans-serif' },
  { family: 'Oswald', category: 'sans-serif' },
  { family: 'Bebas Neue', category: 'display' },
  { family: 'Anton', category: 'display' },
  { family: 'Teko', category: 'display' },
  { family: 'Righteous', category: 'display' },
  { family: 'Archivo Black', category: 'display' },
  { family: 'Abril Fatface', category: 'display' },
  { family: 'Pathway Gothic One', category: 'display' },
  { family: 'Staatliches', category: 'display' },
  { family: 'Alfa Slab One', category: 'display' },
  { family: 'Passion One', category: 'display' },
  { family: 'Fjalla One', category: 'display' },
  { family: 'Bungee', category: 'display' },
  { family: 'Unbounded', category: 'display' },
  { family: 'Syne', category: 'display' },
  { family: 'Clash Display', category: 'display' },
  // Serif
  { family: 'Playfair Display', category: 'serif' },
  { family: 'Merriweather', category: 'serif' },
  { family: 'Lora', category: 'serif' },
  { family: 'PT Serif', category: 'serif' },
  { family: 'Bitter', category: 'serif' },
  { family: 'Source Serif 4', category: 'serif' },
  { family: 'Fraunces', category: 'serif' },
  { family: 'Crimson Pro', category: 'serif' },
  { family: 'Crimson Text', category: 'serif' },
  { family: 'Libre Baskerville', category: 'serif' },
  { family: 'EB Garamond', category: 'serif' },
  { family: 'Cormorant Garamond', category: 'serif' },
  { family: 'Cormorant', category: 'serif' },
  { family: 'Spectral', category: 'serif' },
  { family: 'Noto Serif', category: 'serif' },
  { family: 'Domine', category: 'serif' },
  { family: 'Zilla Slab', category: 'serif' },
  { family: 'Arvo', category: 'serif' },
  { family: 'Vollkorn', category: 'serif' },
  { family: 'Bodoni Moda', category: 'serif' },
  { family: 'DM Serif Display', category: 'serif' },
  { family: 'DM Serif Text', category: 'serif' },
  { family: 'Frank Ruhl Libre', category: 'serif' },
  { family: 'Cardo', category: 'serif' },
  { family: 'Newsreader', category: 'serif' },
  { family: 'Petrona', category: 'serif' },
  { family: 'Besley', category: 'serif' },
  { family: 'Rozha One', category: 'serif' },
  // Monospace
  { family: 'IBM Plex Mono', category: 'monospace' },
  { family: 'JetBrains Mono', category: 'monospace' },
  { family: 'Fira Code', category: 'monospace' },
  { family: 'Source Code Pro', category: 'monospace' },
  { family: 'Roboto Mono', category: 'monospace' },
  { family: 'Space Mono', category: 'monospace' },
  { family: 'Inconsolata', category: 'monospace' },
  { family: 'Ubuntu Mono', category: 'monospace' },
  { family: 'DM Mono', category: 'monospace' },
  { family: 'Overpass Mono', category: 'monospace' },
  { family: 'Martian Mono', category: 'monospace' },
  { family: 'Red Hat Mono', category: 'monospace' },
  // Handwriting
  { family: 'Caveat', category: 'handwriting' },
  { family: 'Dancing Script', category: 'handwriting' },
  { family: 'Pacifico', category: 'handwriting' },
  { family: 'Shadows Into Light', category: 'handwriting' },
  { family: 'Satisfy', category: 'handwriting' },
  { family: 'Sacramento', category: 'handwriting' },
  { family: 'Kalam', category: 'handwriting' },
  { family: 'Patrick Hand', category: 'handwriting' },
  { family: 'Permanent Marker', category: 'handwriting' },
  { family: 'Gloria Hallelujah', category: 'handwriting' },
];

const GENERIC: Record<FontCategory, string> = {
  'sans-serif': 'sans-serif',
  serif: 'serif',
  display: 'sans-serif',
  handwriting: 'cursive',
  monospace: 'monospace',
};

const BY_FAMILY = new Map(GOOGLE_FONTS.map((f) => [f.family.toLowerCase(), f]));

export function isGoogleFont(family: string): boolean {
  return BY_FAMILY.has(family.trim().toLowerCase());
}

/** A CSS font-family value with a sensible generic fallback for a Google font. */
export function fontStack(family: string): string {
  const f = BY_FAMILY.get(family.trim().toLowerCase());
  return `'${family.trim()}', ${f ? GENERIC[f.category] : 'sans-serif'}`;
}

/** Extract the primary family name from a CSS font-family stack value. */
export function familyFromStack(value: string | undefined): string {
  if (!value) return '';
  return value.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
}
