import { useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { HexColorPicker } from 'react-colorful';

/**
 * Shared inspector field primitives. Used by both the Properties panel and the
 * inline clause-parameter popover so the two never diverge.
 */

// --- Shadow: structured (Figma-style) ⇄ CSS box-shadow string -------------

export interface ShadowParts {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  inset: boolean;
}

export const DEFAULT_SHADOW: ShadowParts = { x: 0, y: 4, blur: 12, spread: 0, color: 'rgba(0, 0, 0, 0.15)', inset: false };

export function parseShadow(s?: string): ShadowParts {
  if (!s || !s.trim()) return { ...DEFAULT_SHADOW };
  let str = s.trim();
  const inset = /(^|\s)inset(\s|$)/i.test(str);
  str = str.replace(/inset/gi, '').trim();
  const first = str.split(/,(?![^()]*\))/)[0].trim();
  const colorMatch = first.match(/(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-fA-F]{3,8})/);
  const color = colorMatch ? colorMatch[0] : DEFAULT_SHADOW.color;
  const numStr = colorMatch ? first.replace(colorMatch[0], '') : first;
  const nums = (numStr.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  return { x: nums[0] ?? 0, y: nums[1] ?? 0, blur: nums[2] ?? 0, spread: nums[3] ?? 0, color, inset };
}

export function serializeShadow(p: ShadowParts): string {
  return `${p.inset ? 'inset ' : ''}${p.x}px ${p.y}px ${p.blur}px ${p.spread}px ${p.color}`;
}

