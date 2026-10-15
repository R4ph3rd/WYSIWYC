import { create } from 'zustand';
import type {
  BlockRecord,
  CallType,
  Demographics,
  EndInterview,
  EventKind,
  LLMCall,
  StudyConfig,
  StudyEvent,
  StudySession,
} from '@/study/schema';
import { SCHEMA_VERSION } from '@/study/schema';
import type { TlxAnswers } from '@/study/questionnaires';
import {
  archiveSession,
  downloadSessionFiles,
  ENV_SHEETS_URL,
  postToSheets,
  type RemoteStatus,
} from '@/study/exporter';
import { flushOpenProposals, useAppStore } from '@/store/appStore';

/**
 * Study session state machine + instrumentation.
 *
 *   setup → briefing → task → post-block → (briefing → task → post-block)×3 → end → done
 *
 * Every LLM call, prompt, manipulation, proposal and questionnaire answer is
 * appended to the session (timestamps relative to the active block's start)
 * and the whole session is backed up to localStorage on every change, so a
 * crashed tab can resume. Both conditions log through the same calls.
 */

/** Legacy condition flag read by the editor: 'chat_only' locks the canvas. */
export type StudyCondition = 'chat_only' | 'full';

export type StudyPhase = 'idle' | 'recover' | 'setup' | 'briefing' | 'task' | 'post-block' | 'end' | 'done';

const BACKUP_KEY = 'wysiwyc.study.backup.v2';

interface Backup {
  session: StudySession;
  phase: StudyPhase;
  currentBlock: number;
  savedAt: number;
  app?: { ir: unknown; prompt: unknown };
}

