import { useLayoutEffect, useState, type RefObject } from 'react';
import { MapPin } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import type { PromptRef } from '@/ir/types';

/**
 * Non-interactive overlay drawn inside the canvas stage. It puts a labeled
 * emerald border on every element the current prompt refers to (DirectGPT
 * "this object is part of your edit") and a pin wherever a here/there location
 * chip points. Node boxes are measured from the live DOM so flow-positioned
 * nodes work too; it re-measures whenever the references or the IR change.
 */
interface Box {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

type LocationRef = Extract<PromptRef, { kind: 'location' }>;

export function PromptTargetOverlay({
  stageRef,
  nodeIds,
  locations,
}: {
  stageRef: RefObject<HTMLDivElement>;
  nodeIds: string[];
  locations: LocationRef[];
}) {
  const ir = useAppStore((s) => s.ir);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const key = nodeIds.join(',');

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      setBoxes([]);
      return;
    }
    const srect = stage.getBoundingClientRect();
    const seen = new Set<string>();
    const next: Box[] = [];
    for (const id of nodeIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const el = stage.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      next.push({
        id,
        left: r.left - srect.left,
        top: r.top - srect.top,
        width: r.width,
        height: r.height,
      });
    }
    setBoxes(next);
    // ir drives re-measurement after compose moves nodes; key tracks refs.
  }, [key, ir, stageRef]);

  if (boxes.length === 0 && locations.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {boxes.map((b) => (
        <div
          key={b.id}
          className="absolute rounded-[3px]"
          style={{
            left: b.left,
            top: b.top,
            width: b.width,
            height: b.height,
            outline: '2px solid #10b981',
            outlineOffset: 2,
          }}
        >
          <span className="absolute -top-[18px] left-0 whitespace-nowrap rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-sm">
            in your prompt
          </span>
        </div>
      ))}

      {locations.map((loc) => (
        <div
          key={loc.refId}
          className="absolute -translate-x-1/2 -translate-y-full"
          style={{ left: loc.x, top: loc.y }}
        >
          <div className="flex flex-col items-center">
            <span className="mb-0.5 whitespace-nowrap rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-sm">
              here
            </span>
            <MapPin className="h-4 w-4 text-amber-500 drop-shadow" fill="#f59e0b" />
          </div>
        </div>
      ))}
    </div>
  );
}
