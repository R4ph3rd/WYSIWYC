import type {
  ComposeResult,
  IR,
  IRPatch,
  ManipulationOp,
  PromptUpdateProposal,
  StructuredPrompt,
} from '@/ir/types';
import { COMPOSE_SCHEMA, IR_PATCH_SCHEMA, PROMPT_UPDATE_SCHEMA } from './schemas';
import {
  CALL_A_SYSTEM,
  CALL_B_SYSTEM,
  COMPOSE_SYSTEM,
  callAUser,
  callBUser,
  composeUser,
  type ComposeOptions,
} from './prompts';
import { callJSON, LLMError, type ProviderId } from './providers';
import { useSettingsStore } from '@/store/settingsStore';
import { useStudyStore } from '@/store/studyStore';
import type { CallType } from '@/study/schema';

/** Thrown when no provider is connected. The UI surfaces this with the Connect dialog. */
export class NotConnectedError extends Error {
  constructor() {
    super('No model connected. Open the Connect dialog and paste an API key.');
  }
}

async function callConnected<T>(
  system: string,
  user: string,
  schema: unknown,
  schemaName: string,
  maxTokens: number | Record<ProviderId, number>,
  images: string[] | undefined,
  callType: CallType,
): Promise<T> {
  const active = useSettingsStore.getState().active();
  if (!active) throw new NotConnectedError();
  const resolvedMaxTokens = typeof maxTokens === 'number' ? maxTokens : maxTokens[active.provider];
  const study = useStudyStore.getState();
  const started = performance.now();
  try {
    const { data, inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens } = await callJSON(active.provider, {
      apiKey: active.apiKey,
      model: active.model,
      system,
      user,
      schema,
      schemaName,
      maxTokens: resolvedMaxTokens,
      images,
    });
    // Study ledger: one row per call, identical in both conditions.
    study.logCall({
      provider: active.provider,
      model: active.model,
      callType,
      inputTokens,
      outputTokens,
      cacheReadTokens: cachedInputTokens,
      cacheWriteTokens,
      latencyMs: performance.now() - started,
      ok: true,
    });
    return data as T;
  } catch (err) {
    const message = (err as Error).message;
    study.logCall({
      provider: active.provider,
      model: active.model,
      callType,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      latencyMs: performance.now() - started,
      ok: false,
      error: message.slice(0, 300),
    });
    if (err instanceof LLMError) throw err;
    throw new LLMError(message);
  }
}

/**
 * Output-token ceiling for the two calls that can emit a whole scene graph
 * (compose from scratch, or a full Call A regeneration). A rich page — a landing
 * page, a dashboard — easily runs past 16k tokens of JSON (dozens of nodes, each
 * ~15-20 lines) and would otherwise be truncated mid-object ("end of data when
 * property name was expected"). This is per-provider rather than one shared
 * number: OpenAI's gpt-4o tops out at 16384 output tokens, but Anthropic's
 * models allow a much higher ceiling, so pinning every provider to OpenAI's
 * limit was needlessly truncating Anthropic generations.
 */
const MAX_SCENE_TOKENS: Record<ProviderId, number> = {
  anthropic: 32000,
  openai: 16000,
  mistral: 16000,
  groq: 16000,
};

/**
 * Compose — freeform instruction → spec update + IR patch (one call). This is
 * what the Lovable-style composer drives: the user talks naturally, the spec
 * writes itself, and the same call patches the scene so provenance lines up.
 */
export function composeFromInstruction(
  ir: IR,
  prompt: StructuredPrompt,
  instruction: string,
  opts: ComposeOptions = {},
  callType: CallType = 'compose',
): Promise<ComposeResult> {
  const images = (opts.refs ?? [])
    .filter((r): r is Extract<typeof r, { kind: 'image' }> => r.kind === 'image')
    .map((r) => r.dataUrl);
  return callConnected<ComposeResult>(
    COMPOSE_SYSTEM,
    composeUser(ir, prompt, instruction, opts),
    COMPOSE_SCHEMA,
    'compose',
    MAX_SCENE_TOKENS,
    images,
    callType,
  );
}

/** Call A — Prompt → IR patch. */
export function generatePatch(
  ir: IR,
  prompt: StructuredPrompt,
  changedClauseIds: string[],
): Promise<IRPatch> {
  return callConnected<IRPatch>(
    CALL_A_SYSTEM,
    callAUser(ir, prompt, changedClauseIds),
    IR_PATCH_SCHEMA,
    'ir_patch',
    MAX_SCENE_TOKENS,
    undefined,
    'patch',
  );
}

/** Call B — IR delta → Prompt update proposal (the lossy back-channel). */
export function proposePromptUpdate(
  prevIR: IR,
  nextIR: IR,
  prevPrompt: StructuredPrompt,
  op: ManipulationOp,
): Promise<PromptUpdateProposal> {
  return callConnected<PromptUpdateProposal>(
    CALL_B_SYSTEM,
    callBUser(prevIR, nextIR, prevPrompt, op),
    PROMPT_UPDATE_SCHEMA,
    'prompt_update',
    1500,
    undefined,
    'backchannel',
  );
}
