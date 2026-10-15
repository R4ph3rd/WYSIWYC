import { MousePointer2, Square, Circle, Minus, PenTool, Type, MessageSquarePlus, ArrowUpRight, BoxSelect, Highlighter } from 'lucide-react';
import { useAppStore, type Tool } from '@/store/appStore';
import { useStudyStore } from '@/store/studyStore';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './primitives/tooltip';

interface ToolDef {
  tool: Tool;
  icon: React.ReactNode;
  label: string;
  shortcut: string;
}

const DRAW_TOOLS: ToolDef[] = [
  { tool: 'pointer',   icon: <MousePointer2 className="h-4 w-4" />, label: 'Select', shortcut: 'V' },
  { tool: 'rectangle', icon: <Square        className="h-4 w-4" />, label: 'Rectangle', shortcut: 'R' },
  { tool: 'circle',    icon: <Circle        className="h-4 w-4" />, label: 'Circle', shortcut: 'O' },
  { tool: 'line',      icon: <Minus         className="h-4 w-4" />, label: 'Line', shortcut: 'L' },
  { tool: 'path',      icon: <PenTool       className="h-4 w-4" />, label: 'Pen', shortcut: 'P' },
  { tool: 'text',      icon: <Type          className="h-4 w-4" />, label: 'Text', shortcut: 'T' },
];

// Prompt-by-demonstration: markup tools that produce annotations, not UI nodes.
const ANNOT_TOOLS: ToolDef[] = [
  { tool: 'comment',  icon: <MessageSquarePlus className="h-4 w-4" />, label: 'Comment', shortcut: 'C' },
  { tool: 'arrow',    icon: <ArrowUpRight      className="h-4 w-4" />, label: 'Arrow', shortcut: 'A' },
  { tool: 'box',      icon: <BoxSelect         className="h-4 w-4" />, label: 'Surround', shortcut: 'B' },
  { tool: 'scribble', icon: <Highlighter       className="h-4 w-4" />, label: 'Scribble', shortcut: 'S' },
];

export function ToolPalette() {
  const tool = useAppStore((s) => s.tool);
  const setTool = useAppStore((s) => s.setTool);
  const chatOnly = useStudyStore((s) => s.condition === 'chat_only');

  const renderTool = ({ tool: t, icon, label, shortcut }: ToolDef) => (
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
  );

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex items-center gap-0.5 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-md backdrop-blur">
        {chatOnly ? (
          DRAW_TOOLS.filter((t) => t.tool === 'pointer').map(renderTool)
        ) : (
          <>
            {DRAW_TOOLS.map(renderTool)}
            <div className="mx-0.5 h-5 w-px bg-slate-200" />
            {ANNOT_TOOLS.map(renderTool)}
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
