import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Trash2, Sparkles, RefreshCw } from 'lucide-react';
import type { PromptClause } from '@/ir/types';

/**
 * Alternatives dropdown for a living-spec clause (DirectGPT-style swap). Clicking
 * a clause opens this at the cursor: it offers the model's up-to-3 plausible
 * alternatives (one click replaces the clause and re-realizes the IR), plus
 * inline edit and remove. Inferred clauses are flagged so guesses are easy to
 * confirm or change. Floating, dismissed on outside click / Esc.
 */
export function AlternativesMenu({
  clause,
  x,
  y,
  onPick,
  onEdit,
  onRemove,
  onClose,
}: {
  clause: PromptClause;
  x: number;
  y: number;
  onPick: (text: string) => void;
  onEdit: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const alternatives = (clause.alternatives ?? []).filter((a) => a.trim() && a.trim() !== clause.text.trim()).slice(0, 3);

  return createPortal(
    <div
      ref={ref}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-50 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg shadow-slate-300/40"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {clause.origin === 'inferred' && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-amber-600">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 ring-2 ring-amber-100" />
          Inferred — not stated by you. Confirm or swap:
        </div>
      )}

      {alternatives.length > 0 ? (
        <>
          <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <RefreshCw className="h-3 w-3" /> Alternatives
          </div>
          {alternatives.map((alt, i) => (
            <button
              key={i}
              onClick={() => onPick(alt)}
              className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-violet-50"
            >
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-violet-400" />
              <span className="leading-snug">{alt}</span>
            </button>
          ))}
          <div className="my-1 border-t border-slate-100" />
        </>
      ) : (
        <div className="px-3 py-1.5 text-[11px] text-slate-400">No alternatives suggested.</div>
      )}

      <button onClick={onEdit} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50">
        <Pencil className="h-3 w-3 text-slate-400" /> Edit text…
      </button>
      <button onClick={onRemove} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-rose-600 hover:bg-rose-50">
        <Trash2 className="h-3 w-3" /> Remove
      </button>
    </div>,
    document.body,
  );
}
