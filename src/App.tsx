import { useEffect, useState } from 'react';
import { Undo2, FilePlus2, AlertTriangle, X, Plug, Circle as CircleIcon, Layers as LayersIcon } from 'lucide-react';
import { useAppStore, type Tool } from './store/appStore';
import { useSettingsStore } from './store/settingsStore';
import { familyFromStack } from './lib/fonts';
import { loadGoogleFont } from './lib/loadFont';
import { SAMPLES } from './ir/samples';
import { PromptPane } from './ui/PromptPane';
import { Canvas } from './ui/Canvas';
import { LayersPanel } from './ui/LayersPanel';
import { PropertiesPanel } from './ui/PropertiesPanel';
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
  // Layers panel collapses to a narrow icon bar by default (false).
  const [layersOpen, setLayersOpen] = useState(false);

  // Lazily load any Google font actually in use by a node's style.fontFamily
  // (deduped in loadGoogleFont). Never loads the whole catalogue up front.
  const irNodes = useAppStore((s) => s.ir.nodes);
  useEffect(() => {
    const families = new Set<string>();
    for (const n of irNodes) {
      const f = familyFromStack(n.style?.fontFamily);
      if (f) families.add(f);
    }
    families.forEach((f) => loadGoogleFont(f));
  }, [irNodes]);
  useEffect(() => {
    if (needsConnect) setConnectOpen(true);
  }, [needsConnect]);

  // Figma-style keyboard shortcuts: V/R/O/L/P/T pick tools, Delete removes the
  // selection, ⌘Z undo, ⌘C/⌘V copy/paste, ⌘D duplicate, ? opens the shortcut
  // sheet. An unbound modifier combo flags the "see all shortcuts" hint.
  useEffect(() => {
    const TOOL_KEYS: Record<string, Tool> = {
      v: 'pointer', r: 'rectangle', o: 'circle', l: 'line', p: 'path', t: 'text',
    };
    // Modifier combos the browser owns — never hijack or flag these.
    const RESERVED = new Set([
      'r', 't', 'w', 'n', 'q', 's', 'p', 'f', 'a', 'x', '+', '-', '=', '0',
      '1', '2', '3', '4', '5', '6', '7', '8', '9',
    ]);
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      const store = useAppStore.getState();

      if (e.metaKey || e.ctrlKey) {
        if (typing) return; // leave text-field clipboard/undo to the browser
        const k = e.key.toLowerCase();
        if (k === 'z') { e.preventDefault(); store.undo(); return; }
        if (k === 'c') { if (store.selectedNodeIds.length) { e.preventDefault(); store.copySelection(); } return; }
        if (k === 'v') { if (store.clipboard) { e.preventDefault(); store.pasteClipboard(); } return; }
        if (k === 'd') { if (store.selectedNodeId) { e.preventDefault(); store.duplicateNode(store.selectedNodeId); } return; }
        // Any other (non-reserved) combo isn't bound — hint at the shortcut sheet.
        if (k.length === 1 && !RESERVED.has(k)) store.flagUnknownShortcut();
        return;
      }
      if (e.altKey) return;
      if (typing) return;

      if (e.key === '?') { store.setShortcutsOpen(true); return; }
      if (e.key === 'Escape') {
        if (store.shortcutsOpen) store.setShortcutsOpen(false);
        else if (store.tool === 'pointer') store.selectNode(null);
        return;
      }
      const toolKey = TOOL_KEYS[e.key.toLowerCase()];
      if (toolKey) { store.setTool(toolKey); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && store.selectedNodeId) {
        e.preventDefault();
        store.manipulate({ kind: 'delete', id: store.selectedNodeId });
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

          <Button size="sm" variant="ghost" onClick={newBlank}>
            <FilePlus2 className="h-3.5 w-3.5" /> New
          </Button>
          <Button size="sm" variant="ghost" onClick={undo} disabled={!canUndo}>
            <Undo2 className="h-3.5 w-3.5" /> Undo
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

      {/* Body: prompt rail | layers bar/panel | canvas | properties rail */}
      <div className="flex flex-1 overflow-hidden">
        {/* Full-height prompt rail. */}
        <div className="flex w-96 shrink-0 flex-col border-r border-slate-200 bg-white">
          <PromptPane />
        </div>

        {/* Layers — a vertical bar on the right of the spec that expands into
            the full panel when toggled on. */}
        {layersOpen ? (
          <div className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
            <LayersPanel onCollapse={() => setLayersOpen(false)} />
          </div>
        ) : (
          <button
            onClick={() => setLayersOpen(true)}
            title="Show layers"
            className="flex w-8 shrink-0 flex-col items-center gap-2 border-r border-slate-200 bg-white py-3 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
          >
            <LayersIcon className="h-4 w-4" />
            {/* <span className="text-[10px] font-semibold uppercase tracking-wider [writing-mode:vertical-rl]">
              Layers
            </span> */}
          </button>
        )}

        <Canvas />

        <div className="flex w-72 shrink-0 flex-col border-l border-slate-200 bg-white">
          <PropertiesPanel />
        </div>
      </div>
    </div>
  );
}
