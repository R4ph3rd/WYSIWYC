import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles, Keyboard, X, Send } from 'lucide-react';
import { useAppStore, toolToRole, isAnnotTool, type ComputedNodeStyle } from '@/store/appStore';
import { Renderer } from '@/render/Renderer';
import { siblingsOf } from '@/ir/tree';
import { pickDropTarget, type DropTarget } from '@/ir/layoutFit';
import type { Annotation, ComposerValue, IR, IRNode, PathPoint } from '@/ir/types';
import { SAMPLES } from '@/ir/samples';
import { composerIsEmpty, composerRefs, emptyComposer, removeRef, serializeComposer } from '@/lib/composer';
import { cn } from '@/lib/utils';
import { ToolPalette } from './ToolPalette';
import { RefComposer } from './RefComposer';
import { PromptTargetOverlay } from './PromptTargetOverlay';
import { InferenceOverlay } from './InferenceOverlay';
import { AI, ANNOTATION_INK } from './tokens';
import { AnnotationLayer } from './AnnotationLayer';
import { ModificationPlan } from './ModificationPlan';
import { useStudyStore } from '@/store/studyStore';
import { scribbleStrokes } from '@/annot/resolve';
import { strokeJoinsScribble } from '@/annot/gesture';

type Bounds = { x: number; y: number; w: number; h: number };

type DragState =
  | { mode: 'draw'; id: string; role: IRNode['role']; startX: number; startY: number; prevIR: IR }
  | {
      mode: 'move';
      id: string;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
      moved: boolean;
      prevIR: IR;
      /** For a flow (LLM) node: promote it to absolute at these bounds on first move. */
      promote?: Bounds;
    }
  | {
      mode: 'resize';
      id: string;
      handle: 'nw' | 'ne' | 'sw' | 'se';
      startX: number;
      startY: number;
      orig: Bounds;
      prevIR: IR;
    }
  | { mode: 'marquee'; startX: number; startY: number; curX: number; curY: number };

interface PenState {
  points: PathPoint[]; // stage coordinates
  prevIR: IR;
}

/** Roles whose text content is editable inline by double-clicking on the canvas. */
const TEXT_EDIT_ROLES: IRNode['role'][] = ['text', 'heading', 'button', 'badge', 'icon'];

/** A computed color is "real" only if it isn't fully transparent. */
function opaqueColor(c: string): string | undefined {
  if (!c) return undefined;
  const m = c.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const parts = m[1].split(',').map((p) => parseFloat(p));
    if (parts.length >= 4 && parts[3] === 0) return undefined; // transparent
  }
  return c === 'transparent' ? undefined : c;
}

