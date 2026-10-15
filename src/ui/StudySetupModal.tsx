import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Circle as CircleIcon, Download, History, Plug, Trash2 } from 'lucide-react';
import { useStudyStore } from '@/store/studyStore';
import { useSettingsStore } from '@/store/settingsStore';
import { ConnectDialog } from './ConnectDialog';
import { cn } from '@/lib/utils';
import {
  buildAssignment,
  participantNumber,
  suggestAssignment,
  taskById,
  type ConditionOrder,
} from '@/study/tasks';
import { TOOL_NAMES, type Demographics, type ToolFrequency, type ToolName } from '@/study/schema';
import { ENV_SHEETS_URL, readArchive, downloadSessionFiles } from '@/study/exporter';
import { Card, Choice, ConditionChip, Field, GhostButton, inputClass, Likert, PrimaryButton, StudyShell, TargetImage } from './study/kit';

const FREQS: { value: ToolFrequency; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: 'rarely', label: 'Rarely' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'daily', label: 'Daily' },
];

const ROLES = ['Product designer', 'Front-end developer', 'Design engineer', 'Full-stack developer', 'Product manager', 'Researcher', 'Student', 'Other'];

function emptyDemographics(): Demographics {
  return {
    participantId: '',
    gender: '',
    genderSelfDescribe: '',
    age: null,
    role: '',
    yearsUiExperience: null,
    toolUse: Object.fromEntries(TOOL_NAMES.map((t) => [t, ''])) as unknown as Record<ToolName, ToolFrequency>,
    llmFamiliarity: null,
    consent: false,
  };
}

/**
 * Study entry (/study): demographics, background, counterbalanced scenario
 * (auto-suggested from the participant number, overridable), experimenter
 * settings and consent. Creates the session and moves to the first briefing.
 */
