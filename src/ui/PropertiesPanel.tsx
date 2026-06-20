import { useEffect, useState } from 'react';
import {
  Sliders, Type as TypeIcon, Square as SquareIcon, MoveHorizontal, ChevronUp, ChevronDown,
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import type { IRNode, NodeStyle } from '@/ir/types';
import { GOOGLE_FONTS, fontStack } from '@/lib/fonts';

// --- Shadow: structured (Figma-style) ⇄ CSS box-shadow string -------------
// NodeStyle.shadow stays a raw CSS string (the renderer applies it verbatim);
// the editor parses it into X / Y / blur / spread / color / inset fields and
// re-serializes on every change, exactly like Figma's effect controls.

interface ShadowParts {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  inset: boolean;
}

const DEFAULT_SHADOW: ShadowParts = { x: 0, y: 4, blur: 12, spread: 0, color: 'rgba(0, 0, 0, 0.15)', inset: false };

function parseShadow(s?: string): ShadowParts {
  if (!s || !s.trim()) return { ...DEFAULT_SHADOW };
  let str = s.trim();
  const inset = /(^|\s)inset(\s|$)/i.test(str);
  str = str.replace(/inset/gi, '').trim();
  // Only the first shadow layer is edited (Figma edits one effect at a time).
  const first = str.split(/,(?![^()]*\))/)[0].trim();
  const colorMatch = first.match(/(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-fA-F]{3,8})/);
  const color = colorMatch ? colorMatch[0] : DEFAULT_SHADOW.color;
  const numStr = colorMatch ? first.replace(colorMatch[0], '') : first;
  const nums = (numStr.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  return { x: nums[0] ?? 0, y: nums[1] ?? 0, blur: nums[2] ?? 0, spread: nums[3] ?? 0, color, inset };
}

function serializeShadow(p: ShadowParts): string {
  return `${p.inset ? 'inset ' : ''}${p.x}px ${p.y}px ${p.blur}px ${p.spread}px ${p.color}`;
}

// --- Color ⇄ {hex, alpha} (Figma-style swatch + hex + opacity) ------------

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((n) => clampByte(n).toString(16).padStart(2, '0')).join('');
}

