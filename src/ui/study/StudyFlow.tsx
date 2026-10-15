import { useState, type ReactNode } from 'react';
import {
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  Clock,
  CloudOff,
  CloudUpload,
  Download,
  Hand,
  Loader2,
  MessageSquare,
  MousePointer2,
  PenLine,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  TimerOff,
} from 'lucide-react';
import { useStudyStore } from '@/store/studyStore';
import { CONDITION_LABEL, taskById, type Condition } from '@/study/tasks';
import { SUS_ITEMS, TLX_SCALES, emptyTlx, type TlxAnswers } from '@/study/questionnaires';
import { downloadText, sessionFiles } from '@/study/exporter';
import type { EndInterview } from '@/study/schema';
import { StudyRecoverScreen, StudySetupModal } from '../StudySetupModal';
import { Card, Choice, ConditionChip, CriteriaList, Field, GhostButton, inputClass, Likert, PrimaryButton, StudyShell, TargetImage, TlxScale } from './kit';
import { cn } from '@/lib/utils';
import { AI } from '@/ui/tokens';

/** Routes the full-screen study pages; renders nothing while a task runs. */
export function StudyFlow() {
  const phase = useStudyStore((s) => s.phase);
  switch (phase) {
    case 'recover':
      return <StudyRecoverScreen />;
    case 'setup':
      return <StudySetupModal />;
    case 'briefing':
      return <BriefingScreen />;
    case 'post-block':
      return <PostBlockScreen />;
    case 'end':
      return <EndScreen />;
    case 'done':
      return <DoneScreen />;
    default:
      return null;
  }
}

function ParticipantBadge() {
  const pid = useStudyStore((s) => s.session?.demographics.participantId);
  const current = useStudyStore((s) => s.currentBlock);
  const total = useStudyStore((s) => s.session?.config.blocks.length ?? 4);
  if (!pid) return null;
  return (
    <div className="flex items-center gap-2 text-[11px] text-slate-500">
      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono font-semibold text-slate-700">{pid}</span>
      <div className="flex gap-1" aria-label="Progress">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cn('h-1.5 w-5 rounded-full', i < current ? 'bg-slate-700' : i === current ? 'bg-amber-400' : 'bg-slate-200')} />
        ))}
      </div>
    </div>
  );
}

// --- Briefing ----------------------------------------------------------------

const RULES = [
  'Rebuild the target screen as closely as you reasonably can, using only this tool. No other apps, code or copy-paste from outside.',
  'Pixel-perfect is not required: aim to satisfy every acceptance criterion (layout, components, colours, text).',
  'Work as you normally would and think aloud if you like. The experimenter can help with tool problems, not with the design.',
  'Click “I’m done” when you are satisfied. The task also ends automatically when the time limit is reached.',
];

