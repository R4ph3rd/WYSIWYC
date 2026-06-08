import { Undo2, Download, FilePlus2, AlertTriangle, X } from 'lucide-react';
import { useAppStore } from './store/appStore';
import { SAMPLES } from './ir/samples';
import { downloadBackChannelLog } from './lib/log';
import { PromptPane } from './ui/PromptPane';
import { Canvas } from './ui/Canvas';
import { DiffRibbon } from './ui/DiffRibbon';
import { Button } from './ui/primitives/button';

export default function App() {
  const loadSample = useAppStore((s) => s.loadSample);
  const newBlank = useAppStore((s) => s.newBlank);
  const undo = useAppStore((s) => s.undo);
  const canUndo = useAppStore((s) => s.history.length > 0);
  const error = useAppStore((s) => s.error);
  const needsBackend = useAppStore((s) => s.needsBackend);
  const dismissError = useAppStore((s) => s.dismissError);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 items-center gap-3 border-b bg-white px-4">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold tracking-tight text-slate-900">WYSIWYC</span>
          <span className="text-[11px] text-slate-400">What You See Is What You Chat</span>
        </div>

        <div className="mx-2 h-5 w-px bg-slate-200" />

        <span className="text-[11px] font-medium text-slate-400">Examples:</span>
        {SAMPLES.map((s) => (
          <button
            key={s.id}
            onClick={() => loadSample(s.id)}
            className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
          >
            {s.title}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={newBlank}>
            <FilePlus2 className="h-3.5 w-3.5" /> New
          </Button>
          <Button size="sm" variant="ghost" onClick={undo} disabled={!canUndo}>
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </Button>
          <Button size="sm" variant="ghost" onClick={downloadBackChannelLog} title="Download back-channel study log">
            <Download className="h-3.5 w-3.5" /> Log
          </Button>
        </div>
      </header>

      {(error || needsBackend) && (
        <div className="flex items-center gap-2 border-b bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            {needsBackend
              ? 'LLM backend not reachable. Direct manipulation, provenance, and examples work offline; prompt⇄UI generation needs running locally with ANTHROPIC_API_KEY set (see README).'
              : error}
          </span>
          <button onClick={dismissError} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <PromptPane />
        <Canvas />
      </div>

      <DiffRibbon />
    </div>
  );
}
