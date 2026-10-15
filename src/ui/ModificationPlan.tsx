import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Send, X, MapPin, Pencil, Check, AlertTriangle } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import type { DemoPlanItem } from '@/ir/types';
import { intentLabel, nodeLabel } from '@/annot/resolve';
import { AI, AI_ACCENT, AI_ACCENT_FILL } from './tokens';

type Box = { x: number; y: number; w: number; h: number };

/**
 * Guardrail overlay (prompt-by-demonstration, part C). Before an annotation set
 * is applied, this shows the planned change for each annotation: the guessed
 * target element(s) are pinned on the canvas, and each plan row lets the user
 * fix the wording and re-pick targets by clicking elements. Low-confidence
 * guesses are flagged so the user verifies them before sending.
 */
export function ModificationPlan({ stageRef }: { stageRef: React.RefObject<HTMLDivElement | null> }) {
  const demoPlan = useAppStore((s) => s.demoPlan);
  const ir = useAppStore((s) => s.ir);
  const updateDemoPlanItem = useAppStore((s) => s.updateDemoPlanItem);
  const removeDemoPlanItem = useAppStore((s) => s.removeDemoPlanItem);
  const cancelDemoPlan = useAppStore((s) => s.cancelDemoPlan);
  const confirmDemoPlan = useAppStore((s) => s.confirmDemoPlan);

  // Which plan row is in "pick targets" mode (clicking canvas nodes edits it).
  const [picking, setPicking] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<Record<string, Box>>({});

  // Measure target boxes for the pins.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !demoPlan) return;
    const sr = stage.getBoundingClientRect();
    const next: Record<string, Box> = {};
    for (const item of demoPlan) {
      for (const id of item.targetNodeIds) {
        const el = stage.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        next[id] = { x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height };
      }
    }
    setBoxes(next);
  }, [demoPlan, stageRef, ir]);

  // While picking targets, clicking a canvas node toggles it on the active row.
  useEffect(() => {
    if (!picking) return;
    const stage = stageRef.current;
    if (!stage) return;
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest('[data-node-id]');
      const id = el?.getAttribute('data-node-id');
      if (!id) return;
      const node = ir.nodes.find((n) => n.id === id);
      if (node && node.parentId === null && node.role === 'frame') return; // ignore root frame
      e.preventDefault();
      e.stopPropagation();
      const item = useAppStore.getState().demoPlan?.find((p) => p.id === picking);
      if (!item) return;
      const has = item.targetNodeIds.includes(id);
      updateDemoPlanItem(picking, {
        targetNodeIds: has ? item.targetNodeIds.filter((x) => x !== id) : [...item.targetNodeIds, id],
      });
    };
    stage.addEventListener('click', onClick, true); // capture: beat the canvas handlers
    return () => stage.removeEventListener('click', onClick, true);
  }, [picking, stageRef, ir, updateDemoPlanItem]);

  if (!demoPlan) return null;

  const uncertain = demoPlan.some((p) => p.confidence !== 'high' || p.targetNodeIds.length === 0);

  return (
    <>
      {/* Pins on the guessed targets (rendered in-stage so they track the canvas). */}
      {createPortal(
        <StagePins stageRef={stageRef} boxes={boxes} demoPlan={demoPlan} picking={picking} />,
        stageRef.current ?? document.body,
      )}

      {/* The plan panel. */}
      <div className="absolute bottom-16 left-1/2 z-40 w-[min(30rem,calc(100%-2rem))] -translate-x-1/2 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl ring-1 ring-black/5">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-semibold tracking-tight text-slate-800">Review changes before applying</span>
          {uncertain && (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
              <AlertTriangle className="h-3 w-3" /> verify targets
            </span>
          )}
          <button
            onClick={cancelDemoPlan}
            className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {demoPlan.length === 0 ? (
          <p className="px-1 py-3 text-center text-xs text-slate-400">No actionable annotations — add a note or arrow.</p>
        ) : (
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {demoPlan.map((item) => (
              <PlanRow
                key={item.id}
                item={item}
                picking={picking === item.id}
                onPick={() => setPicking((id) => (id === item.id ? null : item.id))}
                onText={(t) => updateDemoPlanItem(item.id, { instruction: t })}
                onRemove={() => removeDemoPlanItem(item.id)}
                labelOf={(id) => nodeLabel(id, ir.nodes)}
              />
            ))}
          </div>
        )}

        <div className="mt-2 flex items-center justify-end gap-2">
          <button
            onClick={cancelDemoPlan}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={() => { setPicking(null); confirmDemoPlan(); }}
            disabled={demoPlan.length === 0}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:opacity-40 ${AI.fill} ${AI.focus}`}
          >
            <Send className="h-3.5 w-3.5" /> Apply changes
          </button>
        </div>
      </div>
    </>
  );
}

function PlanRow({
  item, picking, onPick, onText, onRemove, labelOf,
}: {
  item: DemoPlanItem;
  picking: boolean;
  onPick: () => void;
  onText: (t: string) => void;
  onRemove: () => void;
  labelOf: (id: string) => string;
}) {
  const low = item.confidence !== 'high' || item.targetNodeIds.length === 0;
  if (item.error) {
    return (
      <div data-plan-error className="rounded-xl border border-rose-200 bg-rose-50/50 p-2">
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
            {item.source}
          </span>
          <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-semibold text-rose-700">Skipped</span>
          <button
            onClick={onRemove}
            className="ml-auto rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500"
            title="Drop this change"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
        <p className="mt-1 flex items-start gap-1 text-[12px] text-rose-700">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {item.error}
        </p>
      </div>
    );
  }
  return (
    <div className={'rounded-xl border p-2 ' + (low ? 'border-orange-200 bg-orange-50/40' : 'border-slate-200')}>
      <div className="mb-1 flex items-center gap-1.5">
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
          {item.source}
        </span>
        {item.intent && (
          <span
            data-intent={item.intent.kind}
            className={
              'rounded-full px-1.5 py-0.5 text-[9px] font-semibold ' +
              (item.intent.kind === 'delete' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-800 ring-1 ring-amber-300')
            }
            title={item.intent.kind === 'fill' ? 'Recognised gesture: sent to the model' : 'Recognised gesture: applied directly, without a model call'}
          >
            {intentLabel(item.intent, labelOf)}
          </span>
        )}
        {item.intent?.kind === 'move' && item.intent.source && (
          <span className="text-[9px] text-slate-400" data-move-source={item.intent.source}>
            {item.intent.source === 'selection' ? 'from selection' : 'from arrow tail'}
          </span>
        )}
        <button
          onClick={onPick}
          className={
            'flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-colors ' +
            (picking ? 'bg-amber-400 text-amber-950' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')
          }
          title="Click elements on the canvas to set the target"
        >
          <MapPin className="h-3 w-3" />
          {item.targetNodeIds.length ? `${item.targetNodeIds.length} target${item.targetNodeIds.length === 1 ? '' : 's'}` : 'pick target'}
          {picking && <Check className="h-3 w-3" />}
        </button>
        <button
          onClick={onRemove}
          className="ml-auto rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500"
          title="Drop this change"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {item.targetNodeIds.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {item.targetNodeIds.map((id) => (
            <span key={id} className="truncate rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500">{labelOf(id)}</span>
          ))}
        </div>
      )}
      <div className="flex items-start gap-1.5">
        <Pencil className="mt-1.5 h-3 w-3 shrink-0 text-slate-400" />
        <textarea
          value={item.instruction}
          onChange={(e) => onText(e.target.value)}
          rows={2}
          className={`w-full resize-none rounded-md border border-slate-200 px-2 py-1 text-[12px] outline-none ${AI.fieldFocus}`}
        />
      </div>
      {item.followUp && (
        <p className="mt-1 text-[10px] text-slate-500">
          Moved directly, then sent to the model: <span className="italic">“{item.followUp}”</span>
        </p>
      )}
      {(item.images?.length ?? 0) > 0 && (
        <div className="mt-1 flex gap-1">
          {item.images!.map((src, i) => (
            <img key={i} src={src} alt="" className="h-8 w-8 rounded border border-slate-200 object-cover" />
          ))}
        </div>
      )}
    </div>
  );
}

/** Target pins drawn inside the stage so they stay aligned to the canvas. */
function StagePins({
  boxes, demoPlan, picking,
}: {
  stageRef: React.RefObject<HTMLDivElement | null>;
  boxes: Record<string, Box>;
  demoPlan: DemoPlanItem[];
  picking: string | null;
}) {
  // Map node id → whether it belongs to the row being edited (highlight).
  const activeIds = new Set(demoPlan.find((p) => p.id === picking)?.targetNodeIds ?? []);
  const allIds = Array.from(new Set(demoPlan.flatMap((p) => p.targetNodeIds)));
  return (
    <>
      {allIds.map((id) => {
        const b = boxes[id];
        if (!b) return null;
        const hot = activeIds.has(id);
        return (
          <div key={id} className="pointer-events-none absolute z-30" style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
            <div
              className={'absolute inset-0 rounded ' + (hot ? 'outline outline-2 outline-amber-500' : 'outline-dashed outline-2 outline-amber-400/80')}
              style={{ outlineOffset: 2 }}
            />
            <MapPin className="absolute -left-1 -top-5 h-4 w-4 text-amber-800 drop-shadow-sm" fill={hot ? AI_ACCENT : AI_ACCENT_FILL} />
          </div>
        );
      })}
    </>
  );
}
