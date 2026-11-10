#!/usr/bin/env node
// Run the project's quality gates in order and print a one-screen summary.
// Usage: node .claude/skills/verify/verify.mjs [--e2e] [--build] [--all]
//   default: lint + unit tests (the CLAUDE.md "before claiming finished" gate)
//   --e2e   also run Playwright (needs `npx playwright install chromium` once)
//   --build also run `npm run build` (what deploy.yml ships)
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const a = new Set(process.argv.slice(2));
const steps = [
  ['lint', 'npm run lint'],
  ['test', 'npm test'],
  ...(a.has('--build') || a.has('--all') ? [['build', 'npm run build']] : []),
  ...(a.has('--e2e') || a.has('--all') ? [['e2e', 'npm run e2e -- --reporter=line']] : []),
];

const missing = ['vitest', '@playwright/test', 'typescript'].filter((m) => !existsSync(`node_modules/${m}`));
if (missing.length) {
  console.error(`Missing dev dependencies: ${missing.join(', ')}. Run \`npm install\` first.`);
  process.exit(1);
}

const results = [];
for (const [name, cmd] of steps) {
  const t = Date.now();
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8', env: { ...process.env, CI: process.env.CI ?? '' } });
  const ok = r.status === 0;
  results.push({ name, ok, secs: ((Date.now() - t) / 1000).toFixed(1) });
  if (!ok) {
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n');
    console.log(`\n--- ${name} FAILED (last 60 lines) ---\n${out.slice(-60).join('\n')}`);
    break; // later gates are meaningless if an earlier one fails
  }
}

console.log('\n=== verify ===');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(6)} ${r.secs}s`);
for (const [name] of steps.slice(results.length)) console.log(`SKIP  ${name}`);
process.exit(results.every((r) => r.ok) && results.length === steps.length ? 0 : 1);
