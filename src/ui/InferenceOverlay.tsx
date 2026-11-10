import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Sparkles, X, Check, Eraser, Image as ImageIcon, LayoutTemplate } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import type { ComponentInference } from '@/ir/types';

type Box = { x: number; y: number; w: number; h: number };

/** Grace period before the hover controls hide once the pointer leaves. */
const HIDE_DELAY_MS = 280;
/** Slack around the host box that still counts as hovering it. */
const HIT_PAD = 6;
/** Generous footprint of the controls strip under the host (gap included). */
const CONTROLS_W = 260;
const CONTROLS_H = 36;

/**
 * Component-inference layer (prompt-by-demonstration, part A). When a shape is
 * drawn we guess the UI component it represents; this overlay surfaces that as:
 *  - a small sparkle bubble pinned to the shape's corner (a "suggestions" badge),
 *  - a popover of the top-3 candidate components on click, and
 *  - once a component is chosen, a hovering button group to leave the host empty
 *    or complete it with neutral placeholder content. It only appears while the
 *    pointer is over the component (or the controls themselves, with a short
 *    grace delay bridging the gap), or while keyboard focus is inside it.
 * Choosing a component accepts the proposal: the bubble and popover go away and
 * the variation can still be changed from the spec pane (clause sparkle icon /
 * alternatives menu), which rebuilds the wireframe in the current fill mode.
 * Everything is positioned in stage coordinates so it scrolls with the canvas.
 */
