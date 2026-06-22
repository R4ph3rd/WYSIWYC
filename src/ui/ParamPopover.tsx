import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ParamKind, ParamSpan } from '@/ir/types';
import {
  ColorField, OpacityField, ShadowEditor, Slider, ToggleButton,
} from './primitives/fields';
import { FontPicker } from './FontPicker';

/**
 * A small anchored popover holding the right widget for a clicked parameter
 * token. The widget registry falls back to a plain TEXT INPUT for any kind it
 * doesn't recognize (and the lexer/model may always emit kind:'text'), so
 * clicking ANY parameter word yields an editable control. `onChange` writes
 * through `setClauseParam` (deterministic, no LLM).
 */
export function ParamPopover({
  span,
  x,
  y,
  onChange,
  onClose,
}: {
  span: ParamSpan;
  x: number;
  y: number;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const commitClose = (v: string) => { onChange(v); onClose(); };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y + 8, window.innerHeight - r.height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-50 w-60 rounded-xl border border-slate-200 bg-white p-2.5 shadow-lg shadow-slate-300/40 ring-1 ring-black/5"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {LABELS[span.kind]}
        {span.nodeIds.length === 0 && (
          <span className="ml-auto normal-case text-[9px] text-slate-300">prose only</span>
        )}
      </div>
      <Widget span={span} onChange={onChange} onCommitClose={commitClose} />
    </div>,
    document.body,
  );
}

const LABELS: Record<ParamKind, string> = {
  color: 'Color',
  length: 'Size',
  fontFamily: 'Font',
  fontWeight: 'Weight',
  shadow: 'Shadow',
  radius: 'Corners',
  opacity: 'Opacity',
  align: 'Align',
  enum: 'Option',
  shape: 'Shape',
  text: 'Value',
};

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

function Widget({
  span,
  onChange,
  onCommitClose,
}: {
  span: ParamSpan;
  onChange: (v: string) => void;
  onCommitClose: (v: string) => void;
}) {
  switch (span.kind) {
    case 'color':
      return <ColorField value={span.value || '#000000'} onChange={onChange} />;

    case 'length':
    case 'radius': {
      const unit = span.unit ?? 'px';
      const max = unit === '%' ? 100 : unit === 'rem' ? 8 : 128;
      const step = unit === 'rem' ? 0.25 : 1;
      return (
        <Slider value={Number(span.value) || 0} min={0} max={max} step={step} unit={unit} onChange={(n) => onChange(String(n))} />
      );
    }

    case 'opacity':
      return <OpacityField value={Number(span.value) || 1} onChange={(n) => onChange(String(n))} />;

    case 'fontWeight':
      return (
        <div className="grid grid-cols-3 gap-1">
          {WEIGHTS.map((w) => (
            <ToggleButton key={w} active={Number(span.value) === w} onClick={() => onChange(String(w))}>
              {w}
            </ToggleButton>
          ))}
        </div>
      );

    case 'shadow':
      return <ShadowEditor value={span.value} onChange={onChange} />;

    case 'align':
      return (
        <div className="flex gap-1">
          {(['left', 'center', 'right'] as const).map((a) => (
            <ToggleButton key={a} active={span.value === a} onClick={() => onCommitClose(a)}>
              {a[0].toUpperCase() + a.slice(1)}
            </ToggleButton>
          ))}
        </div>
      );

    case 'enum':
      return (
        <div className="flex flex-wrap gap-1">
          {(span.options ?? []).map((o) => (
            <ToggleButton key={o} active={span.value === o} onClick={() => onCommitClose(o)}>
              {o}
            </ToggleButton>
          ))}
        </div>
      );

    case 'shape': {
      const SHAPE_MAP: Record<string, number> = { round: 9999, circular: 9999, rounded: 8, rectangular: 0, square: 0 };
      return (
        <div className="flex flex-wrap gap-1">
          {(span.options ?? Object.keys(SHAPE_MAP)).map((o) => (
            <ToggleButton key={o} active={span.value === SHAPE_MAP[o]?.toString()} onClick={() => onCommitClose(String(SHAPE_MAP[o] ?? 0))}>
              {o}
            </ToggleButton>
          ))}
        </div>
      );
    }

    case 'fontFamily':
      return <FontPicker value={span.value} onChange={(f) => onCommitClose(f)} />;

    case 'text':
    default:
      return <TextInput value={span.value} onChange={onChange} />;
  }
}

/** The universal fallback: edit any parameter token as free text. */
function TextInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => { setDraft(e.target.value); onChange(e.target.value); }}
      className="w-full rounded border border-slate-200 px-2 py-1 text-[11px] outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50"
    />
  );
}
