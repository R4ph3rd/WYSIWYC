import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ListChecks, Timer } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { useStudyStore } from '@/store/studyStore';
import { taskById } from '@/study/tasks';
import { cn } from '@/lib/utils';
import { ConditionChip, CriteriaList, TargetImage, formatClock } from './study/kit';

/**
 * Task header shown above the editor while a study block runs (/study):
 * block + condition, the target (click to enlarge), acceptance criteria,
 * the countdown and the participant's "I'm done" button. The block ends
 * automatically when the time limit is reached.
 */
export function StudyBar() {
  const session = useStudyStore((s) => s.session);
  const current = useStudyStore((s) => s.currentBlock);
  const blockElapsed = useStudyStore((s) => s.blockElapsed);
  const endBlock = useStudyStore((s) => s.endBlock);
  const track = useStudyStore((s) => s.track);
  const [elapsed, setElapsed] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const ended = useRef(false);

  const block = session?.config.blocks[current];
  const limitMs = (session?.config.timeLimitMin ?? 10) * 60_000;

  useEffect(() => {
    ended.current = false;
    const tick = () => {
      const e = blockElapsed();
      setElapsed(e);
      if (e >= limitMs && !ended.current) {
        ended.current = true;
        endBlock('timeout');
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [blockElapsed, endBlock, limitMs, current]);

  if (!session || !block) return null;
  const task = taskById(block.taskId)!;
  const remaining = limitMs - elapsed;
  const low = remaining < 2 * 60_000;

  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4" data-testid="study-bar">
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Block {current + 1}/{session.config.blocks.length}
        </span>
        <ConditionChip condition={block.condition} />
      </div>
      <div className="mx-1 h-8 w-px bg-slate-200" />
      <TargetImage
        taskId={task.id}
        className="h-10 w-[58px] shrink-0"
        onOpen={() => track('target_view', { subkind: 'task', data: { taskId: task.id } })}
      />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-slate-800">{task.title}</p>
        <p className="truncate text-[11px] text-slate-500">{task.goal}</p>
      </div>
      <Popover.Root onOpenChange={(o) => o && track('target_view', { subkind: 'criteria', data: { taskId: task.id } })}>
        <Popover.Trigger asChild>
          <button className="flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50">
            <ListChecks className="h-3.5 w-3.5" /> Criteria
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content sideOffset={6} align="start" className="z-[70] w-96 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Done when…</p>
            <CriteriaList criteria={task.criteria} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <div className="ml-auto flex items-center gap-3">
        <span
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[13px] tabular-nums',
            low ? 'bg-amber-50 text-amber-800' : 'text-slate-600',
          )}
          title={`Time left of ${session.config.timeLimitMin} min`}
          data-testid="study-timer"
        >
          <Timer className="h-3.5 w-3.5" />
          {formatClock(remaining)}
        </span>
        {confirming ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-500">Finish this task?</span>
            <button onClick={() => setConfirming(false)} className="rounded-md px-2 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100">
              Keep working
            </button>
            <button
              onClick={() => { ended.current = true; endBlock('done'); setConfirming(false); }}
              className="flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
            >
              Yes, I’m done
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-slate-800"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> I’m done
          </button>
        )}
      </div>
    </div>
  );
}
