import type { Canvas } from 'fabric';

const EXTRA_PROPS = ['promptAreaId', 'imageDataURL', 'status', 'layerId', 'layerName'];

/** Snapshot-based undo/redo over the whole canvas. */
export class CanvasHistory {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private suspended = false;

  constructor(private canvas: Canvas) {}

  private snapshot(): string {
    return JSON.stringify(this.canvas.toObject(EXTRA_PROPS));
  }

  /** Record current state. Call before/after a mutating operation. */
  record(): void {
    if (this.suspended) return;
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
  }

  private async restore(json: string): Promise<void> {
    this.suspended = true;
    await this.canvas.loadFromJSON(json);
    this.canvas.requestRenderAll();
    this.suspended = false;
  }

  async undo(): Promise<void> {
    if (this.undoStack.length < 2) return;
    const current = this.undoStack.pop()!;
    this.redoStack.push(current);
    await this.restore(this.undoStack[this.undoStack.length - 1]);
  }

  async redo(): Promise<void> {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(next);
    await this.restore(next);
  }

  canUndo(): boolean {
    return this.undoStack.length >= 2;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
