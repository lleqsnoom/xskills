# X-UI — Strict Rules (Machine-Readable)

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

## Component Patterns
Reference implementations (form field, button set, empty state, toast, data list) live in `references/components.md`. Copy patterns from there rather than improvising.

Reference implementations (form field, button set, empty state, toast, data list) live in `references/components.md`. Copy patterns from there rather than improvising.

## Anti-Patterns (any of these fails the run)

- Two or more elements with equal visual weight on one screen. Demote all but the primary action.
- A border, card, or icon added where a spacing gap would group the same elements.
- Secondary text smaller than 14px.
- A screen with zero primary actions, or with more than one.
- A data region missing an empty, loading, or error state.
- A custom component written from scratch when the framework's standard component (`q-table`, `MUI Table`, `Ant Table`) does the job. Use the standard component.
