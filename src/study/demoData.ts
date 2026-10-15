/**
 * SYNTHETIC preview dataset for the analysis page. Generates complete
 * StudySession objects (events, LLM calls, questionnaires) for 12 fake
 * participants, so the preview exercises the same projection + statistics
 * code as real data. Never mix with real data or publish its numbers.
 */
import type { BlockRecord, LLMCall, StudyEvent, StudySession } from './schema';
import { SCHEMA_VERSION, TOOL_NAMES } from './schema';
import { suggestAssignment } from './tasks';
import { TLX_SCALES } from './questionnaires';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = 'make the card wider add a subtle border use indigo for the primary button move the link under the field align the labels left'.split(' ');

export function demoSessions(n = 12, seed = 7): StudySession[] {
  const r = rng(seed);
  const between = (lo: number, hi: number) => lo + (hi - lo) * r();
  const int = (lo: number, hi: number) => Math.round(between(lo, hi));
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const sessions: StudySession[] = [];

  for (let p = 1; p <= n; p++) {
    const pid = `P${String(p).padStart(2, '0')}`;
    const a = suggestAssignment(p);
    const skill = between(0.8, 1.25);
    const t0 = Date.UTC(2026, 8, 1 + p, 9, 0, 0);
    const events: StudyEvent[] = [];
    const calls: LLMCall[] = [];
    const blocks: BlockRecord[] = [];
    let clock = t0;
    const ev = (blockIndex: number, start: number, t: number, kind: StudyEvent['kind'], extra: Partial<StudyEvent> = {}) =>
      events.push({ seq: events.length, blockIndex, t, ts: start + t, kind, ...extra });
    const call = (blockIndex: number, start: number, t: number, callType: LLMCall['callType'], input: number, output: number, cache: number) => {
      const c: LLMCall = {
        callId: `call_${pid}_${calls.length}`, blockIndex, t, ts: start + t, provider: 'anthropic', model: 'claude-sonnet-4-6',
        callType, inputTokens: input, outputTokens: output, cacheReadTokens: cache, cacheWriteTokens: cache ? 0 : Math.min(input, 2400),
        latencyMs: int(1500, 9000), ok: true,
      };
      calls.push(c);
      ev(blockIndex, start, t, 'llm_call', { subkind: callType, data: { callId: c.callId, in: input, out: output, cacheRead: cache, ok: true } });
    };

    a.blocks.forEach((b, i) => {
      const start = clock;
      const wys = b.condition === 'wysiwyc';
      const prompts = wys ? Math.max(1, Math.round(between(1.4, 3.8) * skill)) : Math.max(4, Math.round(between(6.5, 12) * skill));
      const minutes = wys ? between(4.2, 7.2) * skill : between(7.6, 11.8) * skill;
      const dur = Math.min(minutes, 14.5) * 60_000;
      ev(i, start, 0, 'block_start', { subkind: b.condition, data: { taskId: b.taskId, timeLimitMin: 15 } });
      let ctx = 1200;
      for (let k = 0; k < prompts; k++) {
        const t = (dur * (k + 0.5)) / (prompts + (wys ? 3 : 0.5));
        const words = k === 0 ? int(28, 55) : int(9, 24);
        ev(i, start, t, 'prompt_submit', { subkind: 'composer', data: { words, chars: words * 6, provenance: 'typed', chips: 0, scoped: false } });
        const out = k === 0 ? int(3000, 4200) : int(450, 900);
        call(i, start, t + 400, 'compose', 2600 + ctx, out, k === 0 ? 0 : 2600);
        ctx += k === 0 ? int(2200, 3000) : int(80, 240);
        ev(i, start, t + 6000, 'compose_result', { subkind: 'compose', data: { assistantWords: k === 0 ? int(110, 160) : int(70, 120), updated: int(1, 6), removed: 0, ops: int(1, 12) } });
      }
      if (wys) {
        const gestures = int(4, 9);
        for (let g = 0; g < gestures; g++) {
          const t = dur * (0.35 + (0.6 * g) / gestures);
          const kind = pick(['move', 'resize', 'draw', 'move', 'reorder'] as const);
          const cat = kind === 'move' || kind === 'reorder' ? 'drag' : kind;
          ev(i, start, t, 'manipulation', { subkind: kind, category: cat });
          call(i, start, t + 300, 'backchannel', int(700, 1100), int(90, 180), r() < 0.7 ? 520 : 0);
          ev(i, start, t + 2500, 'proposal_shown', { subkind: kind, data: { proposalId: `prop_${g}`, source: 'backchannel' } });
          const x = r();
          const outcome = x < 0.79 ? 'accepted' : x < 0.92 ? 'alternative' : x < 0.98 ? 'rephrased' : 'dismissed';
          ev(i, start, t + 5000, 'proposal_resolved', { subkind: outcome, data: { proposalId: `prop_${g}`, source: 'backchannel', latencyMs: int(1200, 6000) } });
        }
        for (let w = 0, nw = int(2, 6); w < nw; w++) ev(i, start, dur * between(0.3, 0.95), 'manipulation', { subkind: pick(['color', 'length', 'fontFamily'] as const), category: 'widget' });
        if (r() < 0.5) ev(i, start, dur * 0.6, 'manipulation', { subkind: 'comment', category: 'annotation' });
        if (r() < 0.4) ev(i, start, dur * 0.7, 'manipulation', { subkind: 'inspector', category: 'edit' });
      }
      if (r() < 0.4) ev(i, start, dur * 0.8, 'undo', { data: { depth: 3 } });
      ev(i, start, dur, 'block_end', { subkind: 'done' });
      const clauses = wys ? int(11, 16) : int(10, 15);
      const finalSpec = Array.from({ length: clauses }, () => Array.from({ length: int(9, 14) }, () => pick(WORDS)).join(' '));
      const susBase = wys ? between(72, 92) : between(52, 74);
      const lastOfCondition = i % 2 === 1;
      const tlxBase = wys ? between(22, 42) : between(42, 66);
      blocks.push({
        blockIndex: i, condition: b.condition, taskId: b.taskId, startedAt: start, endedAt: start + dur, pausedMs: 0, endReason: 'done',
        finalSpec,
        tlx: Object.fromEntries(TLX_SCALES.map((s) => [s.key, Math.max(0, Math.min(100, Math.round((tlxBase + between(-15, 15)) / 5) * 5))])) as never,
        sus: lastOfCondition ? susAnswers(susBase, r) : undefined,
        similarity: Math.round(between(wys ? 70 : 60, 95) / 5) * 5,
        selfMatch: int(wys ? 5 : 4, 7),
      });
      clock = start + dur + 4 * 60_000;
    });

    const prefersW = p !== 7;
    sessions.push({
      schemaVersion: SCHEMA_VERSION,
      sessionId: `ses_demo_${pid}`,
      createdAt: t0,
      finishedAt: clock,
      demographics: {
        participantId: pid,
        gender: pick(['woman', 'man', 'non-binary', 'prefer-not'] as const),
        genderSelfDescribe: '',
        age: int(23, 44),
        role: pick(['Product designer', 'Front-end developer', 'Design engineer', 'Full-stack developer']),
        yearsUiExperience: int(2, 14),
        toolUse: Object.fromEntries(TOOL_NAMES.map((t) => [t, pick(['monthly', 'weekly', 'daily'] as const)])) as never,
        llmFamiliarity: int(4, 7),
        consent: true,
      },
      config: { conditionOrder: a.conditionOrder, squareRow: a.squareRow, overridden: false, blocks: a.blocks, timeLimitMin: 15, sheetsUrl: '', susSchedule: 'per-condition' },
      blocks,
      events,
      calls,
      interview: {
        preference: prefersW ? 'wysiwyc' : 'baseline',
        preferenceStrength: prefersW ? int(5, 7) : 3,
        reason: prefersW ? 'Fixing small things by hand is faster than describing them.' : 'For throwaway screens chat is enough.',
        notes: '(synthetic)',
      },
      appVersion: 'demo',
    });
  }
  return sessions;
}

/** Ten SUS answers whose score lands near `target`. */
function susAnswers(target: number, r: () => number): number[] {
  const per = target / 2.5 / 10; // average item contribution 0..4
  return Array.from({ length: 10 }, (_, i) => {
    const c = Math.max(0, Math.min(4, Math.round(per + (r() - 0.5) * 1.6)));
    return i % 2 === 0 ? c + 1 : 5 - c;
  });
}
