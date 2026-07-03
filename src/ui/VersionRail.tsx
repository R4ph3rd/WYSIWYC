import { useState } from 'react';
import { History } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import type { SpecVersion } from '@/store/appStore';

/**
 * Configuration version rail (Malleable Prompting's version tracking,
 * linearized). Each chip is a restorable spec+IR snapshot recorded after a
 * compose send, spec-edit regeneration, canvas sync, or param-widget
 * adjustment burst — so iterations are organized around configurations
 * rather than chat turns, and any earlier state is one click away.
 *
 * When there are more than four versions the rail collapses to `v1 … [last 3]`
 * to stay compact; clicking the ellipsis expands the full list.
 */
export function VersionRail() {
  const versions = useAppStore((s) => s.versions);
  const restoreVersion = useAppStore((s) => s.restoreVersion);
  const [expanded, setExpanded] = useState(false);
  if (versions.length < 2) return null;
  const last = versions[versions.length - 1];
  const collapsed = versions.length > 4 && !expanded;

  const chip = (v: SpecVersion, index: number) => (
    <button
      key={v.id}
      onClick={() => restoreVersion(v.id)}
      title={`${v.label} — ${new Date(v.ts).toLocaleTimeString()} (click to restore)`}
      className={
        v.id === last.id
          ? 'shrink-0 rounded-full bg-slate-900 px-1.5 py-0.5 text-[9px] font-semibold text-white'
          : 'shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800'
      }
    >
      v{index + 1}
    </button>
  );

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-100 px-3 py-1.5 [scrollbar-width:none]">
      <span title="Versions" className="shrink-0"><History className="h-3 w-3 text-slate-400" /></span>
      {collapsed ? (
        <>
          {chip(versions[0], 0)}
          <button
            onClick={() => setExpanded(true)}
            title={`Show all ${versions.length} versions`}
            className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
          >
            …
          </button>
          {versions.slice(-3).map((v) => chip(v, versions.indexOf(v)))}
        </>
      ) : (
        versions.map((v, i) => chip(v, i))
      )}
      <span className="ml-1 shrink-0 truncate text-[10px] text-slate-400">{last.label}</span>
    </div>
  );
}
