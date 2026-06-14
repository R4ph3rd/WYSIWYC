import { Wand2, Plus } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { cn } from '@/lib/utils';

/**
 * Recipes rail (DirectGPT principle d: reusable prompts as a toolbar). Any
 * accepted instruction can be abstracted into a one-click command; clicking a
 * recipe re-runs its instruction scoped to the CURRENT selection. Quiet by
 * default; disabled (with a reason) when nothing is selected.
 */
export function RecipesRail() {
  const recipes = useAppStore((s) => s.recipes);
  const lastSent = useAppStore((s) => s.lastSent);
  const selectedNodeIds = useAppStore((s) => s.selectedNodeIds);
  const applyRecipe = useAppStore((s) => s.applyRecipe);
  const addRecipe = useAppStore((s) => s.addRecipe);

  const hasSelection = selectedNodeIds.length > 0;
  const canSave = Boolean(lastSent);

  if (recipes.length === 0 && !canSave) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1 pb-2">
      <span className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-slate-400">
        <Wand2 className="h-3 w-3" /> Recipes
      </span>

      {recipes.map((r) => (
        <button
          key={r.id}
          onClick={() => hasSelection && applyRecipe(r.id)}
          disabled={!hasSelection}
          title={
            hasSelection
              ? `Apply to selection — “${r.instruction}”${r.uses ? ` · used ${r.uses}×` : ''}`
              : 'Select an element first'
          }
          className={cn(
            'group inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 transition-colors',
            hasSelection
              ? 'bg-white text-slate-700 ring-slate-200 hover:bg-indigo-50 hover:text-indigo-700 hover:ring-indigo-200'
              : 'cursor-not-allowed bg-slate-50 text-slate-400 ring-slate-100',
          )}
        >
          <span className="max-w-[12rem] truncate">{r.label}</span>
          {r.uses > 0 && <span className="text-[9px] text-slate-400">{r.uses}×</span>}
        </button>
      ))}

      {canSave && (
        <button
          onClick={() => lastSent && addRecipe(lastSent)}
          title={`Save the last instruction as a reusable recipe — “${lastSent}”`}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:border-indigo-300 hover:text-indigo-600"
        >
          <Plus className="h-3 w-3" /> Save as recipe
        </button>
      )}
    </div>
  );
}
