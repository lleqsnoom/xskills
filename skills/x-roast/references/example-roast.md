# Roast — drop-jest

A worked roast, to match tone and depth against. Its artifact is the frozen calibration case
`evals/calibration/drop-jest.md`, and a test runs the gate on this file, so it is also a report
that passes `check-report.mjs`.

**Artifact:** evals/calibration/drop-jest.md
**Reviewer:** self — claude (the family that wrote this skill)
**Profile:** article
**Total:** 18.8 / 100 — raw
**Completeness:** 100%
**Calibration:** skipped — this roast is of the only `article` case, drop-jest, itself

## Central claim
Node's built-in test runner makes a test framework unnecessary, so every Node project should drop Jest.

## Claims
| # | Claim | Kind | Backs | Source | Result |
|---|-------|------|-------|--------|--------|
| C1 | "`node:test` was added in Node 18" | external | accuracy | https://nodejs.org/api/test.html ("Added in: v18.0.0") | confirmed |
| C2 | "it has been stable since Node 18" | external | accuracy, logic | https://nodejs.org/api/test.html ("v20.0.0: The test runner is now stable.") | contradicted |
| C3 | "ran in 9 seconds with Jest and in 3 seconds with node:test" | local | accuracy, logic, evidence | no data, command or repository is given | unverified |

## Score
```json
{
  "profile": "article",
  "scores": { "accuracy": 1, "logic": 1, "evidence": 1, "originality": 2, "clarity": 4, "completeness": 2, "actionability": 3, "balance": 1 },
  "total": 18.8,
  "band": "raw",
  "completeness": 1
}
```

## Findings
- **accuracy (1/5)**: C2 is false. The runner was experimental in 18 and became stable in v20.0.0, and the conclusion rests on that claim ("so there is no reason left"), which makes it a 1 even though C1 checks out.
- **logic (1/5)**: "Every Node project should therefore drop Jest" follows from one service's timing (C3). A single anecdote is made into a rule for every project. The article never asks what Jest gives that `node:test` does not (snapshots, module mocking, watch mode).
- **evidence (1/5)**: The only number in the piece (C3) comes with no command, no hardware and no repository, and no source is cited anywhere.
- **originality (2/5)**: "Fewer dependencies mean fewer supply-chain risks" is the standard argument, restated. The one fresh input, a migration's timing, is the part left unsupported.
- **clarity (4/5)**: Three short paragraphs, each doing one job. "no other change" is undefined: the same machine? the same tests? a warm cache?
- **completeness (2/5)**: Migration cost, missing features and who should *not* switch are all absent. "We moved our API service over last month" gives no account of what broke.
- **actionability (3/5)**: The next step is stated ("drop Jest and use node:test"), but not how: no migration steps, no mapping from `expect` to `assert`.
- **balance (1/5)**: No counter-argument is raised at all. "there is no reason left" closes the question instead of weighing it.

## Creative alternatives
1. `reframe`: "When `node:test` is enough": a decision table (snapshots? module mocks? watch mode? a Node version before 20?) instead of a universal rule.
2. `addition`: A reproducible benchmark: the repository, the command, and runs on both runners with the variance, so C3 becomes a result.
3. `restructure`: Lead with the migration story, what broke and what it cost, and let the recommendation come last and be scoped to projects like that one.

## Improvement proposals
1. Correct C2 at paragraph 1 to "stable since Node 20" → raises `accuracy` 1→4
2. Publish the benchmark behind C3 (alternative 2) → raises `evidence` 1→3
3. Scope the conclusion in the last paragraph to projects that need none of snapshots, module mocks or watch mode → raises `logic` 1→3
4. Add a "When to keep Jest" section → raises `balance` 1→3 and `completeness` 2→3
5. Add a short `expect` → `assert` mapping → raises `actionability` 3→4

## How to read a roast
- Every claim is quoted from the artifact, and the gate finds the quote in it.
- A contradicted claim caps `accuracy` at 2 (at 1 when the conclusion rests on it), and an unverified one at 4.
- Every claim names in `Backs` the dimensions it bears on, and a finding's claim id counts only for those.
- Every finding cites a backing claim, a quote or a `file:line` the gate can check.
- Every report carries the `**Calibration:**` line `score.mjs --calibrate` printed, and the gate re-runs it.
- The reviewer line names the model that judged; `independent` means another model family, or a human.
- A re-roast opens with `## Since last roast`: every earlier proposal is marked closed, open or regressed, every score that rose is named on a closed line, and a rise of 2 or more shows the fix with a `file:line` or a command.
