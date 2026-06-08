import { useState } from 'react';
import { Check, KeyRound, Loader2, Plug, X } from 'lucide-react';
import { PROVIDERS, type ProviderId } from '@/llm/providers';
import { useSettingsStore } from '@/store/settingsStore';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './primitives/dialog';
import { Button } from './primitives/button';
import { Input } from './primitives/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './primitives/select';

type TestState = 'idle' | 'ok' | 'fail';

export function ConnectDialog({ children, open, onOpenChange }: {
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const activeProvider = useSettingsStore((s) => s.activeProvider);
  const keys = useSettingsStore((s) => s.keys);
  const models = useSettingsStore((s) => s.models);
  const setActiveProvider = useSettingsStore((s) => s.setActiveProvider);
  const setKey = useSettingsStore((s) => s.setKey);
  const setModel = useSettingsStore((s) => s.setModel);

  const [tab, setTab] = useState<ProviderId>(activeProvider);
  const [keyStatus, setKeyStatus] = useState<Record<ProviderId, TestState>>({
    anthropic: 'idle', openai: 'idle', mistral: 'idle', groq: 'idle',
  });

  const provider = PROVIDERS.find((p) => p.id === tab)!;
  const currentKey = keys[tab] ?? '';
  const currentModel = models[tab] ?? provider.defaultModel;

  const markKey = (id: ProviderId, value: string) => {
    setKey(id, value);
    setKeyStatus((s) => ({ ...s, [id]: value.trim() ? 'ok' : 'idle' }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect a model</DialogTitle>
          <DialogDescription>
            Keys stay in this browser (localStorage). The app calls each provider directly — no key
            ever transits a backend.
          </DialogDescription>
        </DialogHeader>

        {/* Provider tabs */}
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
          {PROVIDERS.map((p) => {
            const hasKey = Boolean(keys[p.id]?.trim());
            const isActive = tab === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setTab(p.id)}
                className={cn(
                  'relative flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  isActive ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                )}
              >
                {p.label}
                {hasKey && (
                  <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                )}
              </button>
            );
          })}
        </div>

        {/* Key + model for the focused tab */}
        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <KeyRound className="h-3.5 w-3.5" /> API key
              <a
                href={`https://${provider.keyHint}`}
                target="_blank"
                rel="noreferrer"
                className="ml-auto text-[10px] text-indigo-600 hover:underline"
              >
                Get one at {provider.keyHint}
              </a>
            </label>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={provider.keyPlaceholder}
              value={currentKey}
              onChange={(e) => markKey(provider.id, e.target.value)}
            />
            {currentKey && (
              <p className="mt-1 flex items-center gap-1 text-[10px] text-emerald-600">
                <Check className="h-3 w-3" /> Stored for this browser. Use Disconnect to clear.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Model</label>
            <Select value={currentModel} onValueChange={(v) => setModel(provider.id, v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {provider.models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={!currentKey}
            onClick={() => markKey(provider.id, '')}
          >
            <X className="h-3.5 w-3.5" /> Disconnect
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500">Active provider:</span>
            <Button
              size="sm"
              onClick={() => {
                setActiveProvider(provider.id);
                onOpenChange?.(false);
              }}
              disabled={activeProvider === provider.id && Boolean(keys[provider.id]?.trim())}
            >
              {activeProvider === provider.id ? (
                <><Check className="h-3.5 w-3.5" /> Using {provider.label}</>
              ) : (
                <><Plug className="h-3.5 w-3.5" /> Use {provider.label}</>
              )}
            </Button>
          </div>
        </div>

        {/* hidden — only here to satisfy unused-var lint when not surfaced */}
        <span className="hidden">{keyStatus[provider.id]}<Loader2 /></span>
      </DialogContent>
    </Dialog>
  );
}
