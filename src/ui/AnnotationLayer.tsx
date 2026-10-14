import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Trash2, X, ImagePlus } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import type { Annotation } from '@/ir/types';
import { scribbleStrokes } from '@/annot/resolve';

/**
 * Annotation layer (prompt-by-demonstration, part B). Renders the rough markup
 * the user draws on the canvas to instruct the model: arrows, surrounding boxes,
 * freehand scribbles, and pinned text comments. Comments open to an overlay
 * editor on hover (with image drag-and-drop) and collapse back to a small bubble
 * on mouse-out. Coordinates are stage-relative so the markup scrolls with the
 * canvas. The drawings themselves are created in Canvas's mouse handlers.
 */
const INK = '#6366f1'; // indigo-500 — reads as "markup", distinct from UI + selection

export function AnnotationLayer({ stageRef }: { stageRef: React.RefObject<HTMLDivElement | null> }) {
  const annotations = useAppStore((s) => s.annotations);
  const updateAnnotation = useAppStore((s) => s.updateAnnotation);
  const removeAnnotation = useAppStore((s) => s.removeAnnotation);
  const [openId, setOpenId] = useState<string | null>(null);
  const prevCount = useRef(annotations.length);

  // Auto-open a freshly placed comment for immediate typing.
  useEffect(() => {
    if (annotations.length > prevCount.current) {
      const last = annotations[annotations.length - 1];
      if (last?.kind === 'comment') setOpenId(last.id);
    }
    prevCount.current = annotations.length;
  }, [annotations]);

  const drawings = annotations.filter((a) => a.kind !== 'comment');
  const comments = annotations.filter((a) => a.kind === 'comment');
  const stageW = stageRef.current?.clientWidth ?? 960;
  const stageH = stageRef.current?.clientHeight ?? 640;

  return (
    <>
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <marker id="annot-arrowhead" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L7,3 L0,6 Z" fill={INK} />
          </marker>
        </defs>
        {drawings.map((a) => (
          <AnnotationShape key={a.id} a={a} />
        ))}
      </svg>

      {/* Delete handle for each drawing (top-left of its bounds). */}
      {drawings.map((a) => {
        const b = shapeBounds(a);
        if (!b) return null;
        return (
          <button
            key={`del-${a.id}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); removeAnnotation(a.id); }}
            title="Remove annotation"
            className="absolute z-30 flex h-4 w-4 items-center justify-center rounded-full border border-indigo-200 bg-white text-indigo-500 shadow-sm hover:bg-indigo-50"
            style={{ left: b.x - 8, top: b.y - 8 }}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        );
      })}

      {comments.map((a) => (
        <CommentBubble
          key={a.id}
          a={a}
          open={openId === a.id}
          stageW={stageW}
          stageH={stageH}
          onOpen={() => setOpenId(a.id)}
          onClose={() => setOpenId((id) => (id === a.id ? null : id))}
          onChange={(patch) => updateAnnotation(a.id, patch)}
          onRemove={() => { removeAnnotation(a.id); setOpenId(null); }}
        />
      ))}
    </>
  );
}

function AnnotationShape({ a }: { a: Annotation }) {
  if (a.kind === 'arrow' && a.points && a.points.length >= 2) {
    const p0 = a.points[0];
    const p1 = a.points[a.points.length - 1];
    return (
      <line
        x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y}
        stroke={INK} strokeWidth={2.5} strokeLinecap="round"
        markerEnd="url(#annot-arrowhead)"
      />
    );
  }
  if (a.kind === 'box' && a.rect) {
    return (
      <rect
        x={a.rect.x} y={a.rect.y} width={a.rect.w} height={a.rect.h}
        fill={INK} fillOpacity={0.06} stroke={INK} strokeWidth={2}
        strokeDasharray="6 4" rx={6}
      />
    );
  }
  if (a.kind === 'scribble') {
    // One polyline per stroke, so separate strokes are never joined up.
    const strokes = scribbleStrokes(a).filter((s) => s.length >= 2);
    if (strokes.length === 0) return null;
    return (
      <g data-annotation-id={a.id} data-stroke-count={strokes.length}>
        {strokes.map((s, i) => (
          <polyline
            key={i}
            points={s.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none" stroke={INK} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
          />
        ))}
      </g>
    );
  }
  return null;
}

function shapeBounds(a: Annotation): { x: number; y: number; w: number; h: number } | null {
  if (a.rect) return a.rect;
  const pts = a.kind === 'scribble' ? scribbleStrokes(a).flat() : a.points ?? [];
  if (pts.length) {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return null;
}

function CommentBubble({
  a, open, stageW, stageH, onOpen, onClose, onChange, onRemove,
}: {
  a: Annotation;
  open: boolean;
  stageW: number;
  stageH: number;
  onOpen: () => void;
  onClose: () => void;
  onChange: (patch: Partial<Annotation>) => void;
  onRemove: () => void;
}) {
  const anchor = a.anchor ?? { x: 0, y: 0 };
  const focused = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (open) taRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const addImages = (files: FileList | null) => {
    if (!files) return;
    Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .forEach((f) => {
        const reader = new FileReader();
        reader.onload = () => {
          const url = String(reader.result);
          onChange({ images: [...(a.images ?? []), url] });
        };
        reader.readAsDataURL(f);
      });
  };

  if (!open) {
    const hasText = Boolean(a.text?.trim());
    const count = (a.images?.length ?? 0) + (hasText ? 1 : 0);
    return (
      <button
        onMouseEnter={onOpen}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        title={a.text || 'Comment'}
        className="absolute z-30 flex h-6 items-center gap-1 rounded-full rounded-bl-none border border-indigo-300 bg-indigo-500 px-1.5 text-white shadow-md transition-transform hover:scale-105"
        style={{ left: anchor.x, top: anchor.y - 24 }}
      >
        <MessageSquare className="h-3 w-3" />
        {count > 0 && <span className="text-[9px] font-bold tabular-nums">{count}</span>}
      </button>
    );
  }

  const CARD_W = 224;
  const CARD_H = (a.images?.length ?? 0) > 0 ? 220 : 150;
  const cardLeft = Math.max(4, Math.min(anchor.x, stageW - CARD_W - 8));
  const cardTop = Math.max(4, Math.min(anchor.y - 8, stageH - CARD_H - 8));

  return (
    <div
      ref={cardRef}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseLeave={() => { if (!focused.current) onClose(); }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); addImages(e.dataTransfer.files); }}
      className={
        'absolute z-40 w-56 rounded-xl border bg-white p-2 shadow-xl ring-1 ring-black/5 ' +
        (dragOver ? 'border-indigo-400' : 'border-indigo-200')
      }
      style={{ left: cardLeft, top: cardTop }}
    >
      <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-indigo-500">
        <MessageSquare className="h-3 w-3" /> Note
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="ml-auto rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500"
          title="Delete note"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <textarea
        ref={taRef}
        value={a.text ?? ''}
        onChange={(e) => onChange({ text: e.target.value })}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; }}
        placeholder="Describe the change… (drop images for context)"
        rows={2}
        className="w-full resize-none rounded-md border border-slate-200 px-2 py-1 text-[12px] outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50"
      />
      {(a.images?.length ?? 0) > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {a.images!.map((src, i) => (
            <span key={i} className="group relative">
              <img src={src} alt="" className="h-10 w-10 rounded border border-slate-200 object-cover" />
              <button
                onClick={(e) => { e.stopPropagation(); onChange({ images: a.images!.filter((_, j) => j !== i) }); }}
                className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-900 text-white group-hover:flex"
                title="Remove image"
              >
                <X className="h-2 w-2" />
              </button>
            </span>
          ))}
        </div>
      )}
      <label className="mt-1.5 flex cursor-pointer items-center gap-1 text-[10px] text-slate-400 hover:text-indigo-500">
        <ImagePlus className="h-3 w-3" /> Add image
        <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addImages(e.target.files)} />
      </label>
    </div>
  );
}