function parseColor(c: string): { hex: string; alpha: number } {
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

/** Recompose a hex + alpha% into the most compact CSS color (hex at 100%). */
function composeColor(hex: string, alpha: number): string {
  if (alpha >= 100) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.round((alpha / 100) * 100) / 100})`;
}


/** A draggable inspector parameter (DirectGPT: drag a coordinate into prose). */
interface ParamDrag {
  nodeId: string;
  path: string;
  value: number | string | undefined;
}

/** Drag-source props for a field label. Returns {} when there is no value. */
function paramDragProps(param?: ParamDrag): React.HTMLAttributes<HTMLElement> & { draggable?: boolean } {
  if (!param || param.value === undefined || param.value === '') return {};
  return {
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData(
        'text/wysiwyc-param',
        JSON.stringify({ nodeId: param.nodeId, path: param.path, value: param.value }),
      );
      e.dataTransfer.effectAllowed = 'copy';
    },
    title: 'Drag into the prompt to refer to this value',
  };
}

function isTextRole(role: IRNode['role']): boolean {
  return role === 'text' || role === 'heading' || role === 'button' || role === 'badge' || role === 'icon';
}
function isShapeRole(role: IRNode['role']): boolean {
  return role === 'rectangle' || role === 'circle' || role === 'line' || role === 'path';
}

export function PropertiesPanel() {
  const selectedId = useAppStore((s) => s.selectedNodeId);
  const node = useAppStore((s) => selectedId ? s.ir.nodes.find((n) => n.id === selectedId) ?? null : null);
  // edit* write the IR immediately and, once the burst settles, run the Call B
  // back-channel so panel edits propose prompt updates like any manipulation.
  const editStyle = useAppStore((s) => s.editStyle);
  const editLayout = useAppStore((s) => s.editLayout);
  const manipulate = useAppStore((s) => s.manipulate);

  if (!selectedId || !node) {
    return (
      <div className="flex h-full flex-col bg-white">
        <PanelHeader title="Properties" />
        <p className="px-4 py-6 text-center text-[11px] text-slate-400">
          Select a layer to edit its properties.
        </p>
      </div>
    );
  }

  const set = (patch: Partial<NodeStyle>) => editStyle(node.id, patch);
  const setLayout = (patch: Partial<{ x: number; y: number; w: number; h: number }>) =>
    editLayout(node.id, patch);

  return (
    <div className="flex h-full flex-col bg-white">
      <PanelHeader title={`Properties — ${node.role}`} />
      <div className="flex-1 overflow-y-auto p-3 text-xs">
        {/* Position */}
        <Section title="Position & size" icon={<MoveHorizontal className="h-3 w-3" />}>
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField label="X" value={node.layout?.x} onChange={(v) => setLayout({ x: v })}
              param={{ nodeId: node.id, path: 'layout.x', value: node.layout?.x }} />
            <NumberField label="Y" value={node.layout?.y} onChange={(v) => setLayout({ y: v })}
              param={{ nodeId: node.id, path: 'layout.y', value: node.layout?.y }} />
            <NumberField label="W" value={node.layout?.w} onChange={(v) => setLayout({ w: v })}
              param={{ nodeId: node.id, path: 'layout.w', value: node.layout?.w }} />
            <NumberField label="H" value={node.layout?.h} onChange={(v) => setLayout({ h: v })}
              param={{ nodeId: node.id, path: 'layout.h', value: node.layout?.h }} />
          </div>
        </Section>

        {/* Appearance */}
        <Section title="Appearance" icon={<SquareIcon className="h-3 w-3" />}>
          <Row label="Fill" param={{ nodeId: node.id, path: 'style.fill', value: node.style?.fill }}>
            <ColorField value={node.style?.fill ?? ''} onChange={(v) => set({ fill: v })} />
          </Row>
          <Row label="Stroke">
            <ColorField value={node.style?.stroke ?? ''} onChange={(v) => set({ stroke: v })} />
          </Row>
          <Row label="Stroke W">
            <NumberField
              value={node.style?.strokeWidth}
              onChange={(v) => set({ strokeWidth: v })}
              min={0}
              max={32}
            />
          </Row>
          {!isShapeRole(node.role) || node.role === 'rectangle' ? (
            <Row label="Radius" param={{ nodeId: node.id, path: 'style.borderRadius', value: node.style?.borderRadius }}>
              <NumberField
                value={node.style?.borderRadius}
                onChange={(v) => set({ borderRadius: v })}
                min={0}
                max={9999}
              />
            </Row>
          ) : null}
          <Row label="Opacity">
            <OpacityField value={node.style?.opacity} onChange={(v) => set({ opacity: v })} />
          </Row>
        </Section>

        {/* Typography */}
        {isTextRole(node.role) && (
          <Section title="Typography" icon={<TypeIcon className="h-3 w-3" />}>
            <Row label="Family">
              <select
                value={node.style?.fontFamily ?? ''}
                onChange={(e) => set({ fontFamily: e.target.value })}
                className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px]"
              >
                <option value="">Default</option>
                {GOOGLE_FONTS.map((f) => (
                  <option key={f} value={fontStack(f)} style={{ fontFamily: fontStack(f) }}>
                    {f}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Size" param={{ nodeId: node.id, path: 'style.fontSize', value: node.style?.fontSize }}>
              <NumberField value={node.style?.fontSize} onChange={(v) => set({ fontSize: v })} min={8} max={200} />
            </Row>
            <Row label="Weight">
              <select
                value={String(node.style?.fontWeight ?? 400)}
                onChange={(e) => set({ fontWeight: Number(e.target.value) })}
                className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px]"
              >
                {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </Row>
            <Row label="Color" param={{ nodeId: node.id, path: 'style.fontColor', value: node.style?.fontColor }}>
              <ColorField value={node.style?.fontColor ?? ''} onChange={(v) => set({ fontColor: v })} />
            </Row>
            <Row label="Style">
              <div className="flex gap-1">
                <ToggleButton active={node.style?.italic} onClick={() => set({ italic: !node.style?.italic })}>i</ToggleButton>
                <ToggleButton active={node.style?.underline} onClick={() => set({ underline: !node.style?.underline })}>U</ToggleButton>
              </div>
            </Row>
            <Row label="Align">
              <div className="flex gap-1">
                {(['left', 'center', 'right'] as const).map((a) => (
                  <ToggleButton
                    key={a}
                    active={node.style?.textAlign === a}
                    onClick={() => manipulate({ kind: 'align', ids: [node.id], axis: a })}
                  >
                    {a[0].toUpperCase()}
                  </ToggleButton>
                ))}
              </div>
            </Row>
          </Section>
        )}

        {/* Shadow (Figma-style drop/inner shadow editor) */}
        <Section
          title="Shadow"
          icon={<Sliders className="h-3 w-3" />}
          accessory={
            <Switch
              checked={Boolean(node.style?.shadow?.trim())}
              onChange={(on) => set({ shadow: on ? serializeShadow(DEFAULT_SHADOW) : '' })}
            />
          }
        >
          {node.style?.shadow?.trim() ? (
            <ShadowEditor value={node.style.shadow} onChange={(v) => set({ shadow: v })} />
          ) : (
            <p className="text-[10px] text-slate-400">No shadow. Toggle it on to add a drop shadow.</p>
          )}
        </Section>
      </div>
    </div>
  );
}

// --- Sub-components -------------------------------------------------------

function PanelHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2">
      <Sliders className="h-3.5 w-3.5 text-slate-500" />
      <span className="text-xs font-semibold tracking-tight text-slate-700">{title}</span>
    </div>
  );
}

function Section({ title, icon, accessory, children }: {
  title: string; icon: React.ReactNode; accessory?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="mb-3 border-b border-slate-100 pb-3 last:border-b-0">
      <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {icon} {title}
        {accessory && <span className="ml-auto normal-case">{accessory}</span>}
      </div>
      {children}
    </div>
  );
}

/** Figma-style small on/off switch. */
function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={
        'relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors ' +
        (checked ? 'bg-indigo-600' : 'bg-slate-200')
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

function Row({ label, param, children }: { label: string; param?: ParamDrag; children: React.ReactNode }) {
  const drag = paramDragProps(param);
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <span
        {...drag}
        className={
          'w-16 shrink-0 text-[10px] text-slate-500' +
          (drag.draggable ? ' cursor-grab rounded hover:bg-sky-50 hover:text-sky-600 active:cursor-grabbing' : '')
        }
      >
        {label}
      </span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function NumberField({
  value, onChange, label, param, min, max, step,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  label?: string;
  param?: ParamDrag;
  min?: number; max?: number; step?: number;
}) {
  const [draft, setDraft] = useState<string>(value === undefined ? '' : String(value));
  useEffect(() => { setDraft(value === undefined ? '' : String(value)); }, [value]);
  const drag = paramDragProps(param);
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
    <div className="flex items-center gap-1 rounded border border-slate-200 bg-white pl-1.5 focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-50">
      {label && (
        <span
          {...drag}
          className={
            'text-[9px] uppercase text-slate-400' +
            (drag.draggable ? ' cursor-grab rounded hover:bg-sky-50 hover:text-sky-600 active:cursor-grabbing' : '')
          }
        >
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

/** Figma-style stacked +/- chevrons that nudge a number field. */
function Stepper({ onUp, onDown }: { onUp: () => void; onDown: () => void }) {
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

/**
 * Figma-style color control: a swatch (opens the native picker) + a hex field +
 * an opacity % field. Below 100% the value serializes to rgba(); at 100% it
 * stays a compact hex. `alpha={false}` hides opacity (e.g. shadow uses its own).
 */
function ColorField({
  value,
  onChange,
  alpha = true,
}: {
  value: string;
  onChange: (v: string) => void;
  alpha?: boolean;
}) {
  const has = Boolean(value && value.trim());
  const { hex, alpha: a } = parseColor(has ? value : '#000000');
  const [hexDraft, setHexDraft] = useState(hex.slice(1).toUpperCase());
  useEffect(() => setHexDraft(hex.slice(1).toUpperCase()), [hex]);

  const commitHex = (raw: string) => {
    const clean = raw.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
    setHexDraft(clean.toUpperCase());
    if (clean.length === 3 || clean.length === 6) {
      const full = clean.length === 3 ? clean.split('').map((d) => d + d).join('') : clean;
      onChange(composeColor('#' + full.toLowerCase(), alpha ? a : 100));
    }
  };

  return (
    <div className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-1.5 py-1">
      <span className="relative h-4 w-4 shrink-0 overflow-hidden rounded border border-slate-200">
        <span className="absolute inset-0 [background-image:linear-gradient(45deg,#ddd_25%,transparent_25%),linear-gradient(-45deg,#ddd_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#ddd_75%),linear-gradient(-45deg,transparent_75%,#ddd_75%)] [background-position:0_0,0_2px,2px_-2px,-2px_0] [background-size:4px_4px]" />
        <span className="absolute inset-0" style={{ background: has ? value : 'transparent' }} />
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(composeColor(e.target.value, alpha ? a : 100))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label="Pick color"
        />
      </span>
      <input
        type="text"
        value={hexDraft}
        placeholder="—"
        onChange={(e) => commitHex(e.target.value)}
        className="w-full min-w-0 bg-transparent font-mono text-[10px] uppercase outline-none"
      />
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
    </div>
  );
}

/** Figma-style opacity: a slider with a live percentage readout (0–100%). */
function OpacityField({ value, onChange }: { value: number | undefined; onChange: (v: number) => void }) {
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

/** Figma-style shadow effect: type + X / Y / blur / spread + color. */
function ShadowEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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
      <Row label="Color">
        <ColorField value={parts.color} onChange={(color) => update({ color })} />
      </Row>
    </>
  );
}

function ToggleButton({ active, onClick, children }: {
  active?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'rounded border px-2 py-1 text-[10px] font-medium transition-colors ' +
        (active
          ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')
      }
    >
      {children}
    </button>
  );
}

