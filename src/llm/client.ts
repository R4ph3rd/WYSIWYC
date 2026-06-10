import type {
  ComposeResult,
  IR,
  IRPatch,
  ManipulationOp,
  PromptUpdateProposal,
  StructuredPrompt,
} from '@/ir/types';
import { COMPOSE_SCHEMA, IR_PATCH_SCHEMA, PROMPT_UPDATE_SCHEMA } from './schemas';
import { CALL_A_SYSTEM, CALL_B_SYSTEM, COMPOSE_SYSTEM, callAUser, callBUser, composeUser } from './prompts';
import { callJSON, LLMError } from './providers';
import { useSettingsStore } from '@/store/settingsStore';

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
  maxTokens: number,
): Promise<T> {
  const active = useSettingsStore.getState().active();
  if (!active) throw new NotConnectedError();
  try {
    return (await callJSON(active.provider, {
      apiKey: active.apiKey,
      model: active.model,
      system,
      user,
      schema,
      schemaName,
      maxTokens,
    })) as T;
  } catch (err) {
    if (err instanceof LLMError) throw err;
    throw new LLMError((err as Error).message);
  }
}

/**
 * Compose — freeform instruction → spec update + IR patch (one call). This is
 * what the Lovable-style composer drives: the user talks naturally, the spec
 * writes itself, and the same call patches the scene so provenance lines up.
 */
export function composeFromInstruction(
  ir: IR,
  prompt: StructuredPrompt,
  instruction: string,
): Promise<ComposeResult> {
  return callConnected<ComposeResult>(
    COMPOSE_SYSTEM,
    composeUser(ir, prompt, instruction),
    COMPOSE_SCHEMA,
    'compose',
    8000,
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
    8000,
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
  );
}
