import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AI } from '@/ui/tokens';
import { CONDITION_LABEL, taskById, taskImage, type Condition } from '@/study/tasks';

/** Full-screen study page: app-style top bar + centered column. */
export function StudyShell({
  eyebrow,
  title,
  subtitle,
  right,
  children,
  footer,
  wide,
}: {
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-slate-50">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <span className="text-sm font-bold tracking-tight text-slate-900">WYSIWYC</span>
        <span className="text-[11px] text-slate-500">User study</span>
        <div className="ml-auto flex items-center gap-2">{right}</div>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className={cn('mx-auto px-6 pb-28 pt-8', wide ? 'max-w-5xl' : 'max-w-3xl')}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{eyebrow}</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
          <div className="mt-6 space-y-5">{children}</div>
        </div>
      </div>
      {footer && (
        <footer className="shrink-0 border-t border-slate-200 bg-white/95 px-6 py-3 backdrop-blur">
          <div className={cn('mx-auto flex items-center gap-3', wide ? 'max-w-5xl' : 'max-w-3xl')}>{footer}</div>
        </footer>
      )}
    </div>
  );
}

export function Card({ title, hint, children, className }: { title?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-xl border border-slate-200 bg-white p-5 shadow-sm', className)}>
      {title && (
        <div className="mb-4 flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string | null; children: ReactNode; className?: string }) {
  return (
    // A div, not a <label>: several fields hold button groups, and a wrapping
    // label would forward clicks on its text to the first button.
    <div className={cn('block', className)} role="group" aria-label={label}>
      <span className="mb-1.5 block text-[11px] font-medium text-slate-600">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11px] text-rose-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>
      ) : null}
    </div>
  );
}

export const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-100';

/** Pill group for single choice. */
export function Choice<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  name,
}: {
  value: T | '' | null;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  name?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-lg border font-medium transition-colors',
            size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
            value === o.value
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A 1..n Likert row with end labels. */
export function Likert({
  value,
  onChange,
  points,
  low,
  high,
  name,
}: {
  value: number | null;
  onChange: (v: number) => void;
  points: number;
  low: string;
  high: string;
  name: string;
}) {
  return (
    <div>
      <div className="flex gap-1.5" role="radiogroup" aria-label={name}>
        {Array.from({ length: points }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${name}: ${n}`}
            onClick={() => onChange(n)}
            className={cn(
              'h-9 flex-1 rounded-lg border text-xs font-semibold transition-colors',
              value === n
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

/** NASA-TLX 0–100 scale with 21 tick marks (steps of 5), as on the paper form. */
export function TlxScale({ value, onChange, low, high, name }: { value: number | null; onChange: (v: number) => void; low: string; high: string; name: string }) {
  return (
    <div>
      <div className="flex h-9 items-stretch overflow-hidden rounded-lg border border-slate-200 bg-white" role="radiogroup" aria-label={name}>
        {Array.from({ length: 21 }, (_, i) => i * 5).map((v) => {
          const on = value !== null && v <= value;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={value === v}
              aria-label={`${name}: ${v}`}
              title={String(v)}
              onClick={() => onChange(v)}
              className={cn(
                'relative flex-1 border-r border-slate-100 transition-colors last:border-r-0',
                on ? 'bg-slate-800' : 'hover:bg-slate-100',
                value === v && 'bg-slate-900',
                v === 50 && !on && 'bg-slate-50',
              )}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{low}</span>
        <span className="font-mono text-slate-500">{value === null ? '—' : value}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

export function ConditionChip({ condition, className }: { condition: Condition; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        condition === 'wysiwyc' ? AI.chip : 'border-slate-300 bg-slate-100 text-slate-700',
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', condition === 'wysiwyc' ? 'bg-amber-500' : 'bg-slate-500')} />
      {CONDITION_LABEL[condition]}
    </span>
  );
}

export function PrimaryButton({ children, disabled, onClick, className, type = 'button' }: { children: ReactNode; disabled?: boolean; onClick?: () => void; className?: string; type?: 'button' | 'submit' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, onClick, className, disabled }: { children: ReactNode; onClick?: () => void; className?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Target screenshot that opens a large lightbox (with the criteria) on click. */
export function TargetImage({ taskId, className, onOpen }: { taskId: string; className?: string; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const task = taskById(taskId);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); onOpen?.(); }}
        className={cn('group relative block overflow-hidden rounded-lg border border-slate-200 bg-slate-50', className)}
        aria-label={`Enlarge target: ${task?.title ?? taskId}`}
        data-testid="target-thumb"
      >
        <img src={taskImage(taskId)} alt={`Target: ${task?.title ?? taskId}`} className="h-full w-full object-contain" />
        <span className="absolute right-1.5 top-1.5 rounded-md bg-white/90 p-1 text-slate-600 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
          <Maximize2 className="h-3 w-3" />
        </span>
      </button>
      {open && task &&
        createPortal(
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-6 backdrop-blur-sm" onClick={() => setOpen(false)} data-testid="target-lightbox">
            <div className="flex max-h-full w-full max-w-5xl gap-5 rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <img src={taskImage(taskId)} alt={`Target: ${task.title}`} className="min-w-0 flex-[3] rounded-lg border border-slate-200 object-contain" />
              <div className="flex min-w-0 flex-[2] flex-col">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Target</p>
                    <h3 className="text-base font-semibold text-slate-900">{task.title}</h3>
                  </div>
                  <button onClick={() => setOpen(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-2 text-sm text-slate-600">{task.goal}</p>
                <CriteriaList criteria={task.criteria} className="mt-4" />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export function CriteriaList({ criteria, className }: { criteria: string[]; className?: string }) {
  return (
    <ol className={cn('space-y-2', className)}>
      {criteria.map((c, i) => (
        <li key={i} className="flex gap-2.5 text-[13px] leading-snug text-slate-700">
          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500">{i + 1}</span>
          <span>{c}</span>
        </li>
      ))}
    </ol>
  );
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