export function StudySetupModal() {
  const createSession = useStudyStore((s) => s.createSession);
  const [d, setD] = useState<Demographics>(emptyDemographics);
  const [override, setOverride] = useState(false);
  const [order, setOrder] = useState<ConditionOrder>('wysiwyc-first');
  const [row, setRow] = useState(0);
  const [timeLimit, setTimeLimit] = useState(10);
  const [susSchedule, setSusSchedule] = useState<'per-condition' | 'per-block'>('per-condition');
  const [sheetsUrl, setSheetsUrl] = useState(ENV_SHEETS_URL);
  const [connectOpen, setConnectOpen] = useState(false);
  const [tried, setTried] = useState(false);
  const isConnected = useSettingsStore((s) => Boolean(s.keys[s.activeProvider]?.trim()));
  const activeLabel = useSettingsStore((s) => s.activeLabel());

  const pnum = participantNumber(d.participantId);
  const usedIds = useMemo(() => new Set(readArchive().map((s) => s.demographics.participantId.toUpperCase())), []);
  const idError = !d.participantId
    ? 'Required'
    : pnum === null
      ? 'Use the form P01, P02, … (letter P + number)'
      : null;
  const idDuplicate = !idError && usedIds.has(d.participantId.trim().toUpperCase());

  const suggested = pnum !== null ? suggestAssignment(pnum) : null;
  const assignment = override || !suggested ? buildAssignment(order, row) : suggested;

  const up = <K extends keyof Demographics>(k: K, v: Demographics[K]) => setD((p) => ({ ...p, [k]: v }));

  const missing: string[] = [];
  if (idError) missing.push('participant ID');
  if (!d.gender || (d.gender === 'self-describe' && !d.genderSelfDescribe.trim())) missing.push('gender');
  if (!d.age || d.age < 18 || d.age > 99) missing.push('age (18–99)');
  if (!d.role) missing.push('role');
  if (d.yearsUiExperience === null || d.yearsUiExperience < 0) missing.push('years of UI experience');
  if (TOOL_NAMES.some((t) => !d.toolUse[t])) missing.push('tool use');
  if (!d.llmFamiliarity) missing.push('LLM familiarity');
  if (!d.consent) missing.push('consent');
  const valid = missing.length === 0;

  const start = () => {
    setTried(true);
    if (!valid) return;
    createSession(
      { ...d, participantId: d.participantId.trim().toUpperCase() },
      {
        conditionOrder: assignment.conditionOrder,
        squareRow: assignment.squareRow,
        overridden: override,
        blocks: assignment.blocks,
        timeLimitMin: timeLimit,
        sheetsUrl: sheetsUrl.trim(),
        susSchedule,
      },
    );
  };

  return (
    <StudyShell
      eyebrow="Step 1 · Participant setup"
      title="Welcome to the WYSIWYC study"
      subtitle="Thanks for taking part. A few questions about you first; the experimenter completes the session settings at the bottom."
      right={
        <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen}>
          <button className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-50">
            <CircleIcon className="h-2 w-2" fill={isConnected ? '#22c55e' : '#cbd5e1'} stroke="none" />
            <Plug className="h-3.5 w-3.5 text-slate-500" />
            <span className="text-slate-700">{activeLabel}</span>
          </button>
        </ConnectDialog>
      }
      footer={
        <>
          <p className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
            {tried && !valid ? (
              <span className="text-rose-600">Still missing: {missing.join(', ')}</span>
            ) : (
              <>Your answers are stored under your participant ID only — no name or email.</>
            )}
          </p>
          <PrimaryButton onClick={start} disabled={tried && !valid}>
            Continue to briefing <ArrowRight className="h-4 w-4" />
          </PrimaryButton>
        </>
      }
    >
      <Card title="Participant">
        <div className="grid grid-cols-3 gap-4">
          <Field
            label="Participant ID"
            error={tried || d.participantId ? idError : null}
            hint={idDuplicate ? undefined : 'Given by the experimenter, e.g. P07'}
          >
            <input
              className={inputClass}
              value={d.participantId}
              onChange={(e) => up('participantId', e.target.value)}
              placeholder="P01"
              aria-label="Participant ID"
              autoFocus
            />
            {idDuplicate && (
              <span className="mt-1 flex items-center gap-1 text-[11px] text-amber-700">
                <AlertTriangle className="h-3 w-3" /> This ID already ran in this browser.
              </span>
            )}
          </Field>
          <Field label="Age">
            <input
              className={inputClass}
              type="number"
              min={18}
              max={99}
              value={d.age ?? ''}
              onChange={(e) => up('age', e.target.value ? Number(e.target.value) : null)}
              aria-label="Age"
            />
          </Field>
          <Field label="Years designing or building UIs">
            <input
              className={inputClass}
              type="number"
              min={0}
              max={60}
              value={d.yearsUiExperience ?? ''}
              onChange={(e) => up('yearsUiExperience', e.target.value ? Number(e.target.value) : null)}
              aria-label="Years of UI experience"
            />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Gender">
            <div className="flex flex-wrap items-center gap-2">
              <Choice
                name="Gender"
                value={d.gender}
                onChange={(v) => up('gender', v)}
                options={[
                  { value: 'woman', label: 'Woman' },
                  { value: 'man', label: 'Man' },
                  { value: 'non-binary', label: 'Non-binary' },
                  { value: 'self-describe', label: 'Prefer to self-describe' },
                  { value: 'prefer-not', label: 'Prefer not to say' },
                ]}
              />
              {d.gender === 'self-describe' && (
                <input
                  className={cn(inputClass, 'w-48 py-1.5')}
                  value={d.genderSelfDescribe}
                  onChange={(e) => up('genderSelfDescribe', e.target.value)}
                  placeholder="Self-describe"
                  aria-label="Gender self-description"
                />
              )}
            </div>
          </Field>
        </div>
      </Card>

      <Card title="Background">
        <Field label="Which best describes your role?">
          <Choice name="Role" value={d.role} onChange={(v) => up('role', v)} options={ROLES.map((r) => ({ value: r, label: r }))} />
        </Field>
        <div className="mt-5">
          <span className="mb-2 block text-[11px] font-medium text-slate-600">How often do you use these tools to make interfaces?</span>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2 text-left font-semibold">Tool</th>
                  {FREQS.map((f) => (
                    <th key={f.value} className="px-2 py-2 text-center font-semibold">{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TOOL_NAMES.map((t) => (
                  <tr key={t} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 font-medium text-slate-700">{t}</td>
                    {FREQS.map((f) => {
                      const on = d.toolUse[t] === f.value;
                      return (
                        <td key={f.value} className="px-2 py-1.5 text-center">
                          <button
                            type="button"
                            role="radio"
                            aria-checked={on}
                            aria-label={`${t}: ${f.label}`}
                            onClick={() => up('toolUse', { ...d.toolUse, [t]: f.value })}
                            className={cn(
                              'mx-auto flex h-5 w-5 items-center justify-center rounded-full border transition-colors',
                              on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 hover:border-slate-500',
                            )}
                          >
                            {on && <Check className="h-3 w-3" />}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="mt-5">
          <Field label="How familiar are you with prompting large language models (ChatGPT, Claude, …)?">
            <Likert name="LLM familiarity" points={7} value={d.llmFamiliarity} onChange={(v) => up('llmFamiliarity', v)} low="Not at all familiar" high="Expert" />
          </Field>
        </div>
      </Card>

      <Card
        title="Session plan"
        hint={suggested && !override ? `Suggested for ${d.participantId.toUpperCase()} (Latin square row ${suggested.squareRow + 1}, ${suggested.conditionOrder})` : 'Experimenter'}
      >
        <div className="grid grid-cols-4 gap-3">
          {assignment.blocks.map((b, i) => {
            const task = taskById(b.taskId)!;
            return (
              <div key={i} className="rounded-lg border border-slate-200 p-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-slate-500">Block {i + 1}</span>
                  <ConditionChip condition={b.condition} />
                </div>
                <TargetImage taskId={b.taskId} className="h-20 w-full" />
                <p className="mt-1.5 truncate text-[11px] font-medium text-slate-700">{task.title}</p>
              </div>
            );
          })}
        </div>
        {!suggested && (
          <p className="mt-3 text-[11px] text-slate-500">Enter a participant ID to get the counterbalanced order automatically.</p>
        )}
        <label className="mt-4 flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={override}
            onChange={(e) => {
              setOverride(e.target.checked);
              if (e.target.checked && suggested) { setOrder(suggested.conditionOrder); setRow(suggested.squareRow); }
            }}
          />
          Override the suggested order
        </label>
        {override && (
          <div className="mt-3 grid grid-cols-2 gap-4 rounded-lg bg-slate-50 p-3">
            <Field label="Condition order">
              <Choice
                name="Condition order"
                size="sm"
                value={order}
                onChange={setOrder}
                options={[
                  { value: 'wysiwyc-first', label: 'WYSIWYC first' },
                  { value: 'baseline-first', label: 'Chat-only first' },
                ]}
              />
            </Field>
            <Field label="Task order (Latin square row)">
              <Choice
                name="Latin square row"
                size="sm"
                value={String(row)}
                onChange={(v) => setRow(Number(v))}
                options={[0, 1, 2, 3].map((r) => ({ value: String(r), label: `Row ${r + 1}` }))}
              />
            </Field>
          </div>
        )}
        <div className="mt-5 grid grid-cols-3 gap-4 border-t border-slate-100 pt-4">
          <Field label="Time limit per task (min)">
            <input
              className={inputClass}
              type="number"
              min={2}
              max={60}
              value={timeLimit}
              onChange={(e) => setTimeLimit(Math.max(1, Number(e.target.value) || 10))}
              aria-label="Time limit"
            />
          </Field>
          <Field label="SUS questionnaire" className="col-span-2">
            <Choice
              name="SUS schedule"
              size="sm"
              value={susSchedule}
              onChange={setSusSchedule}
              options={[
                { value: 'per-condition', label: 'Once per condition (after its 2nd task)' },
                { value: 'per-block', label: 'After every task' },
              ]}
            />
          </Field>
          <Field
            label="Google Sheets backup (Apps Script web-app URL, optional)"
            hint={ENV_SHEETS_URL ? 'Pre-filled from VITE_STUDY_SHEETS_URL.' : 'Local CSV/JSON export always runs; this is an extra copy. See docs/STUDY.md.'}
            className="col-span-3"
          >
            <input
              className={inputClass}
              value={sheetsUrl}
              onChange={(e) => setSheetsUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/…/exec"
              aria-label="Sheets URL"
            />
          </Field>
        </div>
        {!isConnected && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            No model connected. Connect one (top right) before the first task so both conditions use the same model.
          </div>
        )}
      </Card>

      <Card title="Consent">
        <label className="flex items-start gap-2.5 text-[13px] leading-snug text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={d.consent} onChange={(e) => up('consent', e.target.checked)} aria-label="Consent" />
          <span>
            I agree to take part. I understand that my interactions with the tool (prompts, edits, timings and model token usage) and my
            questionnaire answers are recorded under my participant ID, that the session may be observed, and that I can stop at any time
            without giving a reason.
          </span>
        </label>
      </Card>
    </StudyShell>
  );
}

/** Crash recovery: an unfinished session backup was found on load. */
export function StudyRecoverScreen() {
  const backup = useStudyStore((s) => s.pendingBackup);
  const resume = useStudyStore((s) => s.resumeBackup);
  const discard = useStudyStore((s) => s.discardBackup);
  if (!backup) return null;
  const s = backup.session;
  const mins = Math.round((Date.now() - backup.savedAt) / 60000);
  return (
    <StudyShell eyebrow="Recovery" title="Unfinished session found" subtitle="The page was closed or reloaded during a session. Nothing was lost.">
      <Card>
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            <History className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-800">
              {s.demographics.participantId} · block {Math.min(backup.currentBlock + 1, s.config.blocks.length)} of {s.config.blocks.length}
              <span className="ml-2 text-[11px] font-normal text-slate-500">({backup.phase})</span>
            </p>
            <p className="text-[11px] text-slate-500">
              Last saved {mins <= 0 ? 'just now' : `${mins} min ago`} · {s.events.length} events · {s.calls.length} model calls
            </p>
          </div>
        </div>
        <p className="mt-4 text-[11px] text-slate-500">
          Resuming continues where it stopped; the time the page was closed is excluded from the task timer.
        </p>
        <div className="mt-4 flex gap-2">
          <PrimaryButton onClick={resume}>Resume session</PrimaryButton>
          <GhostButton onClick={() => void downloadSessionFiles(s)}>
            <Download className="h-3.5 w-3.5" /> Export backup
          </GhostButton>
          <GhostButton
            className="ml-auto text-rose-600 hover:bg-rose-50"
            onClick={() => { if (window.confirm('Discard this unfinished session? Export it first if you need it.')) discard(); }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Discard and start new
          </GhostButton>
        </div>
      </Card>
    </StudyShell>
  );
}
