import { useEffect, useState } from 'react';
import { Eye, EyeOff, Lock, Unlock, Layers } from 'lucide-react';
import { useEngine } from '@/canvas/CanvasContext';
import { useCanvasStore } from '@/state/canvasStore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './primitives/select';
import type { BlendMode, LayerInfo, LayerType } from '@/types';
import { cn } from '@/lib/utils';

const BLEND_MODES: BlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'];

const TYPE_BADGE: Record<LayerType, string> = {
  prompt: 'bg-blue-100 text-blue-700',
  drawing: 'bg-green-100 text-green-700',
  shape: 'bg-amber-100 text-amber-700',
  text: 'bg-purple-100 text-purple-700',
};

export function LayerPanel() {
  const engine = useEngine();
  const [tick, setTick] = useState(0);
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const selectedId = useCanvasStore((s) => s.selectedObjectId);

  useEffect(() => {
    if (!engine) return;
    const { canvas } = engine;
    const refresh = () => setTick((t) => t + 1);
    canvas.on('object:added', refresh);
    canvas.on('object:removed', refresh);
    canvas.on('object:modified', refresh);
    return () => {
      canvas.off('object:added', refresh);
      canvas.off('object:removed', refresh);
      canvas.off('object:modified', refresh);
    };
  }, [engine]);

  useEffect(() => {
    if (engine) setLayers(engine.layerManager.list());
  }, [engine, tick, selectedId]);

  if (!engine) return null;
  const { layerManager } = engine;

  const bump = () => setTick((t) => t + 1);

  return (
    <div className="flex w-[220px] flex-col border-l bg-[var(--panel-bg)]">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
        <Layers className="h-4 w-4" /> Layers
      </div>
      <div className="flex-1 overflow-y-auto">
        {layers.length === 0 && (
          <p className="px-3 py-4 text-xs text-muted-foreground">No layers yet.</p>
        )}
        {layers.map((layer) => (
          <div
            key={layer.id}
            onClick={() => layerManager.select(layer.id)}
            className={cn(
              'cursor-pointer border-b px-2 py-2 text-xs hover:bg-accent',
              selectedId === layer.id && 'bg-accent',
            )}
          >
            <div className="flex items-center gap-1.5">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  layerManager.setVisible(layer.id, !layer.visible);
                  bump();
                }}
              >
                {layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 opacity-40" />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  layerManager.setLocked(layer.id, !layer.locked);
                  bump();
                }}
              >
                {layer.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5 opacity-40" />}
              </button>
              <span className="flex-1 truncate">{layer.name}</span>
              <span className={cn('rounded px-1 py-0.5 text-[9px] font-medium', TYPE_BADGE[layer.type])}>
                {layer.type}
              </span>
            </div>
            <div className="mt-1.5 pl-5" onClick={(e) => e.stopPropagation()}>
              <Select
                value={layer.blendMode}
                onValueChange={(v) => {
                  layerManager.setBlendMode(layer.id, v as BlendMode);
                  bump();
                }}
              >
                <SelectTrigger className="h-6">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BLEND_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
