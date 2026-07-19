# MANIFESTO — xskills

## Why We Exist

People running local and small LLMs deserve the same agentic tooling as those with cloud access. Most AI coding tools assume GPT-4 or Claude Opus. They bloat context, ignore token budgets, and ship features that crumble on sub-70B models.

xskills exists to close that gap. **One format, all CLIs — optimized for the models people actually run.**

## Who We Serve

Primary: developers using local or small-parameter models (Qwen 14–35B, Llama 8–13B, Gemma 27B, Ornith 35B, and similar).

Secondary: anyone who wants lean, fast, context-efficient skills regardless of model size.

## Core Principles

### Simple by default
If it needs documentation to understand, it's too complex. Skills are folders with a markdown file. No YAML config files, no JSON schemas, no dependency trees. The installer is ~200 lines and uses zero dependencies.

### Fast always
Cold start matters. Users on local models already wait for inference — they shouldn't also wait for tooling. Every command responds in under 500ms. Discovery is filesystem-based, not API-call-based. Skills load only when invoked (progressive disclosure).

### Quality over quantity
We ship fewer skills but each one works end-to-end. A skill that half-works on a small model is worse than no skill at all. Every workflow is tested against the constraint of limited context windows and weaker instruction-following.

### Cross-CLI, not cross-compromise
One format (Agent Skills spec), 45+ tools. We don't maintain per-tool adapters or fork our instructions for each CLI. If a tool supports Agent Skills, it works here — unmodified.

## Design Constraints

These are non-negotiable and shape every decision:

| Constraint | Target | Rationale |
|-----------|--------|-----------|
| Zero npm dependencies | Always | Small models choke on large context; complex install chains fail silently |
| Single-file core logic | <300 lines | Easy to audit, easy to fix when a model hallucinates instructions |
| Skills self-contained | No cross-skill imports | Each skill works alone if the user only installs one |
| Context budget aware | Every skill tested at ≤4K tokens | That's what most local models effectively have after system prompt + code context |

## What We Don't Do

- **No model-specific hacks** — skills work on Qwen, Llama, Gemma, Claude, GPT. The constraint is the design, not the adapter.
- **No cloud lock-in** — everything runs locally. No API keys needed to install or use skills.
- **No "smart" features that fail silently** — if a skill can't run, it says so clearly. Small models don't recover from vague errors well.

## How We Decide

When two approaches exist:
1. Which one uses less context? → pick that one
2. Which one has fewer dependencies? → pick that one
3. Which one works on a 4K context window? → pick that one
4. If tied, which is simpler to read in source? → pick that one

## Quality Bar

A skill ships when:
- It installs and runs with `node >= 18` only (no external deps)
- Its SKILL.md instructions are clear enough for a Qwen 14B model to follow without examples
- The workflow completes end-to-end in under 30 seconds of real time
- Every script produces deterministic output (small models can't reason through randomness well)
