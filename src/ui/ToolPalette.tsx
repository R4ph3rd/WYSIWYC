import { MousePointer2, Square, Circle, Minus, PenTool, Type } from 'lucide-react';
import { useAppStore, type Tool } from '@/store/appStore';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './primitives/tooltip';

const TOOLS: { tool: Tool; icon: React.ReactNode; label: string; shortcut: string }[] = [
  { tool: 'pointer',   icon: <MousePointer2 className="h-4 w-4" />, label: 'Select', shortcut: 'V' },
  { tool: 'rectangle', icon: <Square        className="h-4 w-4" />, label: 'Rectangle', shortcut: 'R' },
  { tool: 'circle',    icon: <Circle        className="h-4 w-4" />, label: 'Circle', shortcut: 'O' },
  { tool: 'line',      icon: <Minus         className="h-4 w-4" />, label: 'Line', shortcut: 'L' },
  { tool: 'path',      icon: <PenTool       className="h-4 w-4" />, label: 'Pen', shortcut: 'P' },
  { tool: 'text',      icon: <Type          className="h-4 w-4" />, label: 'Text', shortcut: 'T' },
];

export function ToolPalette() {
  const tool = useAppStore((s) => s.tool);
  const setTool = useAppStore((s) => s.setTool);

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex items-center gap-0.5 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-md backdrop-blur">
        {TOOLS.map(({ tool: t, icon, label, shortcut }) => (
          <Tooltip key={t}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setTool(t)}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                  tool === t
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100',
                )}
                aria-label={label}
              >
                {icon}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {label} <span className="opacity-60">({shortcut})</span>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
