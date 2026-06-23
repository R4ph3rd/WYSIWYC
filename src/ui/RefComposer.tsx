import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowUp, Loader2, Link2, Sparkles, Hash, Image as ImageIcon, Plus, X } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import type { ComposerValue, ExtractKind, PromptRef } from '@/ir/types';
import { extractAttribute } from '@/ir/extract';
import {
  composerIsEmpty,
  emptyComposer,
  insertRef,
  nextComposerRefId,
  normalizeComposer,
  removeRef,
  serializeComposer,
} from '@/lib/composer';
import { cn } from '@/lib/utils';
import { ExtractMenu } from './ExtractMenu';

/**
 * The composer is a RICH text+chip field (DirectGPT principles b/c). Rather than
 * a fragile contentEditable, it is a flex-wrap row of auto-sized text inputs
 * interleaved with chip pills, kept in strict text/ref/text alternation. Drag a
 * node in (canvas or Layers) to drop a reference chip; paste/drop an image for
 * an inline thumbnail chip. On send it serializes to prose with «ref_n» markers.
 */

export interface RefComposerProps {
  value: ComposerValue;
  onChange: (v: ComposerValue) => void;
  onSend: (text: string, refs: PromptRef[]) => void;
  onFocusChange?: (focused: boolean) => void;
  /** When this request targets 'composer', the field pulls focus (canvas hand-off). */
  focusRequest?: { target: 'composer' | 'canvas'; seq: number } | null;
  disabled?: boolean;
  busy?: boolean;
  placeholder?: string;
  size?: 'sm' | 'lg';
  autoFocus?: boolean;
}

const CHIP_STYLE: Record<PromptRef['kind'], string> = {
  // Node + location chips reuse the primary indigo, matching the canvas overlay.
  node: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  attribute: 'bg-violet-50 text-violet-700 ring-violet-200',
  param: 'bg-sky-50 text-sky-700 ring-sky-200',
  image: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  location: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
};

function ChipIcon({ kind }: { kind: PromptRef['kind'] }) {
  const cls = 'h-3 w-3 shrink-0';
  if (kind === 'node') return <Link2 className={cls} />;
  if (kind === 'attribute') return <Sparkles className={cls} />;
  if (kind === 'param') return <Hash className={cls} />;
  if (kind === 'location') return <Plus className={cls} />;
  return <ImageIcon className={cls} />;
}

/** A label for a dropped node chip: role + a short content snippet. */
function getNodeLabel(nodeId: string): string {
  const node = useAppStore.getState().ir.nodes.find((n) => n.id === nodeId);
  if (!node) return nodeId;
  const snip = node.content?.trim().slice(0, 16);
  return snip ? `${node.role} “${snip}”` : node.role;
}

