import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, ArrowUpFromLine, Pencil, ChevronDown, Sparkles } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { cn } from '@/lib/utils';
import type { ProposalConfidence } from '@/ir/types';
import { Button } from './primitives/button';

const CONFIDENCE_STYLE: Record<ProposalConfidence, string> = {
  high: 'bg-emerald-100 text-emerald-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-rose-100 text-rose-700',
};

/**
 * The back-channel banner. A direct manipulation is ALREADY in the IR; this
 * proposes how to describe it in the spec. The user cannot silently refuse a
 * substantial change — they accept it, pick one of the proposed alternatives,
 * or rephrase it themselves. (There is no "reject"/diverge path.)
 */
export function DiffRibbon() {
  const proposing = useAppStore((s) => s.proposing);
  const proposal = useAppStore((s) => s.pendingProposal);
  const accept = useAppStore((s) => s.acceptProposal);

  const primary = proposal?.updatedClauses[0];
  const alternatives = (primary?.alternatives ?? [])
    .filter((a) => a.trim() && a.trim() !== primary?.text.trim())
    .slice(0, 3);

  const [rephrasing, setRephrasing] = useState(false);
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the local edit state whenever a fresh proposal arrives.
  useEffect(() => {
    setRephrasing(false);
    setMenuOpen(false);
    setDraft(primary?.text ?? proposal?.deltaDescription ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal]);

  useEffect(() => {
    if (rephrasing) inputRef.current?.focus();
  }, [rephrasing]);

  if (!proposing && !proposal) return null;

  return (
    <div className="relative border-t bg-slate-50 px-4 py-2.5">
      <div className="flex items-center gap-3">
        <ArrowUpFromLine className="h-4 w-4 shrink-0 text-slate-400" />
        {proposing ? (
          <span className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Edit applied — describing it in the prompt…
          </span>
        ) : proposal ? (
          <>
            <span className="shrink-0 text-xs font-medium text-slate-400">Describe this edit</span>
            {rephrasing ? (
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') accept(draft);
                  if (e.key === 'Escape') setRephrasing(false);
                }}
                className="flex-1 rounded-md border border-indigo-200 bg-white px-2 py-1 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-indigo-100"
              />
            ) : (
              <span className="flex-1 text-sm text-slate-800">{proposal.deltaDescription}</span>
            )}
            <span
              className={cn(
                'shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase',
                CONFIDENCE_STYLE[proposal.confidence],
              )}
            >
              {proposal.confidence}
            </span>

            {rephrasing ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setRephrasing(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => accept(draft)}>
                  <Check className="h-3.5 w-3.5" /> Save
                </Button>
              </>
            ) : (
              <>
                {alternatives.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => setMenuOpen((v) => !v)}>
                    <Sparkles className="h-3.5 w-3.5" /> Alternatives <ChevronDown className="h-3 w-3" />
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => { setDraft(primary?.text ?? proposal.deltaDescription); setRephrasing(true); }}>
                  <Pencil className="h-3.5 w-3.5" /> Rephrase
                </Button>
                <Button size="sm" onClick={() => accept()}>
                  <Check className="h-3.5 w-3.5" /> Accept
                </Button>
              </>
            )}
          </>
        ) : null}
      </div>

      {menuOpen && alternatives.length > 0 && (
        <div className="absolute bottom-full right-4 mb-1 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg shadow-slate-300/40">
          <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <Sparkles className="h-3 w-3" /> Pick a phrasing
          </div>
          {alternatives.map((alt, i) => (
            <button
              key={i}
              onClick={() => accept(alt)}
              className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-violet-50"
            >
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-violet-400" />
              <span className="leading-snug">{alt}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
