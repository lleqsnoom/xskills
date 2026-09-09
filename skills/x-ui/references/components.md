# X-UI Component Patterns

Reference implementations. Plain HTML/CSS, no dependencies. Adjust tokens to the app's foundation (spacing/type scale, accent color) but keep the structure.

## Tokens (baseline)

```css
:root {
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-6: 24px; --space-8: 32px; --space-12: 48px; --space-16: 64px;
  --text-xs: 12px; --text-sm: 14px; --text-base: 16px; --text-lg: 18px; --text-xl: 24px; --text-2xl: 30px;
  --bg: #FAFAFA; --surface: #FFFFFF; --text: #222222; --text-muted: #555555;
  --line: #E5E5E5; --accent: #1F6C9F; --accent-text: #FFFFFF; --danger: #9F2F2D;
  --radius: 4px;
}
```

## Form Field

```html
<div class="field">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" placeholder="name@company.com" aria-describedby="email-error" required>
  <p class="field-error" id="email-error" hidden>Enter a valid email address.</p>
</div>
```

```css
.field { display: flex; flex-direction: column; gap: var(--space-1); max-width: 400px; }
.field label { font-size: var(--text-sm); font-weight: 600; color: var(--text); }
.field input {
  font-size: var(--text-base); padding: var(--space-2) var(--space-3);
  border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); color: var(--text);
}
.field input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-color: var(--accent); }
.field input:disabled { opacity: 0.5; cursor: not-allowed; }
.field-error { font-size: var(--text-sm); color: var(--danger); margin: 0; }
```

## Button Set (one primary per view)

```html
<div class="actions">
  <button type="submit" class="btn btn-primary">Save invoice</button>
  <button type="button" class="btn btn-secondary">Preview</button>
  <button type="button" class="btn btn-text">Cancel</button>
</div>
```

```css
.actions { display: flex; gap: var(--space-3); align-items: center; }
.btn { font-size: var(--text-base); padding: var(--space-2) var(--space-4); border-radius: var(--radius); cursor: pointer; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: var(--accent); color: var(--accent-text); border: 1px solid var(--accent); }
.btn-primary:hover:not(:disabled) { filter: brightness(0.92); }
.btn-secondary { background: var(--surface); color: var(--text); border: 1px solid var(--line); }
.btn-secondary:hover:not(:disabled) { background: var(--bg); }
.btn-text { background: none; border: none; color: var(--accent); padding: var(--space-2); }
.btn-text:hover { text-decoration: underline; }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```

## Empty State

```html
<div class="empty" role="status">
  <p class="empty-title">No invoices yet</p>
  <p class="empty-body">Invoices you create will appear here.</p>
  <button type="button" class="btn btn-primary">Create your first invoice</button>
</div>
```

```css
.empty { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); padding: var(--space-12) var(--space-4); }
.empty-title { font-size: var(--text-lg); font-weight: 600; margin: 0; }
.empty-body { font-size: var(--text-base); color: var(--text-muted); margin: 0 0 var(--space-2); }
```

## Toast (feedback, no alert())

```html
<div class="toast" role="status" aria-live="polite">Invoice INV-0042 saved</div>
```

```css
.toast {
  position: fixed; bottom: var(--space-4); left: 50%; transform: translateX(-50%);
  background: var(--text); color: var(--bg); font-size: var(--text-sm);
  padding: var(--space-2) var(--space-4); border-radius: var(--radius);
}
@media (prefers-reduced-motion: no-preference) {
  .toast { transition: opacity 200ms cubic-bezier(0.2, 0, 0, 1); }
  .toast[hidden] { opacity: 0; }
}
```

## Data List (hairlines, not cards)

```html
<ul class="rows">
  <li><span>INV-0042</span><span class="muted">Acme Logistics</span><span>1,240.00</span></li>
  <li><span>INV-0041</span><span class="muted">Nordic Supply AB</span><span>860.50</span></li>
</ul>
```

```css
.rows { list-style: none; margin: 0; padding: 0; max-width: 65ch; }
.rows li { display: flex; justify-content: space-between; gap: var(--space-4); padding: var(--space-3) 0; border-bottom: 1px solid var(--line); font-size: var(--text-base); }
.rows .muted { color: var(--text-muted); font-size: var(--text-sm); }
```
