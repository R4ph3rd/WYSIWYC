import { useEffect, useState } from 'react';
import { Undo2, Download, FilePlus2, AlertTriangle, X, Plug, Circle as CircleIcon, Layers as LayersIcon } from 'lucide-react';
import { useAppStore, type Tool } from './store/appStore';
import { useSettingsStore } from './store/settingsStore';
import { SAMPLES } from './ir/samples';
import { downloadBackChannelLog } from './lib/log';
import { PromptPane } from './ui/PromptPane';
import { Canvas } from './ui/Canvas';
import { LayersPanel } from './ui/LayersPanel';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { DiffRibbon } from './ui/DiffRibbon';
import { ConnectDialog } from './ui/ConnectDialog';
import { Button } from './ui/primitives/button';

export default function App() {
  const loadSample = useAppStore((s) => s.loadSample);
  const newBlank = useAppStore((s) => s.newBlank);
  const undo = useAppStore((s) => s.undo);
  const canUndo = useAppStore((s) => s.history.length > 0);
  const error = useAppStore((s) => s.error);
  const needsConnect = useAppStore((s) => s.needsConnect);
  const dismissError = useAppStore((s) => s.dismissError);

  const isConnected = useSettingsStore((s) => Boolean(s.keys[s.activeProvider]?.trim()));
  const activeLabel = useSettingsStore((s) => s.activeLabel());

  const [connectOpen, setConnectOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  useEffect(() => {
    if (needsConnect) setConnectOpen(true);
  }, [needsConnect]);

  // Figma-style keyboard shortcuts: V/R/O/L/P/T pick tools, Delete removes the
  // selection (a manipulation — it runs the back-channel), ⌘Z undoes.
  useEffect(() => {
    const TOOL_KEYS: Record<string, Tool> = {
      v: 'pointer', r: 'rectangle', o: 'circle', l: 'line', p: 'path', t: 'text',
    };
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }
      const store = useAppStore.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        store.undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const toolKey = TOOL_KEYS[e.key.toLowerCase()];
      if (toolKey) {
        store.setTool(toolKey);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && store.selectedNodeId) {
        e.preventDefault();
        store.manipulate({ kind: 'delete', id: store.selectedNodeId });
      }
      if (e.key === 'Escape' && store.tool === 'pointer') {
        store.selectNode(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <header className="flex h-12 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold tracking-tight text-slate-900">WYSIWYC</span>
          <span className="text-[11px] text-slate-400">What You See Is What You Chat</span>
        </div>

        <div className="mx-2 h-5 w-px bg-slate-200" />

        
        <div className="ml-auto flex items-center gap-1.5">
          <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen}>
            <button
              className={
                'flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium transition-colors hover:bg-slate-50'
              }
            >
              <CircleIcon
                className="h-2 w-2"
                fill={isConnected ? '#22c55e' : '#cbd5e1'}
                stroke="none"
              />
              <Plug className="h-3.5 w-3.5 text-slate-500" />
              <span className="text-slate-700">{activeLabel}</span>
            </button>
          </ConnectDialog>

          <div className="mx-1 h-5 w-px bg-slate-200" />

          <Button
            size="sm"
            variant={layersOpen ? 'secondary' : 'ghost'}
            onClick={() => setLayersOpen((v) => !v)}
            title="Toggle layers panel"
          >
            <LayersIcon className="h-3.5 w-3.5" /> Layers
          </Button>

          <div className="mx-1 h-5 w-px bg-slate-200" />

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

      {error && (
        <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
          {needsConnect && (
            <Button size="sm" onClick={() => setConnectOpen(true)}>
              <Plug className="h-3.5 w-3.5" /> Connect
            </Button>
          )}
          <button onClick={dismissError} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Body: prompt rail | (toggleable layers) | canvas | properties rail */}
      <div className="flex flex-1 overflow-hidden">
        {/* Full-height prompt rail. */}
        <div className="flex w-96 shrink-0 flex-col border-r border-slate-200 bg-white">
          <PromptPane />
        </div>

        {/* Layers — toggleable, sits to the right of the prompt panel. */}
        {layersOpen && (
          <div className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
            <LayersPanel />
          </div>
        )}

        <Canvas />

        <div className="flex w-72 shrink-0 flex-col border-l border-slate-200 bg-white">
          <PropertiesPanel />
        </div>
      </div>

      <DiffRibbon />
    </div>
  );
}
