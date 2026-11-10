---
name: e2e-test
description: Write, run or debug Playwright end-to-end tests in e2e/ for WYSIWYC, with LLM responses mocked at the network layer. Use when adding a user-facing feature or fixing a UI bug that a unit test can't cover (prompt → canvas, clause editing, gestures, drag/drop, dialogs), or when an e2e test fails.
---

# E2E tests (Playwright)

Setup lives in `playwright.config.ts`: Chromium only, `baseURL` `http://localhost:5173`,
Playwright starts `npm run dev` itself (reuses a running server locally), 1 retry and
a trace on retry in CI. Specs go in `e2e/*.spec.ts`; `e2e/prompt-to-ui.spec.ts` is the
reference.

## Hard rules

- **No real LLM calls** (CLAUDE.md). The browser calls providers directly, so every
  test that reaches a model must `page.route()` the provider URL and return a fixed body.
  An unmocked call fails anyway because the key is fake — make that explicit with a
  catch-all that aborts unknown provider hosts.
- **Select by role, label, placeholder or text**, not CSS or `data-testid` (banned in
  prod code unless there is no alternative). If an element has no accessible name, add
  one to the component (`aria-label`) — that is a real a11y fix, not a test hack.
- **Wait on UI state, never on time.** `await expect(locator).toBeVisible()`, not
  `waitForTimeout`.
- Each test is independent: state is in `localStorage`, set it with `addInitScript`.

## Fake connection + mocked model

Settings key: `wysiwyc.settings.v1` (`src/store/settingsStore.ts`).
Response shapes are what `src/llm/providers.ts` parses:

```ts
import { test, expect, type Page } from '@playwright/test';

async function connect(page: Page, provider: 'anthropic' | 'openai' = 'anthropic') {
  await page.addInitScript((p) => {
    localStorage.setItem('wysiwyc.settings.v1', JSON.stringify({
      activeProvider: p, keys: { anthropic: 'sk-test', openai: 'sk-test', mistral: '', groq: '' },
    }));
  }, provider);
}

/** Queue of model replies, served in order. Each reply is the JSON the schema expects. */
async function mockLLM(page: Page, replies: object[]) {
  const calls: unknown[] = [];
  const next = () => JSON.stringify(replies[Math.min(calls.length - 1, replies.length - 1)]);
  await page.route('https://api.anthropic.com/v1/messages', (r) => {
    calls.push(r.request().postDataJSON());
    r.fulfill({ json: { content: [{ type: 'text', text: next() }], usage: { input_tokens: 1, output_tokens: 1 } } });
  });
  await page.route('https://api.openai.com/v1/chat/completions', (r) => {
    calls.push(r.request().postDataJSON());
    r.fulfill({ json: { choices: [{ message: { content: next() } }], usage: { prompt_tokens: 1, completion_tokens: 1 } } });
  });
  await page.route(/api\.(mistral\.ai|groq\.com)/, (r) => r.abort());
  return calls; // assert on what was sent (scoped IR, selection, clauses…)
}
```

Reply fixtures must match the schemas in `src/llm/schemas.ts` (`COMPOSE_SCHEMA`,
`IR_PATCH_SCHEMA`, `PROMPT_UPDATE_SCHEMA`) and follow the IR rules: flat nodes with
`parentId`, ids `node_N` / `clause_N`. Keep them minimal — one or two nodes. If
several specs share fixtures, move `connect`/`mockLLM` into `e2e/fixtures.ts`.

Also cover the **no-LLM paths** (they're most of the product): samples under "Try:",
inline param pins, gestures, arrow moves, wireframes. For those, register `mockLLM(page, [])`
and assert `calls.length === 0` at the end — it proves the path stayed deterministic.

Error path: `r.fulfill({ status: 500, json: { error: { message: 'boom' } } })` and
assert the user-facing message.

## Running

```bash
npx playwright install chromium                     # once per machine
npx playwright test e2e/<spec>.ts --reporter=line   # one file while iterating
npx playwright test -g "<test name>" --debug        # step through
npm run e2e                                         # full suite
npx playwright show-trace test-results/**/trace.zip # after a CI-style retry
```

## Debugging a failure

1. Read the error: a locator timeout usually means the accessible name changed or the
   element is behind a popover. Check the component's current label before touching
   the test.
2. Re-run with `--trace on` and inspect, or screenshot the state with
   `await page.screenshot({ path: 'scratch.png' })` (don't commit it).
3. Flaky? Look for missing awaits, animation (`.wysiwyc-ai-halo`), or Tailwind Play CDN
   not having compiled a class yet. Fix the wait, never add retries or sleeps.
4. Never `test.skip` / `test.fixme` to get CI green.