// --- Color ⇄ {hex, alpha} --------------------------------------------------

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((n) => clampByte(n).toString(16).padStart(2, '0')).join('');
}
export function parseColor(c: string): { hex: string; alpha: number } {
  const rgb = c.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
  if (rgb) {
    const a = rgb[4] !== undefined ? Number(rgb[4]) : 1;
    return { hex: rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3])), alpha: Math.round(a * 100) };
  }
  const hx = c.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (hx) return { hex: '#' + hx[1].toLowerCase(), alpha: hx[2] ? Math.round((parseInt(hx[2], 16) / 255) * 100) : 100 };
  const short = c.match(/^#([0-9a-f]{3})$/i);
  if (short) {
    const [r, g, b] = short[1].split('').map((d) => parseInt(d + d, 16));
    return { hex: rgbToHex(r, g, b), alpha: 100 };
  }
  return { hex: '#000000', alpha: 100 };
}
export function composeColor(hex: string, alpha: number): string {
  if (alpha >= 100) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.round((alpha / 100) * 100) / 100})`;
}

// --- Components ------------------------------------------------------------

/** Figma-style stacked +/- chevrons that nudge a number field. */
export function Stepper({ onUp, onDown }: { onUp: () => void; onDown: () => void }) {
  const btn =
    'flex h-1/2 w-full items-center justify-center text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700';
  return (
    <div className="flex h-6 w-4 shrink-0 flex-col border-l border-slate-200">
      <button type="button" tabIndex={-1} aria-label="Increase" className={btn} onClick={onUp}>
        <ChevronUp className="h-2.5 w-2.5" />
      </button>
      <button type="button" tabIndex={-1} aria-label="Decrease" className={btn} onClick={onDown}>
        <ChevronDown className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

export function NumberField({
  value, onChange, label, labelProps, min, max, step,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  label?: string;
  labelProps?: React.HTMLAttributes<HTMLElement> & { draggable?: boolean };
  min?: number; max?: number; step?: number;
}) {
  const [draft, setDraft] = useState<string>(value === undefined ? '' : String(value));
  useEffect(() => { setDraft(value === undefined ? '' : String(value)); }, [value]);
  const stepBy = step ?? 1;
  const clamp = (n: number) => {
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return Math.round(n * 1000) / 1000;
  };
  const nudge = (dir: 1 | -1) => {
    const base = Number.isFinite(value as number) ? (value as number) : 0;
    onChange(clamp(base + dir * stepBy));
  };
  return (
    <div className="flex items-center gap-1 rounded border border-slate-200 bg-white pl-1.5 focus-within:border-slate-400 focus-within:ring-2 focus-within:ring-slate-100">
      {label && (
        <span {...labelProps} className={'text-[9px] uppercase text-slate-400' + (labelProps?.className ? ' ' + labelProps.className : '')}>
          {label}
        </span>
      )}
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        step={stepBy}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number.parseFloat(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="min-w-0 flex-1 bg-transparent py-1 text-[11px] tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <Stepper onUp={() => nudge(1)} onDown={() => nudge(-1)} />
    </div>
  );
}

/** A range slider + compact number box with an optional unit. */
export function Slider({
  value, onChange, min = 0, max = 100, step = 1, unit,
}: {
  value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; unit?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(Math.max(value, min), max)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="wysiwyc-range flex-1 cursor-pointer"
      />
      <div className="flex items-center rounded border border-slate-200 px-1.5 py-1">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-9 bg-transparent text-right text-[11px] tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        {unit && <span className="text-[9px] text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}

/** Opacity slider with a live percentage readout (0–100%). */
export function OpacityField({ value, onChange }: { value: number | undefined; onChange: (v: number) => void }) {
  const pct = Math.round((value ?? 1) * 100);
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={0}
        max={100}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="wysiwyc-range flex-1 cursor-pointer"
      />
      <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-slate-500">{pct}%</span>
    </div>
  );
}

/**
 * Figma-style color control: a checkered swatch (opens a react-colorful popover)
 * + hex text field + optional alpha %. Replaces the native <input type="color">
 * so the value always updates correctly and the picker looks good on any OS.
 */
export function ColorField({
  value, onChange, alpha = true,
}: {
  value: string; onChange: (v: string) => void; alpha?: boolean;
}) {
  const has = Boolean(value && value.trim());
  const { hex, alpha: a } = parseColor(has ? value : '#000000');
  const [hexDraft, setHexDraft] = useState(hex.slice(1).toUpperCase());
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => setHexDraft(hex.slice(1).toUpperCase()), [hex]);

  // Close picker when clicking outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const commitHex = (raw: string) => {
    const clean = raw.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
    setHexDraft(clean.toUpperCase());
    if (clean.length === 3 || clean.length === 6) {
      const full = clean.length === 3 ? clean.split('').map((d) => d + d).join('') : clean;
      onChange(composeColor('#' + full.toLowerCase(), alpha ? a : 100));
    }
  };

  return (
    <div className="relative flex items-center gap-1.5 rounded border border-slate-200 bg-white px-1.5 py-1">
      {/* Swatch button — opens the react-colorful popover */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative h-4 w-4 shrink-0 overflow-hidden rounded border border-slate-200 focus:outline-none"
        aria-label="Pick color"
      >
        <span className="absolute inset-0 [background-image:linear-gradient(45deg,#ddd_25%,transparent_25%),linear-gradient(-45deg,#ddd_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#ddd_75%),linear-gradient(-45deg,transparent_75%,#ddd_75%)] [background-position:0_0,0_2px,2px_-2px,-2px_0] [background-size:4px_4px]" />
        <span className="absolute inset-0" style={{ background: has ? value : 'transparent' }} />
      </button>

      {/* Hex text input */}
      <input
        type="text"
        value={hexDraft}
        placeholder="—"
        onChange={(e) => commitHex(e.target.value)}
        className="w-full min-w-0 bg-transparent font-mono text-[10px] uppercase outline-none"
      />

      {/* Alpha % */}
      {alpha && (
        <div className="flex items-center gap-0.5 border-l border-slate-200 pl-1.5">
          <input
            type="number"
            value={has ? a : ''}
            min={0}
            max={100}
            placeholder="100"
            onChange={(e) => {
              const n = Math.max(0, Math.min(100, Number.parseInt(e.target.value, 10)));
              onChange(composeColor(hex, Number.isFinite(n) ? n : 100));
            }}
            className="w-7 bg-transparent text-right text-[10px] tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="text-[9px] text-slate-400">%</span>
        </div>
      )}

      {/* react-colorful popover */}
      {open && (
        <div
          ref={popoverRef}
          className="absolute bottom-full left-0 z-50 mb-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-300/40"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <HexColorPicker
            color={hex}
            onChange={(h) => {
              onChange(composeColor(h, alpha ? a : 100));
            }}
          />
          {/* Quick hex input inside the picker for power users */}
          <div className="mt-1.5 flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-1">
            <span className="text-[10px] text-slate-400">#</span>
            <input
              type="text"
              value={hexDraft}
              onChange={(e) => commitHex(e.target.value)}
              className="flex-1 bg-transparent font-mono text-[11px] uppercase outline-none"
              maxLength={6}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function ToggleButton({ active, onClick, children }: {
  active?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'rounded border px-2 py-1 text-[10px] font-medium transition-colors ' +
        (active
          ? 'border-slate-700 bg-slate-900 text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')
      }
    >
      {children}
    </button>
  );
}

/** Figma-style small on/off switch. */
export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={
        'relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors ' +
        (checked ? 'bg-slate-900' : 'bg-slate-200')
      }
    >
      <span
        className={
          'inline-block h-2.5 w-2.5 transform rounded-full bg-white shadow transition-transform ' +
          (checked ? 'translate-x-3' : 'translate-x-0.5')
        }
      />
    </button>
  );
}

/** Structured drop/inner shadow editor: type + X / Y / blur / spread + color. */
export function ShadowEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parts = parseShadow(value);
  const update = (patch: Partial<ShadowParts>) => onChange(serializeShadow({ ...parts, ...patch }));
  return (
    <>
      <div className="mb-1.5 flex items-center gap-1">
        <ToggleButton active={!parts.inset} onClick={() => update({ inset: false })}>Drop</ToggleButton>
        <ToggleButton active={parts.inset} onClick={() => update({ inset: true })}>Inner</ToggleButton>
      </div>
      <div className="mb-1.5 grid grid-cols-2 gap-1.5">
        <NumberField label="X" value={parts.x} onChange={(x) => update({ x })} />
        <NumberField label="Y" value={parts.y} onChange={(y) => update({ y })} />
        <NumberField label="Blur" value={parts.blur} min={0} onChange={(blur) => update({ blur })} />
        <NumberField label="Spread" value={parts.spread} onChange={(spread) => update({ spread })} />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 text-[10px] text-slate-500">Color</span>
        <div className="flex-1"><ColorField value={parts.color} onChange={(color) => update({ color })} /></div>
      </div>
    </>
  );
}
