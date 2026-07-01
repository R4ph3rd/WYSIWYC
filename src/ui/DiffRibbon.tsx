import { Loader2, Sparkles } from 'lucide-react';
import { useAppStore } from '@/store/appStore';

/**
 * The back-channel banner. A direct manipulation is ALREADY in the IR; the
 * spec needs to describe it. Rather than open a panel above the composer, we
 * show a slim amber notice with the change count and two text actions:
 *  - "Review changes" scrolls the spec to the first proposed clause.
 *  - "Accept all" folds every proposed clause into the spec at once.
 * Per-change accept / rephrase / alternatives live inline on the clauses
 * themselves (see PromptPane).
 */
export function DiffRibbon({ onReview }: { onReview: () => void }) {
  const proposing = useAppStore((s) => s.proposing);
  const proposal = useAppStore((s) => s.pendingProposal);
  const accept = useAppStore((s) => s.acceptProposal);

  if (!proposing && !proposal) return null;

  if (proposing) {
    return (
      <div className="flex items-center gap-2 border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        Edit applied — describing it in the spec…
      </div>
    );
  }

  const count = (proposal?.updatedClauses.length ?? 0) + (proposal?.removedClauseIds.length ?? 0);

  return (
    <div className="flex items-center gap-2 border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-500" />
      <span className="flex-1 font-medium">
        {count} proposed change{count === 1 ? '' : 's'}
      </span>
      <button
        onClick={onReview}
        className="rounded px-1.5 py-0.5 font-semibold text-amber-700 underline-offset-2 hover:bg-amber-100 hover:underline"
      >
        Review changes
      </button>
      <button
        onClick={() => accept()}
        className="rounded bg-slate-900 px-2 py-0.5 font-semibold text-white transition-colors hover:bg-slate-800"
      >
        Accept all
      </button>
    </div>
  );
}
