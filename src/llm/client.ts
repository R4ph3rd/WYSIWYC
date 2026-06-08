import type { IR, IRPatch, PromptUpdateProposal, StructuredPrompt, ManipulationOp } from '@/ir/types';
import { IR_PATCH_SCHEMA, PROMPT_UPDATE_SCHEMA } from './schemas';
import { CALL_A_SYSTEM, CALL_B_SYSTEM, callAUser, callBUser } from './prompts';

/** Thrown when the LLM proxy isn't reachable (e.g. static GitHub Pages host). */
export class LLMUnavailableError extends Error {}

interface LLMRequest {
  system: string;
  user: string;
  schema: unknown;
  schemaName: string;
  maxTokens: number;
}

async function callLLM<T>(req: LLMRequest): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch {
    throw new LLMUnavailableError('Could not reach the LLM backend.');
  }

  if (res.status === 404) {
    throw new LLMUnavailableError('No LLM backend on this host. Run locally with ANTHROPIC_API_KEY.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error ?? `LLM request failed (${res.status}).`);
  }
  return body.data as T;
}

/** Call A — Prompt → IR patch. */
export function generatePatch(
  ir: IR,
  prompt: StructuredPrompt,
  changedClauseIds: string[],
): Promise<IRPatch> {
  return callLLM<IRPatch>({
    system: CALL_A_SYSTEM,
    user: callAUser(ir, prompt, changedClauseIds),
    schema: IR_PATCH_SCHEMA,
    schemaName: 'ir_patch',
    maxTokens: 8000,
  });
}

/** Call B — IR delta → Prompt update proposal (the lossy back-channel). */
export function proposePromptUpdate(
  prevIR: IR,
  nextIR: IR,
  prevPrompt: StructuredPrompt,
  op: ManipulationOp,
): Promise<PromptUpdateProposal> {
  return callLLM<PromptUpdateProposal>({
    system: CALL_B_SYSTEM,
    user: callBUser(prevIR, nextIR, prevPrompt, op),
    schema: PROMPT_UPDATE_SCHEMA,
    schemaName: 'prompt_update',
    maxTokens: 1500,
  });
}
