import { createElement, type CSSProperties, type ReactNode } from 'react';
import type { IR, IRNode } from '@/ir/types';
import { buildTree, type IRTreeNode } from '@/ir/tree';

export interface RendererProps {
  ir: IR;
  selectedId: string | null;
  hoveredClauseId: string | null;
  recentIds?: string[];
  onSelect?: (id: string) => void;
  onReorder?: (draggedId: string, targetId: string) => void;
}

const SELF_CLOSING: IRNode['role'][] = ['input', 'image', 'divider'];

function isDiverged(node: IRNode): boolean {
  return node.provenance.source === 'user' && node.provenance.promptClauseId === null;
}

function overlayStyle(node: IRNode, opts: {
  selected: boolean;
  clauseHover: boolean;
}): CSSProperties {
  const style: CSSProperties = {};

  // Absolute-positioning mode (only when x/y hints are present).
  const { x, y, w, h } = node.layout ?? {};
  if (x !== undefined || y !== undefined) {
    style.position = 'absolute';
    if (x !== undefined) style.left = x;
    if (y !== undefined) style.top = y;
  }
  if (w !== undefined) style.width = w;
  if (h !== undefined) style.height = h;

  // Selection / provenance / divergence overlays use outline (no layout impact).
  if (opts.selected) {
    style.outline = '2px solid #4f46e5';
    style.outlineOffset = '2px';
  } else if (opts.clauseHover) {
    style.outline = '2px dashed #0ea5e9';
    style.outlineOffset = '2px';
  } else if (isDiverged(node)) {
    style.outline = '1px dashed #f59e0b';
    style.outlineOffset = '1px';
  }
  return style;
}

function renderNode(tree: IRTreeNode, props: RendererProps): ReactNode {
  const { node } = tree;
  const selected = props.selectedId === node.id;
  const clauseHover =
    props.hoveredClauseId != null && node.provenance.promptClauseId === props.hoveredClauseId;

  const children: ReactNode = tree.children.length
    ? tree.children.map((c) => renderNode(c, props))
    : node.content ?? null;

  const className = [
    node.tailwind,
    props.onSelect ? 'cursor-pointer' : '',
    props.recentIds?.includes(node.id) ? 'wysiwyc-flash' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const handlers = props.onSelect
    ? {
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          props.onSelect?.(node.id);
        },
        draggable: true,
        onDragStart: (e: React.DragEvent) => {
          e.stopPropagation();
          e.dataTransfer.setData('text/wysiwyc-node', node.id);
          e.dataTransfer.effectAllowed = 'move';
        },
        onDragOver: (e: React.DragEvent) => {
          if (e.dataTransfer.types.includes('text/wysiwyc-node')) e.preventDefault();
        },
        onDrop: (e: React.DragEvent) => {
          const draggedId = e.dataTransfer.getData('text/wysiwyc-node');
          if (draggedId && draggedId !== node.id) {
            e.stopPropagation();
            props.onReorder?.(draggedId, node.id);
          }
        },
      }
    : {};

  const role = node.role;
  const tag =
    role === 'heading'
      ? 'h2'
      : role === 'button'
        ? 'button'
        : role === 'input'
          ? 'input'
          : role === 'image'
            ? 'div'
            : role === 'icon' || role === 'badge' || role === 'text'
              ? 'span'
              : role === 'divider'
                ? 'hr'
                : 'div';

  const elementProps: Record<string, unknown> = {
    key: node.id,
    className,
    style: overlayStyle(node, { selected, clauseHover }),
    'data-node-id': node.id,
    'data-role': role,
    ...handlers,
  };

  if (role === 'input') {
    elementProps.placeholder = node.content ?? '';
    elementProps.readOnly = true;
    return createElement('input', elementProps);
  }
  if (SELF_CLOSING.includes(role)) {
    return createElement(tag, elementProps);
  }
  return createElement(tag, elementProps, children);
}

/** Pure IR → React+Tailwind projection. No LLM. */
export function Renderer(props: RendererProps) {
  const roots = buildTree(props.ir);
  if (roots.length === 0) {
    return (
      <div className="grid h-full place-items-center text-sm text-slate-400">
        Empty canvas — describe a UI in the prompt pane to generate it.
      </div>
    );
  }
  return <>{roots.map((r) => renderNode(r, props))}</>;
}
