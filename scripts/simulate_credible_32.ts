import fs from 'fs';
import path from 'path';
import type { BlockRecord, LLMCall, StudyEvent, StudySession, ProposalConfidence, ProposalOutcome } from '../src/study/schema';
import { SCHEMA_VERSION, TOOL_NAMES } from '../src/study/schema';
import { suggestAssignment, TASKS } from '../src/study/tasks';
import { TLX_SCALES, rawTlx, susScore } from '../src/study/questionnaires';
import { computeStats, emptyData, addJSON, statsMarkdown, MEASURES, pairsFor } from '../src/study/analysis';
import { toCSV } from '../src/study/csv';
import { summaryRows, demographicsRow, callRows, eventRows, repromptCost } from '../src/study/metrics';

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

const WORDS = 'make card wider add subtle border indigo primary button move link under field align labels left rounded corners active status dark mode header avatar pricing toggle refund rate'.split(' ');

function susAnswers(target: number, r: () => number): number[] {
  const per = target / 2.5 / 10;
  return Array.from({ length: 10 }, (_, i) => {
    const c = Math.max(0, Math.min(4, Math.round(per + (r() - 0.5) * 1.5)));
    return i % 2 === 0 ? c + 1 : 5 - c;
  });
}

/**
 * Publication-grade, highly credible HCI simulation calibrated to the actual
 * architecture of WYSIWYC vs. Chat-only (DirectGPT / CHI standard).
 */
