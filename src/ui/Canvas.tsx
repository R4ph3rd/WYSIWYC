import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles, Keyboard, X } from 'lucide-react';
import { useAppStore, toolToRole } from '@/store/appStore';
import { Renderer } from '@/render/Renderer';
import { siblingsOf } from '@/ir/tree';
import type { ComposerValue, IR, IRNode, PathPoint } from '@/ir/types';
import { SAMPLES } from '@/ir/samples';
import { composerIsEmpty, composerRefs, emptyComposer, removeRef, serializeComposer } from '@/lib/composer';
import { cn } from '@/lib/utils';
import { ToolPalette } from './ToolPalette';
import { RefComposer } from './RefComposer';
import { PromptTargetOverlay } from './PromptTargetOverlay';

type DragState =
  | { mode: 'draw'; id: string; role: IRNode['role']; startX: number; startY: number; prevIR: IR }
  | { mode: 'move'; id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean; prevIR: IR }
  | {
      mode: 'resize';
      id: string;
      handle: 'nw' | 'ne' | 'sw' | 'se';
      startX: number;
      startY: number;
      orig: { x: number; y: number; w: number; h: number };
      prevIR: IR;
    };

interface PenState {
  points: PathPoint[]; // stage coordinates
  prevIR: IR;
}

/** Roles whose text content is editable inline by double-clicking on the canvas. */
const TEXT_EDIT_ROLES: IRNode['role'][] = ['text', 'heading', 'button', 'badge', 'icon'];

/** Default footprint when a drawing tool is clicked without dragging. */
const CLICK_SIZE: Partial<Record<IRNode['role'], { w: number; h: number }>> = {
  rectangle: { w: 96, h: 96 },
  circle: { w: 96, h: 96 },
  line: { w: 120, h: 24 },
};

