import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { CLAUSE_CATEGORIES, type ClauseCategory, type PromptClause } from '@/ir/types';
import { cn } from '@/lib/utils';
import { RefComposer } from './RefComposer';
import { RecipesRail } from './RecipesRail';
import { AlternativesMenu } from './AlternativesMenu';

/**
 * The prompt is a LIVING SPEC. Rather than one flat paragraph, it renders as
 * semantic sections — Layout / Components / Style / Content — so the structure
 * of the spec is visible at a glance. Each clause is a row: hover traces its UI
 * elements, single click opens alternatives/remove, double click edits in
 * place, and the composer below folds new instructions in.
 */

const CATEGORY_META: Record<ClauseCategory, { label: string; dot: string; accent: string }> = {
  layout: { label: 'Layout', dot: 'bg-sky-400', accent: 'text-sky-600' },
  component: { label: 'Components', dot: 'bg-violet-400', accent: 'text-violet-600' },
  style: { label: 'Style', dot: 'bg-amber-400', accent: 'text-amber-600' },
  content: { label: 'Content', dot: 'bg-emerald-400', accent: 'text-emerald-600' },
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
  const composerValue = useAppStore((s) => s.composerValue);
  const setComposerValue = useAppStore((s) => s.setComposerValue);
  const focusRequest = useAppStore((s) => s.focusRequest);
  const chooseAlternative = useAppStore((s) => s.chooseAlternative);
  const selectedClauseId = useAppStore((s) =>
    selectedNodeId ? (s.ir.nodes.find((n) => n.id === selectedNodeId)?.provenance.promptClauseId ?? null) : null,
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [altMenu, setAltMenu] = useState<{ clauseId: string; x: number; y: number } | null>(null);

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="border-b border-slate-100 px-3 py-2">
        <h2 className="text-xs font-semibold tracking-tight text-slate-700">Prompt</h2>
        <p className="text-[10px] text-slate-500">
          A living description of your UI. It writes itself as you edit the canvas.
        </p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {clauses.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-slate-400">
            Nothing here yet — describe what you want below, or pick an example.
          </p>
        ) : (
          CLAUSE_CATEGORIES.map((cat) => {
            const items = clauses.filter((c) => c.category === cat);
            if (items.length === 0) return null;
            const meta = CATEGORY_META[cat];
            return (
              <section key={cat}>
                <div className="mb-1.5 flex items-center gap-1.5 px-1">
                  <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
                  <span className={cn('text-[10px] font-semibold uppercase tracking-wider', meta.accent)}>
                    {meta.label}
                  </span>
                  <span className="text-[10px] font-medium text-slate-300">{items.length}</span>
                </div>
                <div className="space-y-0.5">
                  {items.map((c) =>
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
                      <ClauseItem
                        key={c.id}
                        clause={c}
                        selected={selectedClauseId === c.id}
                        flash={recentIds.includes(c.id)}
                        onHover={hoverClause}
                        onOpenMenu={(x, y) => setAltMenu({ clauseId: c.id, x, y })}
                        onEdit={() => setEditingId(c.id)}
                        onRemove={() => removeClause(c.id)}
                      />
                    ),
                  )}
                </div>
              </section>
            );
          })
        )}
      </div>

      {altMenu && (() => {
        const clause = clauses.find((c) => c.id === altMenu.clauseId);
        if (!clause) return null;
        return (
          <AlternativesMenu
            clause={clause}
            x={altMenu.x}
            y={altMenu.y}
            onPick={(text) => { chooseAlternative(clause.id, text); setAltMenu(null); }}
            onEdit={() => { setEditingId(clause.id); setAltMenu(null); }}
            onRemove={() => { removeClause(clause.id); setAltMenu(null); }}
            onClose={() => setAltMenu(null)}
          />
        );
      })()}

      <div className="border-t border-slate-100 p-2.5">
        <RecipesRail />
        {composerFocused && selectedNodeIds.length > 0 && (
          <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-medium text-violet-600">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
            Editing {selectedNodeIds.length} selected element{selectedNodeIds.length > 1 ? 's' : ''}
          </div>
        )}
        <RefComposer
          value={composerValue}
          onChange={setComposerValue}
          onSend={(text, refs) => instruct(text, { scopeNodeIds: selectedNodeIds, refs })}
          onFocusChange={setComposerFocused}
          focusRequest={focusRequest}
          busy={generating}
          placeholder={clauses.length ? 'Describe a change…' : 'Describe the UI you want…'}
        />
      </div>
    </div>
  );
}

function ClauseItem({
  clause,
  selected,
  flash,
  onHover,
  onOpenMenu,
  onEdit,
  onRemove,
}: {
  clause: PromptClause;
  selected: boolean;
  flash: boolean;
  onHover: (id: string | null) => void;
  onOpenMenu: (x: number, y: number) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const inferred = clause.origin === 'inferred';
  // Single click opens the alternatives/remove menu; a double click goes
  // straight to inline editing. A short timer disambiguates the two (a
  // double click fires two click events first).
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <div
      onMouseEnter={() => onHover(clause.id)}
      onMouseLeave={() => onHover(null)}
      onClick={(e) => {
        const { clientX, clientY } = e;
        if (clickTimer.current) return;
        clickTimer.current = setTimeout(() => {
          clickTimer.current = null;
          onOpenMenu(clientX, clientY);
        }, 220);
      }}
      onDoubleClick={() => {
        if (clickTimer.current) {
          clearTimeout(clickTimer.current);
          clickTimer.current = null;
        }
        onEdit();
      }}
      title={inferred ? 'Inferred — click for alternatives, double-click to edit' : 'Click for alternatives · double-click to edit'}
      className={cn(
        'group flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 text-[13px] leading-snug transition-colors',
        selected
          ? 'border-indigo-200 bg-indigo-50 text-indigo-900'
          : 'border-transparent text-slate-700 hover:bg-slate-50',
        flash && 'wysiwyc-flash',
      )}
    >
      <span
        className={cn(
          'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
          inferred ? 'bg-amber-400 ring-2 ring-amber-100' : 'bg-slate-200',
        )}
        aria-label={inferred ? 'inferred' : undefined}
        title={inferred ? 'Inferred — not stated by you' : undefined}
      />
      <span className="flex-1">{sentence(clause.text)}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        aria-label="Remove sentence"
      >
        <X className="h-3 w-3 text-slate-300 hover:text-rose-500" />
      </button>
    </div>
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
