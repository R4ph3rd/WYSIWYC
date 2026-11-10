---
name: deploy
description: Ship WYSIWYC to GitHub Pages (https://r4ph3rd.github.io/WYSIWYC/) safely — verify, build and preview locally, push, watch the workflow, smoke-test the live site. Use when the user asks to deploy, release, publish or "put it online".
disable-model-invocation: true
---

# Deploy to GitHub Pages

## How deployment works today (read before pushing)

- `.github/workflows/deploy.yml` runs on **push to any branch** (`branches: ['**']`):
  `npm install --no-package-lock` → `npm run build` → publishes `dist/` to the
  `gh-pages` branch with `peaceiris/actions-gh-pages`. **No lint, no tests.**
- So **every push to any branch replaces the live site**, including pushes of
  feature branches. Treat `git push` as a production deploy.
- `.github/workflows/ci.yml` (lint + unit + e2e) runs on pull requests only.
- `vite.config.ts` uses `base: './'` so the build works under `/WYSIWYC/`.
- No secrets are involved: users paste their own API key in the browser.
- CLAUDE.md: **don't modify `.github/workflows/` without asking.** If the user wants
  deploys gated on tests or limited to `main`, propose the YAML change and wait for a yes.

## Steps

1. **Confirm intent.** State which branch will be pushed and that it will replace the
   live site. Get an explicit go-ahead — prior approval for a different push doesn't count.
2. **Clean tree.** `git status`: nothing uncommitted that the user didn't mean to ship;
   no `.env`, keys or `dist/` staged. Search the diff for key-shaped strings:
   `git diff origin/HEAD...HEAD | grep -nE "sk-(ant-)?[A-Za-z0-9_-]{20,}"` must print nothing.
3. **Verify:** `node .claude/skills/verify/verify.mjs --all` (lint, unit, build, e2e).
   Stop on any failure — the workflow won't catch it.
4. **Local preview of the production build:**
   `npm run preview -- --port 4173` (background), then
   `node .claude/skills/fix-design/screenshot.mjs <scratchpad>/preview.png` against it
   (or open it in Chrome) and check the app loads, with no console errors and assets
   resolving under a sub-path. Stop the preview server after.
5. **Push** (asks for permission): `git push origin <branch>`. Never force-push.
6. **Watch the run:** `gh run list --workflow=deploy.yml --branch <branch> --limit 1`, then
   `gh run watch <id> --exit-status`. On failure: `gh run view <id> --log-failed`, report,
   don't retry blindly.
7. **Smoke-test live:** load https://r4ph3rd.github.io/WYSIWYC/ (Pages can lag about a minute;
   hard-refresh). Check: the app shell renders, a sample under "Try:" loads on the canvas
   (no LLM call), no console errors. Don't paste a real API key into the live site.
8. **Report:** commit SHA deployed, run URL, live-check result.

## Rollback

`gh-pages` keeps history. To roll back, redeploy a known-good commit: check it out on a
branch and push it (that triggers the workflow) — confirm with the user first. Don't
rewrite `gh-pages` history by hand.
