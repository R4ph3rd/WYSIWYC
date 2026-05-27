import { useState } from 'react';
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
import { useModelStore } from '@/state/modelStore';
import { testConnection } from '@/llm/AnthropicClient';

const MODELS = [
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  { id: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
  { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
];

export function ConnectModelDialog({ children }: { children: React.ReactNode }) {
  const { apiKey, modelId, isConnected, setApiKey, setModelId, disconnect } = useModelStore();
  const [open, setOpen] = useState(false);
  const [keyInput, setKeyInput] = useState(apiKey ?? '');
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  const connect = async () => {
    if (!keyInput.trim()) return;
    setStatus('testing');
    setApiKey(keyInput.trim());
    setModelId(modelId);
    try {
      const ok = await testConnection(keyInput.trim(), modelId);
      setStatus(ok ? 'ok' : 'fail');
      if (ok) setTimeout(() => setOpen(false), 600);
    } catch {
      setStatus('fail');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect model</DialogTitle>
          <DialogDescription>
            Your Anthropic API key is stored only in this browser and sent directly to Anthropic.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="text-sm font-medium">API key</label>
          <Input
            type="password"
            placeholder="sk-ant-..."
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
          />

          <label className="text-sm font-medium">Model</label>
          <Select value={modelId} onValueChange={setModelId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {status === 'ok' && <p className="text-xs text-green-600">Connected.</p>}
          {status === 'fail' && (
            <p className="text-xs text-destructive">Connection failed. Check the key and try again.</p>
          )}

          <div className="mt-1 flex justify-between">
            {isConnected ? (
              <Button variant="outline" onClick={disconnect}>
                Disconnect
              </Button>
            ) : (
              <span />
            )}
            <Button onClick={connect} disabled={status === 'testing'}>
              {status === 'testing' ? 'Testing…' : 'Connect'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
