import { Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { Renderer } from '@/render/Renderer';
import { siblingsOf } from '@/ir/tree';
import { SelectionToolbar } from './SelectionToolbar';

export function Canvas() {
  const ir = useAppStore((s) => s.ir);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const hoveredClauseId = useAppStore((s) => s.hoveredClauseId);
  const recentIds = useAppStore((s) => s.recentIds);
  const generating = useAppStore((s) => s.generating);
  const selectNode = useAppStore((s) => s.selectNode);
  const manipulate = useAppStore((s) => s.manipulate);

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

  return (
    <div className="relative flex-1 overflow-hidden bg-[var(--workbench-bg)]">
      {/* Floating selection toolbar */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2">
        <div className="pointer-events-auto">
          <SelectionToolbar />
        </div>
      </div>

      {generating && (
        <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs text-slate-600 shadow">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Composing…
        </div>
      )}

      <div className="h-full overflow-auto p-6" onClick={() => selectNode(null)}>
        <div
          className="mx-auto min-h-full w-full max-w-5xl overflow-hidden rounded-xl shadow-sm ring-1 ring-black/5"
          style={{ background: ir.canvas.background }}
          onClick={(e) => e.stopPropagation()}
        >
          <Renderer
            ir={ir}
            selectedId={selectedNodeId}
            hoveredClauseId={hoveredClauseId}
            recentIds={recentIds}
            onSelect={selectNode}
            onReorder={onReorder}
          />
        </div>
      </div>
    </div>
  );
}
