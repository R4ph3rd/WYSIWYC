import { Circle } from 'lucide-react';
import { useCanvasStore } from '@/state/canvasStore';
import { usePromptStore } from '@/state/promptStore';
import { useModelStore } from '@/state/modelStore';
import { ConnectModelDialog } from './ConnectModelDialog';

export function StatusBar() {
  const zoom = useCanvasStore((s) => s.zoom);
  const cursor = useCanvasStore((s) => s.cursor);
  const areaCount = usePromptStore((s) => s.order.length);
  const { modelId, isConnected } = useModelStore();

  return (
    <div className="flex h-7 items-center gap-4 border-t bg-[var(--panel-bg)] px-3 text-[11px] text-muted-foreground">
      <span>Zoom: {Math.round(zoom * 100)}%</span>
      <span>
        Cursor: {cursor.x}, {cursor.y}
      </span>
      <span>Areas: {areaCount}</span>
      <span>Model: {modelId.replace('claude-', '').replace(/-\d+$/, '')}</span>
      <ConnectModelDialog>
        <button className="ml-auto flex items-center gap-1.5 hover:text-foreground">
          <Circle
            className="h-2.5 w-2.5"
            fill={isConnected ? '#22c55e' : '#d4d4d4'}
            stroke="none"
          />
          {isConnected ? 'Connected' : 'Connect model'}
        </button>
      </ConnectModelDialog>
    </div>
  );
}
