import { useMemo } from 'react';
import {
  ChevronRight, Box, Type as TypeIcon, MousePointer2, Image as ImageIcon,
  Square, Circle, Minus, PenTool, Layers as LayersIcon, Eye, EyeOff, Trash2,
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { buildTree, type IRTreeNode } from '@/ir/tree';
import type { NodeRole } from '@/ir/types';
import { cn } from '@/lib/utils';

const ROLE_ICON: Record<NodeRole, React.ReactNode> = {
  frame: <Box className="h-3.5 w-3.5" />,
  container: <Box className="h-3.5 w-3.5" />,
  text: <TypeIcon className="h-3.5 w-3.5" />,
  heading: <TypeIcon className="h-3.5 w-3.5" />,
  button: <MousePointer2 className="h-3.5 w-3.5" />,
  input: <Box className="h-3.5 w-3.5" />,
  image: <ImageIcon className="h-3.5 w-3.5" />,
  icon: <TypeIcon className="h-3.5 w-3.5" />,
  divider: <Minus className="h-3.5 w-3.5" />,
  badge: <Box className="h-3.5 w-3.5" />,
  rectangle: <Square className="h-3.5 w-3.5" />,
  circle: <Circle className="h-3.5 w-3.5" />,
  line: <Minus className="h-3.5 w-3.5" />,
  path: <PenTool className="h-3.5 w-3.5" />,
};

export function LayersPanel() {
  const ir = useAppStore((s) => s.ir);
  const selectedId = useAppStore((s) => s.selectedNodeId);
  const selectedIds = useAppStore((s) => s.selectedNodeIds);
  const selectNode = useAppStore((s) => s.selectNode);
  const toggleSelection = useAppStore((s) => s.toggleSelection);
  const hoverClause = useAppStore((s) => s.hoverClause);
  const toggleHidden = useAppStore((s) => s.toggleHidden);
  const manipulate = useAppStore((s) => s.manipulate);

  const tree = useMemo(() => buildTree(ir), [ir]);

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2">
        <LayersIcon className="h-3.5 w-3.5 text-slate-500" />
        <span className="text-xs font-semibold tracking-tight text-slate-700">Layers</span>
        <span className="ml-auto text-[10px] text-slate-400">{ir.nodes.length} nodes</span>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5 text-xs">
        {tree.length === 0 && (
          <p className="px-2 py-4 text-center text-[11px] text-slate-400">
            Nothing here yet. Draw a shape or generate from the prompt.
          </p>
        )}
        {tree.map((t) => (
          <TreeNode
            key={t.node.id}
            tree={t}
            depth={0}
            selectedId={selectedId}
            selectedIds={selectedIds}
            onSelect={(id, additive) => (additive ? toggleSelection(id) : selectNode(id))}
            onHoverClause={hoverClause}
            onToggleHidden={toggleHidden}
            onDelete={(id) => manipulate({ kind: 'delete', id })}
          />
        ))}
      </div>
    </div>
  );
}

interface TreeNodeProps {
  tree: IRTreeNode;
  depth: number;
  selectedId: string | null;
  selectedIds: string[];
  onSelect: (id: string, additive?: boolean) => void;
  onHoverClause: (id: string | null) => void;
  onToggleHidden: (id: string) => void;
  onDelete: (id: string) => void;
}

function TreeNode({ tree, depth, selectedId, selectedIds, onSelect, onHoverClause, onToggleHidden, onDelete }: TreeNodeProps) {
  const { node, children } = tree;
  const isSelected = selectedIds.includes(node.id);
  const hidden = node.tailwind.split(/\s+/).includes('hidden');
  const isDiverged =
    node.provenance.source === 'user' && node.provenance.promptClauseId === null;

  const label = node.content?.slice(0, 24) || node.role;

  return (
    <>
      <div
        draggable
        onDragStart={(e) => {
          // Same payload as canvas nodes, so a Layers row can be dropped into
          // the composer as a reference chip (DirectGPT "refer").
          e.dataTransfer.setData('text/wysiwyc-node', node.id);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={(e) => onSelect(node.id, e.shiftKey)}
        onMouseEnter={() => onHoverClause(node.provenance.promptClauseId)}
        onMouseLeave={() => onHoverClause(null)}
        className={cn(
          'group flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 transition-colors',
          isSelected ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50',
          hidden && 'opacity-50',
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
      >
        {children.length > 0 ? (
          <ChevronRight className="h-3 w-3 rotate-90 text-slate-400" />
        ) : (
          <span className="w-3" />
        )}
        <span className={isSelected ? 'text-indigo-600' : 'text-slate-400'}>
          {ROLE_ICON[node.role]}
        </span>
        <span className="flex-1 truncate text-[11px]">{label}</span>
        {isDiverged && (
          <span title="Diverged from prompt" className="text-[9px] font-semibold text-amber-600">
            ⚠
          </span>
        )}
        <button
          className="opacity-0 transition-opacity hover:text-slate-900 group-hover:opacity-100"
          onClick={(e) => { e.stopPropagation(); onToggleHidden(node.id); }}
          aria-label={hidden ? 'Show' : 'Hide'}
        >
          {hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </button>
        <button
          className="opacity-0 transition-opacity hover:text-rose-600 group-hover:opacity-100"
          onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
          aria-label="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      {children.map((c) => (
        <TreeNode
          key={c.node.id}
          tree={c}
          depth={depth + 1}
          selectedId={selectedId}
          selectedIds={selectedIds}
          onSelect={onSelect}
          onHoverClause={onHoverClause}
          onToggleHidden={onToggleHidden}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}
