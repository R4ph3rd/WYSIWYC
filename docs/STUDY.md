# WYSIWYC user study kit

A within-subjects comparison of **WYSIWYC** against a **chat-only baseline**
built into the same app (same models, renderer and LLM client; canvas
read-only, no spec widgets, no back-channel). Everything the case study's §5
reports is logged automatically and computed on the analysis page.

| Route | What it is |
|---|---|
| `/study` | Participant session: setup → briefing → 4 tasks with questionnaires → preference/interview → export |
| `/analysis` | Load exports (files or Google Sheets), paired statistics, charts, Markdown/JSON export |
| `/` | The normal editor (no logging unless a study session is running) |

Run locally with `npm run dev` and open `http://localhost:5173/study`. Connect a
model in the setup screen (top right) before the first task; both conditions use
whichever model is connected, and every call is logged with provider and model.

---

## 1. Protocol

**Participants.** People who build UIs weekly with v0, Lovable, Cursor, Figma or
similar. Plan N = 8, 12 or 16 (see counterbalancing). ~60 minutes per session.

**Design.** 2 conditions × 2 tasks each = 4 blocks per participant.
Condition order and task order are counterbalanced (below).

**Session timeline**

| Step | Screen | ~min |
|---|---|---|
| 1 | Setup: participant ID, demographics, background, consent; experimenter checks the plan, time limit, Sheets URL | 5 |
| 2 | Briefing for condition A: tool tutorial (+ optional live demo by the experimenter), rules, task 1 target + criteria | 3 |
| 3 | Task 1 (timer runs; "I'm done" or time limit) → TLX + self-rated match | 12 |
| 4 | Briefing (same tool, new target) → task 2 → TLX + **SUS for condition A** | 14 |
| 5 | Briefing for condition B (new tutorial) → task 3 → TLX | 14 |
| 6 | Task 4 → TLX + **SUS for condition B** | 12 |
| 7 | Preference (3-way + 7-point strength + why) and semi-structured interview notes → **Save and export** | 7 |

SUS can also be asked after every task (setup option "After every task"); the
analysis averages whatever SUS answers exist per participant × condition.

**Rules shown to participants.** Rebuild the target as closely as reasonable
with this tool only; pixel-perfection is not required, all acceptance criteria
are; think aloud if you like; the experimenter helps with tool problems, not
with the design; click "I'm done" when satisfied (with a confirm step); the task
ends automatically at the time limit (default 10 min, set per session).

**Each block starts from a blank editor.** Sample shortcuts are hidden on
`/study`, and the "New" button is removed.

### Tasks (public/tasks/task_N.svg)

Four matched "rebuild this screen" targets. Each has ~15 visible elements, one
accent colour, one non-default layout feature and specific copy.

| Task | Target | Accent | Acceptance criteria (abridged; full list in `src/study/tasks.ts`) |
|---|---|---|---|
| task_1 | Northwind sign-in card | indigo | brand + "Northwind"; "Welcome back" + subtitle; labelled Email/Password with right-aligned "Forgot?"; checked "Remember me"; full-width "Sign in"; "or" divider, outlined Google button, footer link |
| task_2 | Monthly revenue card (dense) | emerald | title + "Last 30 days" dropdown; "$48,290" + green "▲ 12.4%" pill + comparison line; 7-day bar chart, last bar solid; three KPI rows (refund rate red); "View full report →" |
| task_3 | Acme nav bar + Projects header | sky | dark bar, 4 links with Pricing active; search, bell with red dot, "Upgrade"; title + count + "+ New project"; All/Active/Archived tabs; two project rows with "Active" pills |
| task_4 | Profile settings form | rose | heading + helper; "JD" avatar + "Change photo"; Full name / Email side by side, Bio with "0 / 160"; notifications row with toggle on; Cancel / Save changes |

The target and criteria are visible during the task (header thumbnail opens a
lightbox; "Criteria" popover). Every view is logged (`target_view`).

### Counterbalancing

`suggestAssignment(n)` in `src/study/tasks.ts`, auto-filled from the participant
number and overridable in setup (the override is recorded). Cycle of 8: odd
numbers start with WYSIWYC, even with chat-only; each row of a Williams-balanced
4×4 Latin square is used once with each order. The first two tasks of the row go
to the first condition.

| P | Order | Latin row | Block 1–2 | Block 3–4 |
|---|---|---|---|---|
| P01 | WYSIWYC first | 1 | task_1, task_2 | task_4, task_3 |
| P02 | Chat-only first | 1 | task_1, task_2 | task_4, task_3 |
| P03 | WYSIWYC first | 2 | task_2, task_3 | task_1, task_4 |
| P04 | Chat-only first | 2 | task_2, task_3 | task_1, task_4 |
| P05 | WYSIWYC first | 3 | task_3, task_4 | task_2, task_1 |
| P06 | Chat-only first | 3 | task_3, task_4 | task_2, task_1 |
| P07 | WYSIWYC first | 4 | task_4, task_1 | task_3, task_2 |
| P08 | Chat-only first | 4 | task_4, task_1 | task_3, task_2 |
| P09… | repeats from P01 | | | |

