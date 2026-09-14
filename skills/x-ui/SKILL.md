---
name: x-ui
description: Design and audit app UIs to be clean, clear, and effective — framework-agnostic method (Vue/React/HTML) with component-selection, row-action, and pre-flight rules.
version: 3.0.0
author: Community
tags: [ui, html, css, usability, readability, minimalism, accessibility, frontend, design]
user-invocable: true
---

# X-UI — Design That Works

Build app interfaces (tools, forms, dashboards-lite, internal apps) that a human reads at a glance and uses without thinking. Every rule below is a hard instruction: apply it, then verify it with the check listed under it.

**Scope:** any web UI, in plain HTML/CSS or any component framework (Vue/Quasar, React/MUI/Ant, Svelte, etc.). Rules apply to templates, components, and styles equally. Generic component names below (`table`, `select`, `button`) mean "use your framework's equivalent": `q-table`, `MUI DataGrid`, `Ant Table`, etc. **Out of scope:** marketing landing pages, print, native mobile.

## Apply to Existing UI (Audit & Rewrite)

Most work is improving bad existing UI, not greenfield. Do not rebuild from scratch; transform what is there.

1. **Audit.** List what is wrong in concrete terms, tied to a rule: "payments rendered as flat text rows instead of a table (violates Component Selection: 6+ comparative rows → table)". No vague "looks dated".
2. **Decide the fix.** For each finding, pick the replacement from the Strict Rules section (component, count limit, structure).
3. **Rewrite the smallest surface.** Change the template + styles of the target component only. Preserve data, logic, i18n keys, and event handlers exactly.
4. **Verify in the running app.** Load the page, confirm each finding is resolved, and confirm no behavior regressed.

The highest-yield fixes, in order of impact: item list → table → fix per-row action noise → hide irrelevant actions → de-emphasize technical IDs → component states (empty/loading/error).

## The Method (5 steps)

1. **Name the task.** State the single primary task of the screen. Every element either serves it or is removed.
2. **Wireframe in grayscale.** Lay out structure, spacing, and hierarchy with no color. If it does not read in grayscale, it will not read in color.
3. **Apply color.** One accent, 2-3 neutrals, never pure black on pure white.
4. **Add states.** Every interactive element gets default, hover, focus, disabled, and every data region gets empty/loading/error.
5. **Run the pre-flight checklist.** All items must pass.

---

## Principle 1 — One loud thing

Every screen has exactly one primary action. Give it the most visual weight on the screen (solid background + bold text). No other element may have equal weight.

**Technique:**
- Hierarchy is built from three levers: size, weight, color. Use one or two on most elements; use all three only on the primary action.
- Primary = solid, high-contrast background. Secondary = outline or muted background. Tertiary = text link.
- Secondary content is de-emphasized by *muting* (lighter weight, grayer color), not by shrinking below readable size.

**Check:** list every element with a solid/accent background or bold (600+) text. There must be exactly one. If more than one, restyle the others to outline or text style.

## Principle 2 — Group by space, not chrome

Place related elements close together and unrelated elements far apart. Group with spacing; do not add a border or box unless the rows must be separated by a line.

**Technique:**
- Gap *within* a group < gap *between* groups. Use a fixed spacing scale: 4, 8, 12, 16, 24, 32, 48, 64. No other values.
- Before adding a border, try: more space, a background tint, or a shadow. Hairlines are for separating list rows, not for wrapping cards.
- One alignment edge. Left-align text and forms; never center body text or justify it.
- Fixed type scale: 12, 14, 16, 18, 20, 24, 30. Body 16, secondary 14, page title 24-30. Headings roughly 2x body, not 10-20% larger.

**Check:** every text block and control shares one left edge (same `padding-left` / grid column). Each label's gap to its own input is smaller than the gap to the next field.

## Principle 3 — Design in grayscale, add color last

Do not add color until layout and hierarchy are finished. Verify the hierarchy is still readable with all color removed.

**Technique:**
- Neutrals: near-white background, near-black text (`#111` to `#333`), one mid gray for secondary text. Never pure `#000` on `#FFF`.
- One accent, used only where the user can act: primary button, links, focus ring, active state. Saturation below 80%.
- Text hierarchy via color: dark for primary content, gray for secondary. Two or three text colors total.
- Contrast: 4.5:1 body text, 3:1 for text 18px+. Color is never the only signal; pair status with text or icon.

**Check:** temporarily set `filter: grayscale(1)` on the page root. If the primary action is no longer distinguishable, increase its weight or spacing instead of changing color.

## Principle 4 — De-emphasize to emphasize

To emphasize an element, mute the elements around it (grayer color, lighter weight). Do not enlarge the emphasized element beyond the type scale.