export function RefComposer({
  value,
  onChange,
  onSend,
  onFocusChange,
  focusRequest,
  disabled,
  busy,
  placeholder,
  size = 'sm',
  autoFocus,
}: RefComposerProps) {
  // The caret position of the last-focused text segment, for drop insertion.
  const caretRef = useRef<{ segIndex: number; caret: number } | null>(null);
  // Outer field, used to pull focus back to the trailing input on request.
  const rootRef = useRef<HTMLDivElement>(null);
  // Mirror the latest value so chained / async inserts (e.g. dropping several
  // images at once, whose FileReader callbacks fire across ticks) each build on
  // the previous insertion instead of a stale closed-over `value`.
  const valueRef = useRef(value);
  valueRef.current = value;
  const [dragOver, setDragOver] = useState(false);
  const [menu, setMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);

  const segments = normalizeComposer(value);
  const lg = size === 'lg';
  const inputsDisabled = disabled || busy;

  // A stable letter ID (A, B, …) per node chip, mirrored on the canvas overlay.
  const nodeRefIds = segments.flatMap((s) => (s.type === 'ref' && s.ref.kind === 'node' ? [s.ref.refId] : []));
  const nodeLetter = (refId: string) => String.fromCharCode(65 + nodeRefIds.indexOf(refId));

  // Canvas hand-off: when an element/location chip is dropped from the canvas
  // mid-draft, focus returns here so the user keeps typing without a reach for
  // the field. (A double-click on the canvas targets 'canvas' instead — ignored.)
  useEffect(() => {
    if (focusRequest?.target !== 'composer' || inputsDisabled) return;
    const inputs = rootRef.current?.querySelectorAll<HTMLInputElement>('input[type="text"]');
    const last = inputs?.[inputs.length - 1];
    if (last) {
      last.focus();
      const end = last.value.length;
      last.setSelectionRange(end, end);
    }
  }, [focusRequest?.seq, focusRequest?.target, inputsDisabled]);

  const insertChip = (ref: PromptRef) => {
    const at = caretRef.current;
    onChange(insertRef(valueRef.current, ref, at?.segIndex, at?.caret));
    caretRef.current = null;
  };

  const insertNodeRef = (nodeId: string) => {
    insertChip({ kind: 'node', refId: nextComposerRefId(valueRef.current), nodeId, label: getNodeLabel(nodeId) });
  };

  const insertAttributeRef = (nodeId: string, kind: ExtractKind) => {
    const node = useAppStore.getState().ir.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const { label, value: extracted } = extractAttribute(node, kind);
    insertChip({
      kind: 'attribute',
      refId: nextComposerRefId(valueRef.current),
      nodeId,
      extract: kind,
      label: `${node.role} · ${label}`,
      value: extracted,
    });
  };

  const insertImageRef = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      insertChip({ kind: 'image', refId: nextComposerRefId(valueRef.current), label: file.name || 'image', dataUrl });
    };
    reader.readAsDataURL(file);
  };

  const send = () => {
    if (disabled || busy || composerIsEmpty(value)) return;
    const { text, refs } = serializeComposer(value);
    if (!text) return;
    onSend(text, refs);
    onChange(emptyComposer());
    caretRef.current = null;
  };

  const onDrop = (e: React.DragEvent) => {
    const nodeId = e.dataTransfer.getData('text/wysiwyc-node');
    const paramData = e.dataTransfer.getData('text/wysiwyc-param');
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
    if (nodeId || paramData || files.length) {
      e.preventDefault();
      e.stopPropagation();
    }
    setDragOver(false);
    if (nodeId) {
      // Offer the extract-on-drop menu (DirectGPT ad-hoc menu).
      setMenu({ nodeId, x: e.clientX, y: e.clientY });
      return;
    }
    if (paramData) {
      try {
        const { nodeId: pid, path, value: pval } = JSON.parse(paramData);
        const leaf = String(path).split('.').pop() ?? path;
        insertChip({
          kind: 'param',
          refId: nextComposerRefId(valueRef.current),
          nodeId: pid,
          path,
          label: `${leaf} ${pval}`,
          value: String(pval),
        });
      } catch {
        /* ignore malformed param payloads */
      }
      return;
    }
    files.forEach(insertImageRef);
  };

  const onDragOver = (e: React.DragEvent) => {
    const t = e.dataTransfer.types;
    if (
      t.includes('text/wysiwyc-node') ||
      t.includes('text/wysiwyc-param') ||
      t.includes('Files')
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const imageFiles = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length) {
      e.preventDefault();
      imageFiles.forEach(insertImageRef);
    }
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        'rounded-xl border bg-white shadow-sm transition-colors',
        lg ? 'rounded-2xl p-2 shadow-lg shadow-slate-200/60' : 'p-1.5',
        dragOver ? 'border-slate-400 ring-2 ring-slate-200' : 'border-slate-200',
        'focus-within:border-slate-400 focus-within:ring-2 focus-within:ring-slate-100',
      )}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(false)}
      onPaste={onPaste}
    >
      <div className={cn('flex flex-wrap items-center gap-1', lg ? 'px-2 py-1.5' : 'px-1.5 py-1')}>
        {segments.map((seg, i) => {
          if (seg.type === 'ref') {
            return (
              <Chip
                key={seg.ref.refId}
                ref0={seg.ref}
                badge={seg.ref.kind === 'node' ? nodeLetter(seg.ref.refId) : undefined}
                onRemove={() => onChange(removeRef(value, seg.ref.refId))}
              />
            );
          }
          // Stable key tied to the adjacent chip so removing one chip does not
          // remount (and steal focus from) the text inputs around other chips.
          const prev = segments[i - 1];
          const key = i === 0 ? 'lead' : prev && prev.type === 'ref' ? `after_${prev.ref.refId}` : `t${i}`;
          return (
            <TextSegment
              key={key}
              text={seg.text}
              last={i === segments.length - 1}
              size={size}
              disabled={inputsDisabled}
              autoFocus={autoFocus && i === 0}
              placeholder={i === 0 && segments.length === 1 ? placeholder : undefined}
              onFocus={() => onFocusChange?.(true)}
              onBlur={() => onFocusChange?.(false)}
              onCaret={(caret) => (caretRef.current = { segIndex: i, caret })}
              onChange={(text) => {
                const next = segments.map((s, j) => (j === i ? { type: 'text' as const, text } : s));
                onChange(next);
              }}
              onBackspaceEmpty={() => {
                // Remove the chip immediately preceding this empty text segment.
                if (prev && prev.type === 'ref') onChange(removeRef(value, prev.ref.refId));
              }}
              onEnter={send}
            />
          );
        })}
      </div>

      <div className={cn('flex items-center justify-between', lg ? 'px-2 pb-1' : 'px-1 pb-0.5')}>
        <span className="text-[9px] text-slate-300">⏎ to send · drag elements in to refer</span>
        <button
          onClick={send}
          disabled={disabled || busy || composerIsEmpty(value)}
          className={cn(
            'flex items-center justify-center rounded-full bg-slate-900 text-white transition-colors hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400',
            lg ? 'h-8 w-8' : 'h-6 w-6',
          )}
          aria-label="Send"
        >
          {busy ? (
            <Loader2 className={lg ? 'h-4 w-4 animate-spin' : 'h-3 w-3 animate-spin'} />
          ) : (
            <ArrowUp className={lg ? 'h-4 w-4' : 'h-3 w-3'} />
          )}
        </button>
      </div>

      {menu && (
        <ExtractMenu
          nodeId={menu.nodeId}
          x={menu.x}
          y={menu.y}
          onPick={(kind) => {
            if (kind === null) insertNodeRef(menu.nodeId);
            else insertAttributeRef(menu.nodeId, kind);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function Chip({ ref0, badge, onRemove }: { ref0: PromptRef; badge?: string; onRemove: () => void }) {
  return (
    <span
      className={cn(
        'ml-0.5 inline-flex max-w-[16rem] items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1',
        CHIP_STYLE[ref0.kind],
      )}
    >
      {ref0.kind === 'image' ? (
        <img src={ref0.dataUrl} alt="" className="h-4 max-h-[16px] rounded-sm object-cover" />
      ) : (
        <ChipIcon kind={ref0.kind} />
      )}
      <span className="truncate">{ref0.label}</span>
      {badge && (
        <span className="rounded bg-slate-900 px-1 text-[9px] font-bold leading-tight text-white">{badge}</span>
      )}
      <button onClick={onRemove} aria-label="Remove reference" className="-mr-0.5 opacity-60 hover:opacity-100">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function TextSegment({
  text,
  last,
  size,
  disabled,
  autoFocus,
  placeholder,
  onChange,
  onCaret,
  onEnter,
  onBackspaceEmpty,
  onFocus,
  onBlur,
}: {
  text: string;
  last: boolean;
  size: 'sm' | 'lg';
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  onChange: (text: string) => void;
  onCaret: (caret: number) => void;
  onEnter: () => void;
  onBackspaceEmpty: () => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const reportCaret = () => onCaret(ref.current?.selectionStart ?? text.length);
  // Non-trailing segments size to their content (plus a little slack so a
  // following chip never clips the last letter); the trailing one fills the row.
  const style: CSSProperties = last
    ? { flex: '1 1 60px', minWidth: 60 }
    : { width: `calc(${Math.max(text.length, 1)}ch + 0.5rem)` };
  return (
    <input
      ref={ref}
      type="text"
      value={text}
      disabled={disabled}
      autoFocus={autoFocus}
      placeholder={placeholder}
      style={style}
      onChange={(e) => { onChange(e.target.value); reportCaret(); }}
      onFocus={() => { onFocus(); reportCaret(); }}
      onBlur={onBlur}
      onSelect={reportCaret}
      onClick={reportCaret}
      onKeyUp={reportCaret}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onEnter();
        } else if (e.key === 'Backspace' && text === '') {
          // Only an empty segment swallows Backspace into removing the chip
          // before it — a non-empty segment with the caret at 0 must not.
          onBackspaceEmpty();
        }
      }}
      className={cn(
        'bg-transparent text-slate-800 outline-none placeholder:text-slate-400',
        size === 'lg' ? 'text-sm' : 'text-xs',
      )}
    />
  );
}
