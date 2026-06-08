import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { CLAUSE_CATEGORIES, type ClauseCategory } from '@/ir/types';
import { cn } from '@/lib/utils';
import { Button } from './primitives/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './primitives/select';

const CATEGORY_STYLE: Record<ClauseCategory, string> = {
  layout: 'bg-sky-100 text-sky-700',
  component: 'bg-violet-100 text-violet-700',
  style: 'bg-amber-100 text-amber-700',
  content: 'bg-emerald-100 text-emerald-700',
};

export function PromptPane() {
  const clauses = useAppStore((s) => s.prompt.clauses);
  const editClause = useAppStore((s) => s.editClause);
  const addClause = useAppStore((s) => s.addClause);
  const removeClause = useAppStore((s) => s.removeClause);
  const hoverClause = useAppStore((s) => s.hoverClause);
  const recentIds = useAppStore((s) => s.recentIds);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const selectedClauseId = useAppStore((s) =>
    selectedNodeId ? (s.ir.nodes.find((n) => n.id === selectedNodeId)?.provenance.promptClauseId ?? null) : null,
  );

  const [draft, setDraft] = useState('');
  const [draftCat, setDraftCat] = useState<ClauseCategory>('component');

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    addClause(text, draftCat);
    setDraft('');
  };

  return (
    <div className="flex w-80 shrink-0 flex-col border-r bg-white">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight text-slate-900">Prompt</h2>
        <p className="text-[11px] text-slate-500">A living spec. Edit a clause to regenerate; hover to trace it.</p>
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
        {clauses.length === 0 && (
          <p className="px-1 py-6 text-center text-xs text-slate-400">
            No clauses yet. Add one below or load an example to begin.
          </p>
        )}
        {clauses.map((c) => (
          <div
            key={c.id}
            onMouseEnter={() => hoverClause(c.id)}
            onMouseLeave={() => hoverClause(null)}
            className={cn(
              'group rounded-lg border p-2 transition-colors',
              selectedClauseId === c.id ? 'border-indigo-300 bg-indigo-50/60' : 'border-slate-200 hover:border-slate-300',
              recentIds.includes(c.id) && 'wysiwyc-flash',
            )}
          >
            <div className="mb-1 flex items-center justify-between">
              <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide', CATEGORY_STYLE[c.category])}>
                {c.category}
              </span>
              <button
                onClick={() => removeClause(c.id)}
                className="opacity-0 transition-opacity group-hover:opacity-100"
                aria-label="Remove clause"
              >
                <X className="h-3.5 w-3.5 text-slate-400 hover:text-rose-500" />
              </button>
            </div>
            <textarea
              value={c.text}
              onChange={(e) => editClause(c.id, e.target.value)}
              rows={2}
              className="w-full resize-none bg-transparent text-xs leading-snug text-slate-700 outline-none"
            />
          </div>
        ))}
      </div>

      <div className="border-t p-3">
        <Select value={draftCat} onValueChange={(v) => setDraftCat(v as ClauseCategory)}>
          <SelectTrigger className="mb-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLAUSE_CATEGORIES.map((cat) => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
            }}
            rows={2}
            placeholder="Describe a part of the UI…"
            className="flex-1 resize-none rounded-md border border-slate-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-100"
          />
          <Button size="icon" className="h-auto self-stretch" onClick={submit} aria-label="Add clause">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
