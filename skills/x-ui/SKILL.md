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

Deterministic thresholds. When a rule says a number, that number is a hard limit, not a guideline.

### Element Count Limits

| Rule | Limit |
|---|---|
| Primary actions per view | exactly 1 |
| Buttons in one row | max 3 (1 primary + 1 secondary + 1 tertiary text) |
| Navigation items | max 7 |
| Form fields per screen | max 7 (more → split into steps) |
| Text colors | max 3 (1 dark + 1 mid gray + 1 light gray) |
| Accent colors | exactly 1 |
| Font families | max 2 (1 text + 1 mono) |
| Type sizes per view | max 3 |
| Heading levels per view | max 2 |
| Nested container depth | max 3 (page > section > group) |
| Cards inside cards | 0 (never nest a card in a card) |
| Modals stacked on modals | 0 |

### Importance Order (how to compare elements)

Assign every element a level; higher level is visually louder. Two elements at the same level must look equal.

| Level | Element | Treatment |
|---|---|---|
| 1 | Primary action | solid accent background, bold, largest control |
| 2 | Page title | largest text (24-30px), weight 600-700 |
| 3 | Primary content / values | 16px, dark text, normal weight |
| 4 | Secondary actions | outline button or text link |
| 5 | Labels, meta, captions | 14px, gray, weight 400 |
| 6 | Navigation, footer, chrome | quietest, never louder than content |

To compare two elements: the higher level wins on size, weight, or color. If you cannot say which level an element is, it is level 3.

### Component Selection (when to use what)

| Situation | Component |
|---|---|
| 1-5 items, no comparison | inline list or chips |
| 6-20 items, compare columns | table |
| 21+ items | table + pagination (or virtualized list) |
| Comparing numbers across rows | table, numbers right-aligned, `tabular-nums` |
| Single choice among 2-5 | radio group |
| Single choice among 6+ | `<select>` |
| Multi-select among 2-7 | checkbox group |
| Multi-select among 8+ | searchable multi-select |
| Navigation 2-7 items | top nav |
| Navigation 8+ items | grouped menu or hamburger |
| 2-6 related views | tabs |
| 7+ related views | `<select>` or secondary nav |
| Form with 1-5 fields, quick task | modal |
| Form with 6+ fields or complex task | separate page |
| 3+ secondary content blocks | accordion (only if content is secondary) |
| Long form, one task | one column, steps if >7 fields |
| Data with 2+ columns of comparable values | table (never a stacked list of text rows) |
| 1-2 actions per row, always visible | inline icon or text button |
| 3+ actions per row | one visible action + a row menu ("…") |

### Row Action Rules

- An action that does not apply to a record's state must not render. Do not show "generate link" on a paid or cancelled record.
- Max 2 visible actions per row. A third action moves to a row menu.
- Icon-only buttons are allowed only for these glyphs: check, X, three-dot menu, trash, edit pencil. Any other icon must have a visible text label next to it. A `title` tooltip does not count as a label.
- Destructive actions (cancel, delete, remove) use an outline or text style. Style a destructive action as a filled red button only when the whole screen is a confirmation dialog.

### Technical ID Display

- Internal identifiers (UUIDs, payment references, record IDs) are not content. Render them truncated with a reveal-on-click ("PAY-4D2…" → full on click), in monospace, small (12px), and gray. Never as the first or loudest column.

### Status Display

- Status is a small badge: colored background + the text label in the same color. Color is never the only signal; the label text is always present.
- Use one badge style for all statuses; vary only color. No icon-only status dots.

### Pagination Rules

- Page sizes: 10, 25, 50, 100. Default 25 for tables, 10 for dense rows.
- Show a page-size selector only when total > 50.
- Always show: total count, current range ("1-25 of 128"), Previous, Next.
- Page numbers: show all when ≤ 7 pages; show first, last, current ±1, and ellipsis when > 7.
- First/Last buttons only when > 5 pages.
- Page state lives in the URL (query param); Back/Forward restores it.
- Never infinite scroll for data entry or search results. Infinite scroll only for chronological feeds.

### Nesting Rules

- A card contains at most one level of inner groups; deeper structure moves to a new section or page.
- A modal contains at most one form; a modal never opens another modal.
- A tab panel contains at most one scroll region; nested tabs are forbidden.
- Lists inside list items are forbidden (use a detail view or expandable row instead).

### Comparison Rules

- Numbers that will be compared are right-aligned and use `font-variant-numeric: tabular-nums`.
- Compare in one unit per column; never mix units in a column.
- A delta or trend is always shown relative to a stated baseline ("vs last month"), never a bare percentage.

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

## Component Patterns
Reference implementations (form field, button set, empty state, toast, data list) live in `references/components.md`. Copy patterns from there rather than improvising.

## Anti-Patterns (any of these fails the run)

- Two or more elements with equal visual weight on one screen. Demote all but the primary action.
- A border, card, or icon added where a spacing gap would group the same elements.
- Secondary text smaller than 14px.
- A screen with zero primary actions, or with more than one.
- A data region missing an empty, loading, or error state.
- A custom component written from scratch when the framework's standard component (`q-table`, `MUI Table`, `Ant Table`) does the job. Use the standard component.