/** Read the rendered CSS of a node into a structured style for the inspector. */
function readComputedStyle(el: HTMLElement): ComputedNodeStyle {
  const cs = getComputedStyle(el);
  const num = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const borderW = num(cs.borderTopWidth) ?? 0;
  return {
    fill: opaqueColor(cs.backgroundColor),
    stroke: borderW > 0 ? opaqueColor(cs.borderTopColor) : undefined,
    strokeWidth: borderW > 0 ? Math.round(borderW) : undefined,
    borderRadius: num(cs.borderTopLeftRadius),
    fontFamily: cs.fontFamily || undefined,
    fontSize: num(cs.fontSize),
    fontWeight: num(cs.fontWeight),
    fontColor: opaqueColor(cs.color),
    opacity: num(cs.opacity),
  };
}

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
  const hoveredParamNodeIds = useAppStore((s) => s.hoveredParamNodeIds);
  const recentIds = useAppStore((s) => s.recentIds);
  const generating = useAppStore((s) => s.generating);
  const selectNode = useAppStore((s) => s.selectNode);
  const toggleSelection = useAppStore((s) => s.toggleSelection);
  const setSelection = useAppStore((s) => s.setSelection);
  const promoteToAbsolute = useAppStore((s) => s.promoteToAbsolute);
  const addComposerNodeRef = useAppStore((s) => s.addComposerNodeRef);
  const addComposerLocationRef = useAppStore((s) => s.addComposerLocationRef);
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
  const chatOnly = useStudyStore((s) => s.condition === 'chat_only');

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
  const setComputedStyle = useAppStore((s) => s.setComputedStyle);
  const manipulate = useAppStore((s) => s.manipulate);
  const proposeManipulation = useAppStore((s) => s.proposeManipulation);
  const settleDragMove = useAppStore((s) => s.settleDragMove);
  const createShape = useAppStore((s) => s.createShape);
  const updateLayout = useAppStore((s) => s.updateLayout);
  const inferDrawnShape = useAppStore((s) => s.inferDrawnShape);
  const annotations = useAppStore((s) => s.annotations);
  const addAnnotation = useAppStore((s) => s.addAnnotation);
  const updateAnnotation = useAppStore((s) => s.updateAnnotation);
  const buildDemoPlan = useAppStore((s) => s.buildDemoPlan);
  const demoPlan = useAppStore((s) => s.demoPlan);
  const demoBusy = useAppStore((s) => s.demoBusy);

  const stageRef = useRef<HTMLDivElement>(null);
  // Set when a move/resize drag actually moved, to swallow the synthetic click
  // the browser fires afterwards (which would otherwise add a stray ref chip).
  const draggedRef = useRef(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  // Where a dragged flow node would land in a layout (insertion line preview);
  // mirrored in a ref so the mouseup handler reads the latest value.
  const [dropTarget, setDropTargetState] = useState<DropTarget | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const setDropTarget = (t: DropTarget | null) => {
    dropTargetRef.current = t;
    setDropTargetState(t);
  };
  // Stage-relative bounds of a selected FLOW node, so resize handles can be shown
  // for LLM-authored components before they are promoted to absolute positioning.
  const [flowBounds, setFlowBounds] = useState<Bounds | null>(null);
  const [pen, setPen] = useState<PenState | null>(null);
  // In-progress annotation drag (prompt-by-demonstration drawings).
  const [annotDraft, setAnnotDraft] = useState<
    | { kind: 'box' | 'arrow'; startX: number; startY: number; curX: number; curY: number }
    | { kind: 'scribble'; points: PathPoint[] }
    | null
  >(null);
  const [penCursor, setPenCursor] = useState<PathPoint | null>(null);
  // Inline canvas text editing (double-click a text node). Holds the node id
  // plus its measured box (relative to the stage) for the overlay textarea.
  const [editingText, setEditingText] = useState<
    { id: string; left: number; top: number; width: number; height: number } | null
  >(null);
  // Mirror for event listeners (keydown) that outlive a render's closure.
  const penRef = useRef<PenState | null>(null);
  penRef.current = pen;
  // The scribble annotation the current scribble session appends strokes to.
  // Every stroke drawn while the scribble tool stays active merges into it;
  // picking any other tool closes the session.
  const scribbleIdRef = useRef<string | null>(null);
  useEffect(() => {
    scribbleIdRef.current = null;
    // Leaving the pen mid-path keeps what was drawn so far (as Enter would).
    if (tool !== 'path' && penRef.current) commitPen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

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
    if (!selectedNodeId) { setComputedBounds(null); setComputedStyle(null); return; }
    const stage = stageRef.current;
    if (!stage) return;
    const el = stage.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(selectedNodeId)}"]`);
    if (!el) { setComputedBounds(null); setComputedStyle(null); return; }
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
    // Resolve the rendered visual style so the inspector shows real defaults
    // even for LLM nodes that style themselves through Tailwind classes.
    setComputedStyle(readComputedStyle(el));
  // Remeasure after any re-render (IR change) or selection change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, ir]);

  // Measure a selected flow node's box so we can offer resize handles on it even
  // though it has no stored layout yet (it gets promoted to absolute on resize).
  useEffect(() => {
    if (drag) return; // don't remeasure mid-gesture; re-runs once the drag clears
    if (!selectedNodeId) { setFlowBounds(null); return; }
    const node = nodeById(selectedNodeId);
    if (!node || (node.layout?.x !== undefined && node.layout?.y !== undefined)) {
      setFlowBounds(null);
      return;
    }
    setFlowBounds(stageRelativeBounds(selectedNodeId));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, ir, drag]);

  // Surface the "unbound shortcut" hint for a few seconds after it is flagged.
  const [hintVisible, setHintVisible] = useState(false);
  useEffect(() => {
    if (!unknownShortcutAt) return;
    setHintVisible(true);
    const t = setTimeout(() => setHintVisible(false), 6000);
    return () => clearTimeout(t);
  }, [unknownShortcutAt]);

  const role = toolToRole(tool);
  const annotating = isAnnotTool(tool);
  const drawing = Boolean(role) || tool === 'path' || annotating;
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

  /** A rendered node's box measured relative to the stage origin (drawn-shape space). */
  function stageRelativeBounds(id: string): Bounds | null {
    const stage = stageRef.current;
    if (!stage) return null;
    const el = stage.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
    if (!el) return null;
    const sr = stage.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left - sr.left),
      y: Math.round(r.top - sr.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  }

  /** Stage-relative boxes for every rendered node (for annotation target resolution). */
  function allNodeBoxes(): Record<string, { x: number; y: number; w: number; h: number }> {
    const stage = stageRef.current;
    const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
    if (!stage) return out;
    const sr = stage.getBoundingClientRect();
    stage.querySelectorAll<HTMLElement>('[data-node-id]').forEach((el) => {
      const id = el.dataset.nodeId;
      if (!id) return;
      const r = el.getBoundingClientRect();
      out[id] = {
        x: Math.round(r.left - sr.left),
        y: Math.round(r.top - sr.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    });
    return out;
  }

  /**
   * The layout slot under the pointer for a dragged flow node: the innermost
   * rendered node under the cursor outside the dragged subtree, resolved to a
   * container + insertion index by ir/layoutFit.ts.
   */
  function findDropTarget(dragId: string, clientX: number, clientY: number, p: PathPoint): DropTarget | null {
    const stage = stageRef.current;
    if (!stage) return null;
    const nodes = useAppStore.getState().ir.nodes;
    const banned = new Set([dragId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of nodes) {
        if (n.parentId && banned.has(n.parentId) && !banned.has(n.id)) { banned.add(n.id); grew = true; }
      }
    }
    let hitId: string | null = null;
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      if (!stage.contains(el)) continue;
      const id = el.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
      if (id && !banned.has(id)) { hitId = id; break; }
    }
    return pickDropTarget({
      nodes,
      draggedId: dragId,
      hitId,
      point: p,
      boxOf: (id) => stageRelativeBounds(id) ?? undefined,
    });
  }

  /** The op that lands a dragged flow node at `target`, relative to the pre-drag IR (null = no change). */
  function dropOp(id: string, target: DropTarget, prevIR: IR) {
    const before = prevIR.nodes.find((n) => n.id === id);
    if (!before) return null;
    if (before.parentId === target.parentId) {
      const from = siblingsOf(prevIR, id).findIndex((n) => n.id === id);
      return from === target.index
        ? null
        : { kind: 'reorder' as const, id, parentId: before.parentId, from, to: target.index };
    }
    return {
      kind: 'reparent' as const,
      id,
      fromParentId: before.parentId,
      toParentId: target.parentId,
      toIndex: target.index,
      fit: { containerWidth: Math.round(target.container.w) },
    };
  }

  /** A locally-unique annotation id. */
  function newAnnotId(): string {
    return `annot_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
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
    // The pen stays active: the next click starts a fresh path.
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

  // Tools stay active after each gesture. Enter commits an in-progress pen
  // path; Escape cancels it, and with nothing in progress Escape drops back to
  // the pointer (App's global handler only deselects while on the pointer).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      // A dialog/popover that consumed Escape (Radix preventDefaults it) wins.
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (penRef.current) {
        if (e.key === 'Enter') commitPen(false);
        if (e.key === 'Escape') commitPen(true);
        return;
      }
      if (e.key !== 'Escape') return;
      const st = useAppStore.getState();
      if (st.shortcutsOpen || st.tool === 'pointer') return;
      setAnnotDraft(null);
      st.setTool('pointer');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Stage mouse handling -------------------------------------------------

  function onStageMouseDown(e: React.MouseEvent) {
    const p = relativePoint(e);
    if (!p) return;
    // While the modification plan is open the canvas is modal: clicks only
    // (de)select target elements for the plan (handled in ModificationPlan).
    if (demoPlan) return;
    // In chat_only mode the canvas is a read-only preview; only allow selection.
    if (chatOnly && tool !== 'pointer') return;
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
      // The text tool edits an existing text-bearing node in place instead of
      // stacking a new one on top of it (so it can stay active between texts).
      if (role === 'text') {
        const hitId = (e.target as HTMLElement).closest('[data-node-id]')?.getAttribute('data-node-id');
        const hit = hitId ? nodeById(hitId) : undefined;
        if (hit && TEXT_EDIT_ROLES.includes(hit.role)) {
          startTextEdit(hit.id);
          return;
        }
      }
      const prevIR = useAppStore.getState().ir;
      const defaultSize = role === 'text' ? { w: 120, h: 28 } : { w: 2, h: 2 };
      const id = createShape({ role, x: p.x, y: p.y, ...defaultSize });
      setDrag({ mode: 'draw', id, role, startX: p.x, startY: p.y, prevIR });
      return;
    }

    // Annotation tools (prompt by demonstration): produce annotations, not nodes.
    if (isAnnotTool(tool)) {
      e.preventDefault();
      e.stopPropagation();
      if (tool === 'comment') {
        addAnnotation({ id: newAnnotId(), kind: 'comment', anchor: p, text: '', createdAt: Date.now() });
        draggedRef.current = true;
        return;
      }
      if (tool === 'scribble') setAnnotDraft({ kind: 'scribble', points: [p] });
      else setAnnotDraft({ kind: tool as 'box' | 'arrow', startX: p.x, startY: p.y, curX: p.x, curY: p.y });
      return;
    }

    // Pointer tool. In chat_only mode, allow selection only — no dragging.
    if (chatOnly) return;
    // Shift is a selection modifier (multi-select) — never start a drag/marquee,
    // so the trailing click toggles the node in/out of the selection.
    if (e.shiftKey) return;

    const target = (e.target as HTMLElement).closest('[data-node-id]');
    const id = target?.getAttribute('data-node-id');
    const node = id ? nodeById(id) : undefined;
    // Pressing empty space (or the root frame itself) begins a rubber-band
    // selection rather than a move.
    const onEmpty = !node || (node.parentId === null && node.role === 'frame');
    if (onEmpty) {
      setDrag({ mode: 'marquee', startX: p.x, startY: p.y, curX: p.x, curY: p.y });
      return;
    }

    if (node.layout?.x !== undefined && node.layout?.y !== undefined) {
      // Already absolute (a drawn shape or a promoted component): move directly.
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
      return;
    }

    // A flow (LLM-authored) node: arm a move that promotes the node to absolute
    // on the first real drag, so generated components can be repositioned too.
    // A plain click (no drag) leaves the layout untouched and just selects.
    const bounds = stageRelativeBounds(node.id);
    if (!bounds) return;
    e.preventDefault();
    selectNode(node.id);
    setDrag({
      mode: 'move',
      id: node.id,
      startX: p.x,
      startY: p.y,
      origX: bounds.x,
      origY: bounds.y,
      moved: false,
      prevIR: useAppStore.getState().ir,
      promote: bounds,
    });
  }

  function onStageMouseMove(e: React.MouseEvent) {
    const p = relativePoint(e);
    if (!p) return;
    if (pen) setPenCursor(p);
    if (annotDraft) {
      if (annotDraft.kind === 'scribble') setAnnotDraft({ kind: 'scribble', points: [...annotDraft.points, p] });
      else setAnnotDraft({ ...annotDraft, curX: p.x, curY: p.y });
      return;
    }
    if (!drag) return;

    if (drag.mode === 'marquee') {
      setDrag({ ...drag, curX: p.x, curY: p.y });
      return;
    }

    if (drag.mode === 'draw') {
      const x = Math.min(p.x, drag.startX);
      const y = Math.min(p.y, drag.startY);
      const w = Math.max(2, Math.abs(p.x - drag.startX));
      const h = Math.max(2, Math.abs(p.y - drag.startY));
      updateLayout(drag.id, { x, y, w, h });
    } else if (drag.mode === 'move') {
      const dx = p.x - drag.startX;
      const dy = p.y - drag.startY;
      if (!drag.moved) {
        // Sub-threshold jitter is still a click: leave the layout untouched
        // (writing x/y here would pin a flow node absolutely in place).
        if (Math.hypot(dx, dy) <= 3) return;
        // First real movement: an LLM node becomes absolute here so it can float.
        if (drag.promote) promoteToAbsolute(drag.id, drag.promote);
        setDrag({ ...drag, moved: true });
      }
      updateLayout(drag.id, { x: Math.round(drag.origX + dx), y: Math.round(drag.origY + dy) });
      // A flow node being dragged previews where it would join a layout;
      // holding Ctrl/⌘ floats it freely instead.
      if (drag.promote) {
        setDropTarget(e.ctrlKey || e.metaKey ? null : findDropTarget(drag.id, e.clientX, e.clientY, p));
      }
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
    if (annotDraft) {
      const d = annotDraft;
      setAnnotDraft(null);
      draggedRef.current = true;
      if (d.kind === 'scribble') {
        if (d.points.length < 2) return;
        // Merge into the session's scribble while it still exists (it may
        // have been removed or applied meanwhile); otherwise open a new one.
        const current = scribbleIdRef.current
          ? useAppStore.getState().annotations.find((a) => a.id === scribbleIdRef.current)
          : undefined;
        // A stroke far from the session's scribble starts a new gesture (so two
        // separate cross-outs stay two annotations); nearby strokes merge.
        if (current && strokeJoinsScribble(scribbleStrokes(current), d.points)) {
          updateAnnotation(current.id, { strokes: [...scribbleStrokes(current), d.points], points: undefined });
        } else {
          const id = newAnnotId();
          scribbleIdRef.current = id;
          addAnnotation({ id, kind: 'scribble', strokes: [d.points], createdAt: Date.now() });
        }
      } else {
        const dx = Math.abs(d.curX - d.startX);
        const dy = Math.abs(d.curY - d.startY);
        if (dx >= 4 || dy >= 4) {
          if (d.kind === 'arrow') {
            addAnnotation({
              id: newAnnotId(), kind: 'arrow',
              points: [{ x: d.startX, y: d.startY }, { x: d.curX, y: d.curY }],
              createdAt: Date.now(),
            });
          } else {
            addAnnotation({
              id: newAnnotId(), kind: 'box',
              rect: { x: Math.min(d.startX, d.curX), y: Math.min(d.startY, d.curY), w: dx, h: dy },
              createdAt: Date.now(),
            });
          }
        }
      }
      return;
    }
    if (!drag) return;

    if (drag.mode === 'marquee') {
      const rx = Math.min(drag.startX, drag.curX);
      const ry = Math.min(drag.startY, drag.curY);
      const rw = Math.abs(drag.curX - drag.startX);
      const rh = Math.abs(drag.curY - drag.startY);
      setDrag(null);
      // A negligible drag is really a click on empty space → let it deselect.
      if (rw < 4 && rh < 4) return;
      // Swallow the trailing click so it doesn't immediately clear the selection.
      draggedRef.current = true;
      const stage = stageRef.current;
      if (!stage) return;
      const sr = stage.getBoundingClientRect();
      const ids: string[] = [];
      stage.querySelectorAll<HTMLElement>('[data-node-id]').forEach((el) => {
        const nid = el.dataset.nodeId;
        if (!nid) return;
        const n = nodeById(nid);
        if (!n || (n.parentId === null && n.role === 'frame')) return; // skip the root frame
        const r = el.getBoundingClientRect();
        const cx = r.left - sr.left + r.width / 2;
        const cy = r.top - sr.top + r.height / 2;
        if (cx >= rx && cx <= rx + rw && cy >= ry && cy <= ry + rh) ids.push(nid);
      });
      setSelection(ids);
      return;
    }

    const node = nodeById(drag.id);
    // A move/resize that actually changed geometry should swallow the trailing
    // click so it doesn't get read as a "refer to this element" tap.
    if ((drag.mode === 'move' && drag.moved) || drag.mode === 'resize') {
      draggedRef.current = true;
    }
    setDrag(null);

    if (drag.mode === 'draw') {
      // The draw tool stays active; each gesture creates its own node.
      if (!node) return;
      let layout = node.layout ?? {};
      // A click without a drag: give the shape a sensible default footprint.
      const clickSize = CLICK_SIZE[drag.role];
      if (clickSize && (layout.w ?? 0) <= 4 && (layout.h ?? 0) <= 4) {
        updateLayout(drag.id, clickSize);
        layout = { ...layout, ...clickSize };
      }
      // Box-like shapes infer a UI component (semantic) instead of a technical
      // shape clause; other primitives keep the plain Call B back-channel.
      if (drag.role === 'rectangle' || drag.role === 'circle') {
        inferDrawnShape(drag.id, drag.prevIR);
      } else {
        proposeManipulation(
          { kind: 'draw', id: drag.id, role: drag.role, layout },
          drag.prevIR,
        );
      }
    } else if (drag.mode === 'move') {
      const target = dropTargetRef.current;
      setDropTarget(null);
      if (!node || !drag.moved) return;
      if (drag.promote && target) {
        settleDragMove(dropOp(drag.id, target, drag.prevIR), drag.prevIR);
        return;
      }
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
    if (chatOnly) return;
    const node = selectedNodeId ? nodeById(selectedNodeId) : undefined;
    const p = relativePoint(e);
    if (!node || !p) return;
    let orig: Bounds;
    if (node.layout?.x !== undefined) {
      orig = {
        x: node.layout.x,
        y: node.layout.y ?? 0,
        w: node.layout.w ?? 80,
        h: node.layout.h ?? 80,
      };
    } else if (flowBounds) {
      // Resizing an LLM node promotes it to absolute at its current box first.
      promoteToAbsolute(node.id, flowBounds);
      orig = flowBounds;
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setDrag({
      mode: 'resize',
      id: node.id,
      handle,
      startX: p.x,
      startY: p.y,
      orig,
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
  const isAbsoluteSelection =
    selectedNode?.layout?.x !== undefined && selectedNode?.layout?.y !== undefined;
  // Handles show on absolute nodes (via their layout) and on flow nodes (via the
  // measured box); grabbing a handle on a flow node promotes it to absolute.
  const handleLayout: Bounds | { x?: number; y?: number; w?: number; h?: number } | null =
    isAbsoluteSelection ? selectedNode!.layout! : !drag ? flowBounds : null;
  const showHandles = tool === 'pointer' && !!selectedNode && !!handleLayout && !chatOnly;

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

      {/* Send-from-annotations button, floating above the toolbar. */}
      {!chatOnly && annotations.length > 0 && !demoPlan && !demoBusy && (
        <button
          onClick={() => buildDemoPlan(allNodeBoxes())}
          className={`absolute bottom-16 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold shadow-lg transition-colors ${AI.fill} ${AI.focus}`}
        >
          <Send className="h-3.5 w-3.5" />
          Apply {annotations.length} annotation{annotations.length === 1 ? '' : 's'}
        </button>
      )}

      {/* Guardrail: reviewable modification plan built from the annotations. */}
      <ModificationPlan stageRef={stageRef} />

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
        // In-flight prompt call: amber AI-accent pill with the shared halo
        // (same as the prompt send button while busy).
        <div
          role="status"
          aria-live="polite"
          className="wysiwyc-ai-halo absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
        >
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
            if (e.target !== e.currentTarget || drawing || demoPlan) return;
            // A marquee/move drag ends in a click on empty space — swallow it so
            // the just-made selection isn't immediately cleared.
            if (draggedRef.current) { draggedRef.current = false; return; }
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
            paramNodeIds={hoveredParamNodeIds}
            recentIds={recentIds}
            onSelect={
              drawing || demoPlan
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

          {/* Drop preview while dragging a flow node into a layout. */}
          {dropTarget && (
            <div className="pointer-events-none absolute inset-0 z-20" data-testid="drop-indicator">
              <div
                className="absolute rounded-md border-2 border-dashed border-indigo-400/70 bg-indigo-500/[0.04]"
                style={{
                  left: dropTarget.container.x - 2,
                  top: dropTarget.container.y - 2,
                  width: dropTarget.container.w + 4,
                  height: dropTarget.container.h + 4,
                }}
              />
              <div
                data-testid="drop-line"
                className="absolute rounded-full bg-indigo-600 shadow-[0_0_0_2px_rgba(255,255,255,0.9)]"
                style={{
                  left: dropTarget.line.x,
                  top: dropTarget.line.y,
                  width: dropTarget.line.w,
                  height: dropTarget.line.h,
                }}
              />
            </div>
          )}

          {/* Component-inference bubbles + wireframe controls for drawn shapes. */}
          <InferenceOverlay stageRef={stageRef} />

          {/* Prompt-by-demonstration annotations (comments + drawings). */}
          <AnnotationLayer stageRef={stageRef} />

          {/* In-progress annotation draft preview. */}
          {annotDraft && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
              {annotDraft.kind === 'box' && (
                <rect
                  x={Math.min(annotDraft.startX, annotDraft.curX)}
                  y={Math.min(annotDraft.startY, annotDraft.curY)}
                  width={Math.abs(annotDraft.curX - annotDraft.startX)}
                  height={Math.abs(annotDraft.curY - annotDraft.startY)}
                  fill={ANNOTATION_INK} fillOpacity={0.08} stroke={ANNOTATION_INK} strokeWidth={2} strokeDasharray="6 4" rx={6}
                />
              )}
              {annotDraft.kind === 'arrow' && (
                <line
                  x1={annotDraft.startX} y1={annotDraft.startY} x2={annotDraft.curX} y2={annotDraft.curY}
                  stroke={ANNOTATION_INK} strokeWidth={2.5} strokeLinecap="round"
                />
              )}
              {annotDraft.kind === 'scribble' && (
                <polyline
                  points={annotDraft.points.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none" stroke={ANNOTATION_INK} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
                />
              )}
            </svg>
          )}

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
              className="z-30 resize-none overflow-hidden rounded-sm bg-white/95 px-1 py-0.5 text-inherit leading-tight text-slate-900 shadow-[0_0_0_2px_#0f172a] outline-none"
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
                stroke="#0f172a"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {pen.points.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={3} fill="#fff" stroke="#0f172a" strokeWidth={1.5} />
              ))}
            </svg>
          )}

          {/* Resize handles for the selected shape or promotable component. */}
          {showHandles && handleLayout && (
            <SelectionHandles layout={handleLayout} onStart={startResize} />
          )}

          {/* Rubber-band marquee rectangle. */}
          {drag?.mode === 'marquee' && (
            <div
              className="pointer-events-none absolute z-20 rounded-sm border border-indigo-400 bg-indigo-400/10"
              style={{
                left: Math.min(drag.startX, drag.curX),
                top: Math.min(drag.startY, drag.curY),
                width: Math.abs(drag.curX - drag.startX),
                height: Math.abs(drag.curY - drag.startY),
              }}
            />
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
          className="absolute z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-slate-900 bg-white shadow-sm"
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
      title: 'Markup',
      items: [
        ['C', 'Comment'], ['A', 'Arrow'], ['B', 'Surround'], ['S', 'Scribble'],
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
        ['Esc', 'Deselect / exit tool'],
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
          <button onClick={onClose} className="ml-auto rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 p-5 sm:grid-cols-3">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{g.title}</div>
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
          <span className="text-[11px] text-slate-500">Try:</span>
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
