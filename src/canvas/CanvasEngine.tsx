import { useEffect, useRef } from 'react';
import { Canvas, Point, type FabricObject, type TPointerEventInfo } from 'fabric';
import { useCanvasContext } from './CanvasContext';
import { PromptAreaManager } from './PromptAreaManager';
import { LayerManager } from './LayerManager';
import { CanvasHistory } from './CanvasHistory';
import { FabricPromptArea } from './PromptArea';
import { createShape, disableDrawing, enableEraser, enablePen, resizeShape, tagObject } from './DrawingTools';
import { useCanvasStore } from '@/state/canvasStore';
import { PromptOverlay } from '@/ui/PromptOverlay';

const CANVAS_BG = '#f8f9fa';

export function CanvasEngine() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const { setEngine } = useCanvasContext();
  const enginesRef = useRef<{
    canvas: Canvas;
    areaManager: PromptAreaManager;
    history: CanvasHistory;
  } | null>(null);

  useEffect(() => {
    if (!canvasElRef.current || !containerRef.current) return;
    const container = containerRef.current;

    const canvas = new Canvas(canvasElRef.current, {
      width: container.clientWidth,
      height: container.clientHeight,
      backgroundColor: CANVAS_BG,
      selection: true,
      preserveObjectStacking: true,
    });

    const areaManager = new PromptAreaManager(canvas);
    const layerManager = new LayerManager(canvas);
    const history = new CanvasHistory(canvas);
    enginesRef.current = { canvas, areaManager, history };
    setEngine({ canvas, areaManager, layerManager, history });

    // --- pan / zoom state ---
    let spaceDown = false;
    let panning = false;
    let lastPan = { x: 0, y: 0 };

    // --- shape drawing state ---
    let drawingShape: FabricObject | null = null;
    let shapeOrigin: Point | null = null;

    const setSelection = () => {
      const active = canvas.getActiveObject() as
        | (FabricObject & { promptAreaId?: string; layerId?: string })
        | undefined;
      const id = active?.promptAreaId ?? active?.layerId ?? null;
      useCanvasStore.getState().setSelectedObjectId(id);
    };

    const onMouseDown = (opt: TPointerEventInfo) => {
      const tool = useCanvasStore.getState().activeTool;
      const pointer = canvas.getScenePoint(opt.e);

      if (spaceDown || tool === 'pan') {
        panning = true;
        canvas.selection = false;
        const e = opt.e as MouseEvent;
        lastPan = { x: e.clientX, y: e.clientY };
        return;
      }

      if (tool === 'prompt' && !opt.target) {
        const id = areaManager.create(pointer.x, pointer.y);
        useCanvasStore.getState().setActiveTool('select');
        useCanvasStore.getState().setSelectedObjectId(id);
        history.record();
        return;
      }

      if (tool === 'shapes' && !opt.target) {
        const color = useCanvasStore.getState().activeColor;
        const kind = useCanvasStore.getState().shapeKind;
        shapeOrigin = pointer;
        drawingShape = createShape(kind, pointer, color);
        canvas.add(drawingShape);
        return;
      }
    };

    const onMouseMove = (opt: TPointerEventInfo) => {
      const pointer = canvas.getScenePoint(opt.e);
      useCanvasStore.getState().setCursor(Math.round(pointer.x), Math.round(pointer.y));

      if (panning) {
        const e = opt.e as MouseEvent;
        const dx = e.clientX - lastPan.x;
        const dy = e.clientY - lastPan.y;
        lastPan = { x: e.clientX, y: e.clientY };
        canvas.relativePan(new Point(dx, dy));
        return;
      }

      if (drawingShape && shapeOrigin) {
        const kind = useCanvasStore.getState().shapeKind;
        resizeShape(drawingShape, kind, shapeOrigin, pointer);
        canvas.requestRenderAll();
      }
    };

    const onMouseUp = () => {
      if (panning) {
        panning = false;
        canvas.selection = true;
        return;
      }
      if (drawingShape) {
        drawingShape.setCoords();
        canvas.setActiveObject(drawingShape);
        drawingShape = null;
        shapeOrigin = null;
        useCanvasStore.getState().setActiveTool('select');
        history.record();
      }
    };

    const onWheel = (opt: TPointerEventInfo) => {
      const e = opt.e as WheelEvent;
      e.preventDefault();
      e.stopPropagation();
      let zoom = canvas.getZoom() * 0.999 ** e.deltaY;
      zoom = Math.min(5, Math.max(0.2, zoom));
      canvas.zoomToPoint(new Point(e.offsetX, e.offsetY), zoom);
      useCanvasStore.getState().setZoom(zoom);
    };

    const onModified = (opt: { target?: FabricObject }) => {
      const target = opt.target;
      if (target instanceof FabricPromptArea) {
        areaManager.handleTransformEnd(target);
      }
      history.record();
    };

    const onPathCreated = (opt: { path: FabricObject }) => {
      const tool = useCanvasStore.getState().activeTool;
      tagObject(opt.path, tool === 'eraser' ? 'Eraser stroke' : 'Drawing');
      history.record();
    };

    canvas.on('mouse:down', onMouseDown);
    canvas.on('mouse:move', onMouseMove);
    canvas.on('mouse:up', onMouseUp);
    canvas.on('mouse:wheel', onWheel);
    canvas.on('object:modified', onModified);
    canvas.on('path:created', onPathCreated as never);
    canvas.on('selection:created', setSelection);
    canvas.on('selection:updated', setSelection);
    canvas.on('selection:cleared', () => useCanvasStore.getState().setSelectedObjectId(null));

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.isContentEditable) return;
      if (e.code === 'Space') spaceDown = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const ro = new ResizeObserver(() => {
      canvas.setDimensions({ width: container.clientWidth, height: container.clientHeight });
    });
    ro.observe(container);

    history.record();

    return () => {
      ro.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      void canvas.dispose();
      setEngine(null);
      enginesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to tool changes for drawing modes.
  const activeTool = useCanvasStore((s) => s.activeTool);
  const activeColor = useCanvasStore((s) => s.activeColor);
  const brushSize = useCanvasStore((s) => s.brushSize);
  useEffect(() => {
    const eng = enginesRef.current;
    if (!eng) return;
    const { canvas } = eng;
    if (activeTool === 'pen') enablePen(canvas, activeColor, brushSize);
    else if (activeTool === 'eraser') enableEraser(canvas, brushSize);
    else disableDrawing(canvas);
  }, [activeTool, activeColor, brushSize]);

  return (
    <div ref={containerRef} className="relative flex-1 overflow-hidden bg-[var(--canvas-bg)]">
      <canvas ref={canvasElRef} />
      <PromptOverlay />
    </div>
  );
}