Any even N balances condition order and gives every task to each condition
equally often; a multiple of 8 also balances task position fully (N = 12 uses
rows 1–2 four times and rows 3–4 twice).

---

## 2. What is logged

Every event carries `t` = ms since the block started (active time; a crash gap
is excluded) and a wall-clock timestamp. Both conditions log through the same
code paths (`src/store/appStore.ts`, `src/llm/client.ts`); the baseline simply
cannot produce manipulation events because the store rejects them.

| Event `kind` | `subkind` / `category` | Where |
|---|---|---|
| `block_start`, `block_end` | condition; end reason `done` / `timeout` | study flow |
| `prompt_submit` | source `composer` / `annotation` / `recipe` / `spec_edit`; data: words, chars, chips, scoped | every language instruction sent to the model |
| `llm_call` | call type `compose` / `patch` / `backchannel` / `annotation` / `recipe` (full row in the call ledger) | `client.ts` |
| `compose_result` | data: assistant words (the reply a chat tool would show), clauses updated/removed, patch ops | compose |
| `manipulation` | op kind; **category** `drag` / `resize` / `draw` / `widget` / `edit` (inspector/text) / `annotation` / `gesture` / `structure` / `component` | canvas, panels, spec widgets |
| `proposal_shown` | op kind; data: `source` `backchannel` or `inference` (drawn-shape suggestion), confidence, #alternatives | |
| `proposal_resolved` | outcome `accepted` / `alternative` / `rephrased` / `dismissed` / `superseded` / `undone` / `abandoned`; latency | |
| `spec_edit` | `edit` / `alternative` / `remove`; data: `llm` true when the edit needed a model call | |
| `undo`, `version_restore` | | |
| `annotation_apply` | steps applied locally vs sent to the model | |
| `target_view`, `questionnaire`, `session_recovered`, `error` | | |

Redo does not exist in the editor, so none is logged. "Alternatives" are
generated inside the compose/back-channel responses (no separate call); the
`alternatives` call type is reserved.

## 3. Files and schema

Saved at the end of the session (always local; the Sheets copy is extra).
`P05` and the date are in every name.

| File | Rows |
|---|---|
| `wysiwyc_P05_<date>_events.csv` | one per event: `participant_id, session_id, seq, block_index, condition, task_id, t_ms, ts_iso, kind, subkind, category, data_json` |
| `wysiwyc_P05_<date>_llm_calls.csv` | one per model call: `call_id, block_index, condition, task_id, t_ms, provider, model, call_type, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, latency_ms, ok, error` |
| `wysiwyc_P05_<date>_summary.csv` | one per block (below) |
| `wysiwyc_P05_<date>_demographics.csv` | the participant's row |
| `wysiwyc_demographics_all.csv` | cumulative: every session finished in this browser |
| `wysiwyc_P05_<date>_session.json` | everything, including final spec and IR per block (for blind rating) |

`input_tokens` is the **total** input including cache reads/writes (Anthropic
reports them separately; they are added back). `cached_share = cache_read / input`.

**Summary columns** (`src/study/metrics.ts`): `duration_s, end_reason, prompts,
prompt_words, llm_calls, calls_<type>, calls_failed, input_tokens, output_tokens,
total_tokens, cache_read_tokens, cache_write_tokens, cached_share, llm_latency_s,
dm_total, dm_<category>…, proposals, prop_accepted, prop_alternative,
prop_rephrased, prop_dismissed, prop_other, single_click_share, undo_count,
version_restores, spec_words, chat_words, reprompt_cost, save_gesture,
save_widget, save_patch, save_cache, sus, tlx_raw, tlx_<subscale>…, similarity,
self_match`.

**Demographics columns**: gender (incl. self-description), age, role, years of
UI experience, LLM familiarity (1–7), weekly use of v0 / Lovable / Bolt / Cursor
/ Figma / chat LLMs, condition order, Latin row, override flag, block order,
time limit, preference, preference strength (1–7), reason, interview notes,
consent.

**Backup and recovery.** The session is written to `localStorage`
(`wysiwyc.study.backup.v2`) on every event, including the live spec and IR
during a task. Reloading `/study` offers *Resume*, *Export backup* or *Discard*.
Resuming excludes the closed time from the timer. Finished sessions are kept in
`wysiwyc.study.archive.v2` (the analysis page can load them).

## 4. Google Sheets (optional)

1. Create a Google Sheet → Extensions → Apps Script.
2. Paste [`docs/apps-script/Code.gs`](apps-script/Code.gs), save.
3. Deploy → New deployment → *Web app*; Execute as **Me**; Who has access **Anyone**. Copy the `/exec` URL.
4. Paste it in the study setup screen, or set `VITE_STUDY_SHEETS_URL=<url>` in `.env.local` to pre-fill it.

The page POSTs the whole session as JSON with `Content-Type: text/plain` (a
CORS "simple request": Apps Script cannot answer preflights). The script writes
tabs `demographics`, `summary`, `llm_calls` and one tab per participant
(`P05`, the event log). Re-sending a session replaces its rows. `doGet?action=all`
returns all tabs as JSON; the analysis page's *Fetch* button reads it.

