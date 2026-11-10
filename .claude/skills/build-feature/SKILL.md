---
name: build-feature
description: Orchestrate the multi-agent pipeline (architect → builders → test-engineer → reviewer → verify) for a feature, refactor or multi-area bug fix. Use when a task touches more than one area of the code or more than ~3 files, or when the user asks to "plan and build". Skip it for small, single-area changes.
---

# Build a feature with the agent team

Subagents can't spawn subagents, so **you (the main session) are the dispatcher**. The
architect plans and writes the briefs; you hand each brief to the right agent, verbatim,
and relay results between them.

## 1. Plan — `architect` (Opus)
Call the `architect` agent with the user's request, any screenshots/paths they gave,
and constraints from the conversation. It returns a plan + work packages (WPs).
- If the plan says an invariant must break, or scope is unclear, ask the user before building.
- For large or risky plans, show the user the plan summary and get a go-ahead.

## 2. Build — dispatch the WPs
For each WP, call the agent it names with a prompt made of:
1. the WP block verbatim (files, context, task, acceptance),
2. outputs from WPs it depends on (new signatures, store action names, accessible names),
3. "Only edit the listed files. Report back in the format your instructions define."

Launch WPs marked parallel in **one message** (several Agent calls); run dependent WPs
after their inputs return. Routing:

| Work | Agent | Model |
|---|---|---|
| IR / annot / LLM / store / study / server / scripts | `backend-builder` | Sonnet |
| Components, render, layout, state wiring | `ui-builder` | Sonnet |
| One/two-file copy, classes, aria-labels, icons | `ui-tweaker` | Haiku |

If `ui-tweaker` replies `ESCALATE`, resend the WP to `ui-builder`. If a builder reports
it needs a file outside its WP, decide (or ask the architect) — don't let it sprawl.

## 3. Test — `test-engineer` (Sonnet)
Give it the WPs' acceptance criteria and the builders' reports (changed APIs, accessible
names). If it reports a production bug, send that finding back to the builder that owns
the file, then re-run the test-engineer on the failing tests only.

## 4. Review — `reviewer` (Opus)
Run on the full diff. For each confirmed finding, route the fix to the owning builder
(or fix trivial ones yourself). Re-review only if the fixes were non-trivial.

## 5. Verify and report
`node .claude/skills/verify/verify.mjs --all` (or the flags the plan names). Report to the
user: what was built (per WP, one line), tests added, reviewer findings and what
happened to each, the verify table verbatim, and anything left open. Don't commit or
push unless asked.

## Cost discipline
- Each agent starts cold: the brief must carry the context. Don't make builders re-explore.
- A one-area change doesn't need the architect; a one-line fix doesn't need any agent.
- Don't re-run Opus agents to double-check Sonnet work unless the reviewer found real issues.
