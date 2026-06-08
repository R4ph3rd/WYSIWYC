import type { IR, IRPatch, PromptUpdateProposal, StructuredPrompt, ManipulationOp } from '@/ir/types';
import { IR_PATCH_SCHEMA, PROMPT_UPDATE_SCHEMA } from './schemas';
import { CALL_A_SYSTEM, CALL_B_SYSTEM, callAUser, callBUser } from './prompts';
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
