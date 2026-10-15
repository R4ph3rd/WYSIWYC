import { useEffect, useRef } from 'react';
import { Loader2, MessageSquare } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { cn } from '@/lib/utils';
import { RefComposer } from './RefComposer';

/**
 * The chat-only baseline's left rail: a Lovable-style transcript instead of
 * the living spec. Same compose call and model as WYSIWYC; only the surface
 * differs (no spec widgets, no proposals, canvas read-only).
 */
export function ChatPane() {
  const chatLog = useAppStore((s) => s.chatLog);
  const generating = useAppStore((s) => s.generating);
  const instruct = useAppStore((s) => s.instruct);
  const composerValue = useAppStore((s) => s.composerValue);
  const setComposerValue = useAppStore((s) => s.setComposerValue);
  const setComposerFocused = useAppStore((s) => s.setComposerFocused);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [chatLog.length, generating]);

  return (
    <div className="flex h-full flex-col bg-white" data-testid="chat-pane">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Chat</span>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {chatLog.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-xs text-slate-500">
            <MessageSquare className="h-5 w-5 text-slate-300" />
            Describe the screen you want. Every change is a new message.
          </div>
        )}
        {chatLog.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-snug',
                m.role === 'user'
                  ? 'rounded-br-md bg-slate-900 text-white'
                  : m.error
                    ? 'rounded-bl-md border border-rose-200 bg-rose-50 text-rose-700'
                    : 'rounded-bl-md bg-slate-100 text-slate-700',
              )}
            >
              {m.text}
            </div>
          </div>
        ))}
        {generating && (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="border-t border-slate-100 p-2.5">
        <RefComposer
          value={composerValue}
          onChange={setComposerValue}
          onSend={(text, refs) => instruct(text, { refs })}
          onFocusChange={setComposerFocused}
          busy={generating}
          placeholder={chatLog.length ? 'Ask for a change…' : 'Describe the UI you want…'}
        />
      </div>
    </div>
  );
}
