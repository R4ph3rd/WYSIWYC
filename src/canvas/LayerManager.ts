import type { Canvas, FabricObject } from 'fabric';
import type { BlendMode, LayerInfo, LayerType } from '@/types';
import { FabricPromptArea } from './PromptArea';

function objectType(obj: FabricObject): LayerType {
  if (obj instanceof FabricPromptArea) return 'prompt';
  const t = (obj as { type?: string }).type;
  if (t === 'path') return 'drawing';
  if (t === 'i-text' || t === 'text' || t === 'textbox') return 'text';
  return 'shape';
}

export class LayerManager {
  constructor(private canvas: Canvas) {}

  /** Layers listed top-of-stack first, to match a typical layer panel. */
  list(): LayerInfo[] {
    const objs = this.canvas.getObjects();
    return objs
      .map((obj) => {
        const meta = obj as FabricObject & { layerId?: string; layerName?: string };
        const type = objectType(obj);
        return {
          id: meta.layerId ?? '',
          name: meta.layerName ?? defaultName(type),
          type,
          visible: obj.visible !== false,
          locked: obj.selectable === false,
          blendMode: ((obj.globalCompositeOperation as BlendMode) || 'normal') as BlendMode,
        } satisfies LayerInfo;
      })
      .filter((l) => l.id)
      .reverse();
  }

  private find(id: string): FabricObject | undefined {
    return this.canvas
      .getObjects()
      .find((o) => (o as FabricObject & { layerId?: string }).layerId === id);
  }

  setVisible(id: string, visible: boolean): void {
    const obj = this.find(id);
    if (!obj) return;
    obj.set({ visible });
    this.canvas.requestRenderAll();
  }

  setLocked(id: string, locked: boolean): void {
    const obj = this.find(id);
    if (!obj) return;
    obj.set({ selectable: !locked, evented: !locked });
    this.canvas.requestRenderAll();
  }

  setBlendMode(id: string, mode: BlendMode): void {
    const obj = this.find(id);
    if (!obj) return;
    obj.set({ globalCompositeOperation: mode === 'normal' ? 'source-over' : mode });
    this.canvas.requestRenderAll();
  }

  select(id: string): void {
    const obj = this.find(id);
    if (!obj || obj.selectable === false) return;
    this.canvas.setActiveObject(obj);
    this.canvas.requestRenderAll();
  }

  /** Move a layer to a new index in panel-space (0 = top of stack). */
  reorder(id: string, panelIndex: number): void {
    const obj = this.find(id);
    if (!obj) return;
    const objs = this.canvas.getObjects();
    const stackIndex = objs.length - 1 - panelIndex;
    const cur = objs.indexOf(obj);
    if (cur === -1) return;
    objs.splice(cur, 1);
    objs.splice(Math.max(0, Math.min(objs.length, stackIndex)), 0, obj);
    this.canvas.requestRenderAll();
  }
}

function defaultName(type: LayerType): string {
  switch (type) {
    case 'prompt':
      return 'Prompt area';
    case 'drawing':
      return 'Drawing';
    case 'text':
      return 'Text';
    default:
      return 'Shape';
  }
}
