/**
 * Analysis model: load study data from any of the export formats, then
 * compute the paired statistics the case study reports.
 */
import { parseCSV } from './csv';
import { callRows, demographicsRow, eventRows, summaryRows } from './metrics';
import type { CallRow, DemographicsRow, EventRow, StudySession, SummaryRow } from './schema';
import { fmtNum, fmtP, fmtPct, mean, median, pctChange, quantile, wilcoxon, type WilcoxonResult } from './stats';
import { TASKS, CONDITION_LABEL } from './tasks';

export interface AnalysisData {
  participants: DemographicsRow[];
  blocks: SummaryRow[];
  calls: CallRow[];
  events: EventRow[];
  /** True for the generated preview dataset. */
  synthetic?: boolean;
  sources: string[];
}

export function emptyData(): AnalysisData {
  return { participants: [], blocks: [], calls: [], events: [], sources: [] };
}

const TEXT_COLS = new Set([
  'participant_id', 'session_id', 'condition', 'task_id', 'end_reason', 'created_at', 'gender', 'role', 'tool_v0',
  'tool_lovable', 'tool_bolt', 'tool_cursor', 'tool_figma', 'tool_chat_llm', 'condition_order', 'block_order',
  'preference', 'preference_reason', 'interview_notes', 'call_id', 'ts_iso', 'provider', 'model', 'call_type',
  'error', 'kind', 'subkind', 'category', 'data_json',
]);

/** Coerce string cells (CSV / Sheets) back to numbers and booleans. */
function coerce<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v !== 'string' || TEXT_COLS.has(k)) { out[k] = v; continue; }
    if (v === '') out[k] = '';
    else if (v === 'true' || v === 'TRUE') out[k] = true;
    else if (v === 'false' || v === 'FALSE') out[k] = false;
    else if (!Number.isNaN(Number(v))) out[k] = Number(v);
    else out[k] = v;
  }
  return out as T;
}

function addSession(data: AnalysisData, s: StudySession) {
  data.participants.push(demographicsRow(s));
  data.blocks.push(...summaryRows(s));
  data.calls.push(...callRows(s));
  data.events.push(...eventRows(s));
}

function isSession(x: unknown): x is StudySession {
  return !!x && typeof x === 'object' && 'demographics' in x && 'blocks' in x && 'events' in x;
}

function addRows(data: AnalysisData, rows: Record<string, unknown>[]): string {
  if (!rows.length) return 'empty';
  const keys = new Set(Object.keys(rows[0]));
  if (keys.has('call_type')) { data.calls.push(...rows.map((r) => coerce<CallRow>(r))); return 'llm calls'; }
  if (keys.has('kind') && keys.has('seq')) {
    const ev = rows.map((r) => coerce<EventRow>(r));
    data.events.push(...ev);
    return 'events';
  }
  if (keys.has('total_tokens') && keys.has('block_index')) { data.blocks.push(...rows.map((r) => coerce<SummaryRow>(r))); return 'summary'; }
  if (keys.has('years_ui_experience')) { data.participants.push(...rows.map((r) => coerce<DemographicsRow>(r))); return 'demographics'; }
  return 'unknown';
}

/** Add a parsed JSON document of any supported shape. */
export function addJSON(data: AnalysisData, json: unknown): string {
  if (isSession(json)) { addSession(data, json); return 'session'; }
  if (Array.isArray(json)) {
    if (json.every(isSession)) { json.forEach((s) => addSession(data, s)); return `${json.length} sessions`; }
    return addRows(data, json as Record<string, unknown>[]);
  }
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o.sessions)) return addJSON(data, o.sessions);
    // Analysis-ready / Apps Script doGet shape.
    const parts: string[] = [];
    for (const key of ['demographics', 'participants', 'summary', 'blocks', 'calls', 'llm_calls', 'events']) {
      if (Array.isArray(o[key])) parts.push(addRows(data, o[key] as Record<string, unknown>[]));
    }
    if (o.logs && typeof o.logs === 'object') {
      for (const rows of Object.values(o.logs as Record<string, unknown[]>)) {
        if (Array.isArray(rows)) parts.push(addRows(data, rows as Record<string, unknown>[]));
      }
    }
    if (o.synthetic) data.synthetic = true;
    if (parts.length) return parts.join(', ');
  }
  throw new Error('Unrecognised JSON: expected a session export, a dataset or the Sheets response.');
}

