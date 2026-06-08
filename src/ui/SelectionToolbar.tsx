import { AlignLeft, AlignCenter, AlignRight, Trash2, Palette, Maximize2, Minimize2 } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { currentBackground } from '@/ir/tailwindEdit';
import { Button } from './primitives/button';
import { Popover, PopoverContent, PopoverTrigger } from './primitives/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './primitives/tooltip';

const COLORS = ['slate', 'rose', 'orange', 'amber', 'emerald', 'sky', 'indigo', 'violet', 'pink'];

export function SelectionToolbar() {
  const selectedId = useAppStore((s) => s.selectedNodeId);
  const node = useAppStore((s) => (selectedId ? s.ir.nodes.find((n) => n.id === selectedId) : null));
  const manipulate = useAppStore((s) => s.manipulate);

  if (!selectedId || !node) return null;

  const recolor = (color: string) => {
    const token = `bg-${color}-600`;
    manipulate({ kind: 'recolor', id: selectedId, from: currentBackground(node.tailwind), to: token, token });
  };

  const resize = (dw: number, dh: number) => {
    const from = { w: node.layout?.w, h: node.layout?.h };
    const w = Math.max(40, (node.layout?.w ?? 220) + dw);
    const h = Math.max(24, (node.layout?.h ?? 120) + dh);
    manipulate({ kind: 'resize', id: selectedId, from, to: { w, h } });
  };

  const align = (axis: 'left' | 'center' | 'right') =>
    manipulate({ kind: 'align', ids: [selectedId], axis });

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex items-center gap-1 rounded-lg border bg-white/95 px-1.5 py-1 shadow-md backdrop-blur">
        <span className="px-1.5 text-[11px] font-medium text-slate-500">{node.role}</span>
        <div className="mx-0.5 h-5 w-px bg-slate-200" />

        <Popover>
          <PopoverTrigger asChild>
            <Button size="icon" variant="ghost" className="h-7 w-7" title="Recolor">
              <Palette className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto">
            <div className="flex gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  aria-label={c}
                  onClick={() => recolor(c)}
                  className={`h-5 w-5 rounded-full ring-1 ring-black/10 bg-${c}-600`}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Tip label="Wider"><IconBtn onClick={() => resize(40, 0)}><Maximize2 className="h-4 w-4" /></IconBtn></Tip>
        <Tip label="Narrower"><IconBtn onClick={() => resize(-40, 0)}><Minimize2 className="h-4 w-4" /></IconBtn></Tip>

        <div className="mx-0.5 h-5 w-px bg-slate-200" />
        <Tip label="Align left"><IconBtn onClick={() => align('left')}><AlignLeft className="h-4 w-4" /></IconBtn></Tip>
        <Tip label="Align center"><IconBtn onClick={() => align('center')}><AlignCenter className="h-4 w-4" /></IconBtn></Tip>
        <Tip label="Align right"><IconBtn onClick={() => align('right')}><AlignRight className="h-4 w-4" /></IconBtn></Tip>

        <div className="mx-0.5 h-5 w-px bg-slate-200" />
        <Tip label="Delete">
          <IconBtn onClick={() => manipulate({ kind: 'delete', id: selectedId })}>
            <Trash2 className="h-4 w-4 text-rose-600" />
          </IconBtn>
        </Tip>
      </div>
    </TooltipProvider>
  );
}

function IconBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClick}>
      {children}
    </Button>
  );
}

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
