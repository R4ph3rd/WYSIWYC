import { ChevronDown } from 'lucide-react';
import { useStudyStore } from '@/store/studyStore';
import type { StudyCondition } from '@/store/studyStore';
import { cn } from '@/lib/utils';

const TASKS = [
  { id: 'task_1', label: 'Task 1 — Login screen' },
  { id: 'task_2', label: 'Task 2 — Dashboard card' },
  { id: 'task_3', label: 'Task 3 — Navigation bar' },
  { id: 'task_4', label: 'Task 4 — Settings form' },
];

/**
 * Full-screen frosted-glass modal shown at the start of each study session
 * (whenever study mode is active but no run has started yet). Dismisses
 * automatically when the user clicks "Start session" and startRun() fires.
 */
export function StudySetupModal() {
  const participantId = useStudyStore((s) => s.participantId);
  const condition = useStudyStore((s) => s.condition);
  const taskId = useStudyStore((s) => s.taskId);
  const setParticipantId = useStudyStore((s) => s.setParticipantId);
  const setCondition = useStudyStore((s) => s.setCondition);
  const setTaskId = useStudyStore((s) => s.setTaskId);
  const startRun = useStudyStore((s) => s.startRun);

  const canStart = participantId.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="mb-5 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Study session</p>
          <h2 className="mt-0.5 text-base font-semibold text-slate-900">Configure participant</h2>
        </div>

        {/* Participant ID */}
        <div className="mb-4">
          <label className="mb-1.5 block text-[11px] font-medium text-slate-600">
            Participant ID
          </label>
          <input
            type="text"
            value={participantId}
            onChange={(e) => setParticipantId(e.target.value)}
            placeholder="e.g. P01"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
            autoFocus
          />
        </div>

        {/* Condition */}
        <div className="mb-4">
          <label className="mb-1.5 block text-[11px] font-medium text-slate-600">Condition</label>
          <div className="flex gap-2">
            {(['full', 'chat_only'] as StudyCondition[]).map((c) => (
              <button
                key={c}
                onClick={() => setCondition(c)}
                className={cn(
                  'flex-1 rounded-lg border py-2 text-[11px] font-semibold transition-colors',
                  condition === c
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                )}
              >
                {c === 'full' ? 'Full UI' : 'Chat only'}
              </button>
            ))}
          </div>
        </div>

        {/* Task */}
        <div className="mb-4">
          <label className="mb-1.5 block text-[11px] font-medium text-slate-600">Task</label>
          <div className="relative">
            <select
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              className="w-full appearance-none rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-8 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
            >
              {TASKS.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        {/* Reference thumbnail */}
        <div className="mb-5">
          <label className="mb-1.5 block text-[11px] font-medium text-slate-600">Reference</label>
          <img
            src={`/tasks/${taskId}.svg`}
            alt="Task reference"
            className="h-24 w-full rounded-lg border border-slate-200 object-contain bg-slate-50 p-2"
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
        </div>

        <button
          onClick={startRun}
          disabled={!canStart}
          className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Start session
        </button>
      </div>
    </div>
  );
}