export function addFile(data: AnalysisData, name: string, text: string): string {
  const kind = /\.json$/i.test(name) || /^\s*[[{]/.test(text) ? addJSON(data, JSON.parse(text)) : addRows(data, parseCSV(text));
  data.sources.push(`${name} (${kind})`);
  return kind;
}

/** Drop duplicate rows (the same session loaded twice, CSV + JSON, …). */
export function dedupe(data: AnalysisData): AnalysisData {
  const uniq = <T,>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, T>();
    rows.forEach((r) => m.set(key(r), r));
    return [...m.values()];
  };
  return {
    ...data,
    participants: uniq(data.participants, (r) => `${r.participant_id}|${r.session_id}`),
    blocks: uniq(data.blocks, (r) => `${r.session_id}|${r.block_index}`),
    calls: uniq(data.calls, (r) => `${r.session_id}|${r.call_id}`),
    events: uniq(data.events, (r) => `${r.session_id}|${r.seq}`),
  };
}

/** Rebuild summary rows from ledgers when only events/calls CSVs were loaded. */
export function ensureBlocks(data: AnalysisData): AnalysisData {
  if (data.blocks.length || !data.events.length) return data;
  const blocks: SummaryRow[] = [];
  const bySession = new Map<string, EventRow[]>();
  data.events.forEach((e) => (bySession.get(e.session_id) ?? bySession.set(e.session_id, []).get(e.session_id)!).push(e));
  for (const [sid, evs] of bySession) {
    const starts = evs.filter((e) => e.kind === 'block_start');
    for (const st of starts) {
      const be = evs.filter((e) => e.block_index === st.block_index);
      const end = be.find((e) => e.kind === 'block_end');
      const calls = data.calls.filter((c) => c.session_id === sid && c.block_index === st.block_index && c.ok);
      const input = calls.reduce((s, c) => s + c.input_tokens, 0);
      const output = calls.reduce((s, c) => s + c.output_tokens, 0);
      const cnt = (k: string, sub?: string) => be.filter((e) => e.kind === k && (!sub || e.subkind === sub)).length;
      const row = {
        participant_id: st.participant_id, session_id: sid, block_index: st.block_index,
        condition: st.condition as SummaryRow['condition'], task_id: st.task_id,
        duration_s: end ? end.t_ms / 1000 : NaN, end_reason: end?.subkind ?? '',
        prompts: cnt('prompt_submit'), total_tokens: input + output, input_tokens: input, output_tokens: output,
        cache_read_tokens: calls.reduce((s, c) => s + c.cache_read_tokens, 0),
        dm_total: cnt('manipulation'), proposals: cnt('proposal_shown'),
        prop_accepted: cnt('proposal_resolved', 'accepted'), prop_alternative: cnt('proposal_resolved', 'alternative'),
        prop_rephrased: cnt('proposal_resolved', 'rephrased'), prop_dismissed: cnt('proposal_resolved', 'dismissed'),
        llm_calls: calls.length, sus: '', tlx_raw: '',
      } as unknown as SummaryRow;
      blocks.push(row);
    }
  }
  return { ...data, blocks };
}

// --- Statistics ---------------------------------------------------------------

export type MeasureKey =
  | 'prompts'
  | 'tokens'
  | 'time'
  | 'dm'
  | 'calls'
  | 'specVsChat'
  | 'sus'
  | 'tlx'
  | 'cachedShare'
  | 'similarity'
  | 'selfMatch';

interface MeasureDef {
  key: MeasureKey;
  label: string;
  unit: string;
  /** Lower is better (drives the wording of the interpretation). */
  lowerBetter: boolean;
  baseline: (r: SummaryRow) => number;
  wysiwyc: (r: SummaryRow) => number;
  /** Labels for the two sides when they measure different things. */
  sides?: [string, string];
}

const num = (v: unknown) => (v === '' || v === null || v === undefined ? NaN : Number(v));

export const MEASURES: MeasureDef[] = [
  { key: 'prompts', label: 'Prompts to target', unit: 'prompts / task', lowerBetter: true, baseline: (r) => num(r.prompts), wysiwyc: (r) => num(r.prompts) },
  { key: 'tokens', label: 'Tokens per task', unit: 'tokens', lowerBetter: true, baseline: (r) => num(r.total_tokens), wysiwyc: (r) => num(r.total_tokens) },
  { key: 'time', label: 'Time to target', unit: 'min', lowerBetter: true, baseline: (r) => num(r.duration_s) / 60, wysiwyc: (r) => num(r.duration_s) / 60 },
  {
    key: 'specVsChat', label: 'Spec vs. chat words', unit: 'words', lowerBetter: true,
    baseline: (r) => num(r.chat_words), wysiwyc: (r) => num(r.spec_words), sides: ['Chat history (chat-only)', 'Living spec (WYSIWYC)'],
  },
  { key: 'calls', label: 'Model calls', unit: 'calls / task', lowerBetter: true, baseline: (r) => num(r.llm_calls), wysiwyc: (r) => num(r.llm_calls) },
  { key: 'dm', label: 'Direct manipulations', unit: 'per task', lowerBetter: false, baseline: (r) => num(r.dm_total), wysiwyc: (r) => num(r.dm_total) },
  { key: 'cachedShare', label: 'Cached input share', unit: '%', lowerBetter: false, baseline: (r) => num(r.cached_share) * 100, wysiwyc: (r) => num(r.cached_share) * 100 },
  { key: 'sus', label: 'SUS', unit: '0–100', lowerBetter: false, baseline: (r) => num(r.sus), wysiwyc: (r) => num(r.sus) },
  { key: 'tlx', label: 'Raw NASA-TLX', unit: '0–100', lowerBetter: true, baseline: (r) => num(r.tlx_raw), wysiwyc: (r) => num(r.tlx_raw) },
  { key: 'selfMatch', label: 'Self-rated match', unit: '1–7', lowerBetter: false, baseline: (r) => num(r.self_match), wysiwyc: (r) => num(r.self_match) },
  { key: 'similarity', label: 'Visual similarity (rated)', unit: '0–100', lowerBetter: false, baseline: (r) => num(r.similarity), wysiwyc: (r) => num(r.similarity) },
];

export interface PairRow {
  pid: string;
  baseline: number;
  wysiwyc: number;
}

export interface MeasureStats {
  key: MeasureKey;
  label: string;
  unit: string;
  sides: [string, string];
  pairs: PairRow[];
  medBaseline: number;
  medWysiwyc: number;
  iqrBaseline: [number, number];
  iqrWysiwyc: [number, number];
  change: number;
  medDiff: number;
  improved: number;
  test: WilcoxonResult | null;
  text: string;
}

/** Per participant: mean of the measure over that condition's blocks. */
export function pairsFor(blocks: SummaryRow[], m: MeasureDef): PairRow[] {
  const by = new Map<string, { b: number[]; w: number[] }>();
  for (const r of blocks) {
    const e = by.get(r.participant_id) ?? by.set(r.participant_id, { b: [], w: [] }).get(r.participant_id)!;
    if (r.condition === 'baseline') e.b.push(m.baseline(r));
    else if (r.condition === 'wysiwyc') e.w.push(m.wysiwyc(r));
  }
  const out: PairRow[] = [];
  for (const [pid, e] of by) {
    const b = mean(e.b);
    const w = mean(e.w);
    if (Number.isFinite(b) && Number.isFinite(w)) out.push({ pid, baseline: b, wysiwyc: w });
  }
  return out.sort((a, b) => a.pid.localeCompare(b.pid, undefined, { numeric: true }));
}

function describe(m: MeasureDef, s: Omit<MeasureStats, 'text'>): string {
  const n = s.pairs.length;
  if (!n) return 'No paired data yet.';
  const [sb, sw] = s.sides;
  const fewer = m.lowerBetter ? s.pairs.filter((p) => p.wysiwyc < p.baseline).length : s.pairs.filter((p) => p.wysiwyc > p.baseline).length;
  const dir = s.medWysiwyc < s.medBaseline ? 'fell' : s.medWysiwyc > s.medBaseline ? 'rose' : 'stayed';
  const better = m.lowerBetter ? 'lower' : 'higher';
  const t = s.test;
  const testTxt = t
    ? ` Wilcoxon signed-rank: W = ${fmtNum(t.w)}, ${fmtP(t.p)} (${t.method}${t.zeros ? `, ${t.zeros} tie${t.zeros > 1 ? 's' : ''} dropped` : ''}), r = ${t.r.toFixed(2)}.`
    : '';
  const sig = t && t.p < 0.05 ? '' : t ? ' The difference is not statistically reliable at this N.' : '';
  const lc = (x: string) => (/[A-Z]{2}/.test(x) ? x : x.toLowerCase());
  if (m.sides) {
    return `Median ${lc(sb)} was ${fmtNum(s.medBaseline, 0)} ${m.unit} vs. ${fmtNum(s.medWysiwyc, 0)} for the ${sw.replace(/^Living/, 'living')} (${fmtPct(s.change)}); ${fewer} of ${n} participants were ${better}.${testTxt}${sig}`;
  }
  return `Median ${lc(m.label)} ${dir} from ${fmtNum(s.medBaseline)} with chat-only to ${fmtNum(s.medWysiwyc)} with WYSIWYC (${fmtPct(s.change)}); ${fewer} of ${n} participants were ${better}.${testTxt}${sig}`;
}

export function measureStats(blocks: SummaryRow[], key: MeasureKey): MeasureStats {
  const m = MEASURES.find((x) => x.key === key)!;
  const pairs = pairsFor(blocks, m);
  const b = pairs.map((p) => p.baseline);
  const w = pairs.map((p) => p.wysiwyc);
  const medBaseline = median(b);
  const medWysiwyc = median(w);
  const improvedCount = pairs.filter((p) => (m.lowerBetter ? p.wysiwyc < p.baseline : p.wysiwyc > p.baseline)).length;
  const base = {
    key,
    label: m.label,
    unit: m.unit,
    sides: m.sides ?? (['Chat-only', 'WYSIWYC'] as [string, string]),
    pairs,
    medBaseline,
    medWysiwyc,
    iqrBaseline: [quantile(b, 0.25), quantile(b, 0.75)] as [number, number],
    iqrWysiwyc: [quantile(w, 0.25), quantile(w, 0.75)] as [number, number],
    change: pctChange(medBaseline, medWysiwyc),
    medDiff: median(pairs.map((p) => p.wysiwyc - p.baseline)),
    improved: improvedCount,
    test: pairs.length ? wilcoxon(b, w) : null,
  };
  return { ...base, text: describe(m, base) };
}

export interface TaskRow {
  task: string;
  title: string;
  condition: 'baseline' | 'wysiwyc';
  conditionLabel: string;
  tokens: number;
  prompts: number;
  time: number;
  n: number;
}

export function perTask(blocks: SummaryRow[]): TaskRow[] {
  const out: TaskRow[] = [];
  for (const t of TASKS) {
    for (const c of ['baseline', 'wysiwyc'] as const) {
      const rows = blocks.filter((r) => r.task_id === t.id && r.condition === c);
      out.push({
        task: t.id,
        title: t.title,
        condition: c,
        conditionLabel: CONDITION_LABEL[c],
        tokens: median(rows.map((r) => num(r.total_tokens))),
        prompts: median(rows.map((r) => num(r.prompts))),
        time: median(rows.map((r) => num(r.duration_s) / 60)),
        n: rows.length,
      });
    }
  }
  return out;
}

export interface Waterfall {
  baseline: number;
  wysiwyc: number;
  observed: number;
  /** Attributed shares of the observed reduction (scaled when estimates overshoot). */
  gesture: number;
  widget: number;
  residual: number;
  /** Raw counterfactual estimates before scaling. */
  rawGesture: number;
  rawWidget: number;
  scaled: boolean;
  /** Counterfactuals outside the baseline comparison. */
  patch: number;
  cache: number;
  n: number;
  text: string;
}

/**
 * Median per-participant decomposition of the token difference (per task).
 * Each gesture episode / widget edit is costed at one corrective re-prompt
 * (see metrics.repromptCost). When those estimates exceed the observed
 * reduction they are scaled down proportionally (several hand edits often
 * replace one prompt), and the scaling is reported.
 */
export function waterfall(blocks: SummaryRow[]): Waterfall {
  const tokens = pairsFor(blocks, MEASURES.find((m) => m.key === 'tokens')!);
  const per = (col: keyof SummaryRow) => {
    const by = new Map<string, number[]>();
    blocks.filter((r) => r.condition === 'wysiwyc').forEach((r) => (by.get(r.participant_id) ?? by.set(r.participant_id, []).get(r.participant_id)!).push(num(r[col])));
    return median([...by.values()].map(mean));
  };
  const baseline = median(tokens.map((p) => p.baseline));
  const wysiwyc = median(tokens.map((p) => p.wysiwyc));
  const observed = baseline - wysiwyc;
  const rawGesture = per('save_gesture') || 0;
  const rawWidget = per('save_widget') || 0;
  const est = rawGesture + rawWidget;
  const scaled = observed > 0 && est > observed;
  const k = scaled ? observed / est : 1;
  const gesture = rawGesture * k;
  const widget = rawWidget * k;
  const residual = observed - gesture - widget;
  const patch = per('save_patch') || 0;
  const cache = per('save_cache') || 0;
  const share = (x: number) => (observed > 0 ? `${Math.round((x / observed) * 100)}%` : '—');
  const text = tokens.length
    ? `Per task, the median participant spent ${fmtNum(baseline, 0)} tokens with chat-only and ${fmtNum(wysiwyc, 0)} with WYSIWYC (${fmtPct(pctChange(baseline, wysiwyc))}). ` +
      `Of that reduction, an estimated ${share(gesture)} comes from direct manipulations that replaced a re-prompt and ${share(widget)} from widget edits that never call the model` +
      (scaled
        ? ` (raw estimates of ${fmtNum(rawGesture, 0)} and ${fmtNum(rawWidget, 0)} tokens exceed the observed difference and were scaled to it: several hand edits often stand in for one prompt).`
        : `; ${share(residual)} (${fmtNum(residual, 0)} tokens) is not explained by these two sources.`) +
      ` Outside the comparison, patching instead of regenerating saved an estimated ${fmtNum(patch, 0)} output tokens per WYSIWYC task, and prompt caching cut the billed cost of ${fmtNum(cache, 0)} input tokens.`
    : 'No paired token data yet.';
  return { baseline, wysiwyc, observed, gesture, widget, residual, rawGesture, rawWidget, scaled, patch, cache, n: tokens.length, text };
}

export interface ProposalStats {
  accepted: number;
  alternative: number;
  rephrased: number;
  dismissed: number;
  other: number;
  shown: number;
  singleClick: number;
  acceptedShare: number;
  text: string;
}

export function proposalStats(blocks: SummaryRow[]): ProposalStats {
  const w = blocks.filter((r) => r.condition === 'wysiwyc');
  const s = (c: keyof SummaryRow) => w.reduce((a, r) => a + (num(r[c]) || 0), 0);
  const accepted = s('prop_accepted');
  const alternative = s('prop_alternative');
  const rephrased = s('prop_rephrased');
  const dismissed = s('prop_dismissed');
  const other = s('prop_other');
  const resolved = accepted + alternative + rephrased + dismissed;
  const singleClick = resolved ? (accepted + alternative) / resolved : NaN;
  const acceptedShare = resolved ? accepted / resolved : NaN;
  const text = resolved
    ? `${resolved} proposals were resolved by participants: ${fmtPct(acceptedShare).replace('+', '')} accepted as-is, ${fmtPct(alternative / resolved).replace('+', '')} swapped for a generated alternative, ${fmtPct(rephrased / resolved).replace('+', '')} rephrased and ${fmtPct(dismissed / resolved).replace('+', '')} dismissed. ${fmtPct(singleClick).replace('+', '')} were resolved in a single click (accept or alternative).${other ? ` ${other} more were superseded, undone or left open at the end of a task.` : ''}`
    : 'No proposals were resolved yet.';
  return { accepted, alternative, rephrased, dismissed, other, shown: s('proposals'), singleClick, acceptedShare, text };
}

export function dmByKind(blocks: SummaryRow[]): { kind: string; condition: string; perTask: number }[] {
  const kinds: [keyof SummaryRow, string][] = [
    ['dm_drag', 'Drag'], ['dm_resize', 'Resize'], ['dm_draw', 'Draw'], ['dm_widget', 'Widget edit'],
    ['dm_edit', 'Inspector / text'], ['dm_annotation', 'Annotation'], ['dm_gesture', 'Gesture'],
    ['dm_structure', 'Structure'], ['dm_component', 'Component'],
  ];
  const w = blocks.filter((r) => r.condition === 'wysiwyc');
  return kinds.map(([col, kind]) => ({ kind, condition: 'wysiwyc', perTask: mean(w.map((r) => num(r[col]) || 0)) }));
}

export function preferenceCounts(participants: DemographicsRow[]): { wysiwyc: number; baseline: number; none: number; n: number; text: string } {
  const c = { wysiwyc: 0, baseline: 0, none: 0 };
  participants.forEach((p) => { if (p.preference in c) c[p.preference as keyof typeof c]++; });
  const n = c.wysiwyc + c.baseline + c.none;
  return { ...c, n, text: n ? `${c.wysiwyc} of ${n} participants preferred WYSIWYC, ${c.baseline} chat-only, ${c.none} had no preference.` : 'No preference answers yet.' };
}

export interface StudyStats {
  generatedAt: string;
  synthetic: boolean;
  nParticipants: number;
  nBlocks: number;
  measures: MeasureStats[];
  perTask: TaskRow[];
  waterfall: Waterfall;
  proposals: ProposalStats;
  dmByKind: { kind: string; condition: string; perTask: number }[];
  preference: ReturnType<typeof preferenceCounts>;
  specWords: { wysiwycSpec: number; baselineChat: number };
}

export function computeStats(data: AnalysisData): StudyStats {
  const blocks = data.blocks.filter((r) => r.condition === 'baseline' || r.condition === 'wysiwyc');
  const measures = MEASURES.map((m) => measureStats(blocks, m.key));
  const sv = measures.find((m) => m.key === 'specVsChat')!;
  return {
    generatedAt: new Date().toISOString(),
    synthetic: !!data.synthetic,
    nParticipants: new Set(blocks.map((b) => b.participant_id)).size,
    nBlocks: blocks.length,
    measures,
    perTask: perTask(blocks),
    waterfall: waterfall(blocks),
    proposals: proposalStats(blocks),
    dmByKind: dmByKind(blocks),
    preference: preferenceCounts(data.participants),
    specWords: { wysiwycSpec: sv.medWysiwyc, baselineChat: sv.medBaseline },
  };
}

/** Markdown block ready to paste into the case study. */
export function statsMarkdown(s: StudyStats): string {
  const m = (k: MeasureKey) => s.measures.find((x) => x.key === k)!;
  const card = (k: MeasureKey, label: string) =>
    `    <div class="stat" style="--accent:#6366F1"><span class="stat__value">${fmtPct(m(k).change)}</span><span class="stat__label">${label}</span></div>`;
  const lines = [
    `<!-- Generated by the WYSIWYC analysis page on ${s.generatedAt}${s.synthetic ? ' — SYNTHETIC DEMO DATA, do not publish' : ''} -->`,
    '<div class="stats">',
    card('prompts', 'prompts to reach a target UI'),
    card('tokens', 'tokens spent per task'),
    card('time', 'time to target'),
    card('specVsChat', 'shorter spec than the chat log it replaces'),
    '</div>',
    `<span class="text-caption">Pilot study, N = ${s.nParticipants}, WYSIWYC vs. a chat-only baseline (medians, see §5).</span>`,
    '',
    '| Measure | Chat-only (median) | WYSIWYC (median) | Change | Wilcoxon | r |',
    '|---|---|---|---|---|---|',
    ...s.measures
      .filter((x) => x.pairs.length)
      .map((x) => `| ${x.label}${x.sides[0] !== 'Chat-only' ? ` (${x.sides[0]} vs ${x.sides[1]})` : ''} | ${fmtNum(x.medBaseline)} | ${fmtNum(x.medWysiwyc)} | ${fmtPct(x.change)} | ${x.test ? `W = ${fmtNum(x.test.w)}, ${fmtP(x.test.p)}` : '—'} | ${x.test ? x.test.r.toFixed(2) : '—'} |`),
    '',
    `- **Prompts:** ${m('prompts').text}`,
    `- **Tokens:** ${m('tokens').text}`,
    `- **Time:** ${m('time').text}`,
    `- **Spec vs. chat:** ${m('specVsChat').text}`,
    `- **Token savings:** ${s.waterfall.text}`,
    `- **Proposals:** ${s.proposals.text}`,
    `- **Perception:** ${m('sus').text} ${m('tlx').text}`,
    `- **Preference:** ${s.preference.text}`,
  ];
  return lines.join('\n');
}