function Tutorial({ condition }: { condition: Condition }) {
  const items: { icon: ReactNode; title: string; body: string }[] =
    condition === 'wysiwyc'
      ? [
          { icon: <MessageSquare className="h-4 w-4" />, title: 'Describe it', body: 'Type what you want in the composer. The spec on the left writes itself and the canvas updates.' },
          { icon: <MousePointer2 className="h-4 w-4" />, title: 'Edit by hand', body: 'Drag, resize, draw shapes or use the properties panel directly on the canvas, without asking the model.' },
          { icon: <SlidersHorizontal className="h-4 w-4" />, title: 'Tweak values', body: 'Highlighted words in the spec (colours, sizes, fonts…) are widgets: click one to adjust it instantly.' },
          { icon: <Sparkles className="h-4 w-4" />, title: 'Resolve proposals', body: 'After a hand edit, an amber “proposed” sentence appears. Accept it, pick an alternative, or rephrase it.' },
          { icon: <PenLine className="h-4 w-4" />, title: 'Mark up', body: 'Comment, arrow, box and scribble tools let you point at what to change, then apply the annotations.' },
        ]
      : [
          { icon: <MessageSquare className="h-4 w-4" />, title: 'Chat to build', body: 'Describe the UI in the chat. Each message updates the preview, like Lovable or v0.' },
          { icon: <Hand className="h-4 w-4" />, title: 'Preview only', body: 'The canvas is read-only: you can look and select, but every change has to be asked for in a new message.' },
          { icon: <RotateCw className="h-4 w-4" />, title: 'Iterate', body: 'Follow up with corrections (“make the button indigo”, “move the link under the field”…). Undo is available.' },
        ];
  return (
    <div className={cn('grid gap-3', items.length > 3 ? 'grid-cols-2' : 'grid-cols-3')}>
      {items.map((it) => (
        <div key={it.title} className="flex gap-3 rounded-lg border border-slate-200 bg-white p-3">
          <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', condition === 'wysiwyc' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-600')}>
            {it.icon}
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-800">{it.title}</p>
            <p className="mt-0.5 text-[12px] leading-snug text-slate-500">{it.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function BriefingScreen() {
  const session = useStudyStore((s) => s.session)!;
  const current = useStudyStore((s) => s.currentBlock);
  const startBlock = useStudyStore((s) => s.startBlock);
  const track = useStudyStore((s) => s.track);
  const block = session.config.blocks[current];
  const task = taskById(block.taskId)!;
  const prev = session.config.blocks[current - 1];
  const newCondition = !prev || prev.condition !== block.condition;
  const total = session.config.blocks.length;
  const [ready, setReady] = useState(!newCondition);

  return (
    <StudyShell
      wide
      eyebrow={`Block ${current + 1} of ${total} · ${newCondition ? (prev ? 'New tool' : 'First tool') : 'Same tool, new screen'}`}
      title={newCondition ? `Next you will use ${CONDITION_LABEL[block.condition]}` : `Task ${current + 1}: ${task.title}`}
      subtitle={
        newCondition
          ? block.condition === 'wysiwyc'
            ? 'Talk to the tool and edit the result directly; the written spec stays in sync with what you see.'
            : 'A chat-only version of the same tool: describe what you want; the preview cannot be edited by hand.'
          : 'Same rules as before. Take a moment to study the target.'
      }
      right={<ParticipantBadge />}
      footer={
        <>
          <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <Clock className="h-3.5 w-3.5" /> Time limit: {session.config.timeLimitMin} min · the timer starts when you click Start
          </span>
          <PrimaryButton className="ml-auto" onClick={startBlock} disabled={!ready}>
            Start task <ArrowRight className="h-4 w-4" />
          </PrimaryButton>
        </>
      }
    >
      {newCondition && (
        <Card title={`How ${CONDITION_LABEL[block.condition]} works`} hint={<ConditionChip condition={block.condition} />}>
          <Tutorial condition={block.condition} />
          <label className="mt-4 flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={ready} onChange={(e) => setReady(e.target.checked)} aria-label="Tutorial understood" />
            I have read how this tool works (ask the experimenter for a short demo if anything is unclear).
          </label>
        </Card>
      )}
      <div className="grid grid-cols-5 gap-5">
        <Card className="col-span-3" title={`Task ${current + 1}: ${task.title}`} hint="Click the image to enlarge it">
          <TargetImage taskId={task.id} className="aspect-[16/11] w-full" onOpen={() => track('target_view', { subkind: 'briefing', data: { taskId: task.id } })} />
          <p className="mt-3 text-sm text-slate-600">{task.goal}</p>
        </Card>
        <div className="col-span-2 space-y-5">
          <Card title="Done when…">
            <CriteriaList criteria={task.criteria} />
          </Card>
          {(current === 0 || newCondition) && (
            <Card title="Rules">
              <ul className="space-y-2">
                {RULES.map((r) => (
                  <li key={r} className="flex gap-2 text-[12px] leading-snug text-slate-600">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                    {r}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </StudyShell>
  );
}

// --- Post-block questionnaires -------------------------------------------------

function PostBlockScreen() {
  const session = useStudyStore((s) => s.session)!;
  const current = useStudyStore((s) => s.currentBlock);
  const submit = useStudyStore((s) => s.submitPostBlock);
  const block = session.blocks.find((b) => b.blockIndex === current)!;
  const next = session.config.blocks[current + 1];
  const lastOfCondition = !next || next.condition !== block.condition;
  const askSus = session.config.susSchedule === 'per-block' || lastOfCondition;
  const [tlx, setTlx] = useState<TlxAnswers>(emptyTlx);
  const [sus, setSus] = useState<(number | null)[]>(() => Array(10).fill(null));
  const [selfMatch, setSelfMatch] = useState<number | null>(null);
  const [similarity, setSimilarity] = useState<number | null>(null);
  const [tried, setTried] = useState(false);

  const tlxDone = Object.values(tlx).every((v) => v !== null);
  const susDone = !askSus || sus.every((v) => v !== null);
  const valid = tlxDone && susDone && selfMatch !== null;
  const label = CONDITION_LABEL[block.condition];

  return (
    <StudyShell
      eyebrow={`Block ${current + 1} · questionnaire`}
      title={block.endReason === 'timeout' ? 'Time is up — a few quick questions' : 'Task complete — a few quick questions'}
      subtitle={<>About the task you just did with <strong className="font-semibold text-slate-700">{label}</strong>. There are no right answers.</>}
      right={<ParticipantBadge />}
      footer={
        <>
          <p className="flex-1 text-[11px] text-slate-500">
            {tried && !valid ? <span className="text-rose-600">Please answer every question.</span> : askSus ? '7 + 10 short questions' : '7 short questions'}
          </p>
          <PrimaryButton
            onClick={() => {
              setTried(true);
              if (valid) submit({ tlx, sus: askSus ? sus : undefined, similarity, selfMatch });
            }}
          >
            Continue <ArrowRight className="h-4 w-4" />
          </PrimaryButton>
        </>
      }
    >
      {block.endReason === 'timeout' && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-600">
          <TimerOff className="h-4 w-4 text-slate-400" /> The {session.config.timeLimitMin}-minute limit was reached; your work so far was saved.
        </div>
      )}
      <Card title="Your result">
        <Field label="How closely does what you built match the target?">
          <Likert name="Self-rated match" points={7} value={selfMatch} onChange={setSelfMatch} low="Not at all" high="Exactly" />
        </Field>
      </Card>
      <Card title="Workload (NASA-TLX)" hint="Click on each scale">
        <div className="space-y-5">
          {TLX_SCALES.map((sc) => (
            <div key={sc.key} className={cn(tried && tlx[sc.key] === null && 'rounded-lg ring-2 ring-rose-200 ring-offset-4')}>
              <p className="mb-1.5 text-[13px] text-slate-700">
                <span className="font-semibold">{sc.label}.</span> {sc.question}
              </p>
              <TlxScale name={sc.label} value={tlx[sc.key]} onChange={(v) => setTlx((p) => ({ ...p, [sc.key]: v }))} low={sc.low} high={sc.high} />
            </div>
          ))}
        </div>
      </Card>
      {askSus && (
        <Card title={`Usability of ${label} (SUS)`} hint={session.config.susSchedule === 'per-condition' ? 'About the tool overall, across both of its tasks' : undefined}>
          <div className="divide-y divide-slate-100">
            {SUS_ITEMS.map((q, i) => (
              <div key={i} className={cn('flex items-center gap-4 py-2.5', tried && sus[i] === null && 'bg-rose-50/60')}>
                <p className="min-w-0 flex-1 text-[13px] text-slate-700">
                  <span className="mr-1.5 font-mono text-[11px] text-slate-400">{i + 1}.</span>
                  {q}
                </p>
                <div className="w-64 shrink-0">
                  <Likert
                    name={`SUS ${i + 1}`}
                    points={5}
                    value={sus[i]}
                    onChange={(v) => setSus((p) => p.map((x, j) => (j === i ? v : x)))}
                    low="Strongly disagree"
                    high="Strongly agree"
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card title="Experimenter" hint="Optional · fill in after the participant">
        <Field label={`Visual similarity to the target, 0–100 ${similarity === null ? '(not rated)' : `· ${similarity}`}`} hint="Your judgement now; a blind rating can be added later from the saved final IR.">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={similarity ?? 50}
              onChange={(e) => setSimilarity(Number(e.target.value))}
              className={cn('flex-1 accent-slate-800', similarity === null && 'opacity-50')}
              aria-label="Similarity rating"
            />
            {similarity !== null && (
              <button className="text-[11px] text-slate-500 hover:underline" onClick={() => setSimilarity(null)}>
                Clear
              </button>
            )}
          </div>
        </Field>
      </Card>
    </StudyShell>
  );
}

// --- End of session -------------------------------------------------------------

const INTERVIEW_GUIDE = [
  'Walk me through how you approached the last task in each tool.',
  'When did you prefer typing over editing directly, and why?',
  'How did the amber proposed sentences feel? Did you trust their wording?',
  'Would you hand the final spec to someone else? What would you change?',
  'What would make you switch tools for real work?',
];

function EndScreen() {
  const finish = useStudyStore((s) => s.finish);
  const [iv, setIv] = useState<EndInterview>({ preference: '', preferenceStrength: null, reason: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const valid = iv.preference !== '' && iv.preferenceStrength !== null;
  return (
    <StudyShell
      eyebrow="Last step"
      title="Which tool would you rather use?"
      subtitle="Thinking about both tools you used today for building screens like these."
      right={<ParticipantBadge />}
      footer={
        <>
          <p className="flex-1 text-[11px] text-slate-500">Saving downloads the session files to this computer{' '}and sends a backup if Google Sheets is configured.</p>
          <PrimaryButton
            disabled={!valid || busy}
            onClick={async () => { setBusy(true); await finish(iv); }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Save and export
          </PrimaryButton>
        </>
      }
    >
      <Card title="Preference">
        <Choice
          name="Preference"
          value={iv.preference}
          onChange={(v) => setIv((p) => ({ ...p, preference: v }))}
          options={[
            { value: 'wysiwyc', label: 'WYSIWYC' },
            { value: 'baseline', label: 'Chat-only' },
            { value: 'none', label: 'No preference' },
          ]}
        />
        <div className="mt-5">
          <Field label="How strong is that preference?">
            <Likert
              name="Preference strength"
              points={7}
              value={iv.preferenceStrength}
              onChange={(v) => setIv((p) => ({ ...p, preferenceStrength: v }))}
              low="Strongly chat-only"
              high="Strongly WYSIWYC"
            />
          </Field>
        </div>
        <div className="mt-5">
          <Field label="Why? (optional)">
            <textarea className={cn(inputClass, 'h-20 resize-none')} value={iv.reason} onChange={(e) => setIv((p) => ({ ...p, reason: e.target.value }))} aria-label="Preference reason" />
          </Field>
        </div>
      </Card>
      <Card title="Interview notes" hint="Experimenter · semi-structured, ~5 minutes">
        <ul className="mb-3 space-y-1">
          {INTERVIEW_GUIDE.map((q) => (
            <li key={q} className="text-[12px] text-slate-500">· {q}</li>
          ))}
        </ul>
        <textarea
          className={cn(inputClass, 'h-40 resize-y font-mono text-[12px]')}
          value={iv.notes}
          onChange={(e) => setIv((p) => ({ ...p, notes: e.target.value }))}
          placeholder="Notes, quotes, observations…"
          aria-label="Interview notes"
        />
      </Card>
    </StudyShell>
  );
}

function DoneScreen() {
  const session = useStudyStore((s) => s.session)!;
  const remote = useStudyStore((s) => s.remote);
  const retry = useStudyStore((s) => s.retryRemote);
  const downloadAll = useStudyStore((s) => s.downloadAll);
  const files = sessionFiles(session);
  return (
    <StudyShell
      eyebrow="Session complete"
      title={`Thank you, ${session.demographics.participantId}!`}
      subtitle="The session is over. The files below were downloaded to this computer."
      right={<ParticipantBadge />}
      footer={
        <>
          <a href="./analysis" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline">
            <BarChart3 className="h-3.5 w-3.5" /> Open analysis
          </a>
          <PrimaryButton className="ml-auto" onClick={() => window.location.reload()}>
            Next participant <ArrowRight className="h-4 w-4" />
          </PrimaryButton>
        </>
      }
    >
      <Card title="Local files" hint="Always saved, independent of the remote backup">
        <ul className="divide-y divide-slate-100">
          {files.map((f) => (
            <li key={f.name} className="flex items-center gap-3 py-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-slate-700">{f.name}</span>
              <span className="text-[11px] text-slate-400">{(f.text.length / 1024).toFixed(1)} KB</span>
              <button className="text-[11px] font-medium text-slate-600 hover:underline" onClick={() => downloadText(f.name, f.text, f.mime)}>
                Download
              </button>
            </li>
          ))}
        </ul>
        <GhostButton className="mt-3" onClick={() => void downloadAll()}>
          <Download className="h-3.5 w-3.5" /> Download all again
        </GhostButton>
      </Card>
      <Card title="Google Sheets backup">
        <RemoteRow remote={remote} onRetry={() => void retry()} />
      </Card>
    </StudyShell>
  );
}

function RemoteRow({ remote, onRetry }: { remote: ReturnType<typeof useStudyStore.getState>['remote']; onRetry: () => void }) {
  if (remote.state === 'off') {
    return <p className="flex items-center gap-2 text-[12px] text-slate-500"><CloudOff className="h-4 w-4" /> Not configured — local files only.</p>;
  }
  if (remote.state === 'sending') {
    return <p className="flex items-center gap-2 text-[12px] text-slate-600"><Loader2 className="h-4 w-4 animate-spin" /> Sending…</p>;
  }
  const tone =
    remote.state === 'ok' ? 'text-emerald-700' : remote.state === 'unconfirmed' ? 'text-amber-700' : 'text-rose-700';
  return (
    <div className="flex items-center gap-3">
      <p className={cn('flex flex-1 items-center gap-2 text-[12px]', tone)} data-testid="remote-status">
        {remote.state === 'ok' ? <CloudUpload className="h-4 w-4" /> : <CloudOff className="h-4 w-4" />}
        {remote.state === 'ok' ? 'Saved' : remote.state === 'unconfirmed' ? 'Unconfirmed' : 'Failed'} — {remote.detail}
      </p>
      {remote.state !== 'ok' && (
        <button className={cn('rounded-md px-2.5 py-1 text-[11px] font-semibold', AI.fill)} onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
