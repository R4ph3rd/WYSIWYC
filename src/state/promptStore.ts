import { create } from 'zustand';
import type { PromptAreaData, SyncField } from '@/types';

interface PromptStore {
  areas: Record<string, PromptAreaData>;
  order: string[];

  addArea: (area: PromptAreaData) => void;
  updateArea: (id: string, patch: Partial<PromptAreaData>) => void;
  removeArea: (id: string) => void;
  queueSync: (id: string, fields: SyncField[]) => void;
  clearSync: (id: string) => void;
}

export const usePromptStore = create<PromptStore>((set) => ({
  areas: {},
  order: [],

  addArea: (area) =>
    set((s) => ({
      areas: { ...s.areas, [area.id]: area },
      order: [...s.order, area.id],
    })),

  updateArea: (id, patch) =>
    set((s) => {
      const existing = s.areas[id];
      if (!existing) return s;
      return { areas: { ...s.areas, [id]: { ...existing, ...patch } } };
    }),

  removeArea: (id) =>
    set((s) => {
      const next = { ...s.areas };
      delete next[id];
      return { areas: next, order: s.order.filter((x) => x !== id) };
    }),

  queueSync: (id, fields) =>
    set((s) => {
      const existing = s.areas[id];
      if (!existing) return s;
      const merged = Array.from(new Set([...existing.pendingSyncFields, ...fields]));
      return { areas: { ...s.areas, [id]: { ...existing, pendingSyncFields: merged } } };
    }),

  clearSync: (id) =>
    set((s) => {
      const existing = s.areas[id];
      if (!existing) return s;
      return { areas: { ...s.areas, [id]: { ...existing, pendingSyncFields: [] } } };
    }),
}));
