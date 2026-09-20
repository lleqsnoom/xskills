# Judging a quality anchor

A quality anchor (`user-redo`, `user-handoff`, `tool-rejected`, `skill-script-silent`, `user-pushback`,
`cross-session-retry`) says *where* a session fell short of what the user expected. It never says *why*.
This file is how you find the why without inventing it.

## Six rules

1. **Start at the anchor, never at "what went wrong in this session?"** A question that open finds
   something every time, and nobody — people or models — localises a failure well in a long trace.
   Read the anchor's message, the user turns around it, and the reply the user reacted to.
2. **Ask one narrow question, and answer yes or no with a quote:** *which line of the request, or of the
   owner's `SKILL.md` or `evals/expectations.json`, did the reply before this turn not meet?* Quote the
   user's words and the line.
   If no line says it, the answer is "the skill never said it" — that is a finding too.
3. **Open what the session produced.** The export clips tool output to 600 characters. Read the file,
   the run folder artifact, or the report the user reacted to before you judge it.
4. **Surface compliance fails.** A step whose command ran, whose file exists, whose gate passed, but
   whose content is thin — the right filename with empty or generic content, a "loop" that only rewrote
   prose, coverage typed without sources — does not meet the skill.
5. **Say which model judged, and when it is the session's own family.** A model grading its own family's
   output rates it higher. The digest names the reviewer's model; say so in the gap when they match.
6. **Unvalidated until the verdicts say otherwise.** Your verdict is a lead for the morning review, not a
   score. The reviewer's ticks in `## Verdicts` are the only labels a detector is measured by.

## What to write

In `## Gaps`, the anchor gets its verdict like any signal: `- **S5 (high, kept)** — why`.
In `## Quality`, a kept anchor gets one line the gate checks for truth:

```markdown
- **S5** — user: "Do another full round for that analysis … read internet sources, again check the article" — skill: `skills/x-research/references/research-first.md:9` "Fetch official docs and prior art. Cite the URL. Prefer primary sources."
```

- The user's (or the trace's) quote must appear in the transcript — `check-reflection.mjs --transcript`
  fails the line otherwise.
- The `file:line` must exist, and the quote after it must be within three lines of it. When the skill
  never said it, cite the section where it should go and quote its heading.
- A proposal that answers a quality anchor adds **`Watch:`** — the skill, the model, the rate that
  should drop, and the window: `**Watch:** x-research user-redo per session on deepseek-v4-flash, next
  14 days`.

## Codebook

Name the mode in the gap, so the same mode across sessions is visible as one defect.

| Mode | The answer to the narrow question | Usual class |
|------|-----------------------------------|-------------|
| rule not applied | a line in the request or the skill said it; the reply did not do it | `rule-not-applied` |
| intent misread | the reply is valid, but not what was asked | `missing-expectation` |
| overclaim | the reply says "done", "verified", "deep" beyond what the trace shows | `unbacked-report` |
| shallow or premature | the request asked for depth; the work stopped at a first draft | `depth-floor` |
| no verification | the skill's own check, or the tests, never ran after the last change | `missing-gate` |
| input unused | a file or URL the user named was never read, or its failure was buried | `unbacked-report` |
| ritual over outcome | a skill step the situation did not need, refused or interrupted | `ritual-cost` |
| silent success | a skill script exited 0 and said nothing | `silent-success` |

## Two real examples

- **Research that read abstracts only.** A user asked for "deep research … online sources … multiple
  loops"; the run fetched six abstract pages, recorded coverage 0.2 → 1.0 in two minutes and reported
  "Deep research complete … verified trail". The user answered "Do another full round … read internet
  sources, again check the article", then asked for the work as a prompt "so i can pass it to another
  agent". Modes: shallow, overclaim, surface compliance. Fixed in x-research by cited coverage, a depth
  rule and a report with evidence.
- **A confirmation nobody needed.** A user handed an 87-line written prompt to x-analyze; its first step
  asked "Is this restatement of what you want correct?" as a panel. The user refused the panel and ended
  the session. Mode: ritual over outcome. Fixed in x-analyze: a written brief is its own confirmation.
