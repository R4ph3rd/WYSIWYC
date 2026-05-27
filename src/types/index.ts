export type Tool =
  | 'select'
  | 'prompt'
  | 'pen'
  | 'shapes'
  | 'eraser'
  | 'text'
  | 'eyedropper'
  | 'pan';

export type ShapeKind = 'rect' | 'circle' | 'polygon';

export type GenerationStatus = 'idle' | 'pending' | 'streaming' | 'done' | 'error';

export type SyncField =
  | 'rotation'
  | 'scale'
  | 'position'
  | 'layer'
  | 'color_overlay'
  | 'crop'
  | 'word_color'
  | 'word_rotation'
  | 'word_scale';

export interface PromptWord {
  id: string;
  text: string;
  fontSize: number;
  color: string;
  rotation: number;
  bold: boolean;
  italic: boolean;
  x: number;
  y: number;
}

export interface ModelConfig {
  apiKey: string;
  modelId: string;
}

export interface GenerationSnapshot {
  timestamp: number;
  prompt: string;
  imageDataURL: string;
  seed: number;
  modelId: string;
}

export interface PromptAreaData {
  id: string;

  // Canvas geometry
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  zIndex: number;

  // Text / prompt
  rawPrompt: string;
  words: PromptWord[];

  // Visual state
  generatedImageDataURL: string | null;
  generationStatus: GenerationStatus;
  generationSeed: number | null;

  // Sync metadata
  lastSyncedAt: number;
  pendingSyncFields: SyncField[];

  // Model override (if different from global)
  modelOverride?: ModelConfig;

  // History
  generationHistory: GenerationSnapshot[];
  historyIndex: number;
}

export interface GeometryDelta {
  rotation?: number;
  scale?: number;
  dx?: number;
  dy?: number;
}

export type LayerType = 'prompt' | 'drawing' | 'shape' | 'text';

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten';

export interface LayerInfo {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  locked: boolean;
  blendMode: BlendMode;
}

export interface WordStyle {
  fontSize: number;
  color: string;
  rotation: number;
  bold: boolean;
  italic: boolean;
}

export interface GenOptions {
  seed?: number;
  width?: number;
  height?: number;
}

export interface ImageGenClient {
  generate(prompt: string, options: GenOptions): Promise<string>;
  generateStream?(
    prompt: string,
    options: GenOptions,
    onChunk: (partial: string) => void,
  ): Promise<string>;
}
