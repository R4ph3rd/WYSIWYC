import { Rect, Pattern, classRegistry } from 'fabric';
import type { GenerationStatus } from '@/types';

const STATUS_COLOR: Record<GenerationStatus, string> = {
  idle: '#3b82f6',
  pending: '#f59e0b',
  streaming: '#f59e0b',
  done: '#3b82f6',
  error: '#ef4444',
};

function loadImageEl(dataURL: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = dataURL;
  });
}

/**
 * Custom Fabric object representing a linked text+image prompt area.
 * Rendered as a single transformable rectangle; the generated image is painted
 * as a no-repeat fill pattern so rotate/scale/move apply naturally.
 */
export class FabricPromptArea extends Rect {
  static type = 'PromptArea';

  promptAreaId!: string;
  status: GenerationStatus = 'idle';
  imageDataURL: string | null = null;

  constructor(options: Record<string, unknown> = {}) {
    super({
      width: 240,
      height: 200,
      fill: 'rgba(59,130,246,0.05)',
      stroke: STATUS_COLOR.idle,
      strokeWidth: 2,
      strokeDashArray: [6, 4],
      strokeUniform: true,
      rx: 4,
      ry: 4,
      cornerColor: STATUS_COLOR.idle,
      cornerStrokeColor: '#ffffff',
      transparentCorners: false,
      cornerSize: 9,
      borderColor: STATUS_COLOR.idle,
      ...options,
    });
    if (!this.promptAreaId) this.promptAreaId = String(options.promptAreaId ?? '');
  }

  async setImage(dataURL: string): Promise<void> {
    this.imageDataURL = dataURL;
    const img = await loadImageEl(dataURL);
    const pattern = new Pattern({
      source: img,
      repeat: 'no-repeat',
      patternTransform: [this.width / img.width, 0, 0, this.height / img.height, 0, 0],
    });
    this.set({ fill: pattern });
    this.canvas?.requestRenderAll();
  }

  setStatus(status: GenerationStatus): void {
    this.status = status;
    const color = STATUS_COLOR[status];
    const solid = status === 'done' && this.imageDataURL;
    this.set({
      stroke: color,
      strokeDashArray: solid ? null : [6, 4],
      cornerColor: color,
      borderColor: color,
    });
    this.canvas?.requestRenderAll();
  }

  setEditing(editing: boolean): void {
    this.set({ opacity: editing ? 0.3 : 1 });
    this.canvas?.requestRenderAll();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toObject(propertiesToInclude: any[] = []): any {
    return super.toObject([
      ...propertiesToInclude,
      'promptAreaId',
      'imageDataURL',
      'status',
    ] as any);
  }
}

classRegistry.setClass(FabricPromptArea, 'PromptArea');
