/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional Google Apps Script web-app URL for remote study backups. */
  readonly VITE_STUDY_SHEETS_URL?: string;
}
