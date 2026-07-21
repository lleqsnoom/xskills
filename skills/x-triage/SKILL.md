---
name: x-triage
description: Structured intake conversation — ask targeted questions to classify a bug's platform, type, and evidence before touching any tools. Outputs .x-skills/debug/triage-brief.md.
version: 1.0.0
author: Community
tags: [triage, classification, debugging, intake, diagnostic]
user-invocable: true
---

# X-Triage — Structured Intake & Classification

Conduct a brief conversation to classify the bug before any investigation begins. **No tool calls, no source file reads, no commands.** Only produce conversation and write the triage brief.

## Conversation Flow

Ask questions one at a time. Stop once you have enough to classify. If all fields are already inferable from the user's initial message, skip directly to writing the brief.

### 1. Platform Classification

Ask: "What platform is this on?" Classify into exactly one routing key:

| User says | Maps to |
|-----------|---------|
| browser, React, Vue, Angular, CSS, HTML, website, frontend | `web` |
| iPhone, Android, mobile app, iOS, React Native, Flutter, SwiftUI | `mobile` |
| Smart TV, Roku, Fire Stick, set-top box | `tv` |
| server, API, backend service, microservice, cron job, database | `backend` |
| game, Unity, Unreal, Godot, graphics, engine, framerate | `gaming` |

If ambiguous (e.g. "it doesn't work"), ask a clarifying question instead of guessing.

### 2. Bug Type & Symptoms

Ask: "Can you describe what happens? Any error messages or stack traces?" Extract two things:

- **Symptoms**: one-line description of observable behavior
- **Evidence Available**: classify into `stack-trace`, `logs`, `console-output`, or `device-access` (or combination)

Map symptoms to bug type:

| Symptom keywords | Bug Type |
|------------------|----------|
| crash, crashes, segfault, SIGSEGV, unhandled exception, fatal error | `crash` |
| undefined, null, NaN, "cannot read property", TypeError on access | `null-ref` |
| race condition, timing, async bug, TOCTOU, data race | `race` |
| slow, lag, 10fps, memory leak, high CPU, freezes, hangs | `perf` |
| wrong output, incorrect behavior, logic error, unexpected result | `logic` |
| timeout, network error, DNS failure, connection refused, CORS | `network` |
| visual glitch, layout shift, missing image, render issue, artifact | `rendering` |

### 3. Reproduction Status

Ask: "Does it happen every time, or only sometimes?" Classify into:

- `reliable` — happens consistently on each attempt
- `intermittent` — happens sometimes, unpredictably
- `unknown` — user hasn't tried reproducing yet or isn't sure

### 4. Write Triage Brief

When all fields are populated, write `.x-skills/debug/triage-brief.md`:

```markdown
# Triage Brief — <session-id>

**Platform:** web | mobile | tv | backend | gaming
**Bug Type:** crash | null-ref | race | perf | logic | network | rendering
**Evidence Available:** stack-trace | logs | console-output | device-access
**Symptoms:** <one-line description of what the user sees>
**Reproduction Status:** reliable | intermittent | unknown
**Additional Context:** <any other relevant info from conversation>

---
## Routing Notes
**Reproduce Template:** <template name selected by platform>
**Investigate Tools:** <tool set selected by platform>
```

Use `scripts/route.js` to look up the reproduce template and investigate tools for the classified platform. The routing table maps:

- `web` → browser-console / chrome-devtools-mcp, lighthouse, network-capture
- `mobile` → adb-logcat / react-native-debugger, xcode-instruments, android-studio-profiler
- `tv` → vendor-bridge / vendor-dev-tools
- `backend` → node-standalone / node-inspect, gdb-lldb, strace, flame-graphs
- `gaming` → engine-cli / unity-profiler, unreal-insights, renderdoc, gpu-frame-debugger

## Constraints (MANIFESTO)

1. **Intake only** — No tool calls, no source reads, no shell commands. Only conversation and brief output.
2. **No source reading** — Do not use `view`, `read_mcp_resource`, or any file-reading tool on project code during triage.
3. **One question at a time** — Ask, wait for response, then ask the next one.
4. **Stop when sufficient** — If user provides all info upfront, write brief immediately without asking redundant questions.
5. **Keep brief small** — Output must be consumable by a local model in one pass (compact markdown, no verbosity).

## Anti-Patterns to Avoid

- Guessing the platform from vague descriptions
- Asking more than 3 questions before writing the brief
- Reading source files or running tools during triage
- Writing verbose output — the brief should be scannable in under 10 seconds
