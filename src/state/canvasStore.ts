import { create } from 'zustand';
import type { ShapeKind, Tool } from '@/types';

interface CanvasStore {
  activeTool: Tool;
  shapeKind: ShapeKind;
  zoom: number;
  cursor: { x: number; y: number };
  activeColor: string;
  brushSize: number;
  selectedObjectId: string | null;
  autoRegen: boolean;

  setActiveTool: (t: Tool) => void;
  setShapeKind: (k: ShapeKind) => void;
  setZoom: (z: number) => void;
  setCursor: (x: number, y: number) => void;
  setActiveColor: (c: string) => void;
  setBrushSize: (n: number) => void;
  setSelectedObjectId: (id: string | null) => void;
  setAutoRegen: (v: boolean) => void;
}

export const useCanvasStore = create<CanvasStore>((set) => ({
  activeTool: 'select',
  shapeKind: 'rect',
  zoom: 1,
  cursor: { x: 0, y: 0 },
  activeColor: '#2563eb',
  brushSize: 4,
  selectedObjectId: null,
  autoRegen: true,

  setActiveTool: (activeTool) => set({ activeTool }),
  setShapeKind: (shapeKind) => set({ shapeKind }),
  setZoom: (zoom) => set({ zoom }),
  setCursor: (x, y) => set({ cursor: { x, y } }),
  setActiveColor: (activeColor) => set({ activeColor }),
  setBrushSize: (brushSize) => set({ brushSize }),
  setSelectedObjectId: (selectedObjectId) => set({ selectedObjectId }),
  setAutoRegen: (autoRegen) => set({ autoRegen }),
}));
