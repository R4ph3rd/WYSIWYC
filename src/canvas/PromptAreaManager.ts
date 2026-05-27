import type { Canvas } from 'fabric';
import { FabricPromptArea } from './PromptArea';
import { usePromptStore } from '@/state/promptStore';
import { useModelStore } from '@/state/modelStore';
import { useCanvasStore } from '@/state/canvasStore';
import { applyGeometryDelta, regenerate } from '@/llm/PromptSyncEngine';
import { tokenizePrompt } from '@/lib/tokenize';
import type { GeometryDelta, GenerationSnapshot, PromptAreaData, SyncField } from '@/types';
import { uid } from '@/lib/utils';

const SYNC_DEBOUNCE_MS = 800;

function newAreaData(id: string, x: number, y: number): PromptAreaData {
  return {
    id,
    x,
    y,
    width: 240,
    height: 200,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    zIndex: 0,
    rawPrompt: '',
    words: [],
    generatedImageDataURL: null,
    generationStatus: 'idle',
    generationSeed: null,
    lastSyncedAt: Date.now(),
    pendingSyncFields: [],
    generationHistory: [],
    historyIndex: -1,
  };
}

export class PromptAreaManager {
  private syncTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastGeometry = new Map<string, { angle: number; scaleX: number; left: number; top: number }>();

  constructor(private canvas: Canvas) {}

  private fabricFor(id: string): FabricPromptArea | undefined {
    return this.canvas
      .getObjects()
      .find(
        (o) => o instanceof FabricPromptArea && o.promptAreaId === id,
      ) as FabricPromptArea | undefined;
  }

  create(x: number, y: number): string {
    const id = uid('area');
    const obj = new FabricPromptArea({ left: x, top: y, promptAreaId: id });
    (obj as unknown as { layerId: string; layerName: string }).layerId = id;
    (obj as unknown as { layerName: string }).layerName = 'Prompt area';
    this.canvas.add(obj);
    this.canvas.setActiveObject(obj);
    this.canvas.requestRenderAll();
    usePromptStore.getState().addArea(newAreaData(id, x, y));
    this.cacheGeometry(obj);
    return id;
  }

  remove(id: string): void {
    const obj = this.fabricFor(id);
    if (obj) this.canvas.remove(obj);
    usePromptStore.getState().removeArea(id);
    this.canvas.requestRenderAll();
  }

  commitPrompt(id: string, text: string, generateAfter = true): void {
    usePromptStore.getState().updateArea(id, {
      rawPrompt: text,
      words: tokenizePrompt(text),
    });
    if (generateAfter && text.trim()) void this.generate(id);
  }

  async generate(id: string): Promise<void> {
    const area = usePromptStore.getState().areas[id];
    const obj = this.fabricFor(id);
    if (!area || !obj || !area.rawPrompt.trim()) return;

    usePromptStore.getState().updateArea(id, { generationStatus: 'streaming' });
    obj.setStatus('streaming');

    try {
      const { dataURL, seed } = await regenerate(area, (partial) => {
        void obj.setImage(partial);
      });
      await obj.setImage(dataURL);
      obj.setStatus('done');

      const snapshot: GenerationSnapshot = {
        timestamp: Date.now(),
        prompt: area.rawPrompt,
        imageDataURL: dataURL,
        seed,
        modelId: useModelStore.getState().image?.model ?? 'local',
      };
      const history = [...area.generationHistory, snapshot].slice(-20);
      usePromptStore.getState().updateArea(id, {
        generatedImageDataURL: dataURL,
        generationSeed: seed,
        generationStatus: 'done',
        generationHistory: history,
        historyIndex: history.length - 1,
      });
    } catch (err) {
      console.error('Generation failed', err);
      obj.setStatus('error');
      usePromptStore.getState().updateArea(id, { generationStatus: 'error' });
    }
  }

  private cacheGeometry(obj: FabricPromptArea): void {
    this.lastGeometry.set(obj.promptAreaId, {
      angle: obj.angle ?? 0,
      scaleX: obj.scaleX ?? 1,
      left: obj.left ?? 0,
      top: obj.top ?? 0,
    });
  }

  /** Called on Fabric `object:modified` for a prompt area. */
  handleTransformEnd(obj: FabricPromptArea): void {
    const id = obj.promptAreaId;
    const prev = this.lastGeometry.get(id);
    const cur = {
      angle: obj.angle ?? 0,
      scaleX: obj.scaleX ?? 1,
      left: obj.left ?? 0,
      top: obj.top ?? 0,
    };
    usePromptStore.getState().updateArea(id, {
      x: cur.left,
      y: cur.top,
      rotation: cur.angle,
      scaleX: obj.scaleX ?? 1,
      scaleY: obj.scaleY ?? 1,
    });
    if (!prev) {
      this.cacheGeometry(obj);
      return;
    }

    const delta: GeometryDelta = {};
    const dRot = cur.angle - prev.angle;
    const dScale = prev.scaleX !== 0 ? cur.scaleX / prev.scaleX : 1;
    if (Math.abs(dRot) > 0.5) delta.rotation = dRot;
    if (Math.abs(dScale - 1) > 0.02) delta.scale = dScale;
    if (Math.abs(cur.left - prev.left) > 2) delta.dx = cur.left - prev.left;
    if (Math.abs(cur.top - prev.top) > 2) delta.dy = cur.top - prev.top;

    this.cacheGeometry(obj);
    if (Object.keys(delta).length === 0) return;

    const fields: SyncField[] = [];
    if (delta.rotation) fields.push('rotation');
    if (delta.scale) fields.push('scale');
    if (delta.dx || delta.dy) fields.push('position');
    usePromptStore.getState().queueSync(id, fields);

    this.scheduleSync(id, delta);
  }

  private scheduleSync(id: string, delta: GeometryDelta): void {
    const existing = this.syncTimers.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => this.runSync(id, delta), SYNC_DEBOUNCE_MS);
    this.syncTimers.set(id, timer);
  }

  private async runSync(id: string, delta: GeometryDelta): Promise<void> {
    this.syncTimers.delete(id);
    const cfg = useModelStore.getState().textConfig();
    const area = usePromptStore.getState().areas[id];
    if (!area || !area.rawPrompt.trim()) return;
    if (!cfg) return;

    try {
      const updated = await applyGeometryDelta(area, delta, cfg);
      usePromptStore.getState().updateArea(id, {
        rawPrompt: updated,
        words: tokenizePrompt(updated),
        lastSyncedAt: Date.now(),
        pendingSyncFields: [],
      });
      if (useCanvasStore.getState().autoRegen) void this.generate(id);
    } catch (err) {
      console.error('Prompt sync failed', err);
    }
  }

  navigateHistory(id: string, dir: -1 | 1): void {
    const area = usePromptStore.getState().areas[id];
    if (!area || area.generationHistory.length === 0) return;
    const nextIndex = Math.max(
      0,
      Math.min(area.generationHistory.length - 1, area.historyIndex + dir),
    );
    if (nextIndex === area.historyIndex) return;
    const snap = area.generationHistory[nextIndex];
    const obj = this.fabricFor(id);
    if (obj) void obj.setImage(snap.imageDataURL);
    usePromptStore.getState().updateArea(id, {
      historyIndex: nextIndex,
      rawPrompt: snap.prompt,
      words: tokenizePrompt(snap.prompt),
      generatedImageDataURL: snap.imageDataURL,
      generationSeed: snap.seed,
    });
  }
}
