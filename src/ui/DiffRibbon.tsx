import { Check, X, Loader2, ArrowUpFromLine } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { cn } from '@/lib/utils';
import type { ProposalConfidence } from '@/ir/types';
import { Button } from './primitives/button';

const CONFIDENCE_STYLE: Record<ProposalConfidence, string> = {
  high: 'bg-emerald-100 text-emerald-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-rose-100 text-rose-700',
};

export function DiffRibbon() {
  const proposing = useAppStore((s) => s.proposing);
  const proposal = useAppStore((s) => s.pendingProposal);
  const accept = useAppStore((s) => s.acceptProposal);
  const reject = useAppStore((s) => s.rejectProposal);

  if (!proposing && !proposal) return null;

  return (
    <div className="flex items-center gap-3 border-t bg-slate-50 px-4 py-2.5">
      <ArrowUpFromLine className="h-4 w-4 shrink-0 text-slate-400" />
      {proposing ? (
        <span className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Inferring the prompt change from your edit…
        </span>
      ) : proposal ? (
        <>
          <span className="text-xs font-medium text-slate-400">Proposed prompt update</span>
          <span className="flex-1 text-sm text-slate-800">{proposal.deltaDescription}</span>
          <span className={cn('rounded px-2 py-0.5 text-[10px] font-semibold uppercase', CONFIDENCE_STYLE[proposal.confidence])}>
            {proposal.confidence}
          </span>
          <Button size="sm" variant="outline" onClick={reject}>
            <X className="h-3.5 w-3.5" /> Reject
          </Button>
          <Button size="sm" onClick={accept}>
            <Check className="h-3.5 w-3.5" /> Accept
          </Button>
        </>
      ) : null}
    </div>
  );
}
