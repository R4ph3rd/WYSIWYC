import { createElement, type CSSProperties, type ReactNode } from 'react';
import type { IR, IRNode, NodeStyle } from '@/ir/types';
import { buildTree, type IRTreeNode } from '@/ir/tree';

export interface RendererProps {
  ir: IR;
  selectedId: string | null;
  /** Full multi-selection; falls back to [selectedId] when omitted. */
  selectedIds?: string[];
  /** Nodes a focused composer's prompt would be scoped to (dashed preview). */
  scopeIds?: string[];
  hoveredClauseId: string | null;
  recentIds?: string[];
  onSelect?: (id: string, additive?: boolean) => void;
  onReorder?: (draggedId: string, targetId: string) => void;
}

const SELF_CLOSING: IRNode['role'][] = ['input', 'image', 'divider', 'line'];
const SHAPE_ROLES: IRNode['role'][] = ['rectangle', 'circle', 'line', 'path'];
/** Stroke-only shapes where `fill` is drawn by SVG, not as a CSS background. */
const STROKE_ROLES: IRNode['role'][] = ['line', 'path'];

/** Translate the structured `style` block into inline CSS. */
function structuredStyle(node: IRNode): CSSProperties {
  const s: NodeStyle = node.style ?? {};
  const out: CSSProperties = {};
  if (s.fill && !STROKE_ROLES.includes(node.role)) {
    // Lines/paths paint fill inside the SVG; everything else as background.
    out.background = s.fill;
  }
  const sw = s.strokeWidth ?? 0;
  if (sw > 0 && !STROKE_ROLES.includes(node.role)) {
    // Default stroke to near-black if only strokeWidth was set without a color.
    out.border = `${sw}px solid ${s.stroke || '#171717'}`;
    // box-sizing:border-box prevents the border from expanding the element.
    out.boxSizing = 'border-box';
  } else if (sw === 0 && SHAPE_ROLES.includes(node.role)) {
    out.border = 'none';
  }
  if (s.borderRadius !== undefined) {
    out.borderRadius = node.role === 'circle' ? '50%' : s.borderRadius;
  }
  if (s.fontFamily) out.fontFamily = s.fontFamily;
  if (s.fontSize !== undefined) out.fontSize = s.fontSize;
  if (s.fontWeight !== undefined) out.fontWeight = s.fontWeight;
  if (s.fontColor) out.color = s.fontColor;
  if (s.italic) out.fontStyle = 'italic';
  if (s.underline) out.textDecoration = 'underline';
  if (s.textAlign) out.textAlign = s.textAlign;
  if (s.shadow) out.boxShadow = s.shadow;
  if (s.opacity !== undefined) out.opacity = s.opacity;
  return out;
}

function overlayStyle(node: IRNode, opts: {
  selected: boolean;
  clauseHover: boolean;
  scopePreview: boolean;
}): CSSProperties {
  const style: CSSProperties = {};

  // Containers and frames anchor absolute-positioned children. Always
  // set position: relative so the drawing tools can drop shapes inside.
  if (node.role === 'frame' || node.role === 'container') {
    style.position = 'relative';
  }

  // Absolute-positioning mode (only when x/y hints are present).
  const { x, y, w, h } = node.layout ?? {};
  if (x !== undefined || y !== undefined) {
    style.position = 'absolute';
    if (x !== undefined) style.left = x;
    if (y !== undefined) style.top = y;
  }
  if (w !== undefined) style.width = w;
  if (h !== undefined) style.height = h;

  // Shape primitives need a sensible default if no inline width/height yet.
  if (SHAPE_ROLES.includes(node.role)) {
    if (w === undefined) style.width = 80;
    if (h === undefined) style.height = 80;
  }

  // Selection / scope-preview / provenance / divergence overlays use outline
  // (no layout impact). Scope preview takes precedence over plain selection: it
  // is the DirectGPT "these elements are about to be modified" feedback.
  if (opts.scopePreview) {
    style.outline = '2px dashed #8b5cf6';
    style.outlineOffset = '2px';
  } else if (opts.selected) {
    style.outline = '2px solid #4f46e5';
    style.outlineOffset = '2px';
  } else if (opts.clauseHover) {
    style.outline = '2px dashed #0ea5e9';
    style.outlineOffset = '2px';
  }
  return style;
}

