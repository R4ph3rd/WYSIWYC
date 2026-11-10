---
name: verify
description: Run WYSIWYC's quality gates (typecheck, Vitest, optionally build and Playwright e2e) and report the result honestly. Use before saying a task is done, before committing or opening a PR, and after any change to src/.
---

# Verify a change

CLAUDE.md: **lint + test must pass before claiming a task is finished.**

## Pick the gates from what changed

| Changed | Command |
|---|---|
| Anything in `src/` | `node .claude/skills/verify/verify.mjs` (lint + unit tests) |
| `src/ui/**`, `src/render/**`, `src/store/**`, `src/llm/**`, `index.html`, `e2e/**` | add `--e2e` |
| `vite.config.ts`, `index.html`, `package.json`, `public/**`, anything before a deploy | add `--build` |
| Unsure, or before a PR | `--all` |

The script stops at the first failing gate and prints its last 60 lines. If it says
dev dependencies are missing, run `npm install` (ask first if `package-lock.json`
would change on a branch the user didn't expect).

First e2e run on a machine: `npx playwright install chromium`.

## When a gate fails

- Read the failure and fix the cause. Re-run only the failing gate while iterating
  (`npx vitest run <file>`, `npx playwright test e2e/<spec> --reporter=line`), then
  the full script once at the end.
- Never `.skip`/`.only`/delete a test, loosen an assertion, add `// @ts-ignore`, or
  widen a type to `any` just to go green. If you believe the test is wrong, say so and
  ask.
- If you suspect the failure already exists on `main`, check in a separate worktree
  (`git worktree add <scratchpad>/main-check main`, then `npm ci` and the gate there)
  rather than stashing the user's changes. Report it as pre-existing instead of fixing
  unrelated code.

## Report

End with the summary table the script prints, verbatim. If you skipped a gate
(e.g. no Chromium available), say which one and why. Don't write "all tests pass"
unless every gate you ran printed PASS.
