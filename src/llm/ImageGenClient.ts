import type { GenOptions, ImageGenClient } from '@/types';

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Offline placeholder generator. Deterministically renders a seeded gradient
 * "concept" image with the prompt rendered on top, so the full pipeline works
 * without a live image-generation endpoint. Swap this out for a real
 * ImageGenClient (DALL-E / SD / Anthropic) by implementing the same interface.
 */
export class LocalPlaceholderGenClient implements ImageGenClient {
  private render(prompt: string, options: GenOptions, progress = 1): string {
    const w = options.width ?? 512;
    const h = options.height ?? 512;
    const seed = options.seed ?? hashString(prompt);
    const rand = mulberry32(seed);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;

    const hueA = Math.floor(rand() * 360);
    const hueB = (hueA + 60 + Math.floor(rand() * 180)) % 360;
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, `hsl(${hueA}, 70%, 60%)`);
    grad.addColorStop(1, `hsl(${hueB}, 65%, 45%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const blobs = 5 + Math.floor(rand() * 6);
    for (let i = 0; i < blobs; i++) {
      ctx.beginPath();
      const r = (0.05 + rand() * 0.25) * w;
      ctx.arc(rand() * w, rand() * h, r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${Math.floor(rand() * 360)}, 80%, ${50 + rand() * 30}%, ${0.15 + rand() * 0.25})`;
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, h - 130, w, 130);
    ctx.fillStyle = '#ffffff';
    ctx.font = '500 22px ui-sans-serif, system-ui, sans-serif';
    const lines = wrapText(ctx, prompt, w - 40).slice(0, 4);
    lines.forEach((ln, i) => ctx.fillText(ln, 20, h - 95 + i * 28));

    if (progress < 1) {
      const revealed = Math.floor(h * progress);
      ctx.clearRect(0, revealed, w, h - revealed);
      ctx.fillStyle = '#e9ecef';
      ctx.fillRect(0, revealed, w, h - revealed);
    }

    return canvas.toDataURL('image/png');
  }

  async generate(prompt: string, options: GenOptions): Promise<string> {
    await new Promise((r) => setTimeout(r, 350));
    return this.render(prompt, options, 1);
  }

  async generateStream(
    prompt: string,
    options: GenOptions,
    onChunk: (partial: string) => void,
  ): Promise<string> {
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      await new Promise((r) => setTimeout(r, 120));
      onChunk(this.render(prompt, options, i / steps));
    }
    return this.render(prompt, options, 1);
  }
}

export const imageGenClient: ImageGenClient = new LocalPlaceholderGenClient();
