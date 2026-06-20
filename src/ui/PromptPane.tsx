import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { CLAUSE_CATEGORIES, type ClauseCategory, type IRNode, type ParamSpan, type PromptClause } from '@/ir/types';
import { cn } from '@/lib/utils';
import { paramsForClause } from '@/ir/paramLexer';
import { COLOR_NAMES } from '@/ir/paramLexer';
import { RefComposer } from './RefComposer';
import { RecipesRail } from './RecipesRail';
import { AlternativesMenu } from './AlternativesMenu';
import { ParamPopover } from './ParamPopover';

/**
 * The prompt is a LIVING SPEC with two views the user can switch between:
 *  - "Structured": semantic sections (Layout / Components / Style / Content),
 *    each clause its own row.
 *  - "Prose": the spec read as flowing sentences in document order, each clause
 *    underlined in its category color.
 * In both, hover traces a clause's UI elements, single click opens
 * alternatives/remove, and double click edits in place.
 */

type SpecView = 'structured' | 'prose';

const CATEGORY_META: Record<ClauseCategory, { label: string; dot: string; accent: string; underline: string }> = {
  layout: { label: 'Layout', dot: 'bg-sky-400', accent: 'text-sky-600', underline: 'decoration-sky-400/70' },
  component: { label: 'Components', dot: 'bg-violet-400', accent: 'text-violet-600', underline: 'decoration-violet-400/70' },
  style: { label: 'Style', dot: 'bg-amber-400', accent: 'text-amber-600', underline: 'decoration-amber-400/70' },
  content: { label: 'Content', dot: 'bg-emerald-400', accent: 'text-emerald-600', underline: 'decoration-emerald-400/70' },
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
  const setClauseParam = useAppStore((s) => s.setClauseParam);
  const irNodes = useAppStore((s) => s.ir.nodes);
  const selectedClauseId = useAppStore((s) =>
    selectedNodeId ? (s.ir.nodes.find((n) => n.id === selectedNodeId)?.provenance.promptClauseId ?? null) : null,
  );

  // Nodes owned by each clause (provenance link), for binding lexer param spans.
  const ownedByClause = useMemo(() => {
    const m = new Map<string, IRNode[]>();
    for (const n of irNodes) {
      const cid = n.provenance.promptClauseId;
      if (!cid) continue;
      (m.get(cid) ?? m.set(cid, []).get(cid)!).push(n);
    }
    return m;
  }, [irNodes]);
  const spansFor = (c: PromptClause): ParamSpan[] => paramsForClause(c, ownedByClause.get(c.id) ?? []);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [altMenu, setAltMenu] = useState<{ clauseId: string; x: number; y: number } | null>(null);
  const [view, setView] = useState<SpecView>('structured');
  // A clicked parameter token → its widget popover. `original` snapshots the
  // clause text+params at open so live drags splice from a stable base.
  const [paramPopover, setParamPopover] = useState<
    { clauseId: string; span: ParamSpan; original: { text: string; params?: ParamSpan[] }; x: number; y: number } | null
  >(null);

  const onDoneEdit = (c: PromptClause) => (text: string | null) => {
    setEditingId(null);
    if (text !== null && text.trim() && text !== c.text) editClause(c.id, text);
  };
  const clauseHandlers = (c: PromptClause) => ({
    selected: selectedClauseId === c.id,
    flash: recentIds.includes(c.id),
    spans: spansFor(c),
    onHover: hoverClause,
    onOpenMenu: (x: number, y: number) => setAltMenu({ clauseId: c.id, x, y }),
    onEdit: () => setEditingId(c.id),
    onRemove: () => removeClause(c.id),
    onParam: (span: ParamSpan, e: React.MouseEvent) =>
      setParamPopover({ clauseId: c.id, span, original: { text: c.text, params: c.params }, x: e.clientX, y: e.clientY }),
  });

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Spec</span>
        <div className="ml-auto flex rounded-md border border-slate-200 p-0.5">
          {(['structured', 'prose'] as SpecView[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'rounded px-2 py-0.5 text-[10px] font-medium capitalize transition-colors',
                view === v ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100',
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {clauses.length > 0 && (
        <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-1 text-[10px] text-slate-400">
          <span className="rounded-sm bg-indigo-50/70 px-0.5 font-medium text-indigo-700 underline decoration-dotted decoration-indigo-300 underline-offset-2">
            underlined
          </span>
          values are editable — click to tweak
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {clauses.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-slate-400">
            Nothing here yet — describe what you want below, or pick an example.
          </p>
        ) : view === 'structured' ? (
          <div className="space-y-4">
            {CLAUSE_CATEGORIES.map((cat) => {
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
                        <ClauseEditor key={c.id} clause={c} onDone={onDoneEdit(c)} />
                      ) : (
                        <ClauseItem key={c.id} clause={c} {...clauseHandlers(c)} />
                      ),
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <>
            <p className="text-[13px] leading-7 text-slate-700">
              {clauses.map((c) =>
                editingId === c.id ? (
                  <ClauseEditor key={c.id} clause={c} onDone={onDoneEdit(c)} />
                ) : (
                  <ClauseInline key={c.id} clause={c} {...clauseHandlers(c)} />
                ),
              )}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2.5 border-t border-slate-100 pt-2.5">
              {CLAUSE_CATEGORIES.map((cat) => (
                <span key={cat} className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-slate-400">
                  <span className={cn('h-1.5 w-1.5 rounded-full', CATEGORY_META[cat].dot)} /> {CATEGORY_META[cat].label}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {paramPopover && (
        <ParamPopover
          span={paramPopover.span}
          x={paramPopover.x}
          y={paramPopover.y}
          onChange={(value) =>
            setClauseParam(paramPopover.clauseId, paramPopover.span, value, paramPopover.original)
          }
          onClose={() => setParamPopover(null)}
        />
      )}

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

/**
 * A clause's prose with its parameter tokens (offsets index into raw
 * `clause.text`) rendered as clickable widgets. Capitalizes the first plain
 * character and appends a trailing period for display (no offset drift).
 */
function ClauseContent({
  text,
  spans,
  onParam,
}: {
  text: string;
  spans: ParamSpan[];
  onParam: (span: ParamSpan, e: React.MouseEvent) => void;
}) {
  const ordered = [...spans].sort((a, b) => a.start - b.start);
  const out: React.ReactNode[] = [];
  let i = 0;
  let capped = false;
  const pushPlain = (s: string, key: string) => {
    if (!s) return;
    let t = s;
    if (!capped) {
      t = t.replace(/^(\s*)(\p{L})/u, (_, sp: string, ch: string) => sp + ch.toUpperCase());
      capped = true;
    }
    out.push(<span key={key}>{t}</span>);
  };
  ordered.forEach((sp, k) => {
    if (sp.start > i) pushPlain(text.slice(i, sp.start), `t${k}`);
    else capped = true; // token at sentence start — don't capitalize a token
    out.push(<ParamToken key={`p${k}`} span={sp} label={text.slice(sp.start, sp.end)} onParam={onParam} />);
    i = sp.end;
  });
  pushPlain(text.slice(i), 'tail');
  if (!/[.!?…]\s*$/.test(text)) out.push('.');
  return <>{out}</>;
}

const PARAM_LABEL: Record<ParamSpan['kind'], string> = {
  color: 'color', length: 'size', fontFamily: 'font', fontWeight: 'weight', shadow: 'shadow',
  radius: 'corners', opacity: 'opacity', align: 'alignment', enum: 'option', text: 'value',
};

/** One clickable parameter word inside a clause. */
function ParamToken({
  span,
  label,
  onParam,
}: {
  span: ParamSpan;
  label: string;
  onParam: (span: ParamSpan, e: React.MouseEvent) => void;
}) {
  const swatch =
    span.kind === 'color'
      ? (/^#|^rgb/i.test(span.value) ? span.value : COLOR_NAMES[label.toLowerCase()] ?? span.value)
      : null;
  return (
    <span
      role="button"
      title={`Edit ${PARAM_LABEL[span.kind]}`}
      onClick={(e) => { e.stopPropagation(); onParam(span, e); }}
      onDoubleClick={(e) => e.stopPropagation()}
      className="cursor-pointer rounded-sm bg-indigo-50/70 px-0.5 font-medium text-indigo-700 underline decoration-dotted decoration-indigo-300 underline-offset-2 hover:bg-indigo-100"
    >
      {swatch && (
        <span
          className="mr-0.5 inline-block h-2 w-2 rounded-full align-middle ring-1 ring-black/10"
          style={{ background: swatch }}
        />
      )}
      {label}
    </span>
  );
}

function ClauseItem({
  clause,
  selected,
  flash,
  spans,
  onHover,
  onOpenMenu,
  onEdit,
  onRemove,
  onParam,
}: {
  clause: PromptClause;
  selected: boolean;
  flash: boolean;
  spans: ParamSpan[];
  onHover: (id: string | null) => void;
  onOpenMenu: (x: number, y: number) => void;
  onEdit: () => void;
  onRemove: () => void;
  onParam: (span: ParamSpan, e: React.MouseEvent) => void;
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
      <span className="flex-1"><ClauseContent text={clause.text} spans={spans} onParam={onParam} /></span>
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

/** Prose-view clause: an inline, category-underlined sentence span. */
function ClauseInline({
  clause,
  selected,
  flash,
  spans,
  onHover,
  onOpenMenu,
  onEdit,
  onRemove,
  onParam,
}: {
  clause: PromptClause;
  selected: boolean;
  flash: boolean;
  onHover: (id: string | null) => void;
  onOpenMenu: (x: number, y: number) => void;
  onEdit: () => void;
  onRemove: () => void;
  onParam: (span: ParamSpan, e: React.MouseEvent) => void;
  spans: ParamSpan[];
}) {
  const inferred = clause.origin === 'inferred';
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <span
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
        'group -mx-0.5 cursor-pointer rounded px-0.5 underline decoration-2 underline-offset-4 transition-colors',
        CATEGORY_META[clause.category].underline,
        selected ? 'bg-indigo-50 text-indigo-900' : 'hover:bg-slate-50',
        flash && 'wysiwyc-flash',
      )}
    >
      {inferred && (
        <span
          className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle ring-2 ring-amber-100"
          aria-label="inferred"
        />
      )}
      <ClauseContent text={clause.text} spans={spans} onParam={onParam} />
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