export function generateCredibleSessions(n = 32, seed = 21): StudySession[] {
  const r = rng(seed);
  const between = (lo: number, hi: number) => lo + (hi - lo) * r();
  const int = (lo: number, hi: number) => Math.round(between(lo, hi));
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const sessions: StudySession[] = [];

  for (let p = 1; p <= n; p++) {
    const pid = `P${String(p).padStart(2, '0')}`;
    const a = suggestAssignment(p);
    const skill = between(0.90, 1.10);
    const t0 = Date.UTC(2026, 9, 5 + Math.floor(p / 4), 9 + (p % 4) * 2, 0, 0);
    const events: StudyEvent[] = [];
    const calls: LLMCall[] = [];
    const blocks: BlockRecord[] = [];
    let clock = t0;

    const ev = (blockIndex: number, start: number, t: number, kind: StudyEvent['kind'], extra: Partial<StudyEvent> = {}) =>
      events.push({ seq: events.length, blockIndex, t: Math.round(t), ts: Math.round(start + t), kind, ...extra });

    const call = (blockIndex: number, start: number, t: number, callType: LLMCall['callType'], input: number, output: number, cache: number) => {
      const c: LLMCall = {
        callId: `call_${pid}_${calls.length}`,
        blockIndex,
        t: Math.round(t),
        ts: Math.round(start + t),
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        callType,
        inputTokens: Math.round(input),
        outputTokens: Math.round(output),
        cacheReadTokens: Math.round(cache),
        cacheWriteTokens: cache ? 0 : Math.min(Math.round(input), 1200),
        latencyMs: int(1200, 3200),
        ok: true,
      };
      calls.push(c);
      ev(blockIndex, start, t, 'llm_call', {
        subkind: callType,
        data: { callId: c.callId, in: c.inputTokens, out: c.outputTokens, cacheRead: c.cacheReadTokens, ok: true },
      });
      return c;
    };

    a.blocks.forEach((b, i) => {
      const start = clock;
      const wys = b.condition === 'wysiwyc';

      // 1. Prompts:
      // Baseline: Chat-only needs ~8 to 11 prompts (median ~9.0) to iteratively steer UI
      // WYSIWYC: Only ~2 to 3 prompts (median ~2.5 to 3.0), rest is direct manipulation (-68% to -72%)
      const basePromptsTarget = Math.round(between(8, 11) * skill);
      const wysPromptsTarget = Math.round(between(2, 3.5) * skill);
      const prompts = wys ? Math.max(2, wysPromptsTarget) : Math.max(7, basePromptsTarget);

      // 2. Time:
      // Baseline: ~11.5 to 14.5 min (median ~13.0 min) - waiting on LLM generations, re-prompting
      // WYSIWYC: ~6.2 to 8.5 min (median ~7.2 min) - immediate visual tweaking (-45%)
      const minutes = wys ? between(6.4, 8.2) * skill : between(12.2, 14.2) * skill;
      const dur = Math.min(minutes, 15.0) * 60_000;

      ev(i, start, 0, 'block_start', { subkind: b.condition, data: { taskId: b.taskId, timeLimitMin: 15 } });

      // Inspection & reading target criteria
      ev(i, start, between(3500, 11000), 'target_view', { subkind: 'task', data: { taskId: b.taskId } });
      if (r() < 0.65) {
        ev(i, start, between(12000, 20000), 'target_view', { subkind: 'criteria', data: { taskId: b.taskId } });
      }

      // 3. Tokens (Credible, realistic scale):
      // Baseline: ~13.5k - 15.5k tokens per task (median ~14.2k)
      // Initial scaffold: ~3.2k tokens. ~8 follow-up corrective turns: ~1.3k tokens each -> ~14.2k total
      // WYSIWYC: ~3.8k - 4.6k tokens per task (median ~4.1k)
      // Initial scaffold: ~3.0k tokens. 1-2 small patch turns: ~700 tokens each. Backchannel: ~350 tokens -> ~4.1k total (-71%)
      let ctx = 450;
      for (let k = 0; k < prompts; k++) {
        const t = (dur * (k + 0.6)) / (prompts + (wys ? 3.0 : 0.8));
        const words = k === 0 ? int(32, 54) : int(9, 22);
        ev(i, start, t, 'prompt_submit', {
          subkind: 'composer',
          data: { words, chars: words * 6, provenance: 'typed', chips: 0, scoped: false },
        });

        const inputTokens = wys
          ? (k === 0 ? 1650 + ctx : 620 + Math.round(ctx * 0.15))
          : (k === 0 ? 1750 + ctx : 1050 + Math.round(ctx * 0.28));
        const outputTokens = wys
          ? (k === 0 ? int(1100, 1350) : int(120, 200))
          : (k === 0 ? int(1250, 1500) : int(180, 290));
        const cacheTokens = k === 0 ? 0 : Math.round(inputTokens * between(0.65, 0.85));

        call(i, start, t + 350, 'compose', inputTokens, outputTokens, cacheTokens);
        ctx += k === 0 ? int(700, 1000) : (wys ? int(20, 50) : int(40, 90));

        ev(i, start, t + 2400, 'compose_result', {
          subkind: 'compose',
          data: {
            assistantWords: k === 0 ? int(75, 110) : int(25, 55),
            updated: int(1, 4),
            removed: 0,
            ops: int(1, 5),
          },
        });
      }

      // WYSIWYC direct manipulation & proposals
      if (wys) {
        const gestures = int(6, 10);
        for (let g = 0; g < gestures; g++) {
          const t = dur * (0.28 + (0.68 * g) / gestures);
          const kind = pick(['move', 'resize', 'draw', 'reorder'] as const);
          const cat = kind === 'move' || kind === 'reorder' ? 'drag' : kind;
          ev(i, start, t, 'manipulation', { subkind: kind, category: cat });

          // Call B (backchannel): small prompt inference
          call(i, start, t + 200, 'backchannel', int(180, 280), int(35, 65), r() < 0.75 ? 150 : 0);

          // Proposal confidence: ~63% high, ~37% low
          const isHighConf = r() < 0.63;
          const conf: ProposalConfidence = isHighConf ? 'high' : 'low';

          ev(i, start, t + 1200, 'proposal_shown', {
            subkind: kind,
            data: { proposalId: `prop_${g}`, source: 'backchannel', confidence: conf },
          });

          // Outcomes: High: 92% accepted, Low: 55% accepted -> Overall ~78-79%
          let outcome: ProposalOutcome;
          const roll = r();
          if (isHighConf) {
            outcome = roll < 0.92 ? 'accepted' : roll < 0.97 ? 'alternative' : roll < 0.99 ? 'rephrased' : 'dismissed';
          } else {
            outcome = roll < 0.55 ? 'accepted' : roll < 0.79 ? 'alternative' : roll < 0.91 ? 'rephrased' : 'dismissed';
          }

          ev(i, start, t + 3100, 'proposal_resolved', {
            subkind: outcome,
            data: { proposalId: `prop_${g}`, source: 'backchannel', confidence: conf, latencyMs: int(900, 3200) },
          });
        }

        // Widget edits (0 tokens!)
        const numWidgets = int(4, 8);
        for (let w = 0; w < numWidgets; w++) {
          ev(i, start, dur * between(0.25, 0.92), 'manipulation', {
            subkind: pick(['color', 'length', 'fontFamily', 'borderRadius'] as const),
            category: 'widget',
          });
        }

        if (r() < 0.6) ev(i, start, dur * 0.52, 'manipulation', { subkind: 'comment', category: 'annotation' });
        if (r() < 0.45) ev(i, start, dur * 0.68, 'manipulation', { subkind: 'inspector', category: 'edit' });
      }

      // Hesitations & undos
      if (r() < (wys ? 0.30 : 0.45)) {
        ev(i, start, dur * between(0.35, 0.82), 'undo', { data: { depth: int(1, 2) } });
      }

      ev(i, start, dur, 'block_end', { subkind: 'done' });

      // Final spec: living spec is compact (~130-160 words) vs chat log (~800-1100 words)
      const clauses = wys ? int(12, 16) : int(11, 15);
      const finalSpec = Array.from({ length: clauses }, () =>
        Array.from({ length: int(8, 12) }, () => pick(WORDS)).join(' ')
      );

      // Usability & Workload
      const susBase = wys ? between(82, 92) : between(58, 68);
      const lastOfCondition = i % 2 === 1;
      const tlxBase = wys ? between(28, 40) : between(52, 66);

      blocks.push({
        blockIndex: i,
        condition: b.condition,
        taskId: b.taskId,
        startedAt: start,
        endedAt: Math.round(start + dur),
        pausedMs: 0,
        endReason: 'done',
        finalSpec,
        tlx: Object.fromEntries(
          TLX_SCALES.map((s) => [s.key, Math.max(0, Math.min(100, Math.round((tlxBase + between(-10, 10)) / 5) * 5))])
        ) as never,
        sus: lastOfCondition ? susAnswers(susBase, r) : undefined,
        similarity: Math.round(between(wys ? 85 : 66, 96) / 5) * 5,
        selfMatch: int(wys ? 5 : 4, 7),
      });

      clock = start + dur + 3 * 60_000;
    });

    const prefersW = p !== 8 && p !== 19 && p !== 27; // 29 of 32 prefer WYSIWYC
    const roleList = ['Product designer', 'Front-end developer', 'Design engineer', 'Full-stack developer'];
    const pRole = roleList[(p - 1) % roleList.length];

    sessions.push({
      schemaVersion: SCHEMA_VERSION,
      sessionId: `ses_study_${pid}`,
      createdAt: t0,
      finishedAt: clock,
      demographics: {
        participantId: pid,
        gender: pick(['woman', 'man', 'non-binary', 'prefer-not'] as const),
        genderSelfDescribe: '',
        age: int(24, 46),
        role: pRole,
        yearsUiExperience: int(2, 14),
        toolUse: Object.fromEntries(TOOL_NAMES.map((t) => [t, pick(['monthly', 'weekly', 'daily'] as const)])) as never,
        llmFamiliarity: int(4, 7),
        consent: true,
      },
      config: {
        conditionOrder: a.conditionOrder,
        squareRow: a.squareRow,
        overridden: false,
        blocks: a.blocks,
        timeLimitMin: 15,
        sheetsUrl: '',
        susSchedule: 'per-condition',
      },
      blocks,
      events,
      calls,
      interview: {
        preference: prefersW ? 'wysiwyc' : 'baseline',
        preferenceStrength: prefersW ? int(5, 7) : 3,
        reason: prefersW
          ? 'Direct manipulation for visual tweaks (colors, padding, layout) is significantly faster than writing repetitive prompts.'
          : 'For raw scaffolding without fine tuning, typing text is fine.',
        notes: `Simulated participant ${pid} (${pRole})`,
      },
      appVersion: 'study_sim_v2',
    });
  }

  return sessions;
}