export function InferenceOverlay({ stageRef }: { stageRef: React.RefObject<HTMLDivElement | null> }) {
  const inferences = useAppStore((s) => s.inferences);
  const ir = useAppStore((s) => s.ir);
  const chooseComponent = useAppStore((s) => s.chooseComponent);
  const revertWireframe = useAppStore((s) => s.revertWireframe);
  const fillWireframePlaceholders = useAppStore((s) => s.fillWireframePlaceholders);
  const dismissInference = useAppStore((s) => s.dismissInference);
  const [openId, setOpenId] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  // Component whose wireframe controls are shown (pointer over host or controls).
  const [hoverId, setHoverId] = useState<string | null>(null);

  const active: ComponentInference[] = Object.values(inferences).filter(
    (inf) => inf.status !== 'dismissed' && ir.nodes.some((n) => n.id === inf.nodeId),
  );

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const sr = stage.getBoundingClientRect();
    const next: Record<string, Box> = {};
    for (const inf of active) {
      const el = stage.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(inf.nodeId)}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      next[inf.nodeId] = { x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height };
    }
    setBoxes(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ir, inferences]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenId(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Hover tracking. The overlay sits above the rendered nodes and doesn't
  // receive their pointer events, so hit-test the stage's pointermove against
  // the measured host boxes. While a component's controls are showing, the
  // strip below it (gap + controls) counts as "inside" too, and leaving starts
  // a short grace timer, so moving from the shape onto the buttons keeps them.
  const chosenIds = active.filter((i) => i.status === 'chosen').map((i) => i.nodeId).join(',');
  const live = useRef({ boxes, hoverId, chosenIds });
  live.current = { boxes, hoverId, chosenIds };
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const hideSoon = () => {
      if (timer || live.current.hoverId === null) return;
      timer = setTimeout(() => { timer = null; setHoverId(null); }, HIDE_DELAY_MS);
    };
    const onMove = (e: PointerEvent) => {
      // Mid-drag (moving/resizing/drawing): keep the canvas uncluttered.
      if (e.buttons !== 0) { cancel(); setHoverId(null); return; }
      const sr = stage.getBoundingClientRect();
      const px = e.clientX - sr.left;
      const py = e.clientY - sr.top;
      const { boxes: bx, hoverId: cur, chosenIds: ids } = live.current;
      let hit: string | null = null;
      let best = Infinity;
      for (const id of ids ? ids.split(',') : []) {
        const b = bx[id];
        if (!b) continue;
        const inHost = px >= b.x - HIT_PAD && px <= b.x + b.w + HIT_PAD && py >= b.y - HIT_PAD && py <= b.y + b.h + HIT_PAD;
        const inBridge =
          id === cur &&
          px >= b.x - HIT_PAD && px <= b.x + Math.max(b.w, CONTROLS_W) + HIT_PAD &&
          py >= b.y + b.h && py <= b.y + b.h + CONTROLS_H + HIT_PAD;
        // The controls strip wins outright; otherwise the innermost host does.
        const area = inBridge ? -1 : b.w * b.h;
        if ((inHost || inBridge) && area < best) { best = area; hit = id; }
      }
      if (hit) { cancel(); if (hit !== cur) setHoverId(hit); }
      else hideSoon();
    };
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerleave', hideSoon);
    return () => {
      cancel();
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerleave', hideSoon);
    };
  }, [stageRef]);

  const stageW = stageRef.current?.clientWidth ?? 960;
  const stageH = stageRef.current?.clientHeight ?? 640;

  return (
    <>
      {active.map((inf) => {
        const box = boxes[inf.nodeId];
        if (!box) return null;
        // Accepted (a component was chosen): no more "change option" bubble here.
        const suggesting = inf.status === 'suggested';
        const open = suggesting && openId === inf.nodeId;
        const POP_W = 224;
        const POP_H = 44 + inf.candidates.length * 44;
        const popLeft = box.x + box.w + 8 + POP_W > stageW ? Math.max(4, box.x - POP_W - 8) : box.x + box.w + 8;
        const popTop = Math.max(4, Math.min(box.y, stageH - POP_H - 8));
        return (
          <Fragment key={inf.nodeId}>
            {/* Suggestions bubble, pinned to the top-right corner of the shape. */}
            {suggesting && (
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenId(open ? null : inf.nodeId);
                }}
                title="Suggested components — click to choose"
                className="absolute z-30 flex h-5 items-center gap-0.5 rounded-full border border-amber-300 bg-amber-50 px-1.5 text-amber-700 shadow-sm transition-colors hover:bg-amber-100"
                style={{ left: Math.max(2, box.x + box.w - 20), top: Math.max(2, box.y - 10) }}
              >
                <Sparkles className="h-3 w-3" />
                <span className="text-[9px] font-bold tabular-nums">{inf.candidates.length}</span>
              </button>
            )}

            {/* Candidate popover. */}
            {open && (
              <div
                onMouseDown={(e) => e.stopPropagation()}
                className="absolute z-40 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg ring-1 ring-black/5"
                style={{ left: popLeft, top: popTop }}
              >
                <div className="flex items-center gap-1 px-1.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  <Sparkles className="h-3 w-3 text-amber-500" />
                  Looks like…
                  <button
                    onClick={() => { dismissInference(inf.nodeId); setOpenId(null); }}
                    className="ml-auto rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    title="Dismiss suggestions"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                {inf.candidates.map((c) => {
                  const chosen = inf.chosen === c.label;
                  return (
                    <button
                      key={c.label}
                      onClick={() => { chooseComponent(inf.nodeId, c.label); setOpenId(null); }}
                      className={
                        'flex w-full items-start gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors ' +
                        (chosen ? 'bg-amber-50' : 'hover:bg-slate-50')
                      }
                    >
                      <span className="mt-0.5 h-3 w-3 shrink-0 text-amber-500">{chosen && <Check className="h-3 w-3" />}</span>
                      <span className="min-w-0">
                        <span className="block text-[12px] font-semibold text-slate-800">{c.label}</span>
                        <span className="block truncate text-[10px] text-slate-500">{c.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Wireframe controls, once a component is chosen: shown on hover
                (or keyboard focus); otherwise transparent and click-through. */}
            {inf.status === 'chosen' && (
              <div
                role="toolbar"
                aria-label={`${inf.chosen} wireframe`}
                onMouseDown={(e) => e.stopPropagation()}
                className={
                  'absolute z-30 flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-0.5 shadow-md backdrop-blur transition-opacity duration-150 ' +
                  (hoverId === inf.nodeId
                    ? 'opacity-100'
                    : 'pointer-events-none opacity-0 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100')
                }
                style={{ left: box.x, top: box.y + box.h + 4 }}
              >
                {inf.fill === 'empty' ? (
                  <WireBtn icon={<LayoutTemplate className="h-3 w-3" />} label="Add wireframe" onClick={() => chooseComponent(inf.nodeId, inf.chosen!, 'wireframe')} />
                ) : (
                  <WireBtn icon={<Eraser className="h-3 w-3" />} label="Leave empty" onClick={() => revertWireframe(inf.nodeId)} />
                )}
                {inf.fill === 'placeholder' ? (
                  <WireBtn icon={<LayoutTemplate className="h-3 w-3" />} label="Back to wireframe" onClick={() => chooseComponent(inf.nodeId, inf.chosen!, 'wireframe')} />
                ) : (
                  inf.fill === 'wireframe' && (
                    <WireBtn icon={<ImageIcon className="h-3 w-3" />} label="Fill placeholders" onClick={() => fillWireframePlaceholders(inf.nodeId)} />
                  )
                )}
              </div>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

function WireBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
    >
      {icon}
      {label}
    </button>
  );
}
