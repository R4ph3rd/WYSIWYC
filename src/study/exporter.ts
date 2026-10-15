/**
 * Saving study data: local downloads (always) and an optional Google Apps
 * Script web app (best effort; never the only copy).
 */
import { toCSV } from './csv';
import { callRows, demographicsRow, eventRows, summaryRows } from './metrics';
import type { StudySession } from './schema';

export const ARCHIVE_KEY = 'wysiwyc.study.archive.v2';

export function downloadText(filename: string, text: string, mime = 'text/csv'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function readArchive(): StudySession[] {
  try {
    const v = JSON.parse(localStorage.getItem(ARCHIVE_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function archiveSession(session: StudySession): void {
  try {
    const all = readArchive().filter((s) => s.sessionId !== session.sessionId);
    all.push(session);
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(all));
  } catch {
    /* quota: the downloaded files remain the source of truth */
  }
}

export interface ExportFile {
  name: string;
  text: string;
  mime: string;
}

/** Every file a finished (or partial) session exports to. */
export function sessionFiles(session: StudySession): ExportFile[] {
  const pid = session.demographics.participantId || 'P00';
  const stamp = new Date(session.createdAt).toISOString().slice(0, 10);
  const base = `wysiwyc_${pid}_${stamp}`;
  const archive = readArchive().filter((s) => s.sessionId !== session.sessionId).concat(session);
  return [
    { name: `${base}_events.csv`, text: toCSV(eventRows(session)), mime: 'text/csv' },
    { name: `${base}_llm_calls.csv`, text: toCSV(callRows(session)), mime: 'text/csv' },
    { name: `${base}_summary.csv`, text: toCSV(summaryRows(session)), mime: 'text/csv' },
    { name: `${base}_demographics.csv`, text: toCSV([demographicsRow(session)]), mime: 'text/csv' },
    // Cumulative file: every participant run in this browser, one row each.
    { name: `wysiwyc_demographics_all.csv`, text: toCSV(archive.map(demographicsRow)), mime: 'text/csv' },
    { name: `${base}_session.json`, text: JSON.stringify(session, null, 2), mime: 'application/json' },
  ];
}

export async function downloadSessionFiles(session: StudySession): Promise<void> {
  for (const f of sessionFiles(session)) {
    downloadText(f.name, f.text, f.mime);
    // Browsers throttle bursts of programmatic downloads.
    await new Promise((r) => setTimeout(r, 250));
  }
}

export function sheetsPayload(session: StudySession) {
  return {
    action: 'append',
    schemaVersion: session.schemaVersion,
    participantId: session.demographics.participantId,
    sessionId: session.sessionId,
    demographics: demographicsRow(session),
    summary: summaryRows(session),
    events: eventRows(session),
    calls: callRows(session),
  };
}

export type RemoteStatus =
  | { state: 'off' }
  | { state: 'sending' }
  | { state: 'ok'; detail: string }
  | { state: 'unconfirmed'; detail: string }
  | { state: 'error'; detail: string };

/**
 * POST the session to the Apps Script web app. `text/plain` keeps it a CORS
 * "simple request" (no preflight, which Apps Script cannot answer). If the
 * response is unreadable (CORS), retry opaquely and report "unconfirmed".
 */
export async function postToSheets(url: string, session: StudySession): Promise<RemoteStatus> {
  const body = JSON.stringify(sheetsPayload(session));
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      redirect: 'follow',
    });
    if (!res.ok) return { state: 'error', detail: `HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; rows?: number } | null;
    if (json && json.ok === false) return { state: 'error', detail: json.error ?? 'Script error' };
    return { state: 'ok', detail: json?.rows ? `${json.rows} rows written` : 'Saved to Google Sheets' };
  } catch {
    try {
      await fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body });
      return { state: 'unconfirmed', detail: 'Sent, but the response could not be read (check the sheet).' };
    } catch (err) {
      return { state: 'error', detail: (err as Error).message || 'Network error' };
    }
  }
}

/** GET everything the script stored: { demographics, summary, events, calls }. */
export async function fetchFromSheets(url: string): Promise<unknown> {
  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(`${url}${sep}action=all`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const ENV_SHEETS_URL: string = (import.meta.env.VITE_STUDY_SHEETS_URL as string | undefined) ?? '';
