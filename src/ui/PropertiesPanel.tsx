import { useEffect, useState } from 'react';
import { Sliders, Type as TypeIcon, Square as SquareIcon, MoveHorizontal } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import type { IRNode, NodeStyle } from '@/ir/types';

const SHADOW_PRESETS: { label: string; value: string }[] = [
  { label: 'None',  value: '' },
  { label: 'XS',    value: '0 1px 2px 0 rgba(0,0,0,0.05)' },
  { label: 'SM',    value: '0 1px 3px 0 rgba(0,0,0,0.10), 0 1px 2px -1px rgba(0,0,0,0.10)' },
  { label: 'MD',    value: '0 4px 6px -1px rgba(0,0,0,0.10), 0 2px 4px -2px rgba(0,0,0,0.10)' },
  { label: 'LG',    value: '0 10px 15px -3px rgba(0,0,0,0.10), 0 4px 6px -4px rgba(0,0,0,0.10)' },
  { label: 'XL',    value: '0 20px 25px -5px rgba(0,0,0,0.10), 0 8px 10px -6px rgba(0,0,0,0.10)' },
];

const FONT_FAMILIES = [
  'ui-sans-serif, system-ui',
  'ui-serif, Georgia',
  'ui-monospace, SFMono-Regular',
  'Inter, system-ui',
  'Fraunces, Georgia, serif',
];

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
  const editContent = useAppStore((s) => s.editContent);
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
        {/* Content */}
        {(isTextRole(node.role) || node.content !== undefined) && (
          <Section title="Content" icon={<TypeIcon className="h-3 w-3" />}>
            <ContentEditor
              key={node.id}
              value={node.content ?? ''}
              onChange={(v) => editContent(node.id, v)}
            />
          </Section>
        )}

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
            <NumberField
              value={node.style?.opacity}
              onChange={(v) => set({ opacity: Math.min(1, Math.max(0, v)) })}
              step={0.05}
              min={0}
              max={1}
            />
          </Row>
        </Section>

        {/* Typography */}
        {isTextRole(node.role) && (
          <Section title="Typography" icon={<TypeIcon className="h-3 w-3" />}>
            <Row label="Family">
              <select
                value={node.style?.fontFamily ?? FONT_FAMILIES[0]}
                onChange={(e) => set({ fontFamily: e.target.value })}
                className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px]"
              >
                {FONT_FAMILIES.map((f) => (
                  <option key={f} value={f}>{f.split(',')[0]}</option>
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

        {/* Shadow */}
        <Section title="Shadow" icon={<Sliders className="h-3 w-3" />}>
          <div className="grid grid-cols-3 gap-1">
            {SHADOW_PRESETS.map((p) => (
              <ToggleButton
                key={p.label}
                active={(node.style?.shadow ?? '') === p.value}
                onClick={() => set({ shadow: p.value })}
              >
                {p.label}
              </ToggleButton>
            ))}
          </div>
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

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-3 border-b border-slate-100 pb-3 last:border-b-0">
      <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {icon} {title}
      </div>
      {children}
    </div>
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
  return (
    <div className="flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-1">
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
        step={step ?? 1}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number.parseFloat(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="w-full bg-transparent text-[11px] tabular-nums outline-none"
      />
    </div>
  );
}

function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const safe = value && /^#[0-9a-f]{3,8}$/i.test(value) ? value : '#000000';
  return (
    <div className="flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5">
      <input
        type="color"
        value={safe}
        onChange={(e) => onChange(e.target.value)}
        className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
      />
      <input
        type="text"
        value={value}
        placeholder="#000000"
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent font-mono text-[10px] outline-none"
      />
    </div>
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

function ContentEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(e.target.value);
      }}
      rows={2}
      className="w-full resize-none rounded border border-slate-200 bg-white px-2 py-1.5 text-[11px] outline-none focus:ring-2 focus:ring-indigo-100"
    />
  );
}
