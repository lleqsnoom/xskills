# Stack Adapter: JavaScript (Browser)

## Language: JavaScript

### Framework Detection

| Pattern | Framework | Route Style |
|---------|-----------|-------------|
| `from "react"` / `import React` | React | JSX, hooks |
| `from "@angular/core"` | Angular | Decorators, TypeScript required |
| `import Vue from "vue"` | Vue.js | Options/composition API |

### Thresholds (Default)

| Metric | Limit | Notes |
|--------|-------|-------|
| Max function length | 25 lines | Dynamic typing needs brevity for readability |
| Cyclomatic complexity | 6 | Lower threshold — browser code runs on user devices |
| Parameter count warning | >3 params | Excessive params in dynamic languages hurt discoverability |

### DRY Ignore Patterns

1. **`useState` hook repeated in functional components**: React pattern where each component declares its own state. While similar across components, each state variable has independent lifecycle and update logic. Not a violation unless identical state management patterns are extracted into custom hooks.

2. **Event listener registration across similar elements**: Standard DOM manipulation pattern where `element.addEventListener('click', handler)` is repeated for multiple targets. Each listener attaches to a specific element with potentially different handlers or data attributes.

3. **Component prop validation blocks**: Repeated `propTypes` or runtime type checks in components are defensive programming, not duplication. Each component validates its own contract with consumers.

4. **CSS-in-JS style objects with similar structure**: Component-scoped styles often share patterns (spacing, colors) but define unique values per component. Extract to a theme system when >30% of values are identical across components.

### Framework Overrides

#### React
- Max function length: 30 lines (hooks add structural lines)
- Additional ignore patterns: `useEffect` dependency arrays with multiple dependencies, JSX return statements spanning many lines

#### Vue
- Max function length: 25 lines (Options API methods should be concise)
- Additional ignore patterns: `data()`, `computed`, `methods` blocks in single-file components
