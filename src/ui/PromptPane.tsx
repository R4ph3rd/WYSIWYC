import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import type { ClauseCategory, ComposerValue, PromptClause } from '@/ir/types';
import { cn } from '@/lib/utils';
import { RefComposer } from './RefComposer';
import { RecipesRail } from './RecipesRail';
import { emptyComposer } from '@/lib/composer';

/**
 * The prompt is a LIVING SPEC, but it must read like a person describing a
 * screen — flowing sentences, not a config table. Each sentence is a clause
 * span: hover traces its UI elements, click edits it in place, and the
 * composer below folds new natural-language instructions into it.
 */

const CATEGORY_UNDERLINE: Record<ClauseCategory, string> = {
  layout: 'decoration-sky-400/60',
  component: 'decoration-violet-400/60',
  style: 'decoration-amber-400/60',
  content: 'decoration-emerald-400/60',
};

const CATEGORY_DOT: Record<ClauseCategory, string> = {
  layout: 'bg-sky-400',
  component: 'bg-violet-400',
  style: 'bg-amber-400',
  content: 'bg-emerald-400',
};

function sentence(text: string): string {
  const t = text.trim();
  if (!t) return t;
  const capped = t[0].toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(capped) ? capped : `${capped}.`;
}

export function PromptPane() {
  const clauses = useAppStore((s) => s.prompt.clauses);
  const generating = useAppStore((s) => s.generating);
  const instruct = useAppStore((s) => s.instruct);
  const editClause = useAppStore((s) => s.editClause);
  const removeClause = useAppStore((s) => s.removeClause);
  const hoverClause = useAppStore((s) => s.hoverClause);
  const recentIds = useAppStore((s) => s.recentIds);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const selectedNodeIds = useAppStore((s) => s.selectedNodeIds);
  const composerFocused = useAppStore((s) => s.composerFocused);
  const setComposerFocused = useAppStore((s) => s.setComposerFocused);
  const selectedClauseId = useAppStore((s) =>
    selectedNodeId ? (s.ir.nodes.find((n) => n.id === selectedNodeId)?.provenance.promptClauseId ?? null) : null,
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerValue>(emptyComposer());

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="border-b border-slate-100 px-3 py-2">
        <h2 className="text-xs font-semibold tracking-tight text-slate-700">Prompt</h2>
        <p className="text-[10px] text-slate-500">
          A living description of your UI. It writes itself as you edit the canvas.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2.5">
        {clauses.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-slate-400">
            Nothing here yet — describe what you want below, or pick an example.
          </p>
        ) : (
          <p className="text-[13px] leading-7 text-slate-700">
            {clauses.map((c) =>
              editingId === c.id ? (
                <ClauseEditor
                  key={c.id}
                  clause={c}
                  onDone={(text) => {
                    setEditingId(null);
                    if (text !== null && text.trim() && text !== c.text) editClause(c.id, text);
                  }}
                />
              ) : (
                <ClauseSpan
                  key={c.id}
                  clause={c}
                  selected={selectedClauseId === c.id}
                  flash={recentIds.includes(c.id)}
                  onHover={hoverClause}
                  onEdit={() => setEditingId(c.id)}
                  onRemove={() => removeClause(c.id)}
                />
              ),
            )}
          </p>
        )}
      </div>

      {clauses.length > 0 && (
        <div className="flex items-center gap-2.5 border-t border-slate-100 px-3 py-1.5">
          {(Object.keys(CATEGORY_DOT) as ClauseCategory[]).map((cat) => (
            <span key={cat} className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-slate-400">
              <span className={cn('h-1.5 w-1.5 rounded-full', CATEGORY_DOT[cat])} /> {cat}
            </span>
          ))}
        </div>
      )}

      <div className="border-t border-slate-100 p-2.5">
        <RecipesRail />
        {composerFocused && selectedNodeIds.length > 0 && (
          <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-medium text-violet-600">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
            Editing {selectedNodeIds.length} selected element{selectedNodeIds.length > 1 ? 's' : ''}
          </div>
        )}
        <RefComposer
          value={composer}
          onChange={setComposer}
          onSend={(text, refs) => instruct(text, { scopeNodeIds: selectedNodeIds, refs })}
          onFocusChange={setComposerFocused}
          busy={generating}
          placeholder={clauses.length ? 'Describe a change…' : 'Describe the UI you want…'}
        />
      </div>
    </div>
  );
}

function ClauseSpan({
  clause,
  selected,
  flash,
  onHover,
  onEdit,
  onRemove,
}: {
  clause: PromptClause;
  selected: boolean;
  flash: boolean;
  onHover: (id: string | null) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <span
      onMouseEnter={() => onHover(clause.id)}
      onMouseLeave={() => onHover(null)}
      onClick={onEdit}
      className={cn(
        'group -mx-0.5 cursor-text rounded px-0.5 underline decoration-2 underline-offset-4 transition-colors',
        CATEGORY_UNDERLINE[clause.category],
        selected ? 'bg-indigo-50 text-indigo-900' : 'hover:bg-slate-50',
        flash && 'wysiwyc-flash',
      )}
    >
      {sentence(clause.text)}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="ml-0.5 hidden align-baseline group-hover:inline-block"
        aria-label="Remove sentence"
      >
        <X className="inline h-3 w-3 text-slate-300 hover:text-rose-500" />
      </button>{' '}
    </span>
  );
}

function ClauseEditor({
  clause,
  onDone,
}: {
  clause: PromptClause;
  onDone: (text: string | null) => void;
}) {
  const [text, setText] = useState(clause.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <textarea
      ref={ref}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onDone(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onDone(text);
        }
        if (e.key === 'Escape') onDone(null);
      }}
      rows={2}
      className="my-0.5 w-full resize-none rounded-md border border-indigo-200 bg-indigo-50/40 px-1.5 py-1 text-xs leading-snug text-slate-800 outline-none focus:ring-2 focus:ring-indigo-100"
    />
  );
}
