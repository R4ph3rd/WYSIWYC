/**
 * Study data schema. One `StudySession` per participant; everything else (the
 * CSVs, the Sheets payload, the analysis page's input) is a projection of it.
 * Bump SCHEMA_VERSION when a column changes meaning.
 */
import type { Condition, ConditionOrder, StudyTask } from './tasks';
import type { TlxAnswers } from './questionnaires';

export const SCHEMA_VERSION = 2;

export type ToolFrequency = 'never' | 'rarely' | 'monthly' | 'weekly' | 'daily';
export const TOOL_NAMES = ['v0', 'Lovable', 'Bolt', 'Cursor', 'Figma', 'ChatGPT/Claude for UI'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface Demographics {
  participantId: string;
  gender: 'woman' | 'man' | 'non-binary' | 'prefer-not' | 'self-describe' | '';
  genderSelfDescribe: string;
  age: number | null;
  role: string;
  yearsUiExperience: number | null;
  toolUse: Record<ToolName, ToolFrequency>;
  /** 1 (not at all familiar) … 7 (expert). */
  llmFamiliarity: number | null;
  consent: boolean;
}

export interface StudyConfig {
  conditionOrder: ConditionOrder;
  squareRow: number;
  /** True when the experimenter changed the suggested assignment. */
  overridden: boolean;
  blocks: { condition: Condition; taskId: StudyTask['id'] }[];
  timeLimitMin: number;
  /** Google Apps Script web-app URL ('' = local only). */
  sheetsUrl: string;
  /** TLX after every block; SUS once per condition (after its last block). */
  susSchedule: 'per-condition' | 'per-block';
}

/** Taxonomy of direct manipulations (summary columns dm_<category>). */
export type DmCategory =
  | 'drag'
  | 'resize'
  | 'draw'
  | 'widget'
  | 'edit'
  | 'annotation'
  | 'gesture'
  | 'structure'
  | 'component';
export const DM_CATEGORIES: DmCategory[] = ['drag', 'resize', 'draw', 'widget', 'edit', 'annotation', 'gesture', 'structure', 'component'];

export type EventKind =
  | 'block_start'
  | 'block_end'
  | 'prompt_submit'
  | 'compose_result'
  | 'llm_call'
  | 'manipulation'
  | 'proposal_shown'
  | 'proposal_resolved'
  | 'spec_edit'
  | 'undo'
  | 'version_restore'
  | 'annotation_apply'
  | 'target_view'
  | 'questionnaire'
  | 'session_recovered'
  | 'error';

export type CallType = 'compose' | 'patch' | 'backchannel' | 'alternatives' | 'annotation' | 'recipe';

export type ProposalOutcome = 'accepted' | 'alternative' | 'rephrased' | 'dismissed' | 'superseded' | 'undone' | 'abandoned';

export interface StudyEvent {
  seq: number;
  blockIndex: number;
  /** ms since the block started (active time; pauses excluded). -1 outside a block. */
  t: number;
  /** Wall clock, ms epoch. */
  ts: number;
  kind: EventKind;
  /** Kind-specific sub-type: op kind, call type, proposal outcome, … */
  subkind?: string;
  /** For manipulations: the DmCategory. */
  category?: string;
  data?: Record<string, unknown>;
}

export interface LLMCall {
  callId: string;
  blockIndex: number;
  t: number;
  ts: number;
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

export interface BlockRecord {
  blockIndex: number;
  condition: Condition;
  taskId: StudyTask['id'];
  startedAt: number;
  endedAt?: number;
  /** Paused time (crash recovery gaps) excluded from duration. */
  pausedMs: number;
  endReason?: 'done' | 'timeout' | 'skipped';
  finalSpec?: string[];
  /** Final scene graph, kept so blind raters can re-render the result later. */
  finalIR?: unknown;
  tlx?: TlxAnswers;
  sus?: (number | null)[];
  /** Experimenter's visual similarity to target, 0–100 (optional). */
  similarity?: number | null;
  /** Participant's confidence that the result matches the target, 1–7. */
  selfMatch?: number | null;
}

export interface EndInterview {
  preference: 'wysiwyc' | 'baseline' | 'none' | '';
  /** 1 = strongly prefer chat-only … 7 = strongly prefer WYSIWYC. */
  preferenceStrength: number | null;
  reason: string;
  notes: string;
}

export interface StudySession {
  schemaVersion: number;
  sessionId: string;
  createdAt: number;
  finishedAt?: number;
  demographics: Demographics;
  config: StudyConfig;
  blocks: BlockRecord[];
  events: StudyEvent[];
  calls: LLMCall[];
  interview: EndInterview;
  appVersion: string;
}

/** One summary row per participant × block — self-sufficient for the analysis. */
export interface SummaryRow {
  participant_id: string;
  session_id: string;
  block_index: number;
  condition: Condition;
  task_id: string;
  position_in_condition: number;
  duration_s: number;
  end_reason: string;
  prompts: number;
  prompt_words: number;
  llm_calls: number;
  calls_compose: number;
  calls_patch: number;
  calls_backchannel: number;
  calls_annotation: number;
  calls_recipe: number;
  calls_failed: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cached_share: number;
  llm_latency_s: number;
  dm_total: number;
  dm_drag: number;
  dm_resize: number;
  dm_draw: number;
  dm_widget: number;
  dm_edit: number;
  dm_annotation: number;
  dm_gesture: number;
  dm_structure: number;
  dm_component: number;
  proposals: number;
  prop_accepted: number;
  prop_alternative: number;
  prop_rephrased: number;
  prop_dismissed: number;
  prop_other: number;
  single_click_share: number | '';
  undo_count: number;
  version_restores: number;
  spec_words: number;
  chat_words: number;
  reprompt_cost: number;
  save_gesture: number;
  save_widget: number;
  save_patch: number;
  save_cache: number;
  sus: number | '';
  tlx_raw: number | '';
  tlx_mental: number | '';
  tlx_physical: number | '';
  tlx_temporal: number | '';
  tlx_performance: number | '';
  tlx_effort: number | '';
  tlx_frustration: number | '';
  similarity: number | '';
  self_match: number | '';
}

export interface DemographicsRow {
  participant_id: string;
  session_id: string;
  created_at: string;
  gender: string;
  age: number | '';
  role: string;
  years_ui_experience: number | '';
  llm_familiarity: number | '';
  tool_v0: string;
  tool_lovable: string;
  tool_bolt: string;
  tool_cursor: string;
  tool_figma: string;
  tool_chat_llm: string;
  condition_order: string;
  square_row: number;
  assignment_overridden: boolean;
  block_order: string;
  time_limit_min: number;
  preference: string;
  preference_strength: number | '';
  preference_reason: string;
  interview_notes: string;
  consent: boolean;
}

export interface EventRow {
  participant_id: string;
  session_id: string;
  seq: number;
  block_index: number;
  condition: string;
  task_id: string;
  t_ms: number;
  ts_iso: string;
  kind: string;
  subkind: string;
  category: string;
  data_json: string;
}

export interface CallRow {
  participant_id: string;
  session_id: string;
  call_id: string;
  block_index: number;
  condition: string;
  task_id: string;
  t_ms: number;
  ts_iso: string;
  provider: string;
  model: string;
  call_type: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  latency_ms: number;
  ok: boolean;
  error: string;
}
