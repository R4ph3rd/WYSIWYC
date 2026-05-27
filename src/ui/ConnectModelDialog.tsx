import { useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
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
import { useModelStore, type ModelSelection } from '@/state/modelStore';
import { PROVIDERS, modelsByRole, modelLabel, testKey, type ProviderId } from '@/llm/providers';

type TestState = 'idle' | 'testing' | 'ok' | 'fail';

function encode(sel: ModelSelection): string {
  return `${sel.provider}:${sel.model}`;
}
function decode(value: string): ModelSelection {
  const [provider, ...rest] = value.split(':');
  return { provider: provider as ProviderId, model: rest.join(':') };
}

export function ConnectModelDialog({ children }: { children: React.ReactNode }) {
  const { keys, text, image, setKey, removeKey, setText, setImage } = useModelStore();
  const [status, setStatus] = useState<Record<string, TestState>>({});

  const test = async (provider: ProviderId) => {
    const key = keys[provider];
    if (!key) return;
    setStatus((s) => ({ ...s, [provider]: 'testing' }));
    const ok = await testKey(provider, key);
    setStatus((s) => ({ ...s, [provider]: ok ? 'ok' : 'fail' }));
  };

  const textOptions = modelsByRole('text');
  const imageOptions = modelsByRole('image');

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect models</DialogTitle>
          <DialogDescription>
            Keys are stored only in this browser and sent directly to each provider. Add keys for the
            providers you want to use, then pick a prompt-sync model and an image model.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {PROVIDERS.map((p) => {
            const st = status[p.id] ?? 'idle';
            return (
              <div key={p.id} className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-xs font-medium">{p.label}</span>
                <Input
                  type="password"
                  className="h-8 text-xs"
                  placeholder={p.keyPlaceholder}
                  value={keys[p.id] ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) setKey(p.id, v);
                    else removeKey(p.id);
                    setStatus((s) => ({ ...s, [p.id]: 'idle' }));
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 w-16 shrink-0"
                  disabled={!keys[p.id] || st === 'testing'}
                  onClick={() => test(p.id)}
                >
                  {st === 'testing' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : st === 'ok' ? (
                    <Check className="h-3.5 w-3.5 text-green-600" />
                  ) : st === 'fail' ? (
                    <X className="h-3.5 w-3.5 text-destructive" />
                  ) : (
                    'Test'
                  )}
                </Button>
              </div>
            );
          })}
        </div>

        <div className="mt-1 grid grid-cols-2 gap-3 border-t pt-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Prompt sync (text)</label>
            <Select value={encode(text)} onValueChange={(v) => setText(decode(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {textOptions.map(({ provider, model }) => (
                  <SelectItem key={`${provider}:${model.id}`} value={`${provider}:${model.id}`}>
                    {modelLabel(provider, model.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Image generation</label>
            <Select
              value={image ? encode(image) : 'local'}
              onValueChange={(v) => setImage(v === 'local' ? null : decode(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local placeholder (offline)</SelectItem>
                {imageOptions.map(({ provider, model }) => (
                  <SelectItem key={`${provider}:${model.id}`} value={`${provider}:${model.id}`}>
                    {modelLabel(provider, model.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
