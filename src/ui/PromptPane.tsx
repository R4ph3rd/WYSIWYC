import { useEffect, useMemo, useRef, useState } from 'react';
import { X, RefreshCw, Sparkles, Check, CheckCheck } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { CLAUSE_CATEGORIES, type ClauseCategory, type IRNode, type ParamKind, type ParamSpan, type PromptClause } from '@/ir/types';
import { cn } from '@/lib/utils';
import { paramsForClause, COLOR_NAMES } from '@/ir/paramLexer';
import { RefComposer } from './RefComposer';
import { RecipesRail } from './RecipesRail';
import { AlternativesMenu } from './AlternativesMenu';
import { ParamPopover } from './ParamPopover';
import { DiffRibbon } from './DiffRibbon';
import { VersionRail } from './VersionRail';

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

/**
 * Character offsets of a DOM selection range within a clause's rendered text
 * root. The rendered content only re-cases the first letter and may append a
 * trailing period, so text-node offsets map 1:1 onto `clause.text` (the caller
 * clamps the tail). Returns null for selections not fully inside text nodes.
 */
function selectionOffsets(root: Element, range: Range): { start: number; end: number } | null {
  const offsetOf = (node: Node, offset: number): number | null => {
    let acc = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      if (n === node) return acc + offset;
      acc += n.textContent?.length ?? 0;
    }
    return null;
  };
  const a = offsetOf(range.startContainer, range.startOffset);
  const b = offsetOf(range.endContainer, range.endOffset);
  if (a === null || b === null || a === b) return null;
  return { start: Math.min(a, b), end: Math.max(a, b) };
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
  const acceptProposal = useAppStore((s) => s.acceptProposal);
  const discardProposal = useAppStore((s) => s.discardProposal);
  const acceptClauses = useAppStore((s) => s.acceptClauses);
  const dismissClauses = useAppStore((s) => s.dismissClauses);
  const setClauseParam = useAppStore((s) => s.setClauseParam);
  const selectNode = useAppStore((s) => s.selectNode);
  const irNodes = useAppStore((s) => s.ir.nodes);
  const pendingProposal = useAppStore((s) => s.pendingProposal);
  const proposing = useAppStore((s) => s.proposing);
  const irSyncMode = useAppStore((s) => s.irSyncMode);
  const hasPendingSync = useAppStore((s) => s.pendingSync !== null);
  const syncNow = useAppStore((s) => s.syncNow);
  const selectedClauseId = useAppStore((s) =>
    selectedNodeId ? (s.ir.nodes.find((n) => n.id === selectedNodeId)?.provenance.promptClauseId ?? null) : null,
  );
  const hoverParam = useAppStore((s) => s.hoverParam);
  // For reverse attribution: which param tokens control the selected node(s).
  const selectedNodeSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);

  // While a Call B proposal is pending, preview the spec with the proposed
  // clauses merged in and flagged, so the change appears in place in the IR.
  const { displayClauses, pendingIds } = useMemo(() => {
    if (!pendingProposal) return { displayClauses: clauses, pendingIds: new Set<string>() };
    const removed = new Set(pendingProposal.removedClauseIds);
    const updatedById = new Map(pendingProposal.updatedClauses.map((c) => [c.id, c]));
    const merged = clauses.filter((c) => !removed.has(c.id)).map((c) => updatedById.get(c.id) ?? c);
    for (const c of pendingProposal.updatedClauses) if (!merged.some((m) => m.id === c.id)) merged.push(c);
    return { displayClauses: merged, pendingIds: new Set(updatedById.keys()) };
  }, [clauses, pendingProposal]);

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
  // Clauses the app added on its own (inferred from a drawn shape) that still
  // await the user's accept/dismiss.
  const suggestedIds = clauses.filter((c) => c.status === 'pending').map((c) => c.id);
  // Binding context: the whole IR (descendants / layout parents of owned
  // nodes) and other clauses' text (to match subjects like "page title").
  const lexCtx = useMemo(() => {
    const textById = new Map(clauses.map((c) => [c.id, c.text]));
    return { nodes: irNodes, clauseText: (id: string) => textById.get(id) };
  }, [irNodes, clauses]);
  const spansFor = (c: PromptClause): ParamSpan[] => paramsForClause(c, ownedByClause.get(c.id) ?? [], lexCtx);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [altMenu, setAltMenu] = useState<{ clauseId: string; x: number; y: number; pending?: boolean } | null>(null);
  const [view, setView] = useState<SpecView>('structured');
  const scrollRef = useRef<HTMLDivElement>(null);

  // "Review changes" (DiffRibbon) scrolls the spec to the first proposed clause.
  const reviewChanges = () => {
    const firstId = pendingProposal?.updatedClauses[0]?.id;
    if (!firstId) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-clause-id="${CSS.escape(firstId)}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  // A clicked parameter token → its widget popover. `original` snapshots the
  // clause text+params at open so live drags splice from a stable base.
  const [paramPopover, setParamPopover] = useState<
    { clauseId: string; span: ParamSpan; original: { text: string; params?: ParamSpan[] }; x: number; y: number } | null
  >(null);

  // Manual span binding: a text selection inside a clause → "bind to widget"
  // menu (Malleable Prompting: reify ANY preference expression, not just the
  // ones the lexer or model recognized).
  const bindClauseParam = useAppStore((s) => s.bindClauseParam);
  const [bindMenu, setBindMenu] = useState<
    { clauseId: string; start: number; end: number; x: number; y: number } | null
  >(null);
  const onSpecMouseUp = (e: React.MouseEvent) => {
    const { clientX, clientY } = e;
    // Defer one tick so the browser finalizes the selection before we read it.
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setBindMenu(null); return; }
      const range = sel.getRangeAt(0);
      const anchor = range.commonAncestorContainer;
      const el = anchor instanceof Element ? anchor : anchor.parentElement;
      const textRoot = el?.closest('[data-clause-text]');
      const clauseEl = el?.closest('[data-clause-id]');
      const clauseId = clauseEl?.getAttribute('data-clause-id');
      if (!textRoot || !clauseId) return;
      const clause = clauses.find((c) => c.id === clauseId);
      if (!clause) return;
      const offs = selectionOffsets(textRoot, range);
      if (!offs) return;
      // Clamp to the raw clause text (display appends a trailing period) and
      // trim whitespace from the selection edges.
      let start = Math.min(offs.start, clause.text.length);
      let end = Math.min(offs.end, clause.text.length);
      while (start < end && /\s/.test(clause.text[start])) start++;
      while (end > start && /\s/.test(clause.text[end - 1])) end--;
      if (start >= end) return;
      setBindMenu({ clauseId, start, end, x: clientX, y: clientY });
    }, 0);
  };

  const onDoneEdit = (c: PromptClause) => (text: string | null) => {
    setEditingId(null);
    if (text !== null && text.trim() && text !== c.text) editClause(c.id, text);
  };
  // Rephrasing a proposed clause accepts the proposal with the new wording.
  // A cancel (Esc), an empty value, or a blur that left the text unchanged all
  // leave it proposed — it stays pending until the user accepts, genuinely
  // rephrases, or discards it.
  const onDonePendingEdit = (c: PromptClause) => (text: string | null) => {
    setEditingId(null);
    if (text !== null && text.trim() && text.trim() !== c.text.trim()) acceptProposal(text);
  };
  // Proposed (pending) clauses expose no param tokens (their value isn't in the
  // store yet), but ARE interactive: single click opens alternatives, double
  // click rephrases, and the Proposed badge accepts on hover.
  const clauseHandlers = (c: PromptClause, pending = false) => ({
    selected: selectedClauseId === c.id,
    flash: recentIds.includes(c.id),
    spans: pending ? [] : spansFor(c),
    onHover: hoverClause,
    onParamHover: hoverParam,
    selectedNodeSet,
    onAccept: pending ? () => acceptProposal() : undefined,
    suggested: !pending && c.status === 'pending',
    onAcceptSuggested: () => acceptClauses([c.id]),
    onDismissSuggested: () => dismissClauses([c.id]),
    onOpenMenu: (x: number, y: number) => setAltMenu({ clauseId: c.id, x, y, pending }),
    onEdit: () => setEditingId(c.id),
    onRemove: pending ? () => discardProposal() : () => removeClause(c.id),
    onParam: pending
      ? () => {}
      : (span: ParamSpan, e: React.MouseEvent) =>
          setParamPopover({ clauseId: c.id, span, original: { text: c.text, params: spansFor(c) }, x: e.clientX, y: e.clientY }),
  });

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Spec</span>
        <div className="ml-auto flex rounded-md border border-slate-200 p-0.5">
          {(['structured', 'prose'] as SpecView[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'rounded px-2 py-0.5 text-[10px] font-medium capitalize transition-colors',
                view === v ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100',
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <VersionRail />

      {clauses.length > 0 && (
        <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-1 text-[10px] text-slate-500">
          <span className="rounded-sm bg-slate-100 px-0.5 font-semibold text-slate-900 underline decoration-dotted decoration-slate-400 underline-offset-2">
            highlighted
          </span>
          values are editable. click to tweak
        </div>
      )}

      {/* Clicking empty space in the spec clears any canvas selection. */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-3"
        onClick={(e) => { if (e.target === e.currentTarget) selectNode(null); }}
        onMouseUp={onSpecMouseUp}
      >
        {suggestedIds.length > 1 && (
          <div
            role="group"
            aria-label="Suggested clauses"
            className="mb-3 flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600"
          >
            <Sparkles className="h-3 w-3 shrink-0 text-amber-500" />
            <span className="min-w-0 flex-1">{suggestedIds.length} suggested clauses to review</span>
            <button
              onClick={() => dismissClauses(suggestedIds)}
              className="rounded-md px-1.5 py-0.5 font-medium text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
            >
              Dismiss all
            </button>
            <button
              onClick={() => acceptClauses(suggestedIds)}
              className="flex items-center gap-1 rounded-md bg-slate-900 px-1.5 py-0.5 font-semibold text-white transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1"
            >
              <CheckCheck className="h-3 w-3" /> Accept all
            </button>
          </div>
        )}
        {displayClauses.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-slate-500">
            Nothing here yet — describe what you want below, or pick an example.
          </p>
        ) : view === 'structured' ? (
          <div className="space-y-4">
            {CLAUSE_CATEGORIES.map((cat) => {
              const items = displayClauses.filter((c) => c.category === cat);
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
                        <ClauseEditor key={c.id} clause={c} onDone={pendingIds.has(c.id) ? onDonePendingEdit(c) : onDoneEdit(c)} />
                      ) : (
                        <ClauseItem key={c.id} clause={c} pending={pendingIds.has(c.id)} {...clauseHandlers(c, pendingIds.has(c.id))} />
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
              {displayClauses.map((c) =>
                editingId === c.id ? (
                  <ClauseEditor key={c.id} clause={c} onDone={pendingIds.has(c.id) ? onDonePendingEdit(c) : onDoneEdit(c)} />
                ) : (
                  <ClauseInline key={c.id} clause={c} pending={pendingIds.has(c.id)} {...clauseHandlers(c, pendingIds.has(c.id))} />
                ),
              )}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2.5 border-t border-slate-100 pt-2.5">
              {CLAUSE_CATEGORIES.map((cat) => (
                <span key={cat} className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-slate-500">
                  <span className={cn('h-1.5 w-1.5 rounded-full', CATEGORY_META[cat].dot)} /> {CATEGORY_META[cat].label}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {bindMenu && (() => {
        const clause = clauses.find((c) => c.id === bindMenu.clauseId);
        if (!clause) return null;
        return (
          <BindMenu
            label={clause.text.slice(bindMenu.start, bindMenu.end)}
            x={bindMenu.x}
            y={bindMenu.y}
            onPick={(kind) => {
              bindClauseParam(bindMenu.clauseId, bindMenu.start, bindMenu.end, kind);
              window.getSelection()?.removeAllRanges();
              setBindMenu(null);
            }}
            onClose={() => setBindMenu(null)}
          />
        );
      })()}

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
        // Pending clauses live in the proposal preview, not the committed prompt.
        const source = altMenu.pending ? displayClauses : clauses;
        const clause = source.find((c) => c.id === altMenu.clauseId);
        if (!clause) return null;
        return (
          <AlternativesMenu
            clause={clause}
            x={altMenu.x}
            y={altMenu.y}
            onPick={(text) => {
              if (altMenu.pending) acceptProposal(text);
              else chooseAlternative(clause.id, text);
              setAltMenu(null);
            }}
            onEdit={() => { setEditingId(clause.id); setAltMenu(null); }}
            onRemove={() => {
              if (altMenu.pending) discardProposal();
              else removeClause(clause.id);
              setAltMenu(null);
            }}
            onClose={() => setAltMenu(null)}
          />
        );
      })()}

      {/* Manual sync: register applied canvas edits into the spec. */}
      {irSyncMode === 'manual' && hasPendingSync && !proposing && !pendingProposal && (
        <div className="border-t border-slate-100 px-2.5 pt-2.5">
          <button
            onClick={syncNow}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-slate-800"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Update spec from canvas
          </button>
        </div>
      )}

      {/* Pending Call B proposal — slim banner; per-change actions are inline. */}
      <DiffRibbon onReview={reviewChanges} />

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
  onParamHover,
  selectedNodeSet,
}: {
  text: string;
  spans: ParamSpan[];
  onParam: (span: ParamSpan, e: React.MouseEvent) => void;
  onParamHover: (nodeIds: string[] | null) => void;
  selectedNodeSet: Set<string>;
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
    out.push(
      <ParamToken
        key={`p${k}`}
        span={sp}
        label={text.slice(sp.start, sp.end)}
        onParam={onParam}
        onParamHover={onParamHover}
        boundToSelection={selectedNodeSet.size > 0 && sp.nodeIds.some((id) => selectedNodeSet.has(id))}
      />,
    );
    i = sp.end;
  });
  pushPlain(text.slice(i), 'tail');
  if (!/[.!?…]\s*$/.test(text)) out.push('.');
  return <>{out}</>;
}

const PARAM_LABEL: Record<ParamSpan['kind'], string> = {
  color: 'color', length: 'size', fontFamily: 'font', fontWeight: 'weight', shadow: 'shadow',
  radius: 'corners', opacity: 'opacity', align: 'alignment', enum: 'option', shape: 'shape',
  position: 'position', icon: 'icon', text: 'value',
};

/**
 * One clickable parameter word inside a clause. Hover traces the token's bound
 * nodes on the canvas (widget → output attribution); `boundToSelection` marks
 * tokens that control the currently selected canvas node (output → widget,
 * the "reverse widget" direction).
 */
function ParamToken({
  span,
  label,
  onParam,
  onParamHover,
  boundToSelection,
}: {
  span: ParamSpan;
  label: string;
  onParam: (span: ParamSpan, e: React.MouseEvent) => void;
  onParamHover: (nodeIds: string[] | null) => void;
  boundToSelection: boolean;
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
      onMouseEnter={() => onParamHover(span.nodeIds)}
      onMouseLeave={() => onParamHover(null)}
      className={cn(
        'inline-block cursor-pointer whitespace-nowrap rounded-sm px-0.5 align-baseline font-semibold text-slate-900 underline decoration-dotted underline-offset-2',
        boundToSelection
          ? 'bg-amber-100 decoration-amber-500 ring-1 ring-amber-300 hover:bg-amber-200'
          : 'bg-slate-100 decoration-slate-400 hover:bg-slate-200',
      )}
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
  pending,
  spans,
  onHover,
  onAccept,
  suggested,
  onAcceptSuggested,
  onDismissSuggested,
  onOpenMenu,
  onEdit,
  onRemove,
  onParam,
  onParamHover,
  selectedNodeSet,
}: {
  clause: PromptClause;
  selected: boolean;
  flash: boolean;
  pending?: boolean;
  spans: ParamSpan[];
  onHover: (id: string | null) => void;
  onAccept?: () => void;
  suggested?: boolean;
  onAcceptSuggested?: () => void;
  onDismissSuggested?: () => void;
  onOpenMenu: (x: number, y: number) => void;
  onEdit: () => void;
  onRemove: () => void;
  onParam: (span: ParamSpan, e: React.MouseEvent) => void;
  onParamHover: (nodeIds: string[] | null) => void;
  selectedNodeSet: Set<string>;
}) {
  const inferred = clause.origin === 'inferred';
  // Single click opens the alternatives menu; a double click goes straight to
  // inline editing. A short timer disambiguates the two (a double click fires
  // two click events first). Proposed clauses behave the same way: click for
  // alternatives, double-click to rephrase.
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <div
      data-clause-id={clause.id}
      onMouseEnter={() => onHover(clause.id)}
      onMouseLeave={() => onHover(null)}
      onClick={(e) => {
        // A drag-select inside the clause ends in a click; that's the manual
        // span-binding gesture, not a request for the alternatives menu.
        if (!window.getSelection()?.isCollapsed) return;
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
      title={pending ? 'Proposed change — click for alternatives, double-click to rephrase' : suggested ? 'Suggested from your drawing — accept to add it to the spec, or dismiss' : inferred ? 'Inferred — click for alternatives, double-click to edit' : 'Click for alternatives · double-click to edit'}
      className={cn(
        'group flex items-start gap-2 rounded-md border px-2 py-1.5 text-[13px] transition-colors',
        pending
          ? 'cursor-pointer border-dashed border-amber-300 bg-amber-50/60 text-amber-900'
          : suggested
            ? 'cursor-pointer border-dashed border-slate-300 bg-slate-50 italic text-slate-500'
          : selected
            ? 'cursor-pointer border-slate-200 bg-slate-100 text-slate-900'
            : 'cursor-pointer border-transparent text-slate-600 hover:bg-slate-50',
        flash && 'wysiwyc-flash',
      )}
    >
      <span
        className={cn(
          'mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full',
          pending ? 'bg-amber-500' : suggested ? 'border border-dashed border-slate-400 bg-white' : inferred ? 'bg-amber-400 ring-2 ring-amber-100' : 'bg-slate-200',
        )}
      />
      <ClauseInferenceIcon clauseId={clause.id} />
      {/* IR items wrap freely so the whole sentence is visible; only the
          interactive param tokens inside stay on one line (see ParamToken). */}
      <span data-clause-text className="min-w-0 flex-1 break-words">
        <ClauseContent text={clause.text} spans={spans} onParam={onParam} onParamHover={onParamHover} selectedNodeSet={selectedNodeSet} />
      </span>
      {pending ? (
        <button
          onClick={(e) => { e.stopPropagation(); onAccept?.(); }}
          title="Accept this change"
          className="mt-px flex w-16 shrink-0 items-center justify-center rounded-full bg-amber-100 py-0.5 text-[8px] font-bold uppercase tracking-wide text-amber-700 transition-colors group-hover:bg-amber-400 group-hover:text-amber-950"
        >
          <span className="group-hover:hidden">Proposed</span>
          <span className="hidden group-hover:inline">Accept</span>
        </button>
      ) : suggested ? (
        <SuggestedActions onAccept={onAcceptSuggested} onDismiss={onDismissSuggested} />
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="Remove sentence"
        >
          <X className="h-3 w-3 text-slate-300 hover:text-rose-500" />
        </button>
      )}
    </div>
  );
}

/** Prose-view clause: an inline, category-underlined sentence span. */
function ClauseInline({
  clause,
  selected,
  flash,
  pending,
  spans,
  onHover,
  onAccept,
  suggested,
  onAcceptSuggested,
  onDismissSuggested,
  onOpenMenu,
  onEdit,
  onRemove,
  onParam,
  onParamHover,
  selectedNodeSet,
}: {
  clause: PromptClause;
  selected: boolean;
  flash: boolean;
  pending?: boolean;
  onHover: (id: string | null) => void;
  onAccept?: () => void;
  suggested?: boolean;
  onAcceptSuggested?: () => void;
  onDismissSuggested?: () => void;
  onOpenMenu: (x: number, y: number) => void;
  onEdit: () => void;
  onRemove: () => void;
  onParam: (span: ParamSpan, e: React.MouseEvent) => void;
  onParamHover: (nodeIds: string[] | null) => void;
  selectedNodeSet: Set<string>;
  spans: ParamSpan[];
}) {
  const inferred = clause.origin === 'inferred';
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <span
      data-clause-id={clause.id}
      onMouseEnter={() => onHover(clause.id)}
      onMouseLeave={() => onHover(null)}
      onClick={(e) => {
        // A drag-select inside the clause ends in a click; that's the manual
        // span-binding gesture, not a request for the alternatives menu.
        if (!window.getSelection()?.isCollapsed) return;
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
      title={pending ? 'Proposed change — click for alternatives, double-click to rephrase' : suggested ? 'Suggested from your drawing — accept to add it to the spec, or dismiss' : inferred ? 'Inferred — click for alternatives, double-click to edit' : 'Click for alternatives · double-click to edit'}
      className={cn(
        'group -mx-0.5 cursor-pointer rounded px-0.5 underline decoration-2 underline-offset-4 transition-colors',
        CATEGORY_META[clause.category].underline,
        pending
          ? 'bg-amber-50 text-amber-900 decoration-dashed'
          : suggested
            ? 'bg-slate-100 italic text-slate-500 decoration-dashed'
          : selected ? 'bg-slate-100 text-slate-900' : 'hover:bg-slate-50',
        flash && 'wysiwyc-flash',
      )}
    >
      {pending && (
        <span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" aria-label="proposed" />
      )}
      {suggested && (
        <span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full border border-dashed border-slate-400 bg-white align-middle" aria-label="suggested" />
      )}
      {!pending && !suggested && inferred && (
        <span
          className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle ring-2 ring-amber-100"
          aria-label="inferred"
        />
      )}
      <span data-clause-text>
        <ClauseContent text={clause.text} spans={spans} onParam={onParam} onParamHover={onParamHover} selectedNodeSet={selectedNodeSet} />
      </span>
      {pending ? (
        <button
          onClick={(e) => { e.stopPropagation(); onAccept?.(); }}
          title="Accept this change"
          className="ml-0.5 hidden rounded bg-amber-400 px-1 align-middle text-[9px] font-bold uppercase tracking-wide text-amber-950 no-underline group-hover:inline-block"
        >
          Accept
        </button>
      ) : suggested ? (
        <SuggestedActions inline onAccept={onAcceptSuggested} onDismiss={onDismissSuggested} />
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="ml-0.5 hidden align-baseline group-hover:inline-block"
          aria-label="Remove sentence"
        >
          <X className="inline h-3 w-3 text-slate-300 hover:text-rose-500" />
        </button>
      )}{' '}
    </span>
  );
}

/**
 * Accept / dismiss controls for a suggested (pending) clause. Always visible
 * (not hover-only) so the review step is obvious and reachable by keyboard.
 */
function SuggestedActions({
  onAccept,
  onDismiss,
  inline,
}: {
  onAccept?: () => void;
  onDismiss?: () => void;
  inline?: boolean;
}) {
  const stop = (fn?: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn?.();
  };
  return (
    <span
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn('not-italic no-underline', inline ? 'ml-1 inline-flex gap-0.5 align-middle' : 'flex shrink-0 items-center gap-0.5')}
    >
      {!inline && (
        <span className="mr-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400">Suggested</span>
      )}
      <button
        onClick={stop(onAccept)}
        title="Accept — add this clause to the spec"
        aria-label="Accept suggested clause"
        className="flex items-center gap-0.5 rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold not-italic text-slate-700 shadow-sm transition-colors hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
      >
        <Check className="h-3 w-3" />
        {!inline && 'Accept'}
      </button>
      <button
        onClick={stop(onDismiss)}
        title="Dismiss — remove this suggestion (the shape stays)"
        aria-label="Dismiss suggested clause"
        className="grid h-[22px] w-[22px] place-items-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

/** Widget kinds offered when manually binding a selected text span. */
const BIND_KINDS: { kind: ParamKind; label: string }[] = [
  { kind: 'color', label: 'Color' },
  { kind: 'length', label: 'Size' },
  { kind: 'fontWeight', label: 'Weight' },
  { kind: 'radius', label: 'Corners' },
  { kind: 'shape', label: 'Shape' },
  { kind: 'align', label: 'Align' },
  { kind: 'position', label: 'Position' },
  { kind: 'icon', label: 'Icon' },
  { kind: 'shadow', label: 'Shadow' },
  { kind: 'text', label: 'Value' },
];

/**
 * The manual-binding menu: shown after selecting text inside a clause, it
 * turns the selection into a persistent interactive parameter of the chosen
 * widget kind (Malleable Prompting's "highlight any text span to bind it to
 * a specific control type").
 */
function BindMenu({
  label,
  x,
  y,
  onPick,
  onClose,
}: {
  label: string;
  x: number;
  y: number;
  onPick: (kind: ParamKind) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y + 8, window.innerHeight - 160) }}
      className="fixed z-50 w-48 rounded-xl border border-slate-200 bg-white p-2 shadow-lg shadow-slate-300/40 ring-1 ring-black/5"
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
    >
      <div className="mb-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Make <span className="normal-case text-slate-900">“{label.length > 18 ? `${label.slice(0, 18)}…` : label}”</span> editable
      </div>
      <div className="grid grid-cols-2 gap-1">
        {BIND_KINDS.map(({ kind, label: kLabel }) => (
          <button
            key={kind}
            onClick={() => onPick(kind)}
            className="rounded-md border border-slate-200 px-1.5 py-1 text-left text-[11px] font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            {kLabel}
          </button>
        ))}
      </div>
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
      className="my-0.5 w-full resize-none rounded-md border border-slate-200 bg-slate-50/40 px-1.5 py-1 text-xs leading-snug text-slate-800 outline-none focus:ring-2 focus:ring-slate-100"
    />
  );
}

/**
 * A spark icon on an inferred-component clause. Clicking it reveals the other
 * candidate UI components (part A of prompt-by-demonstration); picking one
 * rewrites the clause and rebuilds the wireframe on the canvas. Once a component
 * is chosen this is the place to change it (the canvas bubble is gone).
 */
function ClauseInferenceIcon({ clauseId }: { clauseId: string }) {
  const inferences = useAppStore((s) => s.inferences);
  const chooseComponent = useAppStore((s) => s.chooseComponent);
  const selectNode = useAppStore((s) => s.selectNode);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  const inf = Object.values(inferences).find(
    (i) => i.clauseId === clauseId && i.status !== 'dismissed',
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!inf) return null;

  return (
    <span ref={ref} className="relative mt-[2px] shrink-0">
      <button
        onClick={(e) => { e.stopPropagation(); selectNode(inf.nodeId); setOpen((v) => !v); }}
        title={inf.chosen ? `Component: ${inf.chosen} — click to change` : 'Suggested components — click to choose'}
        className="flex h-4 w-4 items-center justify-center rounded text-amber-500 transition-colors hover:bg-amber-100"
      >
        <Sparkles className="h-3 w-3" />
      </button>
      {open && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute left-0 top-5 z-50 w-52 rounded-xl border border-slate-200 bg-white p-1.5 text-left shadow-lg ring-1 ring-black/5"
        >
          <div className="px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Looks like…
          </div>
          {inf.candidates.map((c) => {
            const chosen = inf.chosen === c.label;
            return (
              <button
                key={c.label}
                onClick={(e) => { e.stopPropagation(); chooseComponent(inf.nodeId, c.label); setOpen(false); }}
                className={
                  'flex w-full items-start gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors ' +
                  (chosen ? 'bg-amber-50' : 'hover:bg-slate-50')
                }
              >
                <span className="mt-0.5 h-3 w-3 shrink-0 text-amber-500">{chosen && <Check className="h-3 w-3" />}</span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold text-slate-800">{c.label}</span>
                  <span className="block truncate text-[10px] text-slate-500">{c.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}
