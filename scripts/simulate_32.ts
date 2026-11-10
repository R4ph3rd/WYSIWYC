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

const WORDS = 'make the card wider add subtle border use indigo for primary button move link under field align labels left rounded corners active status dark mode header avatar pricing toggle refund rate'.split(' ');

function susAnswers(target: number, r: () => number): number[] {
  const per = target / 2.5 / 10;
  return Array.from({ length: 10 }, (_, i) => {
    const c = Math.max(0, Math.min(4, Math.round(per + (r() - 0.5) * 1.5)));
    return i % 2 === 0 ? c + 1 : 5 - c;
  });
}

export function generateCalibratedSessions(n = 32, seed = 12): StudySession[] {
  const r = rng(seed);
  const between = (lo: number, hi: number) => lo + (hi - lo) * r();
  const int = (lo: number, hi: number) => Math.round(between(lo, hi));
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const sessions: StudySession[] = [];

  for (let p = 1; p <= n; p++) {
    const pid = `P${String(p).padStart(2, '0')}`;
    const a = suggestAssignment(p);
    const skill = between(0.93, 1.07);
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
        cacheWriteTokens: cache ? 0 : Math.min(Math.round(input), 2000),
        latencyMs: int(1500, 4200),
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

      // 1. Prompts: Baseline median = 13, WYSIWYC median = 8 (-38%)
      const basePromptsTarget = Math.round(between(11.5, 14.5) * skill);
      const wysPromptsTarget = Math.round(between(7.2, 8.8) * skill);
      const prompts = wys ? Math.max(6, wysPromptsTarget) : Math.max(10, basePromptsTarget);

      // 2. Time: Baseline median = 14.5 min, WYSIWYC median = 10.8 min (-26%)
      const minutes = wys ? between(10.05, 11.65) * skill : between(14.05, 15.05) * skill;
      const dur = Math.min(minutes, 15.0) * 60_000;

      ev(i, start, 0, 'block_start', { subkind: b.condition, data: { taskId: b.taskId, timeLimitMin: 15 } });

      // Hesitation & reading target criteria
      ev(i, start, between(4000, 14000), 'target_view', { subkind: 'task', data: { taskId: b.taskId } });
      if (r() < 0.7) {
        ev(i, start, between(15000, 24000), 'target_view', { subkind: 'criteria', data: { taskId: b.taskId } });
      }

      // 3. Tokens: Baseline ~41.2k, WYSIWYC ~19.6k (-52%)
      let ctx = 820;
      for (let k = 0; k < prompts; k++) {
        const t = (dur * (k + 0.55)) / (prompts + (wys ? 3.5 : 0.8));
        const words = k === 0 ? int(30, 50) : int(10, 24);
        ev(i, start, t, 'prompt_submit', {
          subkind: 'composer',
          data: { words, chars: words * 6, provenance: 'typed', chips: 0, scoped: false },
        });

        const inputTokens = wys
          ? (k === 0 ? 1650 + ctx : 1025 + Math.round(ctx * 0.18))
          : (k === 0 ? 1790 + ctx : 1655 + Math.round(ctx * 0.38));
        const outputTokens = wys
          ? (k === 0 ? int(1680, 1980) : int(185, 275))
          : (k === 0 ? int(1850, 2250) : int(310, 450));
        const cacheTokens = k === 0 ? 0 : Math.round(inputTokens * between(0.68, 0.86));

        call(i, start, t + 400, 'compose', inputTokens, outputTokens, cacheTokens);
        ctx += k === 0 ? int(1200, 1600) : (wys ? int(30, 70) : int(60, 120));

        ev(i, start, t + 3000, 'compose_result', {
          subkind: 'compose',
          data: {
            assistantWords: k === 0 ? int(80, 120) : int(35, 70),
            updated: int(1, 4),
            removed: 0,
            ops: int(1, 6),
          },
        });
      }

      // WYSIWYC direct manipulation & proposals
      if (wys) {
        const gestures = int(5, 8);
        for (let g = 0; g < gestures; g++) {
          const t = dur * (0.30 + (0.65 * g) / gestures);
          const kind = pick(['move', 'resize', 'draw', 'reorder'] as const);
          const cat = kind === 'move' || kind === 'reorder' ? 'drag' : kind;
          ev(i, start, t, 'manipulation', { subkind: kind, category: cat });

          // Call B (backchannel)
          call(i, start, t + 250, 'backchannel', int(390, 570), int(50, 95), r() < 0.8 ? 320 : 0);

          // Proposal confidence: ~62.8% high, ~37.2% low
          const isHighConf = r() < 0.628;
          const conf: ProposalConfidence = isHighConf ? 'high' : 'low';

          ev(i, start, t + 1600, 'proposal_shown', {
            subkind: kind,
            data: { proposalId: `prop_${g}`, source: 'backchannel', confidence: conf },
          });

          // Outcomes: High: 91% accepted, Low: 56% accepted
          let outcome: ProposalOutcome;
          const roll = r();
          if (isHighConf) {
            outcome = roll < 0.91 ? 'accepted' : roll < 0.97 ? 'alternative' : roll < 0.99 ? 'rephrased' : 'dismissed';
          } else {
            outcome = roll < 0.56 ? 'accepted' : roll < 0.80 ? 'alternative' : roll < 0.92 ? 'rephrased' : 'dismissed';
          }

          ev(i, start, t + 3800, 'proposal_resolved', {
            subkind: outcome,
            data: { proposalId: `prop_${g}`, source: 'backchannel', confidence: conf, latencyMs: int(1100, 4200) },
          });
        }

        // Widget tweaks
        const numWidgets = int(3, 7);
        for (let w = 0; w < numWidgets; w++) {
          ev(i, start, dur * between(0.28, 0.92), 'manipulation', {
            subkind: pick(['color', 'length', 'fontFamily', 'borderRadius'] as const),
            category: 'widget',
          });
        }

        if (r() < 0.55) ev(i, start, dur * 0.55, 'manipulation', { subkind: 'comment', category: 'annotation' });
        if (r() < 0.40) ev(i, start, dur * 0.70, 'manipulation', { subkind: 'inspector', category: 'edit' });
      }

      // Hesitations & undos
      if (r() < (wys ? 0.35 : 0.50)) {
        ev(i, start, dur * between(0.4, 0.85), 'undo', { data: { depth: int(1, 2) } });
      }

      ev(i, start, dur, 'block_end', { subkind: 'done' });

      // Final spec
      const clauses = wys ? int(12, 16) : int(11, 15);
      const finalSpec = Array.from({ length: clauses }, () =>
        Array.from({ length: int(8, 12) }, () => pick(WORDS)).join(' ')
      );

      // Workload & usability
      const susBase = wys ? between(80, 90) : between(58, 68);
      const lastOfCondition = i % 2 === 1;
      const tlxBase = wys ? between(32, 44) : between(52, 66);

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
        similarity: Math.round(between(wys ? 84 : 64, 95) / 5) * 5,
        selfMatch: int(wys ? 5 : 4, 7),
      });

      clock = start + dur + 3 * 60_000;
    });

    const prefersW = p !== 7 && p !== 19 && p !== 28; // 29 of 32 prefer WYSIWYC
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
          ? 'Tweaking colors, spacing and component hierarchy directly on canvas saves endless re-prompting cycles.'
          : 'For raw scaffolding without fine tuning, typing text is fine.',
        notes: `Simulated participant ${pid} (${pRole})`,
      },
      appVersion: 'study_sim_v1',
    });
  }

  return sessions;
}
