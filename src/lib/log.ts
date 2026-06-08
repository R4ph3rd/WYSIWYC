import type { ManipulationOp, ProposalConfidence, PromptUpdateProposal } from '@/ir/types';

/**
 * Research instrumentation (spec §7). Every Call B back-channel event is logged
 * as { manipulation, proposal, accepted, confidence } — the dependent measure
 * for the future study is acceptance rate of inferred prompt deltas by
 * manipulation type and confidence. Stored in localStorage and downloadable.
 */
export interface BackChannelLogEntry {
  timestamp: number;
  manipulationKind: ManipulationOp['kind'];
  manipulation: ManipulationOp;
  proposal: PromptUpdateProposal | null;
  accepted: boolean | null; // null = errored / not yet decided
  confidence: ProposalConfidence | null;
}

const KEY = 'wysiwyc.backchannel.log';

function read(): BackChannelLogEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function logBackChannel(entry: BackChannelLogEntry): void {
  const all = read();
  all.push(entry);
  localStorage.setItem(KEY, JSON.stringify(all));
}

/** Record the user's accept/reject on the most recent undecided proposal. */
export function setLastDecision(accepted: boolean): void {
  const all = read();
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].accepted === null && all[i].proposal !== null) {
      all[i].accepted = accepted;
      localStorage.setItem(KEY, JSON.stringify(all));
      return;
    }
  }
}

export function getBackChannelLog(): BackChannelLogEntry[] {
  return read();
}

export function downloadBackChannelLog(): void {
  const blob = new Blob([JSON.stringify(read(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wysiwyc-backchannel-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
