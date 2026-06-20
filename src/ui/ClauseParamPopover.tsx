import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  COLOR_NAMES, RADIUS_OPTIONS, SIZE_OPTIONS, WEIGHT_OPTIONS,
  numberMax, parseNumber, spliceText, type ParamMatch,
} from '@/lib/clauseParams';
import { GOOGLE_FONTS, fontStack } from '@/lib/fonts';

/**
 * A small floating widget for a single style parameter detected inside a clause
 * (color → picker, number → slider, font → selector, adjective → option list).
 * Editing rewrites just that token in the clause text and re-runs Call A.
 */
export function ClauseParamPopover({
  original,
  match,
  x,
  y,
  onCommit,
  onClose,
}: {
  original: string;
  match: ParamMatch;
  x: number;
  y: number;
  onCommit: (newText: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  const commit = (replacement: string) => onCommit(spliceText(original, match.start, match.end, replacement));

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

  return createPortal(
    <div
      ref={ref}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-50 w-60 rounded-xl border border-slate-200 bg-white p-2.5 shadow-lg shadow-slate-300/40"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {LABELS[match.kind]}
        <span className="ml-auto truncate font-mono normal-case text-slate-400">{match.text}</span>
      </div>
      {match.kind === 'color' && <ColorWidget token={match.text} onChange={commit} />}
      {match.kind === 'fontFamily' && (
        <FontWidget current={match.text} onPick={(f) => { commit(f); onClose(); }} />
      )}
      {match.kind === 'number' && <NumberWidget token={match.text} onChange={commit} />}
      {match.kind === 'size' && (
        <OptionWidget current={match.text} options={SIZE_OPTIONS} onPick={(o) => { commit(o); onClose(); }} />
      )}
      {match.kind === 'weight' && (
        <OptionWidget current={match.text} options={WEIGHT_OPTIONS} onPick={(o) => { commit(o); onClose(); }} />
      )}
      {match.kind === 'radius' && (
        <OptionWidget current={match.text} options={RADIUS_OPTIONS} onPick={(o) => { commit(o); onClose(); }} />
      )}
    </div>,
    document.body,
  );
}

const LABELS: Record<ParamMatch['kind'], string> = {
  color: 'Color',
  fontFamily: 'Font',
  number: 'Size',
  size: 'Scale',
  weight: 'Weight',
  radius: 'Corners',
};

function seedHex(token: string): string {
  const t = token.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  if (/^#[0-9a-f]{3}$/.test(t)) return '#' + t.slice(1).split('').map((c) => c + c).join('');
  if (COLOR_NAMES[t]) return COLOR_NAMES[t];
  return '#4f46e5';
}

function ColorWidget({ token, onChange }: { token: string; onChange: (v: string) => void }) {
  const [hex, setHex] = useState(seedHex(token));
  useEffect(() => setHex(seedHex(token)), [token]);
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={hex}
        onChange={(e) => { setHex(e.target.value); onChange(e.target.value); }}
        className="h-8 w-10 cursor-pointer rounded border border-slate-200 bg-transparent p-0.5"
        aria-label="Pick color"
      />
      <input
        type="text"
        value={hex}
        onChange={(e) => {
          setHex(e.target.value);
          if (/^#[0-9a-fA-F]{3,8}$/.test(e.target.value)) onChange(e.target.value);
        }}
        className="w-full rounded border border-slate-200 px-2 py-1 font-mono text-[11px] uppercase outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50"
      />
    </div>
  );
}

function NumberWidget({ token, onChange }: { token: string; onChange: (v: string) => void }) {
  const { value, unit } = parseNumber(token);
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const max = numberMax(unit);
  const set = (n: number) => { setV(n); onChange(`${n}${unit}`); };
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={0}
        max={max}
        value={Math.min(v, max)}
        onChange={(e) => set(Number(e.target.value))}
        className="wysiwyc-range flex-1 cursor-pointer"
      />
      <div className="flex items-center rounded border border-slate-200 px-1.5 py-1">
        <input
          type="number"
          value={v}
          onChange={(e) => set(Number(e.target.value))}
          className="w-9 bg-transparent text-right text-[11px] tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-[9px] text-slate-400">{unit}</span>
      </div>
    </div>
  );
}

function OptionWidget({ current, options, onPick }: {
  current: string; options: string[]; onPick: (o: string) => void;
}) {
  const cur = current.trim().toLowerCase();
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onPick(o)}
          className={
            'rounded border px-2 py-1 text-[11px] capitalize transition-colors ' +
            (o === cur
              ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
              : 'border-slate-200 text-slate-600 hover:bg-slate-50')
          }
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function FontWidget({ current, onPick }: { current: string; onPick: (f: string) => void }) {
  const [q, setQ] = useState('');
  const cur = current.trim().toLowerCase();
  const list = useMemo(
    () => GOOGLE_FONTS.filter((f) => f.toLowerCase().includes(q.trim().toLowerCase())),
    [q],
  );
  return (
    <div>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search fonts…"
        className="mb-1.5 w-full rounded border border-slate-200 px-2 py-1 text-[11px] outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50"
      />
      <div className="max-h-52 overflow-y-auto">
        {list.map((f) => (
          <button
            key={f}
            onClick={() => onPick(f)}
            style={{ fontFamily: fontStack(f) }}
            className={
              'flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-slate-50 ' +
              (f.toLowerCase() === cur ? 'text-indigo-700' : 'text-slate-700')
            }
          >
            {f}
          </button>
        ))}
        {list.length === 0 && <p className="px-2 py-3 text-center text-[11px] text-slate-400">No fonts match.</p>}
      </div>
    </div>
  );
}