A failed or unconfirmed upload never loses data: the local files are written
first, the done screen shows the status with *Retry*, and the backup stays in
the browser archive.

## 5. Analysis (`/analysis`)

Load any mix of session JSON, the CSVs (several at once, drag-and-drop), the
Sheets URL, or the sessions stored in this browser. Duplicates are dropped (by
session and row id). **Load demo data** generates 12 clearly-labelled synthetic
participants to preview the page; it is never mixed with real data.

**Statistics** (`src/study/analysis.ts`, `src/study/stats.ts`):

- Each participant contributes the **mean of their two tasks** per condition.
- Reported per measure: N pairs, median and IQR per condition, relative change
  of the medians (the case study's "−72%" format), median paired difference,
  how many participants improved.
- **Wilcoxon signed-rank**, two-sided, zero differences dropped; exact
  permutation p (ties handled on doubled mid-ranks) for N ≤ 30, else normal
  approximation with tie and continuity correction. Effect size `r = |Z| / √N`.
- Charts (Observable Plot): paired slope charts (prompts, time, SUS, TLX, spec
  vs chat words), tokens by task, token-savings waterfall, proposal outcomes,
  direct manipulations by kind, preference. Each has an auto-generated
  interpretation.
- **Export**: *Copy Markdown* / `stats.md` (a ready `<div class="stats">` block,
  results table and finding sentences), `stats.json`, merged summary CSV.

### How the case-study numbers map to the computed stats

| Case study (§ header / §5) | Computed as |
|---|---|
| −72% prompts to reach a target UI; "median 9 → 2.5"; "all 12 needed fewer" | `prompts` = `prompt_submit` events per block (composer, annotation and recipe sends, plus typed spec edits that needed a model call). Card = change of medians; "x/N improved" |
| −75% tokens spent per task; tokens by task | `total_tokens` = input + output of successful calls per block; per-task chart = median per task × condition |
| cached share | `cached_share` per block (table row "Cached input share") |
| −41% time to target | `duration_s` from block start to "I'm done" or timeout, minus paused time |
| −86% shorter spec; "168 vs 1,240 words" | WYSIWYC `spec_words` (final spec clauses) vs chat-only `chat_words` (user prompt words + assistant reply words of the chat transcript), paired per participant |
| Waterfall "where the 75% comes from" | see below |
| "79% accepted as-is", outcomes chart | `prop_accepted / (accepted + alternative + rephrased + dismissed)` over all WYSIWYC blocks; superseded/undone/abandoned reported separately |
| "92% resolved in a single click" | `single_click_share = (accepted + alternative) / resolved` |
| Direct manipulations | `dm_total` and `dm_<category>` |
| SUS / NASA-TLX | SUS 0–100 (standard scoring); raw TLX = mean of 6 subscales (0–100, steps of 5) |
| "11 of 12 preferred WYSIWYC" | `preference` counts (+ strength 1–7) |
| Visual similarity (next step in the case study) | optional experimenter rating (0–100) per block + final IR saved for later blind rating |

### Token savings decomposition

Per participant, one **corrective re-prompt** costs `reprompt_cost` = median
tokens of their chat-only compose calls after the first call of each block.

- `save_gesture` = (back-channel proposals + locally applied gestures) × `reprompt_cost` − back-channel tokens actually spent.
- `save_widget` = widget edits (spec widgets, zero model calls) × `reprompt_cost`.
- `save_patch` = Σ over non-first edit calls of (first full-generation output − this call's output): what regenerating the screen each time would have cost. Both conditions patch, so this is shown **outside** the comparison.
- `save_cache` = cache-read tokens × 0.9 (billed at ~10%): a **cost** reduction, also shown outside the comparison.

The waterfall starts at the median chat-only tokens per task, subtracts the
gesture and widget estimates and ends at the median WYSIWYC tokens. When the
estimates exceed the observed reduction (several hand edits often stand in for
one prompt) they are scaled to it and the text says so; otherwise the remainder
is shown as "Other / unexplained".

## 6. Pilot checklist

- [ ] Connect the model; run one task yourself in each condition.
- [ ] Set the time limit and (optionally) the Sheets URL; run one full session with a test ID (e.g. P99) and load the files on `/analysis`.
- [ ] Delete test rows from the Sheet and test sessions from the browser archive (DevTools → localStorage `wysiwyc.study.archive.v2`).
- [ ] Prepare the 2-minute live demo for each condition's tutorial.

## 7. Limits

- "Done" is self-declared; the visual similarity score is an optional
  experimenter rating, not an automatic image comparison (final IR is saved so
  a blind rating can be added later).
- The chat-only mode stands in for Lovable-style tools; it still patches the IR
  rather than regenerating files, so patch savings are not part of the
  difference.
- Token savings sources are model-based estimates (re-prompt cost), not
  measured counterfactuals.
- Small N: read the Wilcoxon results as a directional pilot.
