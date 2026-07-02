import { History } from 'lucide-react';
import { useAppStore } from '@/store/appStore';

/**
 * Configuration version rail (Malleable Prompting's version tracking,
 * linearized). Each chip is a restorable spec+IR snapshot recorded after a
 * compose send, spec-edit regeneration, canvas sync, or param-widget
 * adjustment burst — so iterations are organized around configurations
 * rather than chat turns, and any earlier state is one click away.
 */
export function VersionRail() {
  const versions = useAppStore((s) => s.versions);
  const restoreVersion = useAppStore((s) => s.restoreVersion);
  if (versions.length < 2) return null;
  const last = versions[versions.length - 1];
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-100 px-3 py-1.5 [scrollbar-width:none]">
      <span title="Versions" className="shrink-0"><History className="h-3 w-3 text-slate-400" /></span>
      {versions.map((v, i) => (
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
          v{i + 1}
        </button>
      ))}
      <span className="ml-1 shrink-0 truncate text-[10px] text-slate-400">{last.label}</span>
    </div>
  );
}
