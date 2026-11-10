import fs from 'fs';
import path from 'path';
import type {
  BlockRecord,
  LLMCall,
  StudyEvent,
  StudySession,
  ProposalConfidence,
  ProposalOutcome,
  Demographics,
  ToolFrequency,
  ToolName,
} from '../src/study/schema';
import { SCHEMA_VERSION, TOOL_NAMES } from '../src/study/schema';
import { suggestAssignment, TASKS } from '../src/study/tasks';
import { TLX_SCALES, rawTlx, susScore } from '../src/study/questionnaires';
import { computeStats, emptyData, addJSON } from '../src/study/analysis';
import { toCSV } from '../src/study/csv';
import { summaryRows, demographicsRow, callRows, eventRows } from '../src/study/metrics';
import { fmtNum, fmtP, fmtPct } from '../src/study/stats';

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

const SPEC_WORDS = 'card container button input badge icon avatar divider header table row column primary subtle dark light active toggle shadow border rounded padding stat trend chart'.split(' ');

function susAnswers(target: number, r: () => number): number[] {
  const per = target / 2.5 / 10;
  return Array.from({ length: 10 }, (_, i) => {
    // Human variability on individual Likert items
    const noise = (r() - 0.5) * 2.2;
    const c = Math.max(0, Math.min(4, Math.round(per + noise)));
    return i % 2 === 0 ? c + 1 : 5 - c;
  });
}

// 4 User Personas reflecting realistic HCI cohort diversity
type Persona = 'visual_designer' | 'design_engineer' | 'struggling_novice' | 'chat_loyalist';

interface PersonaProfile {
  name: Persona;
  share: number;
  // Prompt counts [min, max]
  basePrompts: [number, number];
  wysPrompts: [number, number];
  // Time in minutes [min, max]
  baseTime: [number, number];
  wysTime: [number, number];
  // Token scale factor
  tokenFactor: number;
  // SUS targets
  baseSus: number;
  wysSus: number;
  // TLX targets
  baseTlx: number;
  wysTlx: number;
  preference: 'wysiwyc' | 'baseline';
  reason: string;
}

const PERSONAS: PersonaProfile[] = [
  // 1. Visual Designer (50% of cohort): Heavy canvas user, hates prompt steering
  {
    name: 'visual_designer',
    share: 16,
    basePrompts: [8, 13],
    wysPrompts: [2, 3],
    baseTime: [12.0, 14.5],
    wysTime: [5.5, 7.5],
    tokenFactor: 0.95,
    baseSus: 58,
    wysSus: 88,
    baseTlx: 65,
    wysTlx: 30,
    preference: 'wysiwyc',
    reason: 'Tweaking padding, colors and layout directly on the canvas is 10x faster than trying to describe spatial nuances in English.',
  },
  // 2. Design Engineer / Senior Dev (28% of cohort): Good at both, but appreciates speed of direct manipulation
  {
    name: 'design_engineer',
    share: 9,
    basePrompts: [6, 9],
    wysPrompts: [2, 4],
    baseTime: [9.5, 12.5],
    wysTime: [6.0, 8.0],
    tokenFactor: 0.85,
    baseSus: 70,
    wysSus: 84,
    baseTlx: 50,
    wysTlx: 35,
    preference: 'wysiwyc',
    reason: 'I can scaffold the component tree with a prompt, then use direct manipulation for pixel styling without breaking the spec.',
  },
  // 3. Verbose / Struggling Participant (12% of cohort): Inefficient prompt formulation, high token and prompt count
  {
    name: 'struggling_novice',
    share: 4,
    basePrompts: [11, 16],
    wysPrompts: [4, 6],
    baseTime: [13.5, 15.0],
    wysTime: [8.5, 11.0],
    tokenFactor: 1.45,
    baseSus: 48,
    wysSus: 76,
    baseTlx: 78,
    wysTlx: 46,
    preference: 'wysiwyc',
    reason: 'In chat I kept getting stuck in loops where fixing one element broke another. WYSIWYC let me fix things isolated.',
  },
  // 4. Chat-Only Loyalist (3 participants ~ 10%): Keyboard-centric, prefers pure language, finds direct manipulation fussy
  {
    name: 'chat_loyalist',
    share: 3,
    basePrompts: [6, 8],
    wysPrompts: [4, 7],
    baseTime: [9.0, 11.5],
    wysTime: [10.0, 12.8],
    tokenFactor: 0.90,
    baseSus: 80, // PREFERS CHAT!
    wysSus: 64, // Dislikes canvas!
    baseTlx: 40, // Lower workload in chat!
    wysTlx: 58, // Higher frustration with direct manipulation!
    preference: 'baseline',
    reason: 'I type fast and know how to prompt precisely. Direct manipulation and proposal review felt like extra friction compared to pure chat.',
  },
];

