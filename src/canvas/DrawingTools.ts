import { Canvas, Circle, PencilBrush, Polygon, Rect, Point, type FabricObject } from 'fabric';
import type { ShapeKind } from '@/types';
import { uid } from '@/lib/utils';

const CANVAS_BG = '#f8f9fa';

export function tagObject(obj: FabricObject, name: string): void {
  const meta = obj as FabricObject & { layerId?: string; layerName?: string };
  meta.layerId = uid('layer');
  meta.layerName = name;
}

export function enablePen(canvas: Canvas, color: string, width: number): void {
  canvas.isDrawingMode = true;
  const brush = new PencilBrush(canvas);
  brush.color = color;
  brush.width = width;
  canvas.freeDrawingBrush = brush;
}

export function enableEraser(canvas: Canvas, width: number): void {
  // Approximate eraser: paint with the canvas background colour.
  canvas.isDrawingMode = true;
  const brush = new PencilBrush(canvas);
  brush.color = CANVAS_BG;
  brush.width = width;
  canvas.freeDrawingBrush = brush;
}

export function disableDrawing(canvas: Canvas): void {
  canvas.isDrawingMode = false;
}

export function createShape(
  kind: ShapeKind,
  origin: Point,
  color: string,
): FabricObject {
  const common = {
    left: origin.x,
    top: origin.y,
    fill: 'transparent',
    stroke: color,
    strokeWidth: 2,
    strokeUniform: true,
  };
  let shape: FabricObject;
  if (kind === 'circle') {
    shape = new Circle({ ...common, radius: 1, originX: 'center', originY: 'center' });
  } else if (kind === 'polygon') {
    shape = new Polygon(trianglePoints(origin, 1), { ...common });
  } else {
    shape = new Rect({ ...common, width: 1, height: 1 });
  }
  tagObject(shape, kind === 'circle' ? 'Circle' : kind === 'polygon' ? 'Polygon' : 'Rectangle');
  return shape;
}

export function resizeShape(shape: FabricObject, kind: ShapeKind, origin: Point, p: Point): void {
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  if (kind === 'circle') {
    const r = Math.max(1, Math.hypot(dx, dy) / 2);
    (shape as Circle).set({ radius: r });
    shape.set({ left: origin.x + dx / 2, top: origin.y + dy / 2 });
  } else if (kind === 'polygon') {
    const size = Math.max(2, Math.max(Math.abs(dx), Math.abs(dy)));
    (shape as Polygon).set({ points: trianglePoints(origin, size) });
  } else {
    shape.set({
      width: Math.max(1, Math.abs(dx)),
      height: Math.max(1, Math.abs(dy)),
      left: Math.min(origin.x, p.x),
      top: Math.min(origin.y, p.y),
    });
  }
  shape.setCoords();
}

function trianglePoints(origin: Point, size: number) {
  return [
    { x: origin.x, y: origin.y },
    { x: origin.x + size, y: origin.y },
    { x: origin.x + size / 2, y: origin.y - size },
  ];
}