function readBackup(): Backup | null {
  try {
    const b = JSON.parse(localStorage.getItem(BACKUP_KEY) ?? 'null') as Backup | null;
    return b && b.session?.schemaVersion === SCHEMA_VERSION ? b : null;
  } catch {
    return null;
  }
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export interface TrackFields {
  subkind?: string;
  category?: string;
  data?: Record<string, unknown>;
}

export interface CallInput {
  provider: string;
  model: string;
  callType: CallType;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
  ok: boolean;
  error?: string;
}

interface StudyState {
  /** True on the /study route. */
  isStudyMode: boolean;
  phase: StudyPhase;
  session: StudySession | null;
  /** Index into session.config.blocks of the current / next block. */
  currentBlock: number;
  /** Derived from the running block: 'chat_only' for the baseline. */
  condition: StudyCondition;
  /** Live counters for the task bar (current block). */
  promptCount: number;
  tokenCount: number;
  editCount: number;
  remote: RemoteStatus;
  /** A backup found at startup, offered for recovery. */
  pendingBackup: Backup | null;

  setStudyMode: (on: boolean) => void;
  /** Create the session from the setup screen and move to the first briefing. */
  createSession: (demographics: Demographics, config: StudyConfig) => void;
  startBlock: () => void;
  endBlock: (reason: 'done' | 'timeout' | 'skipped') => void;
  submitPostBlock: (answers: { tlx: TlxAnswers; sus?: (number | null)[]; similarity: number | null; selfMatch: number | null }) => void;
  finish: (interview: EndInterview) => Promise<void>;
  retryRemote: () => Promise<void>;
  downloadAll: () => Promise<void>;
  resumeBackup: () => void;
  discardBackup: () => void;
  /** Elapsed active ms of the running block. */
  blockElapsed: () => number;
  /** Append an event (no-op outside a session). */
  track: (kind: EventKind, fields?: TrackFields) => void;
  /** Append an LLM-call ledger row (no-op outside a running block). */
  logCall: (call: CallInput) => void;
  /** True while a block is running (instrumentation is live). */
  isRecording: () => boolean;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useStudyStore = create<StudyState>((set, get) => {
  function persist(immediate = false): void {
    const write = () => {
      saveTimer = null;
      const { session, phase, currentBlock } = get();
      if (!session || phase === 'done') return;
      const app = useAppStore.getState();
      const backup: Backup = {
        session,
        phase,
        currentBlock,
        savedAt: Date.now(),
        app: phase === 'task' ? { ir: app.ir, prompt: app.prompt } : undefined,
      };
      try {
        localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
      } catch {
        /* quota — downloads at the end remain available */
      }
    };
    if (immediate) {
      if (saveTimer) clearTimeout(saveTimer);
      write();
      return;
    }
    if (!saveTimer) saveTimer = setTimeout(write, 400);
  }

  function activeBlock(): BlockRecord | undefined {
    const { session, currentBlock, phase } = get();
    if (!session || phase !== 'task') return undefined;
    return session.blocks.find((b) => b.blockIndex === currentBlock);
  }

  function elapsed(block?: BlockRecord): number {
    if (!block) return -1;
    return Date.now() - block.startedAt - block.pausedMs;
  }

  function mutate(fn: (s: StudySession) => void): void {
    const session = get().session;
    if (!session) return;
    fn(session);
    set({ session: { ...session } });
    persist();
  }

  function pushEvent(kind: EventKind, fields: TrackFields = {}, blockIndex?: number): void {
    const block = activeBlock();
    mutate((s) => {
      const ev: StudyEvent = {
        seq: s.events.length,
        blockIndex: blockIndex ?? block?.blockIndex ?? -1,
        t: block ? elapsed(block) : -1,
        ts: Date.now(),
        kind,
        ...fields,
      };
      s.events.push(ev);
    });
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => persist(true));
  }

  return {
    isStudyMode: false,
    phase: 'idle',
    session: null,
    currentBlock: 0,
    condition: 'full',
    promptCount: 0,
    tokenCount: 0,
    editCount: 0,
    remote: { state: 'off' },
    pendingBackup: null,

    setStudyMode: (on) => {
      if (!on) { set({ isStudyMode: false, phase: 'idle' }); return; }
      const backup = readBackup();
      set({ isStudyMode: true, phase: backup ? 'recover' : 'setup', pendingBackup: backup });
    },

    createSession: (demographics, config) => {
      const session: StudySession = {
        schemaVersion: SCHEMA_VERSION,
        sessionId: makeId('ses'),
        createdAt: Date.now(),
        demographics,
        config: { ...config, sheetsUrl: config.sheetsUrl || ENV_SHEETS_URL },
        blocks: [],
        events: [],
        calls: [],
        interview: { preference: '', preferenceStrength: null, reason: '', notes: '' },
        appVersion: '0.1.0',
      };
      set({ session, phase: 'briefing', currentBlock: 0, remote: { state: 'off' } });
      persist(true);
    },

    startBlock: () => {
      const { session, currentBlock } = get();
      if (!session) return;
      const spec = session.config.blocks[currentBlock];
      if (!spec) return;
      // Every block starts from a blank editor.
      useAppStore.getState().newBlank();
      useAppStore.setState({ tool: 'pointer', irSyncMode: 'auto', chatLog: [] });
      const block: BlockRecord = {
        blockIndex: currentBlock,
        condition: spec.condition,
        taskId: spec.taskId,
        startedAt: Date.now(),
        pausedMs: 0,
      };
      mutate((s) => {
        s.blocks = s.blocks.filter((b) => b.blockIndex !== currentBlock).concat(block);
      });
      set({
        phase: 'task',
        condition: spec.condition === 'baseline' ? 'chat_only' : 'full',
        promptCount: 0,
        tokenCount: 0,
        editCount: 0,
      });
      pushEvent('block_start', { subkind: spec.condition, data: { taskId: spec.taskId, timeLimitMin: session.config.timeLimitMin } });
      persist(true);
    },

    endBlock: (reason) => {
      const block = activeBlock();
      if (!block) return;
      const app = useAppStore.getState();
      flushOpenProposals('abandoned');
      pushEvent('block_end', { subkind: reason, data: { clauses: app.prompt.clauses.length, nodes: app.ir.nodes.length } });
      mutate((s) => {
        const b = s.blocks.find((x) => x.blockIndex === block.blockIndex);
        if (!b) return;
        b.endedAt = Date.now();
        b.endReason = reason;
        b.finalSpec = app.prompt.clauses.map((c) => c.text);
        b.finalIR = app.ir;
      });
      set({ phase: 'post-block', condition: 'full' });
      persist(true);
    },

    submitPostBlock: ({ tlx, sus, similarity, selfMatch }) => {
      const { session, currentBlock } = get();
      if (!session) return;
      mutate((s) => {
        const b = s.blocks.find((x) => x.blockIndex === currentBlock);
        if (!b) return;
        b.tlx = tlx;
        if (sus) b.sus = sus;
        b.similarity = similarity;
        b.selfMatch = selfMatch;
      });
      pushEvent('questionnaire', { subkind: sus ? 'tlx+sus' : 'tlx', data: { tlx, sus, similarity, selfMatch } }, currentBlock);
      const next = currentBlock + 1;
      if (next < session.config.blocks.length) set({ currentBlock: next, phase: 'briefing' });
      else set({ phase: 'end' });
      persist(true);
    },

    finish: async (interview) => {
      mutate((s) => {
        s.interview = interview;
        s.finishedAt = Date.now();
      });
      const session = get().session!;
      archiveSession(session);
      set({ phase: 'done' });
      // Keep the backup until the files are out; local export always runs first.
      await downloadSessionFiles(session);
      try { localStorage.removeItem(BACKUP_KEY); } catch { /* ignore */ }
      await get().retryRemote();
    },

    retryRemote: async () => {
      const session = get().session;
      const url = session?.config.sheetsUrl;
      if (!session || !url) { set({ remote: { state: 'off' } }); return; }
      set({ remote: { state: 'sending' } });
      set({ remote: await postToSheets(url, session) });
    },

    downloadAll: async () => {
      const session = get().session;
      if (session) await downloadSessionFiles(session);
    },

    resumeBackup: () => {
      const backup = get().pendingBackup;
      if (!backup) return;
      const session = backup.session;
      let phase = backup.phase;
      if (phase === 'task') {
        const b = session.blocks.find((x) => x.blockIndex === backup.currentBlock);
        if (b) b.pausedMs += Math.max(0, Date.now() - backup.savedAt);
        if (backup.app) {
          useAppStore.getState().newBlank();
          useAppStore.setState({ ir: backup.app.ir as never, prompt: backup.app.prompt as never });
        }
      }
      if (phase === 'recover' || phase === 'idle') phase = 'briefing';
      const spec = session.config.blocks[backup.currentBlock];
      set({
        session,
        phase,
        currentBlock: backup.currentBlock,
        pendingBackup: null,
        condition: phase === 'task' && spec?.condition === 'baseline' ? 'chat_only' : 'full',
      });
      pushEvent('session_recovered', { data: { gapMs: Date.now() - backup.savedAt, phase } });
      persist(true);
    },

    discardBackup: () => {
      try { localStorage.removeItem(BACKUP_KEY); } catch { /* ignore */ }
      set({ pendingBackup: null, phase: 'setup' });
    },

    blockElapsed: () => elapsed(activeBlock()),

    track: (kind, fields) => {
      if (!get().session || get().phase === 'done') return;
      pushEvent(kind, fields);
      if (get().phase !== 'task') return;
      if (kind === 'prompt_submit') set((s) => ({ promptCount: s.promptCount + 1 }));
      if (kind === 'manipulation') set((s) => ({ editCount: s.editCount + 1 }));
    },

    logCall: (call) => {
      const block = activeBlock();
      if (!block) return;
      const row: LLMCall = {
        ...call,
        callId: makeId('call'),
        blockIndex: block.blockIndex,
        t: elapsed(block),
        ts: Date.now(),
      };
      mutate((s) => { s.calls.push(row); });
      pushEvent('llm_call', {
        subkind: call.callType,
        data: { callId: row.callId, in: call.inputTokens, out: call.outputTokens, cacheRead: call.cacheReadTokens, ok: call.ok },
      });
      set((s) => ({ tokenCount: s.tokenCount + call.inputTokens + call.outputTokens }));
    },

    isRecording: () => get().phase === 'task' && !!get().session,
  };
});

/** Shorthand for instrumentation call sites. */
export function track(kind: EventKind, fields?: TrackFields): void {
  useStudyStore.getState().track(kind, fields);
}