function renderLineShape(
  node: IRNode,
  baseProps: Record<string, unknown>,
  style: CSSProperties,
): ReactNode {
  const w = (node.layout?.w ?? 80) as number;
  const h = (node.layout?.h ?? 80) as number;
  const stroke = node.style?.stroke ?? '#171717';
  const strokeWidth = node.style?.strokeWidth ?? 2;
  // Diagonal from top-left to bottom-right of the bounding box.
  return createElement(
    'svg',
    { ...baseProps, viewBox: `0 0 ${Math.max(1, w)} ${Math.max(1, h)}`, style },
    createElement('line', {
      x1: 0,
      y1: 0,
      x2: w,
      y2: h,
      stroke,
      strokeWidth,
      strokeLinecap: 'round',
    }),
  );
}

/** Pen-tool path: anchors stored relative to the node's bounding box. */
function renderPathShape(
  node: IRNode,
  baseProps: Record<string, unknown>,
  style: CSSProperties,
): ReactNode {
  const w = Math.max(1, (node.layout?.w ?? 80) as number);
  const h = Math.max(1, (node.layout?.h ?? 80) as number);
  const points = node.points ?? [];
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
  return createElement(
    'svg',
    { ...baseProps, viewBox: `0 0 ${w} ${h}`, style: { ...style, overflow: 'visible' } },
    createElement('path', {
      d,
      fill: node.style?.fill ?? 'none',
      stroke: node.style?.stroke ?? '#171717',
      strokeWidth: node.style?.strokeWidth ?? 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  );
}

function renderNode(tree: IRTreeNode, props: RendererProps): ReactNode {
  const { node } = tree;
  const selected = props.selectedIds
    ? props.selectedIds.includes(node.id)
    : props.selectedId === node.id;
  const scopePreview = props.scopeIds?.includes(node.id) ?? false;
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

  // Absolute-positioned nodes (drawn shapes) move with pointer drag on the
  // canvas; only flow nodes use HTML5 drag for sibling reordering.
  const isAbsolute = node.layout?.x !== undefined || node.layout?.y !== undefined;

  const handlers = props.onSelect
    ? {
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          props.onSelect?.(node.id, e.shiftKey);
        },
        draggable: !isAbsolute,
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
          : role === 'image' || role === 'rectangle' || role === 'circle'
            ? 'div'
            : role === 'icon' || role === 'badge' || role === 'text'
              ? 'span'
              : role === 'divider'
                ? 'hr'
                : 'div';

  const combinedStyle: CSSProperties = {
    ...overlayStyle(node, { selected, clauseHover, scopePreview }),
    ...structuredStyle(node),
  };

  const baseProps: Record<string, unknown> = {
    key: node.id,
    className,
    'data-node-id': node.id,
    'data-role': role,
    ...handlers,
  };

  if (role === 'line') {
    return renderLineShape(node, baseProps, combinedStyle);
  }
  if (role === 'path') {
    return renderPathShape(node, baseProps, combinedStyle);
  }

  baseProps.style = combinedStyle;

  if (role === 'input') {
    baseProps.placeholder = node.content ?? '';
    baseProps.readOnly = true;
    return createElement('input', baseProps);
  }
  if (SELF_CLOSING.includes(role)) {
    return createElement(tag, baseProps);
  }
  return createElement(tag, baseProps, children);
}

/** Pure IR → React+Tailwind projection. No LLM. */
export function Renderer(props: RendererProps) {
  const roots = buildTree(props.ir);
  if (roots.length === 0) {
    return (
      <div className="grid h-full place-items-center text-sm text-slate-400">
        Empty canvas — draw a shape with the tool palette, or describe a UI in the prompt pane.
      </div>
    );
  }
  return <>{roots.map((r) => renderNode(r, props))}</>;
}
