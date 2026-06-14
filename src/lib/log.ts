import type { ManipulationOp, ProposalConfidence, PromptUpdateProposal } from '@/ir/types';

/**
 * Research instrumentation (spec §7/§8). Every Call B back-channel event is
 * logged as { manipulation, proposal, accepted, confidence } — the dependent
 * measure for the future study is acceptance rate of inferred prompt deltas by
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

/**
 * DirectGPT quantitative signal (spec §8): how a compose send was composed.
 * One row per *gesture* — the core measure of whether direct manipulation
 * shortens prompts / reduces turns versus typing (DirectGPT found −50% turns,
 * −72% length). Recorded alongside the Call B dataset, never instead of it.
 */
export type GestureProvenance =
  | 'typed'
  | 'dragRef'
  | 'attributeRef'
  | 'paramRef'
  | 'image'
  | 'scopedSelection'
  | 'recipe';

export interface ComposeGestureLogEntry {
  timestamp: number;
  /** The strongest direct-manipulation signal present in this send. */
  provenance: GestureProvenance;
  /** Every chip/scope signal present (a send can mix several). */
  signals: GestureProvenance[];
  /** Number of reference chips in the composer value. */
  chipCount: number;
  /** Whether a selection scope was active. */
  scoped: boolean;
  /** Character length of the sent (marker-interpolated) instruction. */
  promptLength: number;
}

const KEY = 'wysiwyc.backchannel.log';
const GESTURE_KEY = 'wysiwyc.compose.gestures.log';

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

// --- Compose gesture log (DirectGPT §8) -----------------------------------

function readGestures(): ComposeGestureLogEntry[] {
  try {
    return JSON.parse(localStorage.getItem(GESTURE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function logComposeGesture(entry: ComposeGestureLogEntry): void {
  const all = readGestures();
  all.push(entry);
  localStorage.setItem(GESTURE_KEY, JSON.stringify(all));
}

export function getComposeGestureLog(): ComposeGestureLogEntry[] {
  return readGestures();
}

export function downloadBackChannelLog(): void {
  // The downloadable study dataset bundles both signals: the Call B back-channel
  // accept/reject rows AND the compose-gesture provenance rows.
  const payload = { backChannel: read(), composeGestures: readGestures() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wysiwyc-study-log-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
