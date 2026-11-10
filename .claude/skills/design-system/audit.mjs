#!/usr/bin/env node
// Design-system audit for the app chrome (src/ui). Heuristic: prints leads, not verdicts.
// Usage: node .claude/skills/design-system/audit.mjs [file-or-dir …]   (default: src/ui)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ALLOWED_TEXT_SIZES = new Set(['9px', '10px', '11px', '12px']);
const rules = [
  { id: 'raw-hex-class', re: /className=[^>]*?\[#[0-9a-fA-F]{3,8}\]/, msg: 'raw hex in a Tailwind arbitrary value; use a token' },
  { id: 'off-palette-neutral', re: /\b(?:bg|text|border|ring|divide)-(?:gray|zinc|neutral|stone)-\d{2,3}\b/, msg: 'neutral outside slate' },
  { id: 'hand-amber', re: /\b(?:bg|text|border|ring)-amber-\d{2,3}\b/, msg: 'hand-written amber; use AI.* from @/ui/tokens', skip: /tokens\.ts$/ },
  { id: 'text-size', re: /\btext-\[(\d+(?:\.\d+)?px)\]/, msg: 'arbitrary text size off the scale', test: (m) => !ALLOWED_TEXT_SIZES.has(m[1]) },
  { id: 'data-testid', re: /data-testid=/, msg: 'data-testid (CLAUDE.md: prefer ARIA / labels)' },
  { id: 'white-on-amber', re: /bg-amber-\d{3}[^"'`]*text-white|text-white[^"'`]*bg-amber-\d{3}/, msg: 'white text on amber fails contrast' },
];

function walk(p, out = []) {
  const s = statSync(p);
  if (s.isDirectory()) for (const f of readdirSync(p)) walk(join(p, f), out);
  else if (/\.(tsx|ts|css)$/.test(p) && !/\.test\.ts$/.test(p)) out.push(p);
  return out;
}

const targets = process.argv.slice(2);
const files = (targets.length ? targets : ['src/ui']).flatMap((t) => walk(t));
const counts = {};
let total = 0;

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const r of rules) {
      if (r.skip?.test(file)) continue;
      const m = line.match(r.re);
      if (m && (!r.test || r.test(m))) {
        console.log(`${relative(process.cwd(), file)}:${i + 1}  [${r.id}] ${r.msg}`);
        counts[r.id] = (counts[r.id] ?? 0) + 1;
        total++;
      }
    }
  });
  // Icon-only buttons: <button …> whose next few lines hold an Icon but no text/aria-label.
  const src = lines.join('\n');
  const btn = /<(button|Button)\b([^>]*)>\s*<([A-Z][A-Za-z0-9]*)\b[^>]*\/>\s*<\/\1>/g;
  let m;
  while ((m = btn.exec(src))) {
    if (!/aria-label|title=/.test(m[2])) {
      const ln = src.slice(0, m.index).split('\n').length;
      console.log(`${relative(process.cwd(), file)}:${ln}  [icon-button-no-label] icon-only button without aria-label`);
      counts['icon-button-no-label'] = (counts['icon-button-no-label'] ?? 0) + 1;
      total++;
    }
  }
}

console.log(`\n${total} finding(s) in ${files.length} file(s)`);
for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
