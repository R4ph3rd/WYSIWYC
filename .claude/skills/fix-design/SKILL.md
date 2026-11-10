---
name: fix-design
description: Fix a visual or UX problem in the WYSIWYC editor (misalignment, overflow, inconsistent colours or spacing, contrast, missing focus state, broken layout at a viewport size) with a screenshot before and after. Use when the user reports something that "looks wrong", asks to polish or restyle a panel, or shares a screenshot of a UI bug.
---

# Fix a design issue

Load the `design-system` skill first: every fix must land on its tokens and primitives.

## 1. Pin down the problem

- Identify the **surface**: app chrome (`src/ui/**`) or canvas content
  (`src/render/**`, IR-generated). Canvas output follows the user's prompt, not our
  design system; a canvas "bug" is usually in `Renderer.tsx`, `layoutFit.ts`,
  `wireframe.ts` or `uiPalette.ts`, and changes in `src/ir/` need a Vitest test
  (`ir-test` skill).
- Get the repro: which panel, which state (empty canvas, sample loaded, selection,
  popover open, study mode), which viewport. If the user gave a screenshot, read it.

## 2. Capture "before"

```bash
node .claude/skills/fix-design/screenshot.mjs <scratchpad>/before.png --size 1440x900 [--sample "Pricing card"] [--click "Connect"]
```

Put screenshots in the session scratchpad, not the repo. The script starts Vite
if needed and prints console errors. For states the script can't reach (drag,
hover, drawing), use the Claude in Chrome tools on `http://localhost:5173`
(`npm run dev` in the background), or describe the state to the user and ask for a
screenshot. Look at the image before touching code.

Check narrow widths too when the issue is layout: `--size 1024x768`.

## 3. Fix at the right level

Prefer, in order:
1. A token or primitive already in the system (`Button` variant, `AI.*` bundle,
   `fields.tsx` control) instead of new classes.
2. A shared fix in `src/ui/primitives/` when the same defect shows in several places.
3. A local class change, staying on the type/radius/spacing scale.

Don't restyle components outside the reported scope. If the audit
(`node .claude/skills/design-system/audit.mjs <files you touched>`) lists issues
elsewhere, report them, don't fix them.

Keep or add accessible names (`aria-label`, label text): e2e tests select by role
and name, so renaming a button's label can break `e2e/*.spec.ts`. Search the specs
for the old name before changing it.

## 4. Capture "after" and compare

Same command, same size, same state → `after.png`. Read both images and check:
the defect is gone, nothing nearby moved, no new console errors, focus ring visible
when tabbing to the control, contrast holds (amber surfaces keep dark text).

## 5. Verify

Run the `verify` skill (lint + unit tests, plus e2e because the UI changed). Report
to the user with the before/after paths and a one-line description of the fix.
