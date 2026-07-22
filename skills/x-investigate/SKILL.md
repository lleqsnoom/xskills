---
name: x-investigate
description: Hypothesis-driven root cause analysis — generate ranked hypotheses from evidence, test systematically with platform tools and git history, eliminate candidates until one root cause remains, output fix plan for x-fix
version: 1.0.0
author: Community
tags: [debugging, root-cause, hypothesis-testing, git-bisect, triage]
user-invocable: true
---

# X-Investigate — Hypothesis-Driven Root Cause Analysis

Systematically test hypotheses using the right tools for your platform and git history. Find the real root cause instead of guessing.

## Prerequisites

These files must exist from prior steps in the debugging pipeline:

- `.x-skills/debug/triage-brief.md` — produced by `x-triage`. Contains Platform + Bug Type + Symptoms + Evidence fields.
- `.x-skills/debug/repro-<platform>.js` — produced by `x-reproduce` or `x-debug`. The reproduction script that triggers the bug locally.

If either file is missing, stop and ask the user to run `x-triage` / `x-reproduce` first. Do not proceed without them.

## Workflow (5 Steps)

### 0. Read Input Context

Read `.x-skills/debug/triage-brief.md` to extract:
- **Platform** — determines which investigation tools to use
- **Bug Type** — guides hypothesis categories
- **Evidence Available** — stack-trace, logs, console-output, device-access
- **Symptoms** — one-line observable behavior

### 1. Generate Ranked Hypotheses

Run `hypothesize.js` with the error text from triage evidence to get a ranked list:

```bash
node <path-to>/scripts/hypothesize.js --error "<error text>" [--context .]
```

The script outputs JSON array of `{rank, id, description, test, likelihood}`. If no patterns match, proceed with manual hypothesis generation based on code context and stack traces — do not abort.

### 2. Narrow with Git History

Use git commands to find when the bug was introduced:

| Command | When to Use |
|---------|-------------|
| `git log --oneline -20` | Recent changes near symptoms timeframe |
| `git blame <file>:<line>` | Who changed this specific line and when |
| `git bisect start; git bisect bad HEAD; git bisect good <known-good-commit>` | "It worked yesterday" — binary search for introducing commit |
| `git diff <commit1> <commit2>` | See what changed between two points |

If the repo has no commits (fresh init), note this limitation and proceed with other investigation methods.

### 3. Route Investigation Tools by Platform

Read the triage brief's **Platform** field and use corresponding tools from `scripts/route.js`:

| Platform | Tools (from triage brief) | Concrete Actions |
|----------|---------------------------|-----------------|
| Web | chrome-devtools-mcp, lighthouse, network-capture | Use `mcp_chrome_devtools_*` tools: `evaluate_script`, `take_snapshot`, `list_network_requests`, `get_console_messages` |
| Backend | node-inspect, gdb-lldb, strace, flame-graphs | Run `node --inspect repro-*.js`, attach GDB/strace to running process |
| Mobile | react-native-debugger, xcode-instruments, android-studio-profiler | Use adb logcat, Xcode Instruments, React Native Debugger |
| TV | vendor-dev-tools | Vendor-specific debugging bridge |
| Gaming | unity-profiler, unreal-insights, renderdoc, gpu-frame-debugger | Unity Profiler, Unreal Insights (`unrealcommandline -profiler`), RenderDoc |

### 4. Test Each Hypothesis Systematically

For each ranked hypothesis:
1. Run the designed isolation test from `hypothesize.js` output
2. Observe results against the reproduction script behavior
3. Mark `[x] Confirmed` or `[ ] Rejected` in `.x-skills/review/debug-<session>.md`
4. Eliminate candidates until exactly one root cause remains

If a hypothesis cannot be tested without additional information, mark it as `[ ] Not testable — requires: <what's needed>` and continue to next.

### 5. Write Fix Plan for x-fix

Produce `.x-skills/review/debug-<session>.md` in this exact format (compatible with `x-fix` parser):

```markdown
# Debug Fix Plan — <session-id>

## Root Cause
<one-sentence description of the confirmed root cause>

## Evidence
- <what led to this conclusion, referencing tested hypotheses>

## Fix Instructions
### File: <path-to-file>
**Issue:** <description of the bug in this file>
**Location:** <line numbers or function name>
**Fix:** <specific change needed — code diff or clear description>

---
## Hypothesis Log
- [x] Confirmed: <hypothesis 1> — test result: <evidence>
- [ ] Rejected: <hypothesis 2> — test result: <why it was eliminated>
```

The `Fix Instructions` section must target **exactly one root cause** with a specific file, location, and change. Never produce ambiguous or multi-file fixes.

## Constraints (MANIFESTO)

1. **Never applies fixes** — uses `edit` only for writing session docs and fix plans. Source files are never modified by this skill.
2. **Never masks errors** — do not run the reproduction script with modifications that could suppress the original error. Test hypotheses without hiding symptoms.
3. **Every hypothesis must be tested or explicitly noted** — no skipped candidates. If untestable, document what's needed and continue.
4. **One root cause per plan** — the fix plan targets a single confirmed root cause with one file location.
5. **Preserve downstream format** — the fix plan MUST conform to x-fix parser expectations. Do not deviate from the documented output structure.

## Anti-Patterns to Avoid

- Skipping hypothesis testing because "it seems obvious"
- Applying fixes inline instead of writing a fix plan for x-fix
- Using web DevTools for backend issues or vice versa — route by platform
- Generating hypotheses without evidence (stack traces, logs, reproduction results)
- Accepting the first plausible cause without systematic elimination
