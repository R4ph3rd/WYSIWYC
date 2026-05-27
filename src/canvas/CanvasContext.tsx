import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Canvas } from 'fabric';
import type { PromptAreaManager } from './PromptAreaManager';
import type { LayerManager } from './LayerManager';
import type { CanvasHistory } from './CanvasHistory';

export interface EngineHandles {
  canvas: Canvas;
  areaManager: PromptAreaManager;
  layerManager: LayerManager;
  history: CanvasHistory;
}

interface CanvasCtx {
  engine: EngineHandles | null;
  setEngine: (e: EngineHandles | null) => void;
}

const Ctx = createContext<CanvasCtx | null>(null);

export function CanvasProvider({ children }: { children: ReactNode }) {
  const [engine, setEngine] = useState<EngineHandles | null>(null);
  return <Ctx.Provider value={{ engine, setEngine }}>{children}</Ctx.Provider>;
}

export function useCanvasContext(): CanvasCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCanvasContext must be used within CanvasProvider');
  return ctx;
}

export function useEngine(): EngineHandles | null {
  return useCanvasContext().engine;
}
