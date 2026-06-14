/**
 * Deterministic property extraction for composer reference chips (DirectGPT
 * principle c — "refer to objects"). Given an IR node and an ExtractKind, return
 * a short human label and a serialized value the compose call can read back.
 *
 * Pure, no LLM, unit-testable. Tailwind parsing is best-effort regex over the
 * className: it recognises the common token families the model authors (text-*,
 * bg-*, rounded-*, shadow-*, border-*, flex/grid, gap-*, font-*) but does NOT
 * resolve arbitrary or custom utilities — for v1 that coverage is enough to give
 * the model a concrete anchor, and the node id travels alongside regardless.
 */
import type { ExtractKind, IRNode, NodeRole } from './types';

/** Pull every className token matching any of the given prefixes, in order. */
function tokens(tw: string | undefined, prefixes: string[]): string[] {
  if (!tw) return [];
  return tw
    .split(/\s+/)
    .filter((t) => t && prefixes.some((p) => t === p || t.startsWith(p)));
}

/** Color-bearing Tailwind families (best-effort). */
const COLOR_PREFIXES = ['bg-', 'text-', 'from-', 'via-', 'to-', 'border-', 'ring-', 'fill-', 'stroke-'];
const TEXT_PREFIXES = ['text-', 'font-', 'italic', 'underline', 'uppercase', 'tracking-', 'leading-'];
const LAYOUT_PREFIXES = ['flex', 'grid', 'gap-', 'items-', 'justify-', 'p-', 'px-', 'py-', 'm-', 'mx-', 'my-', 'w-', 'h-', 'space-'];
const BOX_PREFIXES = ['rounded', 'shadow', 'border', 'ring'];

/** A token like text-rose-500 names a color; text-2xl / text-center do not. */
function isColorToken(t: string): boolean {
  return /-(?:\d{2,3})$|-(?:white|black|transparent|current)$/.test(t) || /\[#?[0-9a-fA-F]{3,8}\]/.test(t);
}

const ROLE_INTERACTION: Partial<Record<NodeRole, string>> = {
  button: 'click to trigger an action',
  input: 'text entry',
  icon: 'decorative / affordance glyph',
  image: 'static image',
  divider: 'visual separator',
};

function joinNonEmpty(parts: (string | undefined | false)[], sep = ', '): string {
  return parts.filter(Boolean).join(sep);
}

export function extractAttribute(node: IRNode, kind: ExtractKind): { label: string; value: string } {
  const s = node.style ?? {};
  const tw = node.tailwind;

  switch (kind) {
    case 'layout': {
      const box = node.layout
        ? joinNonEmpty([
            node.layout.x !== undefined && `x ${Math.round(node.layout.x)}`,
            node.layout.y !== undefined && `y ${Math.round(node.layout.y)}`,
            node.layout.w !== undefined && `w ${Math.round(node.layout.w)}`,
            node.layout.h !== undefined && `h ${Math.round(node.layout.h)}`,
          ], ' · ')
        : '';
      const arrange = tokens(tw, LAYOUT_PREFIXES).join(' ');
      const value = joinNonEmpty([box, arrange], ' — ') || 'in normal flow';
      return { label: 'layout', value };
    }

    case 'hierarchy': {
      const role = node.role;
      const value = joinNonEmpty([
        node.parentId ? `child of ${node.parentId}` : 'root element',
        `order ${node.order}`,
        `role ${role}`,
      ]);
      return { label: 'hierarchy', value };
    }

    case 'colorScheme': {
      const fromStyle = joinNonEmpty([
        s.fill && `fill ${s.fill}`,
        s.stroke && `stroke ${s.stroke}`,
        s.fontColor && `text ${s.fontColor}`,
      ]);
      const fromTw = tokens(tw, COLOR_PREFIXES).filter(isColorToken).join(' ');
      const value = joinNonEmpty([fromStyle, fromTw], ' · ') || 'no explicit colors';
      return { label: 'colors', value };
    }

    case 'fontStyling': {
      const fromStyle = joinNonEmpty([
        s.fontFamily && s.fontFamily.split(',')[0],
        s.fontSize !== undefined && `${s.fontSize}px`,
        s.fontWeight !== undefined && `weight ${s.fontWeight}`,
        s.fontColor && s.fontColor,
        s.italic && 'italic',
        s.underline && 'underline',
        s.textAlign && `align ${s.textAlign}`,
      ]);
      const fromTw = tokens(tw, TEXT_PREFIXES).join(' ');
      const value = joinNonEmpty([fromStyle, fromTw], ' · ') || 'default type';
      return { label: 'typography', value };
    }

    case 'componentStyle': {
      const fromStyle = joinNonEmpty([
        s.borderRadius !== undefined && `radius ${s.borderRadius}`,
        s.stroke && (s.strokeWidth ?? 0) > 0 && `border ${s.strokeWidth}px ${s.stroke}`,
        s.shadow && `shadow ${s.shadow}`,
        s.fill && `fill ${s.fill}`,
      ]);
      const fromTw = tokens(tw, BOX_PREFIXES).join(' ');
      const value = joinNonEmpty([fromStyle, fromTw], ' · ') || 'plain box';
      return { label: 'component style', value };
    }

    case 'interaction': {
      const value = ROLE_INTERACTION[node.role] ?? 'static element';
      return { label: 'interaction', value };
    }

    case 'content': {
      const value = node.content?.trim() || '(no text)';
      return { label: 'content', value };
    }
  }
}

/** Which extract kinds are meaningful for a given node (drives the drop menu). */
export function availableExtracts(node: IRNode): ExtractKind[] {
  const all: ExtractKind[] = ['layout', 'hierarchy', 'colorScheme', 'fontStyling', 'componentStyle', 'interaction'];
  if (node.content !== undefined && node.content !== '') all.push('content');
  return all;
}
