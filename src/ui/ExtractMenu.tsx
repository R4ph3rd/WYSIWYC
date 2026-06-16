import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link2, Sparkles } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useAppStore } from '@/store/appStore';
import { availableExtracts, extractAttribute } from '@/ir/extract';
import type { ExtractKind } from '@/ir/types';

/**
 * Extract-on-drop menu (DirectGPT ad-hoc menu, spec §5). When a node is dropped
 * into the composer, offer "just reference it" or extract a specific semantic
 * property — each shown with a deterministic preview of the value. Floating at
 * the cursor, dismissed on outside click / Esc. No modal, no LLM.
 */
export function ExtractMenu({
  nodeId,
  x,
  y,
  onPick,
  onClose,
}: {
  nodeId: string;
  x: number;
  y: number;
  onPick: (kind: ExtractKind | null) => void;
  onClose: () => void;
}) {
  const node = useAppStore((s) => s.ir.nodes.find((n) => n.id === nodeId) ?? null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep the menu on-screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - r.width - 8);
    const top = Math.min(y, window.innerHeight - r.height - 8);
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (!node) return null;
  const kinds = availableExtracts(node);

  return createPortal(
    <div
      ref={ref}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-50 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg shadow-slate-300/40"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => onPick(null)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
      >
        <Link2 className="h-3.5 w-3.5 text-slate-400" />
        <span className="font-medium">Just reference it</span>
        <span className="ml-auto truncate text-[10px] text-slate-400">{node.role}</span>
      </button>

      <div className="my-1 border-t border-slate-100" />
      <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        <Sparkles className="h-3 w-3" /> Extract a property
      </div>

      <div className="max-h-64 overflow-y-auto">
        {kinds.map((kind) => {
          const { label, value } = extractAttribute(node, kind);
          return (
            <button
              key={kind}
              onClick={() => onPick(kind)}
              className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-violet-50"
            >
              <span className="text-xs font-medium capitalize text-slate-700">{label}</span>
              <span className="w-full truncate text-[10px] text-slate-400">{value}</span>
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
