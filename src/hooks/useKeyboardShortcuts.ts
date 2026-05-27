import { useEffect } from 'react';
import { useEngine } from '@/canvas/CanvasContext';
import { useCanvasStore } from '@/state/canvasStore';
import { FabricPromptArea } from '@/canvas/PromptArea';
import type { Tool } from '@/types';

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  p: 'prompt',
  b: 'pen',
  e: 'eraser',
  t: 'text',
  i: 'eyedropper',
  s: 'shapes',
};

export function useKeyboardShortcuts() {
  const engine = useEngine();

  useEffect(() => {
    if (!engine) return;
    const { canvas, areaManager, history } = engine;

    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el?.isContentEditable || el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA') return;

      const mod = e.metaKey || e.ctrlKey;
      const active = canvas.getActiveObject() as (FabricPromptArea | undefined) | null;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) void history.redo();
        else void history.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (active instanceof FabricPromptArea) void areaManager.generate(active.promptAreaId);
        return;
      }
      if (e.altKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        if (active instanceof FabricPromptArea) {
          areaManager.navigateHistory(active.promptAreaId, e.key === '[' ? -1 : 1);
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (active instanceof FabricPromptArea) {
          e.preventDefault();
          areaManager.remove(active.promptAreaId);
        } else if (active) {
          e.preventDefault();
          canvas.remove(active);
          canvas.requestRenderAll();
        }
        return;
      }
      if (e.key === 'Escape') {
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        return;
      }
      if (!mod && !e.altKey) {
        const tool = TOOL_KEYS[e.key.toLowerCase()];
        if (tool) {
          e.preventDefault();
          useCanvasStore.getState().setActiveTool(tool);
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);
}