export function Canvas() {
  const ir = useAppStore((s) => s.ir);
  const prompt = useAppStore((s) => s.prompt);
  const tool = useAppStore((s) => s.tool);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const selectedNodeIds = useAppStore((s) => s.selectedNodeIds);
  const composerFocused = useAppStore((s) => s.composerFocused);
  const composerValue = useAppStore((s) => s.composerValue);
  const hoveredClauseId = useAppStore((s) => s.hoveredClauseId);
  const recentIds = useAppStore((s) => s.recentIds);
  const generating = useAppStore((s) => s.generating);
  const selectNode = useAppStore((s) => s.selectNode);
  const toggleSelection = useAppStore((s) => s.toggleSelection);
  const addComposerNodeRef = useAppStore((s) => s.addComposerNodeRef);
  const addComposerLocationRef = useAppStore((s) => s.addComposerLocationRef);
  const setTool = useAppStore((s) => s.setTool);
  const requestFocus = useAppStore((s) => s.requestFocus);
  const focusRequest = useAppStore((s) => s.focusRequest);
  const editContent = useAppStore((s) => s.editContent);
  const duplicateNode = useAppStore((s) => s.duplicateNode);
  const setComposerValue = useAppStore((s) => s.setComposerValue);
  const shortcutsOpen = useAppStore((s) => s.shortcutsOpen);
  const setShortcutsOpen = useAppStore((s) => s.setShortcutsOpen);
  const unknownShortcutAt = useAppStore((s) => s.unknownShortcutAt);
  const irSyncMode = useAppStore((s) => s.irSyncMode);
  const setIrSyncMode = useAppStore((s) => s.setIrSyncMode);

  // Composing context: the canvas feeds the single composer when the user is
  // mid-prompt (focused, or a draft exists). Clicking an element then refers to
  // it; clicking empty space while the draft says "here"/"there" drops a pin.
  const isComposing = composerFocused || !composerIsEmpty(composerValue);
  const draftText = serializeComposer(composerValue).text;
  const wantsLocation = /\b(here|there)\b/i.test(draftText);
  const promptRefs = composerRefs(composerValue);
  const referencedNodeIds = promptRefs.flatMap((r) => ('nodeId' in r && r.nodeId ? [r.nodeId] : []));
  const locationRefs = promptRefs.flatMap((r) => (r.kind === 'location' ? [r] : []));
  // Letter IDs (A, B, …) for node chips, shown on the canvas overlay too.
  const nodeLetters: Record<string, string> = {};
  promptRefs
    .filter((r) => r.kind === 'node')
    .forEach((r, i) => { if ('nodeId' in r && r.nodeId) nodeLetters[r.nodeId] = String.fromCharCode(65 + i); });
  const setComputedBounds = useAppStore((s) => s.setComputedBounds);
  const manipulate = useAppStore((s) => s.manipulate);
  const proposeManipulation = useAppStore((s) => s.proposeManipulation);
  const createShape = useAppStore((s) => s.createShape);
  const updateLayout = useAppStore((s) => s.updateLayout);

  const stageRef = useRef<HTMLDivElement>(null);
  // Set when a move/resize drag actually moved, to swallow the synthetic click
  // the browser fires afterwards (which would otherwise add a stray ref chip).
  const draggedRef = useRef(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pen, setPen] = useState<PenState | null>(null);
  const [penCursor, setPenCursor] = useState<PathPoint | null>(null);
  // Inline canvas text editing (double-click a text node). Holds the node id
  // plus its measured box (relative to the stage) for the overlay textarea.
  const [editingText, setEditingText] = useState<
    { id: string; left: number; top: number; width: number; height: number } | null
  >(null);
  // Mirror for event listeners (keydown) that outlive a render's closure.
  const penRef = useRef<PenState | null>(null);
  penRef.current = pen;

  // Canvas hand-off: a double-click mid-draft pulls focus back to the canvas
  // (blurring the composer). Element/location clicks request 'composer' focus,
  // handled by the prompt composer; here we only honor 'canvas'.
  useEffect(() => {
    if (focusRequest?.target === 'canvas') stageRef.current?.focus();
  }, [focusRequest?.seq, focusRequest?.target]);

  // Measure the selected node's DOM bounds (relative to its parent element) and
  // write them to the store so the Properties panel can display them even for
  // flow nodes that have no stored layout.x/y/w/h.
  useEffect(() => {
    if (!selectedNodeId) { setComputedBounds(null); return; }
    const stage = stageRef.current;
    if (!stage) return;
    const el = stage.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(selectedNodeId)}"]`);
    if (!el) { setComputedBounds(null); return; }
    const parentEl = el.offsetParent as HTMLElement | null;
    const elRect = el.getBoundingClientRect();
    if (parentEl) {
      const parentRect = parentEl.getBoundingClientRect();
      setComputedBounds({
        x: Math.round(elRect.left - parentRect.left),
        y: Math.round(elRect.top - parentRect.top),
        w: Math.round(elRect.width),
        h: Math.round(elRect.height),
      });
    } else {
      const stageRect = stage.getBoundingClientRect();
      setComputedBounds({
        x: Math.round(elRect.left - stageRect.left),
        y: Math.round(elRect.top - stageRect.top),
        w: Math.round(elRect.width),
        h: Math.round(elRect.height),
      });
    }
  // Remeasure after any re-render (IR change) or selection change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, ir]);

  // Surface the "unbound shortcut" hint for a few seconds after it is flagged.
  const [hintVisible, setHintVisible] = useState(false);
  useEffect(() => {
    if (!unknownShortcutAt) return;
    setHintVisible(true);
    const t = setTimeout(() => setHintVisible(false), 6000);
    return () => clearTimeout(t);
  }, [unknownShortcutAt]);

  const role = toolToRole(tool);
  const drawing = Boolean(role) || tool === 'path';
  // The Lovable-style hero greets an empty project — but steps aside the
  // moment a drawing tool is picked, so starting by hand is always possible.
  const isEmpty = ir.nodes.length === 0 && prompt.clauses.length === 0 && !drawing;

  function nodeById(id: string): IRNode | undefined {
    return useAppStore.getState().ir.nodes.find((n) => n.id === id);
  }

  /** Begin inline editing of a text-bearing node, measured against the stage. */
  function startTextEdit(id: string): void {
    const stage = stageRef.current;
    if (!stage) return;
    const el = stage.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
    if (!el) return;
    const sr = stage.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    selectNode(id);
    setEditingText({
      id,
      left: r.left - sr.left,
      top: r.top - sr.top,
      width: Math.max(40, r.width),
      height: Math.max(20, r.height),
    });
  }

  function relativePoint(e: React.MouseEvent): PathPoint | null {
    const el = stageRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** The rendered node whose center is closest to a stage point (for here/there). */
  function nearestNodeId(p: PathPoint): string | undefined {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const srect = stage.getBoundingClientRect();
    let best: string | undefined;
    let bestD = Infinity;
    stage.querySelectorAll<HTMLElement>('[data-node-id]').forEach((el) => {
      const r = el.getBoundingClientRect();
      const cx = r.left - srect.left + r.width / 2;
      const cy = r.top - srect.top + r.height / 2;
      const d = Math.hypot(cx - p.x, cy - p.y);
      if (d < bestD) {
        bestD = d;
        best = el.dataset.nodeId;
      }
    });
    return best;
  }

  // --- Pen tool (multi-click path) ----------------------------------------

  function commitPen(cancel: boolean): void {
    const current = penRef.current;
    setPen(null);
    setPenCursor(null);
    setTool('pointer');
    if (cancel || !current || current.points.length < 2) return;
    // Drop duplicate anchors left by the double-click that commits.
    const pts = current.points.filter(
      (p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y) > 2,
    );
    if (pts.length < 2) return;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const w = Math.max(2, Math.max(...xs) - x);
    const h = Math.max(2, Math.max(...ys) - y);
    const id = createShape({
      role: 'path',
      x, y, w, h,
      points: pts.map((p) => ({ x: p.x - x, y: p.y - y })),
    });
    proposeManipulation({ kind: 'draw', id, role: 'path', layout: { x, y, w, h } }, current.prevIR);
  }

  useEffect(() => {
    if (!pen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') commitPen(false);
      if (e.key === 'Escape') commitPen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pen !== null]);

  // --- Stage mouse handling -------------------------------------------------

  function onStageMouseDown(e: React.MouseEvent) {
    const p = relativePoint(e);
    if (!p) return;
    // Every fresh press starts a clean gesture; a real move will re-arm this.
    draggedRef.current = false;

    if (tool === 'path') {
      e.preventDefault();
      setPen((current) =>
        current
          ? { ...current, points: [...current.points, p] }
          : { points: [p], prevIR: useAppStore.getState().ir },
      );
      return;
    }

    if (role) {
      e.preventDefault();
      e.stopPropagation();
      const prevIR = useAppStore.getState().ir;
      const defaultSize = role === 'text' ? { w: 120, h: 28 } : { w: 2, h: 2 };
      const id = createShape({ role, x: p.x, y: p.y, ...defaultSize });
      setDrag({ mode: 'draw', id, role, startX: p.x, startY: p.y, prevIR });
      return;
    }

    // Pointer tool: start a move-drag when pressing an absolute-positioned
    // node (drawn shapes). Flow nodes keep HTML5 drag-to-reorder.
    const target = (e.target as HTMLElement).closest('[data-node-id]');
    const id = target?.getAttribute('data-node-id');
    const node = id ? nodeById(id) : undefined;
    if (node && node.layout?.x !== undefined && node.layout?.y !== undefined) {
      e.preventDefault();
      const origX = node.layout.x;
      const origY = node.layout.y;
      // Alt-drag duplicates: clone the node onto its own position and drag the
      // copy, leaving the original in place (Figma convention).
      let dragId = node.id;
      if (e.altKey) {
        const dup = duplicateNode(node.id);
        if (dup) {
          updateLayout(dup, { x: origX, y: origY });
          dragId = dup;
        }
      } else {
        selectNode(node.id);
      }
      setDrag({
        mode: 'move',
        id: dragId,
        startX: p.x,
        startY: p.y,
        origX,
        origY,
        moved: false,
        prevIR: useAppStore.getState().ir,
      });
    }
  }

  function onStageMouseMove(e: React.MouseEvent) {
    const p = relativePoint(e);
    if (!p) return;
    if (pen) setPenCursor(p);
    if (!drag) return;

    if (drag.mode === 'draw') {
      const x = Math.min(p.x, drag.startX);
      const y = Math.min(p.y, drag.startY);
      const w = Math.max(2, Math.abs(p.x - drag.startX));
      const h = Math.max(2, Math.abs(p.y - drag.startY));
      updateLayout(drag.id, { x, y, w, h });
    } else if (drag.mode === 'move') {
      const dx = p.x - drag.startX;
      const dy = p.y - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) > 3) setDrag({ ...drag, moved: true });
      updateLayout(drag.id, { x: Math.round(drag.origX + dx), y: Math.round(drag.origY + dy) });
    } else {
      const dx = p.x - drag.startX;
      const dy = p.y - drag.startY;
      const { orig, handle } = drag;
      let { x, y, w, h } = orig;
      if (handle.includes('e')) w = orig.w + dx;
      if (handle.includes('s')) h = orig.h + dy;
      if (handle.includes('w')) { w = orig.w - dx; x = orig.x + dx; }
      if (handle.includes('n')) { h = orig.h - dy; y = orig.y + dy; }
      if (w < 8) { if (handle.includes('w')) x = orig.x + orig.w - 8; w = 8; }
      if (h < 8) { if (handle.includes('n')) y = orig.y + orig.h - 8; h = 8; }
      updateLayout(drag.id, {
        x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h),
      });
    }
  }

  function onStageMouseUp() {
    if (!drag) return;
    const node = nodeById(drag.id);
    // A move/resize that actually changed geometry should swallow the trailing
    // click so it doesn't get read as a "refer to this element" tap.
    if ((drag.mode === 'move' && drag.moved) || drag.mode === 'resize') {
      draggedRef.current = true;
    }
    setDrag(null);

    if (drag.mode === 'draw') {
      setTool('pointer');
      if (!node) return;
      let layout = node.layout ?? {};
      // A click without a drag: give the shape a sensible default footprint.
      const clickSize = CLICK_SIZE[drag.role];
      if (clickSize && (layout.w ?? 0) <= 4 && (layout.h ?? 0) <= 4) {
        updateLayout(drag.id, clickSize);
        layout = { ...layout, ...clickSize };
      }
      proposeManipulation(
        { kind: 'draw', id: drag.id, role: drag.role, layout },
        drag.prevIR,
      );
    } else if (drag.mode === 'move') {
      if (!node || !drag.moved) return;
      proposeManipulation(
        {
          kind: 'move',
          id: drag.id,
          from: { x: drag.origX, y: drag.origY },
          to: { x: node.layout?.x ?? 0, y: node.layout?.y ?? 0 },
        },
        drag.prevIR,
      );
    } else {
      if (!node) return;
      proposeManipulation(
        {
          kind: 'resize',
          id: drag.id,
          from: { ...drag.orig },
          to: {
            x: node.layout?.x ?? 0,
            y: node.layout?.y ?? 0,
            w: node.layout?.w ?? 0,
            h: node.layout?.h ?? 0,
          },
        },
        drag.prevIR,
      );
    }
  }

  function startResize(e: React.MouseEvent, handle: 'nw' | 'ne' | 'sw' | 'se') {
    const node = selectedNodeId ? nodeById(selectedNodeId) : undefined;
    const p = relativePoint(e);
    if (!node || !p || node.layout?.x === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    setDrag({
      mode: 'resize',
      id: node.id,
      handle,
      startX: p.x,
      startY: p.y,
      orig: {
        x: node.layout.x,
        y: node.layout.y ?? 0,
        w: node.layout.w ?? 80,
        h: node.layout.h ?? 80,
      },
      prevIR: useAppStore.getState().ir,
    });
  }

  const onReorder = (draggedId: string, targetId: string) => {
    const dragged = ir.nodes.find((n) => n.id === draggedId);
    const target = ir.nodes.find((n) => n.id === targetId);
    if (!dragged || !target || dragged.parentId !== target.parentId) return;
    const sibs = siblingsOf(ir, draggedId);
    const from = sibs.findIndex((n) => n.id === draggedId);
    const to = sibs.findIndex((n) => n.id === targetId);
    if (from === -1 || to === -1 || from === to) return;
    manipulate({ kind: 'reorder', id: draggedId, parentId: dragged.parentId, from, to });
  };

  const selectedNode = selectedNodeId ? ir.nodes.find((n) => n.id === selectedNodeId) : undefined;
  const showHandles =
    tool === 'pointer' &&
    selectedNode?.layout?.x !== undefined &&
    selectedNode?.layout?.y !== undefined;

  return (
    <div className="relative flex-1 overflow-hidden bg-[var(--workbench-bg)]">
      {/* Sync mode toggle: bottom-right, horizontal, aligned with the tool palette. */}
      <div
        className="absolute bottom-4 right-3 z-20 flex flex-row rounded-md border border-slate-200 bg-white/95 p-0.5 text-[10px] shadow-sm backdrop-blur"
        title="How canvas edits update the spec"
      >
        {(['auto', 'manual'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setIrSyncMode(m)}
            className={cn(
              'rounded px-2 py-0.5 font-medium capitalize transition-colors',
              irSyncMode === m ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100',
            )}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Floating tool palette (bottom center) */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
        <div className="pointer-events-auto">
          <ToolPalette />
        </div>
      </div>

      {/* Unbound-shortcut hint: click to open the full shortcut sheet. */}
      {hintVisible && !shortcutsOpen && (
        <button
          onClick={() => { setShortcutsOpen(true); setHintVisible(false); }}
          className="absolute bottom-16 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-900/90 px-3 py-1.5 text-[11px] text-white shadow-lg backdrop-blur transition hover:bg-slate-900"
        >
          <Keyboard className="h-3.5 w-3.5" />
          That shortcut isn’t bound — see all shortcuts
        </button>
      )}

      <ShortcutsSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {generating && !isEmpty && (
        <div className="absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs text-slate-600 shadow">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Composing…
        </div>
      )}

      {pen && (
        <div className="absolute bottom-16 left-1/2 z-20 -translate-x-1/2 rounded-full bg-slate-900/85 px-3 py-1 text-[11px] text-white shadow">
          Click to add points — double-click or ⏎ to finish, Esc to cancel
        </div>
      )}

      <div
        className="h-full overflow-auto p-6"
        onClick={(e) => {
          if (e.target === e.currentTarget) selectNode(null);
        }}
      >
        <div
          ref={stageRef}
          tabIndex={-1}
          className="relative mx-auto min-h-full w-full max-w-5xl overflow-hidden rounded-xl shadow-sm outline-none ring-1 ring-black/5"
          style={{
            background: ir.canvas.background,
            cursor: drawing ? 'crosshair' : 'default',
          }}
          onClick={(e) => {
            if (e.target !== e.currentTarget || drawing) return;
            // "here"/"there" + click on empty canvas → capture the point as a
            // location reference rather than clearing the selection.
            if (isComposing && wantsLocation) {
              const p = relativePoint(e);
              if (p) {
                addComposerLocationRef(p.x, p.y, nearestNodeId(p));
                // The pin dropped — return focus to the prompt to keep typing.
                requestFocus('composer');
                return;
              }
            }
            selectNode(null);
          }}
          onDoubleClick={(e) => {
            if (pen) { commitPen(false); return; }
            // Double-clicking a text node edits its content inline.
            if (tool === 'pointer') {
              const el = (e.target as HTMLElement).closest('[data-node-id]');
              const id = el?.getAttribute('data-node-id');
              const node = id ? nodeById(id) : undefined;
              if (node && TEXT_EDIT_ROLES.includes(node.role)) {
                startTextEdit(node.id);
                return;
              }
            }
            // Otherwise a double-click mid-draft means "I want the canvas now" —
            // hand focus back to it instead of the prompt composer.
            if (isComposing) requestFocus('canvas');
          }}
          onMouseDown={onStageMouseDown}
          onMouseMove={onStageMouseMove}
          onMouseUp={onStageMouseUp}
          onMouseLeave={onStageMouseUp}
        >
          <Renderer
            ir={ir}
            selectedId={selectedNodeId}
            selectedIds={selectedNodeIds}
            scopeIds={composerFocused ? selectedNodeIds : []}
            hoveredClauseId={hoveredClauseId}
            recentIds={recentIds}
            onSelect={
              drawing
                ? undefined
                : (id, additive) => {
                    // Ignore the synthetic click that follows a reposition drag.
                    if (draggedRef.current) {
                      draggedRef.current = false;
                      return;
                    }
                    // Mid-prompt, a click also refers to the element (DirectGPT
                    // "this"/"it" binding) by dropping a chip into the composer,
                    // then returns focus to the prompt so the user keeps typing.
                    if (isComposing) {
                      addComposerNodeRef(id);
                      requestFocus('composer');
                    }
                    if (additive) toggleSelection(id);
                    else selectNode(id);
                  }
            }
            onReorder={drawing ? undefined : onReorder}
          />

          {/* Labeled borders on elements referred to by the prompt + here/there pins. */}
          <PromptTargetOverlay
            stageRef={stageRef}
            nodeIds={referencedNodeIds}
            letters={nodeLetters}
            locations={locationRefs}
            onRemoveLocation={(refId) => {
              // Removing a pin must not blur the composer — keep typing.
              setComposerValue(removeRef(useAppStore.getState().composerValue, refId));
              requestFocus('composer');
            }}
          />

          {/* Inline text editor (double-click a text node). */}
          {editingText && (
            <textarea
              autoFocus
              defaultValue={nodeById(editingText.id)?.content ?? ''}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => {
                editContent(editingText.id, e.target.value);
                setEditingText(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  editContent(editingText.id, (e.target as HTMLTextAreaElement).value);
                  setEditingText(null);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditingText(null);
                }
              }}
              style={{
                position: 'absolute',
                left: editingText.left,
                top: editingText.top,
                width: editingText.width,
                minHeight: editingText.height,
              }}
              className="z-30 resize-none overflow-hidden rounded-sm bg-white/95 px-1 py-0.5 text-inherit leading-tight text-slate-900 shadow-[0_0_0_2px_#4f46e5] outline-none"
            />
          )}

          {/* Pen preview: committed segments + rubber band to the cursor. */}
          {pen && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
              <polyline
                points={[...pen.points, ...(penCursor ? [penCursor] : [])]
                  .map((p) => `${p.x},${p.y}`)
                  .join(' ')}
                fill="none"
                stroke="#4f46e5"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {pen.points.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={3} fill="#fff" stroke="#4f46e5" strokeWidth={1.5} />
              ))}
            </svg>
          )}

          {/* Resize handles for the selected drawn shape. */}
          {showHandles && selectedNode?.layout && (
            <SelectionHandles layout={selectedNode.layout} onStart={startResize} />
          )}

          {isEmpty && <HeroComposer />}
        </div>
      </div>
    </div>
  );
}

