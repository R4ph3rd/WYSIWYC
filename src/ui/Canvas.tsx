import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAppStore, toolToRole } from '@/store/appStore';
import { Renderer } from '@/render/Renderer';
import { siblingsOf } from '@/ir/tree';
import { ToolPalette } from './ToolPalette';

interface DragState {
  id: string;
  startX: number;
  startY: number;
}

export function Canvas() {
  const ir = useAppStore((s) => s.ir);
  const tool = useAppStore((s) => s.tool);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const hoveredClauseId = useAppStore((s) => s.hoveredClauseId);
  const recentIds = useAppStore((s) => s.recentIds);
  const generating = useAppStore((s) => s.generating);
  const selectNode = useAppStore((s) => s.selectNode);
  const setTool = useAppStore((s) => s.setTool);
  const manipulate = useAppStore((s) => s.manipulate);
  const createShape = useAppStore((s) => s.createShape);
  const updateLayout = useAppStore((s) => s.updateLayout);

  const stageRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const role = toolToRole(tool);

  function relativePoint(e: React.MouseEvent): { x: number; y: number } | null {
    const el = stageRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onStageMouseDown(e: React.MouseEvent) {
    if (!role) return;
    e.preventDefault();
    e.stopPropagation();
    const p = relativePoint(e);
    if (!p) return;
    const defaultSize = role === 'text' ? { w: 120, h: 28 } : { w: 2, h: 2 };
    const id = createShape({ role, x: p.x, y: p.y, ...defaultSize });
    setDrag({ id, startX: p.x, startY: p.y });
  }

  function onStageMouseMove(e: React.MouseEvent) {
    if (!drag) return;
    const p = relativePoint(e);
    if (!p) return;
    const x = Math.min(p.x, drag.startX);
    const y = Math.min(p.y, drag.startY);
    const w = Math.max(2, Math.abs(p.x - drag.startX));
    const h = Math.max(2, Math.abs(p.y - drag.startY));
    updateLayout(drag.id, { x, y, w, h });
  }

  function onStageMouseUp() {
    if (drag) {
      setDrag(null);
      setTool('pointer');
    }
  }

  const onReorder = (draggedId: string, targetId: string) => {
    const dragged = ir.nodes.find((n) => n.id === draggedId);
    const target = ir.nodes.find((n) => n.id === targetId);
    if (!dragged || !target || dragged.parentId !== target.parentId) return;
    const sibs = siblingsOf(ir, draggedId);
    const from = sibs.findIndex((n) => n.id === draggedId);
    const to = sibs.findIndex((n) => n.id === targetId);
    if (from === -1 || to === -1 || from === to) return;
    manipulate({ kind: 'reorder', id: draggedId, parentId: dragged.parentId, from, to });
  };

  const drawing = Boolean(role);

  return (
    <div className="relative flex-1 overflow-hidden bg-[var(--workbench-bg)]">
      {/* Floating tool palette (top center) */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2">
        <div className="pointer-events-auto">
          <ToolPalette />
        </div>
      </div>

      {generating && (
        <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs text-slate-600 shadow">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Composing…
        </div>
      )}

      <div
        className="h-full overflow-auto p-6"
        onClick={(e) => {
          if (e.target === e.currentTarget) selectNode(null);
        }}
      >
        <div
          ref={stageRef}
          className="relative mx-auto min-h-full w-full max-w-5xl overflow-hidden rounded-xl shadow-sm ring-1 ring-black/5"
          style={{
            background: ir.canvas.background,
            cursor: drawing ? 'crosshair' : 'default',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !drawing) selectNode(null);
          }}
          onMouseDown={onStageMouseDown}
          onMouseMove={onStageMouseMove}
          onMouseUp={onStageMouseUp}
          onMouseLeave={onStageMouseUp}
        >
          <Renderer
            ir={ir}
            selectedId={selectedNodeId}
            hoveredClauseId={hoveredClauseId}
            recentIds={recentIds}
            onSelect={drawing ? undefined : selectNode}
            onReorder={drawing ? undefined : onReorder}
          />
        </div>
      </div>
    </div>
  );
}
