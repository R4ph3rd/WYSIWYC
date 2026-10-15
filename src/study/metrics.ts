/**
 * Projections of a StudySession into flat rows: per-block summary metrics,
 * the demographics row, and the event / LLM-call ledgers.
 */
import type {
  BlockRecord,
  CallRow,
  DemographicsRow,
  DmCategory,
  EventRow,
  LLMCall,
  StudyEvent,
  StudySession,
  SummaryRow,
} from './schema';
import { rawTlx, susScore } from './questionnaires';

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function median(xs: number[]): number {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const callTokens = (c: LLMCall) => c.inputTokens + c.outputTokens;
/** Calls that realise a language instruction (compose-like). */
const isInstructionCall = (c: LLMCall) => c.callType === 'compose' || c.callType === 'annotation' || c.callType === 'recipe';

/**
 * Typical token cost of ONE corrective re-prompt for this participant: the
 * median of their chat-only instruction calls after the first one of each
 * block (the first builds the screen; the rest are fixes). Falls back to any
 * instruction call, then 0. Used for the counterfactual savings columns.
 */
export function repromptCost(session: StudySession): number {
  const corrective: number[] = [];
  const any: number[] = [];
  for (const b of session.blocks) {
    const calls = session.calls.filter((c) => c.blockIndex === b.blockIndex && c.ok && isInstructionCall(c));
    calls.forEach((c, i) => {
      any.push(callTokens(c));
      if (b.condition === 'baseline' && i > 0) corrective.push(callTokens(c));
    });
  }
  const m = corrective.length ? median(corrective) : median(any);
  return Number.isFinite(m) ? Math.round(m) : 0;
}

const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

export function blockSummary(session: StudySession, block: BlockRecord, reprompt = repromptCost(session)): SummaryRow {
  const ev = session.events.filter((e) => e.blockIndex === block.blockIndex);
  const calls = session.calls.filter((c) => c.blockIndex === block.blockIndex);
  const okCalls = calls.filter((c) => c.ok);
  const count = (pred: (e: StudyEvent) => boolean) => ev.filter(pred).length;
  const sumData = (kind: string, key: string) =>
    ev.filter((e) => e.kind === kind).reduce((s, e) => s + (Number(e.data?.[key]) || 0), 0);

  const dm = (cat: DmCategory) => count((e) => e.kind === 'manipulation' && e.category === cat);
  const outcome = (o: string) => count((e) => e.kind === 'proposal_resolved' && e.subkind === o);
  const accepted = outcome('accepted');
  const alternative = outcome('alternative');
  const rephrased = outcome('rephrased');
  const dismissed = outcome('dismissed');
  const proposals = count((e) => e.kind === 'proposal_shown');
  const resolved = accepted + alternative + rephrased + dismissed;
  const resolvedTotal = count((e) => e.kind === 'proposal_resolved');

  const input = okCalls.reduce((s, c) => s + c.inputTokens, 0);
  const output = okCalls.reduce((s, c) => s + c.outputTokens, 0);
  const cacheRead = okCalls.reduce((s, c) => s + c.cacheReadTokens, 0);
  const cacheWrite = okCalls.reduce((s, c) => s + c.cacheWriteTokens, 0);
  const byType = (t: string) => calls.filter((c) => c.callType === t).length;

  // Counterfactual savings (see docs/STUDY.md § Token savings).
  const backchannelTokens = okCalls.filter((c) => c.callType === 'backchannel').reduce((s, c) => s + callTokens(c), 0);
  const gestureEpisodes = proposals + dm('gesture');
  const saveGesture = Math.max(0, gestureEpisodes * reprompt - backchannelTokens);
  const saveWidget = dm('widget') * reprompt;
  const edits = okCalls.filter((c) => c.callType !== 'backchannel');
  const firstOut = edits[0]?.outputTokens ?? 0;
  const savePatch = edits.slice(1).reduce((s, c) => s + Math.max(0, firstOut - c.outputTokens), 0);
  const saveCache = Math.round(cacheRead * 0.9);

  const durationMs = (block.endedAt ?? block.startedAt) - block.startedAt - block.pausedMs;
  const specWords = (block.finalSpec ?? []).reduce((s, c) => s + wordCount(c), 0);
  const chatWords = sumData('prompt_submit', 'words') + sumData('compose_result', 'assistantWords');
  const position = session.blocks.filter((b) => b.condition === block.condition && b.blockIndex <= block.blockIndex).length;
  const sus = block.sus ? susScore(block.sus) : null;
  const tlx = block.tlx;
  const tlxRaw = tlx ? rawTlx(tlx) : null;
  const opt = (v: number | null | undefined) => (v === null || v === undefined ? '' : v);

  return {
    participant_id: session.demographics.participantId,
    session_id: session.sessionId,
    block_index: block.blockIndex,
    condition: block.condition,
    task_id: block.taskId,
    position_in_condition: position,
    duration_s: round(Math.max(0, durationMs) / 1000, 1),
    end_reason: block.endReason ?? '',
    prompts: count((e) => e.kind === 'prompt_submit'),
    prompt_words: sumData('prompt_submit', 'words'),
    llm_calls: calls.length,
    calls_compose: byType('compose'),
    calls_patch: byType('patch'),
    calls_backchannel: byType('backchannel'),
    calls_annotation: byType('annotation'),
    calls_recipe: byType('recipe'),
    calls_failed: calls.filter((c) => !c.ok).length,
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    cached_share: input ? round(cacheRead / input) : 0,
    llm_latency_s: round(okCalls.reduce((s, c) => s + c.latencyMs, 0) / 1000, 1),
    dm_total: count((e) => e.kind === 'manipulation'),
    dm_drag: dm('drag'),
    dm_resize: dm('resize'),
    dm_draw: dm('draw'),
    dm_widget: dm('widget'),
    dm_edit: dm('edit'),
    dm_annotation: dm('annotation'),
    dm_gesture: dm('gesture'),
    dm_structure: dm('structure'),
    dm_component: dm('component'),
    proposals,
    prop_accepted: accepted,
    prop_alternative: alternative,
    prop_rephrased: rephrased,
    prop_dismissed: dismissed,
    prop_other: resolvedTotal - resolved,
    single_click_share: resolved ? round((accepted + alternative) / resolved) : '',
    undo_count: count((e) => e.kind === 'undo'),
    version_restores: count((e) => e.kind === 'version_restore'),
    spec_words: specWords,
    chat_words: chatWords,
    reprompt_cost: reprompt,
    save_gesture: saveGesture,
    save_widget: saveWidget,
    save_patch: savePatch,
    save_cache: saveCache,
    sus: opt(sus),
    tlx_raw: tlxRaw === null ? '' : round(tlxRaw, 2),
    tlx_mental: opt(tlx?.mental),
    tlx_physical: opt(tlx?.physical),
    tlx_temporal: opt(tlx?.temporal),
    tlx_performance: opt(tlx?.performance),
    tlx_effort: opt(tlx?.effort),
    tlx_frustration: opt(tlx?.frustration),
    similarity: opt(block.similarity),
    self_match: opt(block.selfMatch),
  };
}

export function summaryRows(session: StudySession): SummaryRow[] {
  const reprompt = repromptCost(session);
  return session.blocks.filter((b) => b.endedAt).map((b) => blockSummary(session, b, reprompt));
}

export function demographicsRow(session: StudySession): DemographicsRow {
  const d = session.demographics;
  const c = session.config;
  const i = session.interview;
  return {
    participant_id: d.participantId,
    session_id: session.sessionId,
    created_at: new Date(session.createdAt).toISOString(),
    gender: d.gender === 'self-describe' ? `self: ${d.genderSelfDescribe}` : d.gender,
    age: d.age ?? '',
    role: d.role,
    years_ui_experience: d.yearsUiExperience ?? '',
    llm_familiarity: d.llmFamiliarity ?? '',
    tool_v0: d.toolUse.v0,
    tool_lovable: d.toolUse.Lovable,
    tool_bolt: d.toolUse.Bolt,
    tool_cursor: d.toolUse.Cursor,
    tool_figma: d.toolUse.Figma,
    tool_chat_llm: d.toolUse['ChatGPT/Claude for UI'],
    condition_order: c.conditionOrder,
    square_row: c.squareRow,
    assignment_overridden: c.overridden,
    block_order: c.blocks.map((b) => `${b.condition}:${b.taskId}`).join(' | '),
    time_limit_min: c.timeLimitMin,
    preference: i.preference,
    preference_strength: i.preferenceStrength ?? '',
    preference_reason: i.reason,
    interview_notes: i.notes,
    consent: d.consent,
  };
}

function blockMeta(session: StudySession, blockIndex: number) {
  const b = session.blocks.find((x) => x.blockIndex === blockIndex) ?? session.config.blocks[blockIndex];
  return { condition: b?.condition ?? '', task_id: b?.taskId ?? '' };
}

export function eventRows(session: StudySession): EventRow[] {
  return session.events.map((e) => ({
    participant_id: session.demographics.participantId,
    session_id: session.sessionId,
    seq: e.seq,
    block_index: e.blockIndex,
    ...blockMeta(session, e.blockIndex),
    t_ms: Math.round(e.t),
    ts_iso: new Date(e.ts).toISOString(),
    kind: e.kind,
    subkind: e.subkind ?? '',
    category: e.category ?? '',
    data_json: e.data ? JSON.stringify(e.data) : '',
  }));
}

export function callRows(session: StudySession): CallRow[] {
  return session.calls.map((c) => ({
    participant_id: session.demographics.participantId,
    session_id: session.sessionId,
    call_id: c.callId,
    block_index: c.blockIndex,
    ...blockMeta(session, c.blockIndex),
    t_ms: Math.round(c.t),
    ts_iso: new Date(c.ts).toISOString(),
    provider: c.provider,
    model: c.model,
    call_type: c.callType,
    input_tokens: c.inputTokens,
    output_tokens: c.outputTokens,
    cache_read_tokens: c.cacheReadTokens,
    cache_write_tokens: c.cacheWriteTokens,
    latency_ms: Math.round(c.latencyMs),
    ok: c.ok,
    error: c.error ?? '',
  }));
}