**Technique:**
- Labels are a last resort, and when present they are smaller and lighter than the value they describe. A metric reads `$42,300` large with "vs last month" small and gray, never the reverse.
- Muted text is lighter or grayer, never smaller than 14px.
- Secondary actions are visually quieter than the primary; destructive actions are only red when destruction *is* the primary action (confirmation dialogs).

**Check:** for every label, ask if the value alone would be understood. If yes, drop or demote the label.

## Principle 5 — Legible by the numbers

Use the exact type values below. Do not pick font size, line height, or line length by eye.

**Technique:**
- Body text 16px, line-height 1.5, line length 45-90 characters (`max-width: 65ch`).
- Numbers that will be compared use `font-variant-numeric: tabular-nums`.
- Real typographic characters: curly quotes, the ellipsis character `…` (never three dots), non-breaking spaces in glued terms (`10&nbsp;MB`, `⌘&nbsp;K`).
- One font family + one monospace for data/code. System stack is acceptable.
- Mobile inputs at least 16px font-size (prevents iOS zoom-on-focus).

**Check:** every font-size is on the type scale; every measure is 45-90ch; no straight quotes or `...` in visible text.

## Principle 6 — Self-explanatory and honest

Every data region and control must show three states: pending/loading, error, and empty-with-next-step. A screen missing any of these is incomplete.

**Technique:**
- Feedback: every action is acknowledged within 400ms. Anything slower shows progress ("Saving...", a spinner that keeps the button label).
- Empty states are a first screen for new users: say what belongs here and offer a primary action ("No invoices yet. Create your first one."). Hide UI that has no function until content exists.
- Errors: inline next to the field, in plain language, stating what happened and what to do ("Enter a valid email address"). Never a bare code, never only a red border.
- Links render as `<a>`, buttons as `<button>`, never `<div onclick>`. Style buttons with a visible background or border.
- Forms: label above every input, placeholder is an example not a label, input width matches content (email ~400px, city ~200px, ZIP ~100px), one column.
- Focus: visible `:focus-visible` ring on every control. Never `outline: none` without a replacement.
- Hit targets at least 44px on mobile, 24px minimum elsewhere.
- Motion: only `transform` and `opacity`, under 300ms, wrapped in `@media (prefers-reduced-motion: no-preference)`. No `transition: all`.

**Check:** tab through the page. Every control shows a visible focus ring in order. Trigger every loading, error, and empty state; each must contain text that says what happened and what to do next.

---

## Strict Rules (Machine-Readable)

Deterministic thresholds — element-count limits, importance order, component selection,
row actions, ID display, status, pagination, nesting, and comparison rules — are the hard
limits a screen is checked against. They live in `references/rules.md`; consult them before
applying the method above and when running the Pre-Flight Checklist.

---

## Pre-Flight Checklist

Run every item. The screen is not done until all pass.

- [ ] Primary task stated, and every element serves it?
- [ ] Exactly one element with a solid/accent background or bold (600+) text per view?
- [ ] Hierarchy still readable with `filter: grayscale(1)` on the page root?
- [ ] One accent color, 2-3 neutrals, no pure black on pure white?
- [ ] Spacing values all on the 4/8/12/16/24/32/48/64 scale?
- [ ] Font sizes all on the 12/14/16/18/20/24/30 scale?
- [ ] Body text 16px, line-height 1.5, measure 45-90ch?
- [ ] Grouping done by proximity, not boxes; gap within group < gap between groups?
- [ ] One alignment edge; no centered body text, no justified text?
- [ ] Labels de-emphasized vs values (or removed)?
- [ ] Curly quotes, real ellipsis, tabular-nums on numbers, non-breaking spaces in glued terms?
- [ ] Every control has default, hover, focus-visible, disabled states?
- [ ] Every data region has empty, loading, and error states?
- [ ] Errors inline, plain language, "what happened + what to do"?
- [ ] Every action acknowledged within 400ms (or shows progress)?
- [ ] Links are `<a>`, buttons are `<button>`, no `<div onclick>`?
- [ ] Focus ring visible on every control when tabbing?
- [ ] Hit targets 44px mobile / 24px desktop?
- [ ] Mobile inputs 16px font-size?
- [ ] Motion under 300ms, transform/opacity only, reduced-motion respected?
- [ ] Works keyboard-only and at 320px width?
- [ ] Comparative data rendered as a table, not stacked text rows?
- [ ] Max 2 visible actions per row; irrelevant actions hidden by state?
- [ ] No icon-only buttons except universally obvious glyphs (check/X)?
- [ ] Technical IDs truncated and de-emphasized?
- [ ] Status shown as text badge, color never the only signal?
- [ ] Pagination shows total count and current range?

## Component Patterns & Anti-Patterns
See `references/rules.md` for the component-pattern pointers and the Anti-Patterns list (any of which fails the run).
