import { create } from 'zustand';
import type { ProviderId } from '@/llm/providers';
import { PROVIDERS, providerOf } from '@/llm/providers';

/**
 * LLM connection settings. Keys are stored in localStorage (browser-only) so
 * the user controls them; nothing leaves the page except direct calls to the
 * provider's API. One provider is "active" at a time.
 */

const STORAGE_KEY = 'wysiwyc.settings.v1';

interface Persisted {
  activeProvider: ProviderId;
  models: Record<ProviderId, string>;
  keys: Record<ProviderId, string>;
}

const DEFAULTS: Persisted = {
  activeProvider: 'anthropic',
  models: Object.fromEntries(
    PROVIDERS.map((p) => [p.id, p.defaultModel]),
  ) as Record<ProviderId, string>,
  keys: { anthropic: '', openai: '', mistral: '', groq: '' },
};

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

function save(state: Persisted): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

interface SettingsStore {
  activeProvider: ProviderId;
  models: Record<ProviderId, string>;
  keys: Record<ProviderId, string>;

  setActiveProvider: (id: ProviderId) => void;
  setKey: (id: ProviderId, key: string) => void;
  setModel: (id: ProviderId, model: string) => void;

  /** True iff the active provider has a non-empty key. */
  isConnected: () => boolean;
  /** Resolved active connection, or null when not connected. */
  active: () => { provider: ProviderId; model: string; apiKey: string } | null;
  /** Pretty label for the active connection (used in the top bar). */
  activeLabel: () => string;
}

const initial = load();

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  activeProvider: initial.activeProvider,
  models: initial.models,
  keys: initial.keys,

  setActiveProvider: (activeProvider) =>
    set((s) => {
      const next = { ...s, activeProvider };
      save({ activeProvider, models: s.models, keys: s.keys });
      return next;
    }),

  setKey: (id, key) =>
    set((s) => {
      const keys = { ...s.keys, [id]: key };
      save({ activeProvider: s.activeProvider, models: s.models, keys });
      return { keys };
    }),

  setModel: (id, model) =>
    set((s) => {
      const models = { ...s.models, [id]: model };
      save({ activeProvider: s.activeProvider, models, keys: s.keys });
      return { models };
    }),

  isConnected: () => {
    const { activeProvider, keys } = get();
    return Boolean(keys[activeProvider]?.trim());
  },

  active: () => {
    const { activeProvider, models, keys } = get();
    const apiKey = keys[activeProvider]?.trim();
    if (!apiKey) return null;
    return {
      provider: activeProvider,
      model: models[activeProvider] ?? providerOf(activeProvider).defaultModel,
      apiKey,
    };
  },

  activeLabel: () => {
    const { activeProvider, models, keys } = get();
    const def = providerOf(activeProvider);
    const model = def.models.find((m) => m.id === (models[activeProvider] ?? def.defaultModel))?.label ?? '';
    const connected = Boolean(keys[activeProvider]?.trim());
    return connected ? `${def.label} · ${model}` : `Connect a model`;
  },
}));
