import { CanvasProvider } from './canvas/CanvasContext';
import { CanvasEngine } from './canvas/CanvasEngine';
import { Toolbar } from './ui/Toolbar';
import { LayerPanel } from './ui/LayerPanel';
import { StatusBar } from './ui/StatusBar';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

function Shortcuts() {
  useKeyboardShortcuts();
  return null;
}

export default function App() {
  return (
    <CanvasProvider>
      <div className="flex h-full flex-col">
        <header className="flex h-10 items-center border-b bg-[var(--panel-bg)] px-3">
          <span className="text-sm font-semibold tracking-tight">WISIWIC</span>
          <span className="ml-2 text-xs text-muted-foreground">
            What I See Is What I Caption
          </span>
        </header>
        <div className="flex flex-1 overflow-hidden">
          <Toolbar />
          <CanvasEngine />
          <LayerPanel />
        </div>
        <StatusBar />
        <Shortcuts />
      </div>
    </CanvasProvider>
  );
}
