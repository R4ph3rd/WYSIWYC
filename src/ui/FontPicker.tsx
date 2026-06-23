import { useEffect, useMemo, useState } from 'react';
import { GOOGLE_FONTS, fontStack } from '@/lib/fonts';
import { loadGoogleFont } from '@/lib/loadFont';

/**
 * Searchable Google Fonts list. Previews each row in its own face, loading
 * fonts lazily — only the visible/filtered rows and hovered rows get a
 * stylesheet `<link>` (never the whole catalogue up front).
 */
export function FontPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (family: string) => void;
}) {
  const [q, setQ] = useState('');
  const cur = value.trim().toLowerCase();
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return GOOGLE_FONTS.filter(
      (f) => !needle || f.family.toLowerCase().includes(needle) || f.category.includes(needle),
    );
  }, [q]);

  // Load a bounded slice of the visible results so previews render without
  // requiring a hover, but we never fetch the entire catalogue at once.
  const visible = results.slice(0, 60);
  useEffect(() => {
    visible.forEach((f) => loadGoogleFont(f.family));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex max-h-72 flex-col">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search fonts…"
        className="mb-1.5 w-full rounded border border-slate-200 px-2 py-1 text-[11px] outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-50"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {results.map((f) => (
          <button
            key={f.family}
            onMouseEnter={() => loadGoogleFont(f.family)}
            onClick={() => { loadGoogleFont(f.family); onChange(f.family); }}
            style={{ fontFamily: fontStack(f.family) }}
            className={
              'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50 ' +
              (f.family.toLowerCase() === cur ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700')
            }
          >
            <span className="truncate">{f.family}</span>
            <span className="shrink-0 text-[9px] uppercase tracking-wide text-slate-300">{f.category}</span>
          </button>
        ))}
        {results.length === 0 && <p className="px-2 py-4 text-center text-[11px] text-slate-400">No fonts match.</p>}
      </div>
    </div>
  );
}