function SelectionHandles({
  layout,
  onStart,
}: {
  layout: { x?: number; y?: number; w?: number; h?: number };
  onStart: (e: React.MouseEvent, handle: 'nw' | 'ne' | 'sw' | 'se') => void;
}) {
  const x = layout.x ?? 0;
  const y = layout.y ?? 0;
  const w = layout.w ?? 80;
  const h = layout.h ?? 80;
  const handles: { id: 'nw' | 'ne' | 'sw' | 'se'; left: number; top: number; cursor: string }[] = [
    { id: 'nw', left: x, top: y, cursor: 'nwse-resize' },
    { id: 'ne', left: x + w, top: y, cursor: 'nesw-resize' },
    { id: 'sw', left: x, top: y + h, cursor: 'nesw-resize' },
    { id: 'se', left: x + w, top: y + h, cursor: 'nwse-resize' },
  ];
  return (
    <>
      {handles.map((hd) => (
        <div
          key={hd.id}
          onMouseDown={(e) => onStart(e, hd.id)}
          className="absolute z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-indigo-600 bg-white shadow-sm"
          style={{ left: hd.left, top: hd.top, cursor: hd.cursor }}
        />
      ))}
    </>
  );
}

/** A panel that slides up from the bottom of the canvas listing all shortcuts. */
function ShortcutsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mod =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  const groups: { title: string; items: [string, string][] }[] = [
    {
      title: 'Tools',
      items: [
        ['V', 'Select'], ['R', 'Rectangle'], ['O', 'Circle'],
        ['L', 'Line'], ['P', 'Pen'], ['T', 'Text'],
      ],
    },
    {
      title: 'Edit',
      items: [
        [`${mod} Z`, 'Undo'],
        [`${mod} C`, 'Copy'],
        [`${mod} V`, 'Paste'],
        [`${mod} D`, 'Duplicate'],
        ['Alt-drag', 'Duplicate'],
        ['Delete', 'Delete selection'],
      ],
    },
    {
      title: 'Canvas',
      items: [
        ['Double-click', 'Edit text'],
        ['Shift-click', 'Add to selection'],
        ['Drag corner', 'Resize'],
        ['Esc', 'Deselect'],
        ['?', 'This sheet'],
      ],
    },
  ];

  return (
    <>
      {open && <div className="absolute inset-0 z-30 bg-slate-900/10" onClick={onClose} />}
      <div
        className={
          'absolute inset-x-0 bottom-0 z-40 transform border-t border-slate-200 bg-white shadow-[0_-8px_30px_rgba(0,0,0,0.12)] transition-transform duration-300 ' +
          (open ? 'translate-y-0' : 'translate-y-full')
        }
      >
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
          <Keyboard className="h-4 w-4 text-slate-500" />
          <span className="text-sm font-semibold tracking-tight text-slate-800">Keyboard shortcuts</span>
          <button onClick={onClose} className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 p-5 sm:grid-cols-3">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{g.title}</div>
              <div className="space-y-1.5">
                {g.items.map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-slate-600">{label}</span>
                    <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                      {key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * Lovable-style hero: an empty project greets you with one big natural-language
 * input, not an empty spec table.
 */
function HeroComposer() {
  const instruct = useAppStore((s) => s.instruct);
  const generating = useAppStore((s) => s.generating);
  const loadSample = useAppStore((s) => s.loadSample);
  // The empty-state hero keeps its OWN draft: there are no canvas elements to
  // refer to yet, so it must not mirror the populated PromptPane's store value.
  const [composer, setComposer] = useState<ComposerValue>(emptyComposer());

  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-sm"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="w-full max-w-xl px-6 text-center">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1 text-[11px] font-medium text-white ring-1 ring-slate-900">
          <Sparkles className="h-3 w-3" /> WYSIWYC
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          What do you want to build?
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Describe a UI in plain words. Then edit it directly — the prompt keeps itself in sync.
        </p>

        <div className="mt-5 text-left">
          <RefComposer
            value={composer}
            onChange={setComposer}
            onSend={(text, refs) => instruct(text, { refs })}
            busy={generating}
            size="lg"
            autoFocus
            placeholder="A pricing page with three plans, the middle one highlighted…"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
          <span className="text-[11px] text-slate-400">Try:</span>
          {SAMPLES.map((s) => (
            <button
              key={s.id}
              onClick={() => loadSample(s.id)}
              disabled={generating}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900"
            >
              {s.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
