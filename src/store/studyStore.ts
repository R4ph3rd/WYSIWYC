import { create } from 'zustand';

export type StudyCondition = 'chat_only' | 'full';
export type EventKind = 'task_start' | 'generation' | 'manipulation' | 'backchannel' | 'task_done';

export interface StudyRun {
  runId: string;
  participantId: string;
  condition: StudyCondition;
  taskId: string;
  startedAt: number;
  endedAt?: number;
  completed: boolean;
}

export interface StudyEvent {
  runId: string;
  kind: EventKind;
  ts: number;
  data?: Record<string, unknown>;
}

export interface LLMCallRecord {
  runId: string;
  participantId: string;
  condition: StudyCondition;
  taskId: string;
  callType: 'compose' | 'call_a' | 'call_b';
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Portion of inputTokens served from a prompt cache (Anthropic/OpenAI). */
  cachedInputTokens: number;
  ts: number;
}

export interface StudyDataset {
  runs: StudyRun[];
  events: StudyEvent[];
  llmCalls: LLMCallRecord[];
}

const STORAGE_KEY = 'wysiwyc-study';

function readDataset(): StudyDataset {
  try {
    return (
      (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as StudyDataset | null) ?? {
        runs: [],
        events: [],
        llmCalls: [],
      }
    );
  } catch {
    return { runs: [], events: [], llmCalls: [] };
  }
}

function writeDataset(ds: StudyDataset): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ds));
}

function makeRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

interface StudyState {
  /** True when ?study=1 is present in the URL. */
  isStudyMode: boolean;
  activeRun: StudyRun | null;
  participantId: string;
  condition: StudyCondition;
  taskId: string;
  /** Live counters shown in the study bar. */
  promptCount: number;
  tokenCount: number;
  editCount: number;
  /** Wall-clock start of the active run (ms epoch), for elapsed timer. */
  runStartedAt: number | null;

  setStudyMode: (on: boolean) => void;
  setParticipantId: (id: string) => void;
  setCondition: (c: StudyCondition) => void;
  setTaskId: (id: string) => void;
  startRun: () => void;
  endRun: () => void;
  logEvent: (kind: EventKind, data?: Record<string, unknown>) => void;
  logLLMCall: (
    call: Omit<LLMCallRecord, 'runId' | 'participantId' | 'condition' | 'taskId'>,
  ) => void;
  exportDataset: () => void;
}

export const useStudyStore = create<StudyState>((set, get) => ({
  isStudyMode: false,
  activeRun: null,
  participantId: '',
  condition: 'full',
  taskId: 'task_1',
  promptCount: 0,
  tokenCount: 0,
  editCount: 0,
  runStartedAt: null,

  setStudyMode: (on) => set({ isStudyMode: on }),
  setParticipantId: (id) => set({ participantId: id }),
  setCondition: (c) => set({ condition: c }),
  setTaskId: (id) => set({ taskId: id }),

  startRun: () => {
    const { participantId, condition, taskId } = get();
    const startedAt = Date.now();
    const run: StudyRun = {
      runId: makeRunId(),
      participantId,
      condition,
      taskId,
      startedAt,
      completed: false,
    };
    const ds = readDataset();
    ds.runs.push(run);
    ds.events.push({ runId: run.runId, kind: 'task_start', ts: startedAt });
    writeDataset(ds);
    set({ activeRun: run, promptCount: 0, tokenCount: 0, editCount: 0, runStartedAt: startedAt });
  },

  endRun: () => {
    const { activeRun } = get();
    if (!activeRun) return;
    const endedAt = Date.now();
    const ds = readDataset();
    const idx = ds.runs.findIndex((r) => r.runId === activeRun.runId);
    if (idx >= 0) ds.runs[idx] = { ...ds.runs[idx], endedAt, completed: true };
    ds.events.push({ runId: activeRun.runId, kind: 'task_done', ts: endedAt });
    writeDataset(ds);
    set({ activeRun: null, runStartedAt: null });
  },

  logEvent: (kind, data) => {
    const { activeRun } = get();
    if (!activeRun) return;
    const ds = readDataset();
    ds.events.push({ runId: activeRun.runId, kind, ts: Date.now(), data });
    writeDataset(ds);
    if (kind === 'generation') set((s) => ({ promptCount: s.promptCount + 1 }));
    if (kind === 'manipulation') set((s) => ({ editCount: s.editCount + 1 }));
  },

  logLLMCall: (call) => {
    const { activeRun, participantId, condition, taskId } = get();
    if (!activeRun) return;
    const record: LLMCallRecord = { ...call, runId: activeRun.runId, participantId, condition, taskId };
    const ds = readDataset();
    ds.llmCalls.push(record);
    writeDataset(ds);
    set((s) => ({ tokenCount: s.tokenCount + call.inputTokens + call.outputTokens }));
  },

  exportDataset: () => {
    const ds = readDataset();
    const blob = new Blob([JSON.stringify(ds, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wysiwyc-study-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },
}));