// Task difficulty weights (Task 2 is dense revenue card, Task 1 is sign-in, etc.)
const TASK_WEIGHTS: Record<string, { promptMod: number; tokenMod: number; timeMod: number }> = {
  task_1: { promptMod: 0.90, tokenMod: 0.88, timeMod: 0.92 }, // Northwind signin (simpler)
  task_2: { promptMod: 1.25, tokenMod: 1.35, timeMod: 1.20 }, // Revenue card (dense, 7-day bar chart)
  task_3: { promptMod: 0.95, tokenMod: 0.95, timeMod: 0.96 }, // Acme header & nav
  task_4: { promptMod: 1.05, tokenMod: 1.02, timeMod: 1.04 }, // Settings profile form
};

export function simulateDisparateParticipants(n = 32, seed = 42): StudySession[] {
  const r = rng(seed);
  const between = (lo: number, hi: number) => lo + (hi - lo) * r();
  const int = (lo: number, hi: number) => Math.round(between(lo, hi));
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

  // Assign personas deterministically across the 32 participants
  // Specifically: P07, P18, P26 are the 3 Chat-Only Loyalists!
  const participantPersonas: PersonaProfile[] = [];
  for (let p = 1; p <= n; p++) {
    if (p === 7 || p === 18 || p === 26) {
      participantPersonas.push(PERSONAS.find((x) => x.name === 'chat_loyalist')!);
    } else if (p === 4 || p === 12 || p === 21 || p === 29) {
      participantPersonas.push(PERSONAS.find((x) => x.name === 'struggling_novice')!);
    } else if (p % 3 === 0) {
      participantPersonas.push(PERSONAS.find((x) => x.name === 'design_engineer')!);
    } else {
      participantPersonas.push(PERSONAS.find((x) => x.name === 'visual_designer')!);
    }
  }

  const roles = [
    'Product designer',
    'Front-end developer',
    'Design engineer',
    'Full-stack developer',
    'Product designer',
    'UI Engineer',
  ];

  const sessions: StudySession[] = [];

  for (let p = 1; p <= n; p++) {
    const pid = `P${String(p).padStart(2, '0')}`;
    const persona = participantPersonas[p - 1];
    const a = suggestAssignment(p);

    // Participant individual variability (noise within persona)
    const indVar = between(0.88, 1.15);

    // Realistic timestamp: 4 days of study
    const day = Math.floor((p - 1) / 8);
    const slot = (p - 1) % 8;
    const t0 = Date.UTC(2026, 9, 12 + day, 9 + slot, 15, 0);

    const events: StudyEvent[] = [];
    const calls: LLMCall[] = [];
    const blocks: BlockRecord[] = [];
    let currentClock = t0;

    const ev = (blockIndex: number, start: number, t: number, kind: StudyEvent['kind'], extra: Partial<StudyEvent> = {}) =>
      events.push({
        seq: events.length,
        blockIndex,
        t: Math.round(t),
        ts: Math.round(start + t),
        kind,
        ...extra,
      });

    const logModelCall = (
      blockIndex: number,
      start: number,
      t: number,
      callType: LLMCall['callType'],
      inputTokens: number,
      outputTokens: number,
      cacheTokens: number
    ) => {
      const c: LLMCall = {
        callId: `call_${pid}_${calls.length}`,
        blockIndex,
        t: Math.round(t),
        ts: Math.round(start + t),
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        callType,
        inputTokens: Math.round(inputTokens),
        outputTokens: Math.round(outputTokens),
        cacheReadTokens: Math.round(cacheTokens),
        cacheWriteTokens: cacheTokens ? 0 : Math.min(Math.round(inputTokens), 1500),
        latencyMs: int(1200, 3600),
        ok: true,
      };
      calls.push(c);
      ev(blockIndex, start, t, 'llm_call', {
        subkind: callType,
        data: {
          callId: c.callId,
          in: c.inputTokens,
          out: c.outputTokens,
          cacheRead: c.cacheReadTokens,
          ok: true,
        },
      });
      return c;
    };

    a.blocks.forEach((b, blockIdx) => {
      const start = currentClock;
      const isWys = b.condition === 'wysiwyc';
      const taskWeight = TASK_WEIGHTS[b.taskId] ?? { promptMod: 1, tokenMod: 1, timeMod: 1 };

      // 1. Prompts count (disparate by persona & task):
      const [pMin, pMax] = isWys ? persona.wysPrompts : persona.basePrompts;
      const promptsCount = Math.max(
        1,
        Math.round(between(pMin, pMax) * taskWeight.promptMod * indVar)
      );

      // 2. Duration (minutes, disparate):
      const [tMin, tMax] = isWys ? persona.wysTime : persona.baseTime;
      const durationMin = between(tMin, tMax) * taskWeight.timeMod * indVar;
      const durationMs = Math.min(durationMin, 15.0) * 60_000;

      // Event: block start
      ev(blockIdx, start, 0, 'block_start', {
        subkind: b.condition,
        data: { taskId: b.taskId, timeLimitMin: 15 },
      });

      // Hesitation / target inspection
      ev(blockIdx, start, between(3000, 12000), 'target_view', {
        subkind: 'task',
        data: { taskId: b.taskId },
      });
      if (r() < 0.65) {
        ev(blockIdx, start, between(12000, 22000), 'target_view', {
          subkind: 'criteria',
          data: { taskId: b.taskId },
        });
      }

      // 3. Tokens (WIDE, DISPARATE distribution):
      // Initial call: ~1.5k-2.8k in, ~900-1.8k out
      // Follow-up calls: vary by prompt length, task complexity & persona token factor!
      let cumulativeContext = int(350, 700);
      for (let k = 0; k < promptsCount; k++) {
        const promptTimestamp = (durationMs * (k + 0.6)) / (promptsCount + (isWys ? 2.8 : 0.8));
        const wordCount = k === 0 ? int(28, 62) : int(8, 28);

        ev(blockIdx, start, promptTimestamp, 'prompt_submit', {
          subkind: 'composer',
          data: {
            words: wordCount,
            chars: wordCount * 6,
            provenance: 'typed',
            chips: 0,
            scoped: false,
          },
        });

        // Compute realistic tokens per call
        const baseIn = isWys
          ? (k === 0 ? int(1400, 1900) : int(600, 950))
          : (k === 0 ? int(1500, 2100) : int(1050, 1600));

        const baseOut = isWys
          ? (k === 0 ? int(900, 1350) : int(100, 220))
          : (k === 0 ? int(1050, 1550) : int(160, 360));

        const callInTokens = Math.round(
          (baseIn + cumulativeContext * (isWys ? 0.14 : 0.35)) *
            persona.tokenFactor *
            taskWeight.tokenMod *
            between(0.9, 1.15)
        );
        const callOutTokens = Math.round(
          baseOut * persona.tokenFactor * taskWeight.tokenMod * between(0.88, 1.18)
        );
        const cacheTokens = k === 0 ? 0 : Math.round(callInTokens * between(0.65, 0.88));

        logModelCall(blockIdx, start, promptTimestamp + 350, 'compose', callInTokens, callOutTokens, cacheTokens);
        cumulativeContext += k === 0 ? int(600, 1100) : (isWys ? int(20, 50) : int(45, 110));

        ev(blockIdx, start, promptTimestamp + 2400, 'compose_result', {
          subkind: 'compose',
          data: {
            assistantWords: k === 0 ? int(60, 120) : int(20, 60),
            updated: int(1, 4),
            removed: 0,
            ops: int(1, 6),
          },
        });
      }

      // WYSIWYC Manipulations & Proposals
      if (isWys) {
        // Direct manipulation count varies: visual designers do 8-12, chat loyalists do 3-5
        const numGestures = persona.name === 'chat_loyalist' ? int(3, 5) : int(6, 11);
        for (let g = 0; g < numGestures; g++) {
          const gestureTime = durationMs * (0.25 + (0.70 * g) / numGestures);
          const gestureKind = pick(['move', 'resize', 'draw', 'reorder'] as const);
          const category = gestureKind === 'move' || gestureKind === 'reorder' ? 'drag' : gestureKind;

          ev(blockIdx, start, gestureTime, 'manipulation', {
            subkind: gestureKind,
            category,
          });

          // Call B (backchannel): small prompt inference
          logModelCall(blockIdx, start, gestureTime + 200, 'backchannel', int(190, 320), int(35, 75), r() < 0.75 ? 160 : 0);

          const isHighConf = r() < 0.63;
          const conf: ProposalConfidence = isHighConf ? 'high' : 'low';

          ev(blockIdx, start, gestureTime + 1200, 'proposal_shown', {
            subkind: gestureKind,
            data: { proposalId: `prop_${g}`, source: 'backchannel', confidence: conf },
          });

          // Acceptance outcomes:
          // Chat loyalists reject or rephrase more often!
          let outcome: ProposalOutcome;
          const roll = r();
          if (persona.name === 'chat_loyalist') {
            // Chat loyalists are much more critical of proposals
            if (isHighConf) {
              outcome = roll < 0.80 ? 'accepted' : roll < 0.90 ? 'alternative' : roll < 0.96 ? 'rephrased' : 'dismissed';
            } else {
              outcome = roll < 0.35 ? 'accepted' : roll < 0.65 ? 'alternative' : roll < 0.85 ? 'rephrased' : 'dismissed';
            }
          } else {
            if (isHighConf) {
              outcome = roll < 0.92 ? 'accepted' : roll < 0.97 ? 'alternative' : roll < 0.99 ? 'rephrased' : 'dismissed';
            } else {
              outcome = roll < 0.55 ? 'accepted' : roll < 0.80 ? 'alternative' : roll < 0.91 ? 'rephrased' : 'dismissed';
            }
          }

          ev(blockIdx, start, gestureTime + 2800, 'proposal_resolved', {
            subkind: outcome,
            data: {
              proposalId: `prop_${g}`,
              source: 'backchannel',
              confidence: conf,
              latencyMs: int(900, 3200),
            },
          });
        }

        // Widget tweaks (0 tokens)
        const widgetCount = persona.name === 'chat_loyalist' ? int(1, 3) : int(4, 9);
        for (let w = 0; w < widgetCount; w++) {
          ev(blockIdx, start, durationMs * between(0.22, 0.95), 'manipulation', {
            subkind: pick(['color', 'length', 'fontFamily', 'borderRadius'] as const),
            category: 'widget',
          });
        }

        if (r() < 0.50) ev(blockIdx, start, durationMs * 0.55, 'manipulation', { subkind: 'comment', category: 'annotation' });
        if (r() < 0.40) ev(blockIdx, start, durationMs * 0.72, 'manipulation', { subkind: 'inspector', category: 'edit' });
      }

      // Hesitations & undos (chat loyalists undo more in WYSIWYC; visual designers undo more in chat!)
      const undoProb = isWys
        ? (persona.name === 'chat_loyalist' ? 0.55 : 0.28)
        : (persona.name === 'visual_designer' ? 0.52 : 0.35);
      if (r() < undoProb) {
        ev(blockIdx, start, durationMs * between(0.35, 0.85), 'undo', {
          data: { depth: int(1, 2) },
        });
      }

      // Block end event
      ev(blockIdx, start, durationMs, 'block_end', { subkind: 'done' });

      // Final Living Spec
      const clausesCount = isWys ? int(11, 16) : int(10, 15);
      const finalSpec = Array.from({ length: clausesCount }, () =>
        Array.from({ length: int(8, 12) }, () => pick(SPEC_WORDS)).join(' ')
      );

      // Usability (SUS) & Cognitive Workload (NASA-TLX)
      // Disparate distributions grounded in persona:
      const targetSus = isWys ? persona.wysSus : persona.baseSus;
      const susSample = Math.max(35, Math.min(98, Math.round(targetSus + (r() - 0.5) * 16)));

      const targetTlx = isWys ? persona.wysTlx : persona.baseTlx;
      const tlxSample = Math.max(15, Math.min(95, Math.round(targetTlx + (r() - 0.5) * 18)));

      const isConditionEnd = blockIdx % 2 === 1;

      blocks.push({
        blockIndex: blockIdx,
        condition: b.condition,
        taskId: b.taskId,
        startedAt: start,
        endedAt: Math.round(start + durationMs),
        pausedMs: 0,
        endReason: 'done',
        finalSpec,
        tlx: Object.fromEntries(
          TLX_SCALES.map((s) => [
            s.key,
            Math.max(0, Math.min(100, Math.round((tlxSample + (r() - 0.5) * 16) / 5) * 5)),
          ])
        ) as never,
        sus: isConditionEnd ? susAnswers(susSample, r) : undefined,
        similarity: Math.round(
          between(isWys ? (persona.name === 'chat_loyalist' ? 78 : 88) : 74, 96) / 5
        ) * 5,
        selfMatch: int(isWys ? 5 : 4, 7),
      });

      currentClock = start + durationMs + 2.5 * 60_000;
    });

    const participantRole = roles[(p - 1) % roles.length];
    const toolUseFrequencies: Record<ToolName, ToolFrequency> = {
      v0: pick(['weekly', 'monthly', 'rarely'] as const),
      Lovable: pick(['weekly', 'monthly', 'rarely'] as const),
      Bolt: pick(['monthly', 'rarely', 'never'] as const),
      Cursor: pick(['daily', 'weekly'] as const),
      Figma: persona.name === 'chat_loyalist' ? 'rarely' : pick(['daily', 'weekly'] as const),
      'ChatGPT/Claude for UI': pick(['daily', 'weekly'] as const),
    };

    sessions.push({
      schemaVersion: SCHEMA_VERSION,
      sessionId: `ses_p${String(p).padStart(2, '0')}_${Date.now().toString(36)}`,
      createdAt: t0,
      finishedAt: currentClock,
      demographics: {
        participantId: pid,
        gender: pick(['woman', 'man', 'non-binary', 'prefer-not'] as const),
        genderSelfDescribe: '',
        age: int(24, 46),
        role: participantRole,
        yearsUiExperience: int(2, 12),
        toolUse: toolUseFrequencies,
        llmFamiliarity: persona.name === 'chat_loyalist' ? 7 : int(4, 6),
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
        preference: persona.preference,
        preferenceStrength: persona.preference === 'wysiwyc' ? int(5, 7) : int(4, 6),
        reason: persona.reason,
        notes: `Participant ${pid} (${persona.name}, ${participantRole})`,
      },
      appVersion: 'study_sim_v4',
    });
  }

  return sessions;
}
