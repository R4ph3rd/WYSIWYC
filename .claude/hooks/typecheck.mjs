#!/usr/bin/env node
// PostToolUse hook (Edit|Write): typecheck after a TS/TSX edit.
// - Skips non-TS files (CSV, MD, JSON…) so docs edits stay fast.
// - On type errors, exits 2 so the errors are fed back to Claude (exit 1 would
//   only show them to the user and Claude would carry on unaware).
// - Never blocks on an infrastructure problem (missing deps, tsc crash): it
//   prints a hint and exits 0.
import { execSync } from 'node:child_process';

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let file = '';
  try {
    const input = JSON.parse(raw || '{}');
    file = input?.tool_input?.file_path ?? '';
  } catch {
    process.exit(0);
  }
  if (!/\.(ts|tsx)$/.test(file)) process.exit(0);

  try {
    execSync('npx tsc --noEmit --pretty false', { stdio: 'pipe', encoding: 'utf8' });
    process.exit(0);
  } catch (err) {
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    if (/Cannot find module '(vitest|@playwright\/test)'/.test(out) && !/error TS(?!2307)/.test(out)) {
      process.stderr.write('typecheck hook: dev dependencies are missing. Run `npm install`.\n');
      process.exit(0);
    }
    const errors = out.split('\n').filter((l) => /error TS\d+/.test(l));
    if (errors.length === 0) process.exit(0); // tsc crashed for another reason, don't block
    const shown = errors.slice(0, 20).join('\n');
    const more = errors.length > 20 ? `\n… and ${errors.length - 20} more` : '';
    process.stderr.write(`Typecheck failed after editing ${file}:\n${shown}${more}\n`);
    process.exit(2);
  }
});
