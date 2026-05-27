import {
  MousePointer2,
  Type,
  Pencil,
  Eraser,
  Shapes,
  Hand,
  Pipette,
  SquareDashedMousePointer,
} from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from './primitives/toggle-group';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './primitives/tooltip';
import { ColorPicker } from './ColorPicker';
import { useCanvasStore } from '@/state/canvasStore';
import type { Tool } from '@/types';

const TOOLS: { tool: Tool; icon: React.ReactNode; label: string; shortcut: string }[] = [
  { tool: 'select', icon: <MousePointer2 className="h-4 w-4" />, label: 'Select', shortcut: 'V' },
  { tool: 'prompt', icon: <SquareDashedMousePointer className="h-4 w-4" />, label: 'Prompt area', shortcut: 'P' },
  { tool: 'pen', icon: <Pencil className="h-4 w-4" />, label: 'Pen', shortcut: 'B' },
  { tool: 'shapes', icon: <Shapes className="h-4 w-4" />, label: 'Shapes', shortcut: 'S' },
  { tool: 'eraser', icon: <Eraser className="h-4 w-4" />, label: 'Eraser', shortcut: 'E' },
  { tool: 'text', icon: <Type className="h-4 w-4" />, label: 'Text', shortcut: 'T' },
  { tool: 'eyedropper', icon: <Pipette className="h-4 w-4" />, label: 'Eyedropper', shortcut: 'I' },
  { tool: 'pan', icon: <Hand className="h-4 w-4" />, label: 'Pan (Space)', shortcut: 'Space' },
];

export function Toolbar() {
  const activeTool = useCanvasStore((s) => s.activeTool);
  const setActiveTool = useCanvasStore((s) => s.setActiveTool);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex w-12 flex-col items-center gap-2 border-r bg-[var(--toolbar-bg)] py-2">
        <ToggleGroup
          type="single"
          value={activeTool}
          onValueChange={(v) => v && setActiveTool(v as Tool)}
        >
          {TOOLS.map(({ tool, icon, label, shortcut }) => (
            <Tooltip key={tool}>
              <TooltipTrigger asChild>
                <ToggleGroupItem value={tool} aria-label={label}>
                  {icon}
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent side="right">
                {label} <span className="opacity-60">({shortcut})</span>
              </TooltipContent>
            </Tooltip>
          ))}
        </ToggleGroup>
        <div className="mt-1 border-t pt-2">
          <ColorPicker />
        </div>
      </div>
    </TooltipProvider>
  );
}
