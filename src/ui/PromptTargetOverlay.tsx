import { useLayoutEffect, useState, type RefObject } from 'react';
import { Plus, X } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import type { PromptRef } from '@/ir/types';

/**
 * Overlay drawn inside the canvas stage. It puts a primary-indigo border (with
 * the element's letter ID, matching its chat chip) on every element the current
 * prompt refers to, and a removable pin wherever a here/there location chip
 * points. Node boxes are measured from the live DOM so flow-positioned nodes
 * work too; it re-measures whenever the references or the IR change.
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
  letters,
  locations,
  onRemoveLocation,
}: {
  stageRef: RefObject<HTMLDivElement>;
  nodeIds: string[];
  /** nodeId → its letter ID (A, B, …), mirrored on the chat chip. */
  letters: Record<string, string>;
  locations: LocationRef[];
  onRemoveLocation?: (refId: string) => void;
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
            outline: '2px solid #4f46e5',
            outlineOffset: 2,
          }}
        >
          <span className="absolute -top-[18px] left-0 grid h-4 min-w-[16px] place-items-center rounded-full bg-indigo-600 px-1 text-[9px] font-bold text-white shadow-sm">
            {letters[b.id] ?? '•'}
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
            <span className="mb-0.5 flex items-center gap-1 whitespace-nowrap rounded-full bg-indigo-600 px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-sm">
              {loc.label}
              {onRemoveLocation && (
                <button
                  onClick={() => onRemoveLocation(loc.refId)}
                  aria-label="Remove pin"
                  className="pointer-events-auto -mr-0.5 opacity-80 hover:opacity-100"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </span>
            <Plus className="h-4 w-4 text-indigo-600 drop-shadow" strokeWidth={3} />
          </div>
        </div>
      ))}
    </div>
  );
}
