---
name: design-system
description: The WYSIWYC app-chrome design system (tokens, primitives, amber AI accent, type scale, a11y rules). Use before creating or restyling any component in src/ui/ — panels, toolbars, popovers, dialogs, buttons — and when auditing UI consistency. Not for the user-generated canvas rendered by src/render/.
---

# WYSIWYC design system

## Two surfaces, two rule sets — check which one you are touching

| Surface | Files | Rules |
|---|---|---|
| **App chrome** (the editor itself) | `src/ui/**`, `src/index.css`, `index.html` Tailwind config | This skill applies. |
| **Canvas content** (the UI the user is designing) | `src/render/**`, IR `tailwind`/`style` fields, `src/ir/uiPalette.ts`, `src/ir/wireframe.ts`, `src/ir/samples.ts` | This skill does **not** apply. Colours, fonts and radii there come from the user's prompt or the sample's own design system. Never "fix" canvas output to slate/amber. |

## Tokens

Defined once, in two places that must stay in sync:

- `src/index.css` `:root` — shadcn-style HSL triplets: `--background`, `--foreground`,
  `--border`, `--input`, `--ring`, `--primary(-foreground)`, `--secondary`, `--muted`,
  `--accent`, `--destructive`, `--popover`, `--radius: 0.5rem`, plus `--workbench-bg`
  and `--ai-accent` (amber-500 as `R G B`).
- `index.html` `tailwind.config` — maps those variables to utilities
  (`bg-primary`, `text-muted-foreground`, `border-input`, `ring-ring`…).
  Tailwind runs from the **Play CDN at runtime**, so a new token needs both the CSS
  variable and the config entry; there is no `tailwind.config.js`.
- `src/ui/tokens.ts` — the AI accent for JS (`AI_ACCENT`, `AI_ACCENT_FILL`,
  `AI_ACCENT_TEXT`, `AI_ACCENT_ON`, `ANNOTATION_INK`) and Tailwind bundles `AI.fill`,
  `AI.focus`, `AI.tint`, `AI.chip`, `AI.fieldFocus`.

## Colour rules

1. **Neutral chrome is slate.** Text: `text-slate-900` (titles) › `700` (body) ›
   `500` (secondary, the most used) › `400` (placeholders, disabled hints).
   Surfaces: `bg-white`, `bg-slate-50`, `bg-slate-100`; borders `border-slate-200`
   (default) / `border-slate-100` (dividers). Don't introduce `gray-`, `zinc-`, `neutral-`.
2. **Amber means "the AI / your markup", nothing else.** Use it for things the model
   reads or proposes: send/apply/accept, Composing… halo, inferred and pending
   clauses, annotations, location pins, gesture chips. Always via `AI.*` from
   `@/ui/tokens` — never hand-write `bg-amber-…` in a component. Plain selection,
   hover and navigation stay slate so the accent keeps its meaning.
3. **Never white text on amber.** Fills use `amber-950` text (`AI.fill`), tints use
   `amber-800`/`700`.
4. **Status colours:** destructive/error = `rose` (`bg-rose-50 text-rose-600 border-rose-200`)
   or the `destructive` token in primitives. `indigo` is reserved for the existing
   study/analysis views; don't spread it into editor chrome.
5. **No raw hex in className or JSX** except SVG attributes / canvas drawing, and
   then import the constant from `tokens.ts` instead of repeating the literal.

## Type, radius, elevation (compact editor scale)

- Text: `text-[11px]` default panel text, `text-[10px]` labels/meta, `text-xs` (12px)
  controls, `text-sm` dialog body and primary inputs, `text-[9px]` only for
  badges/counters. Don't go below 9px. Avoid adding new arbitrary sizes
  (`text-[10.5px]`, `text-[13px]`): pick the nearest existing step.
- Radius: `rounded-md` controls, `rounded-lg` cards/panels, `rounded-xl` dialogs and
  floating toolbars, `rounded-full` pills/avatars/dots.
- Elevation: `shadow-sm` resting cards, `shadow-md`/`shadow-lg` popovers and floating
  bars only. Borders do most of the separation work.
- Spacing on a 4px grid (`gap-1/1.5/2/3`, `p-2/3/4`). Panel headers `px-3 py-2`.
- Icons: `lucide-react`, `h-3.5 w-3.5` in dense rows, `h-4 w-4` in buttons.

## Primitives — reuse before building

`src/ui/primitives/`: `button.tsx` (cva variants `default|destructive|outline|secondary|ghost|link`,
sizes `default|sm|lg|icon`), `input.tsx`, `select.tsx`, `popover.tsx`, `dialog.tsx`,
`tooltip.tsx` (Radix), `fields.tsx` (inspector fields shared by PropertiesPanel and
ParamPopover — colour, shadow, number steppers). Compose classes with `cn()` from
`@/lib/utils`. If a third component needs the same pattern, extract it into
`primitives/` instead of copying classes.

## Accessibility (non-negotiable)

- Every icon-only button has `aria-label` (and a `Tooltip` with the same text and
  shortcut). Tests select by role + name, and CLAUDE.md bans new `data-testid`.
- Visible focus: `focus-visible:ring-2 focus-visible:ring-ring` (neutral) or `AI.focus` (accent).
- Text contrast ≥ 4.5:1: `text-slate-400` is only for placeholders/disabled, never for
  information the user needs.
- Motion respects `prefers-reduced-motion` (see `.wysiwyc-ai-halo` in `index.css`).
- Hit targets ≥ 24×24px even in dense toolbars.

## Audit

Run `node .claude/skills/design-system/audit.mjs [path…]` (defaults to `src/ui`). It
flags raw hex in classNames, off-palette neutrals, hand-written amber outside
`tokens.ts`, new arbitrary text sizes, `data-testid`, and icon-only buttons
without `aria-label`. Treat its output as leads to check by hand, not as a
verdict. Fix findings in the files you touched; list the rest for the user rather
than restyling unrelated components.
