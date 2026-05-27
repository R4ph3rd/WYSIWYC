import { create } from 'zustand';
import type { ProviderId } from '@/llm/providers';

const KEYS_LS = 'wysiwyc.keys';
const TEXT_LS = 'wysiwyc.text';
const IMAGE_LS = 'wysiwyc.image';

export interface ModelSelection {
  provider: ProviderId;
  model: string;
}

export interface ResolvedConfig extends ModelSelection {
  apiKey: string;
}

const DEFAULT_TEXT: ModelSelection = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
};

function loadKeys(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEYS_LS) ?? '{}');
  } catch {
    return {};
  }
}

function loadSelection(ls: string, fallback: ModelSelection | null): ModelSelection | null {
  const raw = localStorage.getItem(ls);
  if (!raw || raw === 'local') return raw === 'local' ? null : fallback;
  const [provider, ...rest] = raw.split(':');
  return { provider: provider as ProviderId, model: rest.join(':') };
}

interface ModelStore {
  keys: Record<string, string>;
  text: ModelSelection;
  image: ModelSelection | null; // null = offline local placeholder

  setKey: (provider: ProviderId, key: string) => void;
  removeKey: (provider: ProviderId) => void;
  setText: (sel: ModelSelection) => void;
  setImage: (sel: ModelSelection | null) => void;

  textConfig: () => ResolvedConfig | null;
  imageConfig: () => ResolvedConfig | null;
}

export const useModelStore = create<ModelStore>((set, get) => ({
  keys: loadKeys(),
  text: loadSelection(TEXT_LS, DEFAULT_TEXT) ?? DEFAULT_TEXT,
  image: loadSelection(IMAGE_LS, null),

  setKey: (provider, key) =>
    set((s) => {
      const keys = { ...s.keys, [provider]: key };
      localStorage.setItem(KEYS_LS, JSON.stringify(keys));
      return { keys };
    }),

  removeKey: (provider) =>
    set((s) => {
      const keys = { ...s.keys };
      delete keys[provider];
      localStorage.setItem(KEYS_LS, JSON.stringify(keys));
      return { keys };
    }),

  setText: (text) => {
    localStorage.setItem(TEXT_LS, `${text.provider}:${text.model}`);
    set({ text });
  },

  setImage: (image) => {
    localStorage.setItem(IMAGE_LS, image ? `${image.provider}:${image.model}` : 'local');
    set({ image });
  },

  textConfig: () => {
    const { keys, text } = get();
    const apiKey = keys[text.provider];
    return apiKey ? { ...text, apiKey } : null;
  },

  imageConfig: () => {
    const { keys, image } = get();
    if (!image) return null;
    const apiKey = keys[image.provider];
    return apiKey ? { ...image, apiKey } : null;
  },
}));
