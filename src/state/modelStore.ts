import { create } from 'zustand';

const KEY_STORAGE = 'wisiwic.apiKey';
const MODEL_STORAGE = 'wisiwic.modelId';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

interface ModelStore {
  apiKey: string | null;
  modelId: string;
  isConnected: boolean;
  setApiKey: (key: string) => void;
  setModelId: (id: string) => void;
  disconnect: () => void;
}

export const useModelStore = create<ModelStore>((set) => ({
  apiKey: localStorage.getItem(KEY_STORAGE),
  modelId: localStorage.getItem(MODEL_STORAGE) ?? DEFAULT_MODEL,
  isConnected: Boolean(localStorage.getItem(KEY_STORAGE)),

  setApiKey: (key) => {
    localStorage.setItem(KEY_STORAGE, key);
    set({ apiKey: key, isConnected: Boolean(key) });
  },

  setModelId: (id) => {
    localStorage.setItem(MODEL_STORAGE, id);
    set({ modelId: id });
  },

  disconnect: () => {
    localStorage.removeItem(KEY_STORAGE);
    set({ apiKey: null, isConnected: false });
  },
}));
