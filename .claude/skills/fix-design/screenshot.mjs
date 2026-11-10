#!/usr/bin/env node
// Capture the running app with Playwright (headless Chromium) for before/after design checks.
// Starts `vite` on :5173 if nothing is listening, and stops it afterwards.
//
// Usage:
//   node .claude/skills/fix-design/screenshot.mjs <out.png> [--path /] [--size 1440x900]
//        [--click "Accessible name"]… [--sample "Pricing card"] [--selector "css"]
//
// --click   clicks a button/tab by accessible name (repeatable, in order)
// --sample  clicks a sample under "Try:" on the empty canvas (no LLM call)
// --selector screenshots only that element instead of the full page
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const out = args[0];
if (!out || out.startsWith('--')) {
  console.error('usage: screenshot.mjs <out.png> [--path /] [--size WxH] [--click name]… [--sample name] [--selector css]');
  process.exit(1);
}
const opt = (k) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : undefined; };
const all = (k) => args.flatMap((a, i) => (a === k ? [args[i + 1]] : []));
const base = 'http://localhost:5173';
const [w, h] = (opt('--size') ?? '1440x900').split('x').map(Number);

async function up() {
  try { return (await fetch(base)).ok; } catch { return false; }
}

let server;
if (!(await up())) {
  server = spawn('npm', ['run', 'dev', '--', '--port', '5173', '--strictPort'], { shell: true, stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await up())) { console.error('dev server did not start on :5173'); process.exit(1); }
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base + (opt('--path') ?? '/'));
  await page.waitForLoadState('networkidle');
  const sample = opt('--sample');
  if (sample) await page.getByRole('button', { name: sample }).first().click();
  for (const name of all('--click')) await page.getByRole('button', { name }).or(page.getByRole('tab', { name })).first().click();
  await page.waitForTimeout(400); // let Tailwind Play CDN compile new classes
  const sel = opt('--selector');
  if (sel) await page.locator(sel).first().screenshot({ path: out });
  else await page.screenshot({ path: out, fullPage: false });
  console.log(`saved ${out} (${w}x${h})`);
  if (errors.length) console.log(`console errors:\n  ${errors.join('\n  ')}`);
} finally {
  await browser.close();
  if (server) {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
    else server.kill();
  }
}
