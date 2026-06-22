import { useEffect, useRef, useState } from 'react';
import { Sliders, Type as TypeIcon, Square as SquareIcon, MoveHorizontal, ChevronDown } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import type { IRNode, NodeStyle } from '@/ir/types';
import { fontStack, familyFromStack } from '@/lib/fonts';
import {
  ColorField, NumberField, OpacityField, ShadowEditor, Switch, ToggleButton,
  DEFAULT_SHADOW, serializeShadow,
} from './primitives/fields';
import { FontPicker } from './FontPicker';

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
    className: 'cursor-grab rounded hover:bg-sky-50 hover:text-sky-600 active:cursor-grabbing',
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
  const computedBounds = useAppStore((s) => s.computedBounds);
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
        {/* Position — show stored layout when available; fall back to computed DOM bounds. */}
        <Section title="Position & size" icon={<MoveHorizontal className="h-3 w-3" />}>
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField label="X"
              value={node.layout?.x ?? computedBounds?.x}
              onChange={(v) => setLayout({ x: v })}
              labelProps={paramDragProps({ nodeId: node.id, path: 'layout.x', value: node.layout?.x ?? computedBounds?.x })} />
            <NumberField label="Y"
              value={node.layout?.y ?? computedBounds?.y}
              onChange={(v) => setLayout({ y: v })}
              labelProps={paramDragProps({ nodeId: node.id, path: 'layout.y', value: node.layout?.y ?? computedBounds?.y })} />
            <NumberField label="W"
              value={node.layout?.w ?? computedBounds?.w}
              onChange={(v) => setLayout({ w: v })}
              labelProps={paramDragProps({ nodeId: node.id, path: 'layout.w', value: node.layout?.w ?? computedBounds?.w })} />
            <NumberField label="H"
              value={node.layout?.h ?? computedBounds?.h}
              onChange={(v) => setLayout({ h: v })}
              labelProps={paramDragProps({ nodeId: node.id, path: 'layout.h', value: node.layout?.h ?? computedBounds?.h })} />
          </div>
          {node.layout?.x === undefined && computedBounds && (
            <p className="mt-1 text-[9px] text-slate-400">Computed — edit to switch to absolute layout</p>
          )}
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
            <NumberField value={node.style?.strokeWidth} onChange={(v) => set({ strokeWidth: v })} min={0} max={32} />
          </Row>
          {!isShapeRole(node.role) || node.role === 'rectangle' ? (
            <Row label="Radius" param={{ nodeId: node.id, path: 'style.borderRadius', value: node.style?.borderRadius }}>
              <NumberField value={node.style?.borderRadius} onChange={(v) => set({ borderRadius: v })} min={0} max={9999} />
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
              <FontField
                value={node.style?.fontFamily}
                onChange={(family) => set({ fontFamily: fontStack(family) })}
              />
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

        {/* Shadow (structured drop/inner shadow editor) */}
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

function Row({ label, param, children }: { label: string; param?: ParamDrag; children: React.ReactNode }) {
  const drag = paramDragProps(param);
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <span {...drag} className={'w-16 shrink-0 text-[10px] text-slate-500' + (drag.className ? ' ' + drag.className : '')}>
        {label}
      </span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

/** The Typography → Family control: current font + a FontPicker dropdown. */
function FontField({ value, onChange }: { value: string | undefined; onChange: (family: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const family = familyFromStack(value);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ fontFamily: value || undefined }}
        className="flex w-full items-center justify-between rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-700 hover:border-slate-300"
      >
        <span className="truncate">{family || 'Default'}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg shadow-slate-300/40">
          <FontPicker value={family} onChange={(f) => { onChange(f); setOpen(false); }} />
        </div>
      )}
    </div>
  );
}
