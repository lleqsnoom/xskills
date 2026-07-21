---
name: x-reproduce
description: Generates minimal platform-aware reproducible test cases from triage briefs — exits 1 when bug is present, exits 0 after fix applied
version: 1.0.0
author: Community
tags: [debugging, reproduction, testing, platform-specific]
user-invocable: true
---

# X-Reproduce — Platform-Aware Reproduction

**Read `.x-skills/debug/triage-brief.md` to determine platform and generate minimal reproducible test case.**

## Artifact Location

```bash
node <path-to-x-reproduce-skill>/scripts/<repro-<platform>.js> '<error description>'
```

## Workflow

1. **READ** `.x-skills/debug/triage-brief.md` for the `Platform:` field
2. **SELECT** appropriate template script based on platform:
   - `backend` → `repro-backend.js` (Node.js standalone script using built-in modules)
   - `web` → `repro-web.js` (browser console script or Puppeteer-style repro snippet)
   - `mobile` → `repro-mobile.js` (documented ADB/Logcat steps)
3. **GENERATE** `.x-skills/debug/repro-<platform>.js` with the template content customized for the specific bug pattern
4. **RUN** reproduction: exits 1 when bug is present, exits 0 after fix

## Platform Templates

### Backend (`repro-backend.js`)
Standalone Node.js script using only built-in modules. Minimal and deterministic.

```javascript
#!/usr/bin/env node
"use strict";
const errorText = process.argv[2] || "";
if (!errorText) {
  console.error("Usage: node repro-backend.js '<error description>'");
  process.exit(1);
}

// User fills in the actual server-side bug pattern here.
console.log("Backend reproduction template — customize with actual bug pattern.");
console.log("Error to reproduce:", errorText);

process.exit(1); // placeholder: replace with actual repro that triggers the bug
```

### Web (`repro-web.js`)
Browser console script or Puppeteer-style repro snippet for frontend bugs.

```javascript
#!/usr/bin/env node
// Minimal browser-console-style reproduction for web frontend bugs.
// For complex DOM interactions, wrap in Puppeteer: document.querySelector(...).innerHTML = '...';
"use strict";

const errorText = process.argv[2] || ""; // pass error description as CLI arg
if (!errorText) {
  console.error("Usage: node repro-web.js '<error description>'");
  process.exit(1);
}

// User fills in the actual buggy code pattern here.
// Template provides structure; skill instructions guide customization.
console.log("Web reproduction template — customize with actual bug pattern.");
console.log("Error to reproduce:", errorText);

// Example pattern for undefined-reference:
// (() => { const obj = undefined; console.log(obj.foo); })();

process.exit(1); // placeholder: replace with actual repro that triggers the bug
```

### Mobile (`repro-mobile.js`)
Documents ADB/Logcat steps rather than running code. For mobile, TV, gaming platforms.

```javascript
#!/usr/bin/env node
"use strict";
// Mobile reproduction: documents ADB/Logcat steps rather than running code.
const errorText = process.argv[2] || "";
if (!errorText) {
  console.error("Usage: node repro-mobile.js '<error description>'");
  process.exit(1);
}

console.log(`Mobile Reproduction Steps for: ${errorText}`);
console.log("");
console.log("1. Connect device: adb devices");
console.log("2. Clear logs: adb logcat -c");
console.log("3. Reproduce the issue on device");
console.log("4. Capture: adb logcat -d > repro-log.txt 2>&1");
console.log("5. Search for error: grep -i 'error\\|exception\\|fatal' repro-log.txt");

process.exit(1); // indicates reproduction steps documented, actual bug not in this script
```

## Constraints (MANIFESTO)

- Each script ≤300 lines (expected ~25-40 lines per template + routing helper)
- Zero npm dependencies — only `node:fs/promises`, `path`, `child_process` built-ins
- SKILL.md ≤2000 tokens of instructions
- Routing logic in SKILL.md, not script — skill reads triage brief Platform field and selects template

## Error Handling

- Unknown platform value → report error to user and ask for re-classification
- Missing error description → usage message appears, exits 1
- No `.x-skills/debug/triage-brief.md` found → generate template with placeholder text
