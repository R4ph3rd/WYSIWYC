import { useEffect, useState } from 'react';
import { Play, Square, Download, ChevronDown } from 'lucide-react';
import { useStudyStore } from '@/store/studyStore';
import type { StudyCondition } from '@/store/studyStore';

const TASKS = [
  { id: 'task_1', label: 'Task 1 — Login screen' },
  { id: 'task_2', label: 'Task 2 — Dashboard card' },
  { id: 'task_3', label: 'Task 3 — Navigation bar' },
  { id: 'task_4', label: 'Task 4 — Settings form' },
];

/** Format milliseconds as mm:ss. */
function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Study instrumentation bar. Shown only when ?study=1 is in the URL.
 * Participant ID, condition toggle, task picker, Start/Done buttons,
 * live counters (prompts · tokens · elapsed · edits), reference thumbnail.
 */
export function StudyBar() {
  const {
    activeRun,
    participantId,
    condition,
    taskId,
    promptCount,
    tokenCount,
    editCount,
    runStartedAt,
    setParticipantId,
    setCondition,
    setTaskId,
    startRun,
    endRun,
    exportDataset,
  } = useStudyStore();

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!runStartedAt) { setElapsed(0); return; }
    const tick = () => setElapsed(Date.now() - runStartedAt);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [runStartedAt]);

  const running = activeRun !== null;

  return (
    <div className="flex items-center gap-3 border-b border-violet-200 bg-violet-50 px-4 py-1.5 text-[11px]">
      <span className="font-semibold text-violet-700 uppercase tracking-wider">Study</span>

      <div className="mx-1 h-4 w-px bg-violet-200" />

      {/* Participant ID */}
      <label className="flex items-center gap-1 text-violet-600">
        P#
        <input
          type="text"
          value={participantId}
          onChange={(e) => setParticipantId(e.target.value)}
          disabled={running}
          placeholder="id"
          className="w-14 rounded border border-violet-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 outline-none focus:border-violet-400 disabled:opacity-50"
        />
      </label>

      {/* Condition toggle */}
      <div className="flex items-center gap-1 rounded border border-violet-200 bg-white p-0.5">
        {(['full', 'chat_only'] as StudyCondition[]).map((c) => (
          <button
            key={c}
            disabled={running}
            onClick={() => setCondition(c)}
            className={`rounded px-2 py-0.5 font-medium transition-colors disabled:opacity-50 ${
              condition === c
                ? 'bg-violet-600 text-white'
                : 'text-violet-600 hover:bg-violet-50'
            }`}
          >
            {c === 'full' ? 'Full' : 'Chat only'}
          </button>
        ))}
      </div>

      {/* Task picker */}
      <div className="relative flex items-center">
        <select
          value={taskId}
          onChange={(e) => setTaskId(e.target.value)}
          disabled={running}
          className="appearance-none rounded border border-violet-200 bg-white py-0.5 pl-2 pr-6 text-[11px] text-slate-700 outline-none focus:border-violet-400 disabled:opacity-50"
        >
          {TASKS.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-1.5 h-3 w-3 text-violet-400" />
      </div>

      {/* Reference thumbnail */}
      <img
        src={`/tasks/${taskId}.svg`}
        alt="Reference"
        className="h-8 w-14 rounded border border-violet-200 object-cover"
        onError={(e) => (e.currentTarget.style.display = 'none')}
      />

      <div className="mx-1 h-4 w-px bg-violet-200" />

      {/* Start / Done */}
      {!running ? (
        <button
          onClick={startRun}
          disabled={!participantId.trim()}
          className="flex items-center gap-1 rounded bg-violet-600 px-2.5 py-1 font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-40"
        >
          <Play className="h-3 w-3" /> Start
        </button>
      ) : (
        <button
          onClick={endRun}
          className="flex items-center gap-1 rounded bg-rose-600 px-2.5 py-1 font-semibold text-white transition-colors hover:bg-rose-700"
        >
          <Square className="h-3 w-3" /> Done
        </button>
      )}

      {/* Live counters */}
      {running && (
        <div className="flex items-center gap-3 font-mono text-violet-700">
          <span title="Prompts sent">{promptCount} prompts</span>
          <span title="Total tokens">{tokenCount.toLocaleString()} tok</span>
          <span title="Elapsed time">{formatElapsed(elapsed)}</span>
          <span title="Canvas edits">{editCount} edits</span>
        </div>
      )}

      <div className="ml-auto" />

      {/* Export */}
      <button
        onClick={exportDataset}
        className="flex items-center gap-1 rounded border border-violet-200 bg-white px-2 py-0.5 text-violet-600 transition-colors hover:bg-violet-50"
        title="Download study dataset (JSON)"
      >
        <Download className="h-3 w-3" /> Export
      </button>
    </div>
  );
}
