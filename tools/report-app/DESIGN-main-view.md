# A main view for one goal: make the skills better

**Status: all four are built.** They ship as five views of the main screen (`?view=`), because one screen cannot
serve one goal from one angle. Where the implementation departs from the sketches below, the code is the
record: the findings are grouped by *file* rather than by class (the class wording drifts between runs), the
ledger's window defaults to two measured days, and the ratchet falls back to the whole window's score when the
record is too short to hold a run of days. See the "main screen is five views" section in `AGENTS.md`.

Four designs for `/`, the report's default screen. Each targets the same goal from a different
angle, and each says which screens it needs and what it costs to build.

## 0. What `/` is today, and why it does not serve the goal

The screen is a table of skills: a sparkline, the change, the axes that moved, the latest score
(`tools/report-app/src/components/Movement.tsx:8`, "did anything in use get better or worse, and by
which axis"). Beside it: `/days`, `/day/<date>`, `/todos`, `/skill/<name>`.

The panel is good at *measuring*. The goal is *improving*, and the loop that does the improving is
nowhere on screen:

```
05:00 scan ──► signal ──► proposal ──► [reader keeps it] ──► a fix lands ──► next scan
    ▲                                                                            │
    └────────── did the signal come back? did the score hold? ◄──────────────────┘
```

Nothing joins a fix to its effect. `todos.json` records intent, `history.jsonl` records scores, and
no screen asks the only question that matters after a fix: *did it work?* So the four variants below
are four answers to "what should the main view make the reader decide?"

A constraint that shapes all of them: the data on disk is already enough for most of this. Packs
(`summary.json`), the day line (`history.jsonl`), the digest's proposals (`DIGEST.md`), the kept
selection (`todos.json`), the improvement class vocabulary (`skills/x-autoreflection/references/gap-taxonomy.md`,
`doc-command-drift`, `missing-check`, `panel-rule`, …), and each proposal's `target` file path.

---

## 1. Research: what makes an improvement screen work

| Source | Finding | What the main view should do |
|---|---|---|
| [DORA, software delivery metrics](https://dora.dev/guides/dora-metrics-four-keys/) | Improvement is a loop: set a baseline, talk about the friction, commit to the biggest constraint, turn it into a plan, do the work, **check your progress**, repeat. Named pitfalls: *setting metrics as goals* (Goodhart), *one metric to rule them all*, and *focusing on measurement at the expense of improvement*. | The screen must end in a decision, not a number. Any single headline number needs a stated guard beside it. |
| [Google SRE, error budget policy](https://sre.google/workbook/error-budget-policy/) | An error budget is not a chart: it is a *decision rule* that diverts attention from features to reliability once the budget is spent. | Define an explicit threshold that changes what the reader does today, and say what it is. |
| [Shape Up, "Show Progress"](https://basecamp.com/shapeup/3.4-chapter-13) | The hill chart's killer feature is the **second-order view**: comparing snapshots shows what is moving and what is stuck. "A dot that does not move is a raised hand." Solve the riskiest, most-unknown work first. | Movement over time beats state. A thing that has not moved is the loudest thing on screen. |
| [Amabile & Kramer, "The Power of Small Wins"](https://hbr.org/2011/05/the-power-of-small-wins) (The Progress Principle) | Of everything that shapes motivation on real work, the strongest is **visible progress in meaningful work**. | Show the win. A fix that landed and held deserves pixels, not just an absence of red. |
| [RuboCop `--auto-gen-config`](https://github.com/rubocop/rubocop/blob/master/docs/modules/ROOT/pages/usage/auto_gen_config.adoc) | Two opposite tools. Regenerating the todo *re-baselines* and "absorbs any new offenses", which in CI would legitimise every new one. A ratchet only moves one direction: new offenses fail the build, and a stale todo entry is itself a failure. | A floor is a commitment with a deliberate, recorded way to lower it. Never a silent re-baseline. |
| SonarQube's quality gate and "Clean as You Code" ([docs](https://docs.sonarsource.com/sonarqube-server/)) | Teams act on a pass/fail gate over *new* work, not on a dashboard of legacy totals. Totals become background music. | Gate what changed since the last improvement. Do not ask anyone to read 26 sparklines. |

One more, from this repo's own taxonomy: *"Prefer `missing-check` when a mechanism exists. A doc line
can drift again; a test cannot."* (`skills/x-autoreflection/references/gap-taxonomy.md:42`) A fix that
only rewrites prose is a fix that will come back.

---

## 2. The four variants

### A. The Ledger — the main view is the log of fixes, not the list of skills

**Question it answers:** of the fixes I shipped, how many actually worked?

```
Fixes shipped in the last 30 days        6 shipped · 4 held · 1 flat · 1 came back

when   what was wrong             done      mechanism   before → after       verdict
─────  ─────────────────────────  ────────  ──────────  ───────────────────  ────────────
09-12  dangling path in x-epic    shipped   lint rule   x-decompose 62 → 78  held
09-14  panel rule missing         shipped   prose only  x-review   85 → 84   flat
09-16  scenario report path       shipped   test        x-analyze     79 → 79   waiting (2/3 days)
09-08  prose question in x-fix    not kept      —            —            —
```

Row opens a drawer: the signal with its evidence, the change text, the check command, the sessions
before and after, and the skill's score line with a vertical rule drawn on the day the fix landed.

**Screens:** `/` (the ledger) and `/fix/<skill>/<class>` (the drawer). The skill table moves to a
`/skills` tab; the rail keeps days.

**Data.** All present: proposals (`DIGEST.md` via `readProposals`), the kept selection
(`todos.json`, whose `day` is already "when the reader kept it"), the per-day skill line
(`history.jsonl`). Two things are new:
1. **when it landed** — `git log -1 --format=%cI -- <target path>` in the server, using the proposal's
   own `target` field (`skills/x-decompose/SKILL.md:12` → the file);
2. **before/after** — mean of the measured days either side (3 is enough at this data volume), with
   `n` shown, and `—` when a window is below the sample floor.

**Verdict rule:** ±2 points is flat, and the number is printed beside every verdict so no one has to
trust a badge. "Waiting" states the days still owed.

**Why it works:** it is DORA's "check your progress" with the check made mechanical, and it turns the
progress principle loose on the reader's own work: four held fixes is a small win you can see.

**Cost:** M. One git call per kept item in `report-server.mjs`; a new field (`appliedAt`) in
`writeTodos`'s whitelist (`scripts/report-server.mjs:160-180`); one event marker in `Sparkline`.

**Risk:** attribution. Two fixes in one window, or a quiet week, and the before/after is noise. Say
so under the table, and print the window size rather than a confidence claim.

---

### B. The Ratchet — one floor per skill, and a regression budget

**Question it answers:** has anything slipped below the best I have already proven?

```
26 skills · 2 below floor · budget 2 · status: at budget

x-review      ███████████████████▉  85.2   floor 85.2 since 09-16 (n=7)   0 regressions
x-fix         ████████████████▊····  73.3   floor 78.1 since 09-14 (n=6)   3 days below
x-commit      ███████████████████▌  83.5   floor 81.0 since 09-15 (n=6)   held
x-analyze        ███████████████████··  79.1   floor 79.7 since 09-16 (n=3)   within noise
```

The filled part is the record; the notch is the floor; a row below its floor is the only loud row,
and everything at or above is one muted line. When the count of below-floor skills passes the budget,
the header turns into an instruction: *stop adding, fix `x-fix`*. Two actions per row: **hold this
in** (raise the floor to the sustained mean) and **lower the floor** (allowed, recorded, with a reason).

**Screens:** `/` (the grid) and `/skill/<name>` (unchanged, it already explains one skill well).

**Data.** Skill series already exist. New: `.x-skills/daily/ratchet.json` holding
`{ floor, since, n, raisedBy }` per skill, written only by the two buttons, exactly as `todos.json` is.

**Rules that keep it honest:**
- the floor is the best **sustained** value (a 3-day mean), never the best single day;
- a day below the sample floor cannot raise or break a floor;
- the floor's `n` is printed beside it, so a floor held on three calls never reads like one held on
  twenty;
- lowering a floor needs a reason string, which is the whole point: rubocop's warning is that
  re-baselining silently "absorbs any new offenses".

**Why it works:** SRE's budget turned into a rule the screen states outright, and DORA's "focusing on
measurement at the expense of improvement" avoided by making the only loud thing a *regression*.

**Cost:** S-M. Pure arithmetic plus one JSON file and two endpoints.

**Risk:** Goodhart. A floor invites making the scan quieter instead of the skill better. The guard is
the `n` rule above, plus a "floors raised on thin evidence" line the panel shows when it happens.

---

### C. The Fix Bench — the page is a workbench with one card

**Question it answers:** what is the one thing to fix now, and is it done yet?

```
┌ Now ───────────────────────────────────────────┐  ┌ Doing ──────────┐  ┌ Waiting on the scan ─┐
│ x-decompose · doc-command-drift                │  │ P1  x-analyze      │  │ P3  x-review         │
│ S2 and S24 (both high) · seen in 3 sessions    │  │ since 09-17     │  │ shipped 09-16        │
│ skills/x-decompose/SKILL.md:12                 │  │ check: node …   │  │ 2 of 3 days measured │
│ change: state the order inline …               │  └─────────────────┘  └──────────────────────┘
│ check:  node skills/x-skill-lint/scripts/…     │
│ [ take it ]  [ not this one ]                  │  4 of 26 skills below floor · budget 2
└────────────────────────────────────────────────┘
```

- **Now** is picked mechanically, and the page says why: *"picked because it is high, it has been seen
  in three sessions, and its check is one command."* Rank = severity × recurrence ÷ cost of the check.
- **Doing** is WIP=1. While a card is in Doing, there is no second `take it` button; the page says
  "finish P1 first". That limit is the design, not an accident.
- **Waiting on the scan** is the half of the loop nothing shows today: fixes you believe landed,
  awaiting measured days.
- **not this one** is a recorded decision with a reason, re-examined later rather than rotting quietly.

**Screens:** `/` (the bench), `/fix/<id>` (the task), `/skills` (the old table, demoted). The bench
header always carries the count and the budget, so one-at-a-time never means "all is well".

**Data.** `todos.json` plus the ranking function plus a third bucket. No new file.

**Why it works:** the error budget tells you *when* to divert attention; WIP=1 tells you *how much*;
the progress principle says the card moving from Now to Held is the reward. It is also the cheapest
change here, because it is `TaskList` with a different order and one more column.

**Cost:** S.

**Risk:** false urgency, one narrow item hiding a wide regression. Mitigation is the budget line in
the header, which is never hidden.

---

### D. The Recurrence Board — the metric is "did it come back?"

**Question it answers:** which defects keep costing sessions, and which ones are actually closed?

```
12 open · 4 came back after a fix · 3 closed (not seen for 7 days)

doc-command-drift · skills/x-review/SKILL.md            high · 3 sessions · 2 days   CAME BACK
  ├ 09-14  S36 in 109444fc   one agent guessed duplicatedBlocks was the block array
  ├ 09-16  S25 in 089108aa   the other guessed functions was top-level
  └ 09-17  fixed 09-16 → 0 sightings in 1 measured day
panel-rule · skills/x-fix/SKILL.md                      medium · 6 sessions · 5 days  CHRONIC
  └ the 09-11 fix did not stop it: 3 sightings since
missing-check · skills/x-plan/scripts/scenario.mjs      high · 2 sessions · 2 days   CLOSED
```

Identity across days = the improvement class (`doc-command-drift`, `panel-rule`, …) plus the target
file. Both are already written: the class is in the digest's proposal titles and the vocabulary is
fixed by `skills/x-autoreflection/references/gap-taxonomy.md:32-40`; the target is a proposal field.

**Screens:** `/` (the board) and `/finding/<class>/<path>` (one defect's whole life). Scores move to
`/skill/<name>` as a tab, because a mean of five axes is not a defect and cannot be fixed.

**Why it works:** a defect count can go to zero; a mean of five axes cannot. DORA's "check your
progress" wants an outcome, and "this came back after we fixed it" is the sharpest available outcome.
The hill chart's rule applies as written: a dot that does not move is a raised hand, and here the
raised hand is a finding that reappeared.

**Cost:** S. All of it is derivable from the packs already on disk; no schema change, no new write.

**Risk:** the class vocabulary is authored by the reflection agent, so a renamed class orphans
history. The board should show the mapping and warn when a class disappears.

---

## 3. Shared rules, and the cheap details worth stealing into any variant

Rules all four obey, from the app's own design language and `x-ui`:

- one solid control per screen (the primary action is the only filled button);
- muting is a colour, never a smaller size;
- colour is never the only signal: every band and verdict carries its word;
- an axis with no denominator is a dash, not an empty bar;
- empty, loading and error states say what happened and what to do next;
- the page ends in a decision, or it is furniture.

Cheap details that pay for themselves in any variant:

1. **An event rule on the score chart** at the day a fix landed. One vertical dashed line, and cause
   and effect stop being a memory exercise.
2. **A "durable?" column.** From the proposal's own `check` field: is the fix a test or lint rule, or
   prose? The taxonomy already says which survives.
3. **Sort by the attention rule, not by change.** Below-floor and came-back first; the biggest
   improver is a nice story, not a decision.
4. **Print "not seen for N days", not "closed".** Closure is evidence of absence, and the panel
   should say which evidence.

## 4. Pick one by what it changes

| Variant | Unit on screen | Headline number | Attention rule | Cost |
|---|---|---|---|---|
| A. Ledger | one fix | fixes held / shipped | anything unverified | M |
| B. Ratchet | one skill | skills below floor | regression since the floor | S-M |
| C. Fix Bench | one action | the card you are on | severity × recurrence ÷ cost | S |
| D. Recurrence Board | one defect | came-back count | a finding that reappeared | S |

They compose: D supplies the metric, B the guard, C the commitment, A the proof. If only one ships,
**D is the freshest** and **C is the cheapest**; A is the one that answers the question the panel
currently cannot.

---

# Part 2 — five more, from five other fields

**Status: none of the nine ship.** They were built, reviewed, and then taken off the screen — the main screen is
the movement table again, and `scripts/report-views.mjs` went with them. What is left is this document: the
research, the nine designs, their wireframes, their costs and their measured numbers, which is where a rebuild
would start. `AGENTS.md` describes what the app does today.

The panel's weak point is not its ideas, it is that **every threshold in it was invented**. A movement is "up"
past 0.5 points, a fix is "held" past 2, a score exists at n ≥ 5 and does not below it. None of those numbers
came from anywhere, so none of them can be argued with. Five established systems have an answer, and one of
them has an answer for this exact situation (a small sample, checked daily, where a false alarm costs real
work).

## 5. What already exists, and what each would lend

| Where it is used | The rule it runs on | What to take |
|---|---|---|
| **Clinical lab QC** (Levey-Jennings charts, [Westgard multirules](https://www.westgard.com/westgard-rules.html)) | Control limits at ±1s/±2s/±3s around a baseline, and rules that are checked *together*: `1_3s` (one point past 3s), `2_2s`, `R_4s`, `4_1s`, `10x`, `7T`. `1_2s` is a **warning**, not a rejection. Published false-rejection rates: a lone 2s rule rejects ~9% of good runs at N=2, 14% at N=3, 18% at N=4; `1_3s` is ~1%. Labs auto-verify results when no rule fires, with a target of ≥90% error detection at ≤5% false rejection | Limits from the record's own variation, alarms that **name the rule that fired**, and each rule's false-alarm rate printed beside it. "No alarm" becomes a real answer |
| **Competitive rating** (chess Elo, [TrueSkill](https://en.wikipedia.org/wiki/TrueSkill)) | Each player is a *distribution*: μ (skill) and σ² (uncertainty), with a between-game drift τ². Xbox Live displayed μ − 3σ, the 1% quantile, so a leaderboard is held by players who are both strong and well measured. Also the plain measurement rule: SE = σ/√n, so halving an interval costs four times the observations | A score with an interval, a **conservative** value beside it, and "where does the next session buy the most certainty" |
| **Insurance** ([credibility theory](https://en.wikipedia.org/wiki/Credibility_theory), Bühlmann) | μ̂ = z·x̄ + (1−z)·μ, z = VHM/(VHM + EPV/n). Its own worked example: 30% credibility turns a rate of 3.1 into 0.3×3.1 + 0.7×7.4 = 6.1. z = 0 ignores the individual (adverse selection), z = 1 overfits the sample | A **blend weight** per day, printed, instead of the cliff at n ≥ 5: today counts 60%, the skill's own history counts 40% |
| **Manufacturing and queueing** ([Little's law](https://en.wikipedia.org/wiki/Little%27s_law)) | L = λW: the average number in the system is the arrival rate times the time in it, which is how a factory predicts lead time from work in process. A cumulative flow diagram shows the same thing as a stacked band, and the bottleneck is where a band widens | Measure the **fixing process**, not just the skills: arrivals, closures, WIP, cycle time, and the wait L/λ |
| **Consumer credit** (FICO, [credit scoring](https://en.wikipedia.org/wiki/Credit_score_in_the_United_States)) | A score is never sold alone: it comes with **reason codes** (the factors that depressed it) and a simulator ("paying this down would move it about N points"), and the weights are published (payment history 35%, debt 30%, length 15%, types 10%, inquiries 10%). In the US a declined applicant has a legal right to the specific reasons | Decompose the score into **named factors with a cost in points**, ranked, and recompute it under a target |
| **Learning science** ([SM-2](https://super-memory.com/english/ol/sm2.htm), Anki) | Review at I(1)=1 day, I(2)=6, then I(n)=I(n−1)·EF with EF clamped to [1.3, 2.5]; a lapse restarts at I(1); each review is graded 0–5. Wozniak's own note: an item whose EF falls below 1.3 "always seemed to have inherent flaws... and should be reformulated" | A **due queue** for re-checking findings, with intervals that widen, and "reformulate" as a real outcome |
| **Metrology and rehab** ([standard error](https://en.wikipedia.org/wiki/Standard_error), SEM, MDC) | SE = σ/√n; the minimal detectable change from repeated measures is about 1.96 × the SD of day-to-day differences | The number every threshold should be compared against: **what this record can actually resolve** |

## 6. What this record already says

All measured on `.x-skills/daily` (two days, 2026-09-16 and 09-17; 28 skills known, 12 measured on both days,
4 clear the sample floor):

| Claim | Measured | What it decides |
|---|---|---|
| A day-to-day difference of less than this is not a signal | **SD(Δ) = 7.2 points over 12 paired skills → MDC95 = 14.1** | Only **1 of 12** skills moved by more than that (x-implement, +19.2), while the movement view's ±0.5 fires on **all 12** and the ledger's ±2 on **11 of 12** |
| The cost of checking daily on a small sample | A 2σ rule over 28 skills expects **1.3 false alarms a day**; a 3σ rule, **0.1** | The panel cannot afford a 2σ rule; it needs Westgard's combine-a-specific-rule trick |
| Where the noise lives | Per-axis spread across all measured skills: `trigger` 0.33 mean, SD 0.15 (26 readings); `protocol` 0.87, SD 0.05; `rework` 0.98, SD 0.00; `conformance` 0.99, SD 0.02 | The composite score's movement is mostly the `trigger` rate swinging. It carries 20 of the weights' 100 points and 70–85% of every skill's gap (below) |
| What each day is worth | EPV (one day's reading for one skill) = 5.1² = 26 points²; VHM (spread between skills) = 6.2² = 39 points²; K = 0.67 | z(1 day) = **0.60**, z(3) = 0.82, z(5) = 0.88: a one-day reading is 60% the skill and 40% the day. The panel currently rounds that to 0 (below the floor) or 1 (a change) |
| Where the points are lost | x-review 85.2: **trigger costs 10.4 of its 14.8-point gap** (7 of 12 sessions loaded it); x-fix 73.3: trigger 21.5 of 26.7; x-ui 66.0: trigger 29.1 of 34.0. The widest gaps are skills no session ever loaded: x-refactor, 0 of 11 sessions | One axis is the whole story for every skill, and it is the one the digest calls a description problem |
| The fixing process | 15 proposals (13 distinct findings) in 2 days = **7.5 a day in, 0 a day resolved**; 11 open, 5 kept, 2 landed, **0 closed** | The queue grows by 7.5 a day; W = L/λ = 1.5 days *if arrivals stopped*. The first closure this record can produce is 09-24 (7 quiet days) |
| Is the ranking real? | Of the 19 skills with sessions on 09-17, **all 18 adjacent pairs have overlapping 95% ranges** (x-review 85.2 ± 7.3 sits over x-plan 78.3 ± 7.3 and x-fix 73.3 ± 11.2) | The panel's ordering of skills is not evidence today. x-implement's +19.2 is the single move that survives |
| Is the churn just sampling? | Sampling error per day averages **±4.9 points**, so a two-day difference should show SD ≈ 6.9; the record's actual is **7.2** | The movement in this record is the size noise predicts. The model is the right size, which is why a rule can be trusted more than an eyeball |

## 7. The five

### E. The Control Chart — "did it move, or did I just look at it twice?"

**Borrowed:** clinical lab QC. The lab does not ask whether a value changed; it asks whether a *rule* fired,
and every rule has a known false-alarm rate. `1_2s` is a warning that says "look carefully", `1_3s` says stop,
`2_2s`/`4_1s`/`10x` catch a small shift that a single point misses. That is exactly the panel's problem: 28
skills, checked daily, where the naive rule fires on all 12 measured skills and therefore means nothing.

Built as `?view=control`. On this record it fires **one** alarm: x-implement, at +3.8σ against a baseline of the
day before. That is the same single move the MDC95 test finds, from an independent construction, and the other
thirteen skills sit inside their limits. The centre is a baseline period (every measured day but the days under
judgement), which is the part that makes a two-day record usable at all.

```
The record, against its own limits            2 rules fired · 1.3 false alarms a day expected at 2σ

x-implement  ●━━━╿━━━━━╿━━━━━━●          1_3s   one day past the 3s limit (Westgard's ~1% false alarm)
x-fix        ────╿──●───╿──────           4_1s   four days running past the same 1s limit (~0.1% by chance)
x-ui         ───────●──╿─────────       (none)  inside ±2s: nothing to do
──────────────────────────────────────────────────────────────────────
limits: 1s 5.1 · 2s 10.2 · 3s 15.3, on a pooled sigma from the 12 paired skills, centred on each
        skill's own mean until it has ten measured days of its own
```
Note the agreement: the change that is real by repeated measures (MDC95 = 14.1) is almost exactly the 3s
limit (15.3), so at this sample size one rule carries the whole decision, and `1_3s` is the one whose false
alarm rate is ~0.3%.

- The limits are **pooled** until a skill has ~10 measured days of its own, and the screen says which it used.
- An alarm prints the rule name *and* its false-alarm rate, so a reader can argue with it.
- `1_2s` is a warning row, not a rejection: Westgard's split is the reason a lab can automate the decision.

**What it changes:** the movement view stops flagging all 12 skills and starts flagging the one that moved.
"This week nothing fired" becomes an acceptable, informative answer.
**Cost:** S. The series exists; the pooled σ is 5.10 points today and will be per-skill after ten days.
**Risk:** a pooled σ assumes every skill is equally noisy, which the per-axis table above shows is false
(`trigger` swings 5× more than `rework`). Until each skill has its own baseline, say "pooled limits" on the
screen rather than pretending.

### F. The Interval — "what score can I defend, and where does the next session buy the most?"

**Borrowed:** Elo/Glicko/TrueSkill, plus the measurement rule SE = σ/√n. TrueSkill's Xbox deployment displayed
μ − 3σ rather than μ, precisely so a leaderboard is not held by someone with two lucky games. This panel prints
μ and nothing else, and on this record the same day's score carries a one-sigma interval of ±2.8 to ±6.4 points
depending on the skill, or ±5.5 to ±12.5 at 95%. The model is not the problem: its average one-sigma of 4.9
across skills matches the record's own day-to-day SD of 5.1 almost exactly, which is why the intervals can be
trusted.

```
skill           n   score (95%)   mu-3sigma   range            sessions to halve the interval
x-review        7   85.2 ± 7.3    74.0        77.9 .. 92.5     21 more loaded sessions (4 days at today's rate)
x-commit        6   83.5 ± 7.1    72.8        76.5 .. 90.4     18 more
x-fix           6   73.3 ± 11.2   56.2        62.1 .. 84.5     24 more
x-browser       4   70.8 ± 12.5   51.6        58.3 .. 83.3     16 more
x-ui            3   66.0 ± 10.9   49.3        55.1 .. 76.9     12 more   ← widest, and the cheapest to narrow
x-humanize      1   76.4 ± 5.5    68.0        70.9 .. 81.8      3 more   ← narrow already, so leave it alone
```

Every row here overlaps its neighbour: 85.2 ± 7.3 and 73.3 ± 11.2 are not a ranking, and all 18 adjacent pairs
on the day overlap. That is the honest state of a two-day record, and the panel currently hides it behind a
table sorted by score.

- The conservative column is TrueSkill's μ − 3σ: the score the evidence supports, not the score of the last
  day. On this record it costs x-review 11 points, which is the right price for a seven-session day.
- The "needs N more" column is matchmaking. `x-ui` is the widest interval with the most to gain (9 sessions),
  `x-humanize` is already narrow, and `x-review` would cost 21 more sessions for the same halving. Sort by
  interval width and the panel says where the next session is worth spending, which is what a rating system
  does with a match.
- SE = σ/√n is why this is not a rounding exercise: halving an interval costs **four times** the sessions.

**What it changes:** "x-ui is at 66" stops being a claim. The panel says 66 ± 6, and says that 9 more sessions
is what it takes to make it a number worth acting on.
**Cost:** S-M. Needs the per-axis denominators (they are in the pack's counters), so `apiSkill` reads packs the
way it already does.
**Risk:** sessions within a day are correlated (same repository, same task), which makes a naive interval too
narrow. Widen by a stated design effect (×1.3 is the usual starting point) rather than pretending they are
independent.

### G. The Flow — "is the bottleneck the skills, or the way I fix them?"

**Borrowed:** Little's law and the cumulative flow diagram. A factory reads lead time off work-in-process;
`L = λW` says the wait is the queue divided by the throughput. The panel measures skills and never once asks
whether the *fixing* is keeping up.

```
findings ever   13  ████████████████████████  6.5 arrive a day
kept             5  ▓▓▓▓▓▓▓▓▓
landed           2  ▒▒▒▒
closed           0  ·······················  ← nothing has ever reached here

arrivals 6.5/day · closures 0/day · WIP 11 · ages 1–2 days · L/λ = 1.7 days if arrivals stopped
first closure possible 09-24 (the recurrence rule wants 7 quiet days) · oldest stage: landing → closed
```

- The headline is a **difference**, not a level: arrivals minus closures, and the date the queue is projected
  to reach (today: never, because closures are zero and the stages that produce them are two days long).
- The band that widens is the answer to "what should I do about it". On this record the answer is honest and
  unflattering: *stop landing new fixes until one has been verified*, which is also the bench's WIP = 1 rule.

**What it changes:** it moves attention from skill scores to the pipeline that is supposed to move them, and it
gives the ratchet's budget a rate (SRE's burn-rate idea). On this record nothing has consumed the budget yet,
so the burn rate is genuinely unmeasured, and saying so is better than printing a reassuring zero.
**Cost:** S. Derived from the packs, `todos.json` and the commit dates that Part 1 already collects.
**Risk:** two days of history cannot show a bottleneck. The empty state must say which stages have ever held
work (2 of 5) instead of drawing a flat band and calling it a chart.

### H. The Worst Factors — "which change buys the most points?"

**Borrowed:** credit scoring. FICO does not hand over a number; it hands over reason codes and a simulator, and
publishes the weights. This panel has the same machinery and hides it: the score is
`100·Σ(w·r)/Σw`, so the gap from 100 is exactly `100·Σ(w·(1−r))/Σw` and every point is attributable.

```
x-review  85.2   ·   14.8 points on the table
  trigger         58%    costs 10.4   7 of 12 sessions loaded it; 5 named it and never did
  protocol        85%    costs  2.9   50 panels and 9 prose questions in the sessions it sat in
  conformance     97%    costs  1.1   2 failed checks of 66
  rework          98%    costs  0.4   158 repeated calls out of 7,793
  target [ 100% ▾ ] -> 95.6  (+10.4)     ← the simulator: set one factor, the score follows
```
The four costs add to the gap exactly (10.4 + 2.9 + 1.1 + 0.4 = 14.8), which is what makes the row
checkable by hand rather than trusted.

- Each factor carries its arithmetic and the findings that blame it, so the row is arguable rather than
  authoritative.
- The simulator recomputes the score under a target for one factor. **The target must not be the fleet's
  average**: moving x-review's trigger to the fleet's own 33% would *lose* 6.4 points, because x-review already
  sits at 58%. Offer 100%, or a goal the reader sets.

**What it changes:** it is the only one of these five that ends in a specific edit. The measured answer on this
record is uncomfortable and useful: for every skill, the `trigger` axis (was the skill *loaded*, not merely
named) is 70–85% of the gap, which is a description problem before it is a skill problem.
**Cost:** S-M. The dimensions are already per day; the counters behind each axis are in the pack; the findings
are in the recurrence data that now exists.
**Risk:** the axes are not independent, so "trigger is the biggest lever" may be a symptom rather than a cause.
Say so beside the number, as the skill screen already does for its signals.

### I. The Review Schedule — "when must I re-check this?"

**Borrowed:** SM-2. Review at one day, then six, then ×EF (clamped to 1.3–2.5); a lapse restarts at one day;
each review gets a grade; and the best line in the paper is Wozniak's own, that an item whose easiness factor
falls below 1.3 has "inherent flaws... and should be reformulated". Applied here: a finding that keeps coming
back is often a badly *stated* finding, not an unfixed one.

```
Due today — 3 of 13 findings            the scan already answered 2 of them; 1 needs a look

doc-command-drift · skills/x-plan/SKILL.md    1d   last seen 09-17 · fix landed 09-16
  auto: the class and file appear again in 09-17's pack        [ held ] [ came back ] [ reformulate ]
missing-check · test/x-autoreflection.test.cjs  1d  fix landed 09-16, nothing since
  what to do: confirm the test exists and covers the case      [ held ] [ came back ] [ reformulate ]
script-hardening · skills/x-analyze/scripts/scenario.mjs  1d  interval fell to 1.3 after 2 lapses
  this one keeps failing its check: the finding, not the fix, needs rewriting
```

- The intervals widen (1, 6, 15, 37 days at EF 2.5) so the queue is bounded by arrivals, and a finding that
  comes back is scheduled at **one day** again, which is where the evidence is freshest.
- Half of the checks need no human: the recurrence board already knows whether the class and file appeared
  again in a new pack. The human is asked only for what the scanner cannot see.
- The third outcome is `reformulate`, borrowed from SM-2: a finding that has lapsed repeatedly should be
  rewritten at the source (usually a `missing-check` fix that was never written, or a statement too vague to
  test), and that is a meeting with the digest, not another fix.

**What it changes:** "closed" stops being a 7-day absence and becomes a scheduled, evidenced review, and the
workload becomes predictable (6.5 arrivals a day is 26 checks a day at four intervals each, so the schedule
must widen fast or the arrival rate must fall).
**Cost:** S-M. A `reviews.jsonl` beside the packs, the way `todos.json` and `ratchet.json` already live there.
**Risk:** a routine the reader abandons is worse than none. Cap the due list, let the intervals carry the rest,
and keep the auto-answered ones silent.

## 8. Also considered, and what would make each viable

- **Burn rate** (SRE's multi-window multi-burn-rate alerts): the ratchet's budget divided by the rate it is
  consumed at. Today: 2 regressions allowed, roughly one arriving every 3 days, so the budget is gone in about
  six. It belongs in the ratchet's header, not on a screen of its own.
- **Sigma metric** (clinical lab, Six Sigma): `(target − score)/noise` as one number that folds accuracy and
  precision together. It is the compact form of idea E and a good summary line, not a view.
- **Brier score and reliability diagrams** (weather forecast verification): score the *predictions* rather than
  the scores, using each proposal's own `Check:` as the forecast. Viable as soon as a check's result is
  recorded; nothing writes it today, and running arbitrary commands from the panel is a larger change than a
  view.
- **A past-fix simulator** (FICO's simulator done from history instead of from the weights): "fixes of this
  class moved this skill by +4.2 on average" needs at least three outcomes per class; the record has one or two.
  When idea G has run for a month this becomes the best thing on the screen.
- **Value-added models** (teacher effectiveness, education): the shrinkage and interval that ideas E and F use,
  arrived at from a different direction. Folded in as their baseline rather than shipped separately.
- **FICO-style banding** (exceptional / very good / good / fair / very poor): the panel already bands at 70 and
  85 with its own words. Borrowing FICO's five labels would relabel the same two cut points and add nothing.

## 9. If one of these ships first

- **E** is the one that repairs the panel's credibility: it replaces an invented threshold with a rule that has
  a published error rate, and it makes "nothing happened" a possible answer.
- **H** is the one that changes what a reader does next, because it ends in a specific edit and a count of how
  many points that edit is worth.
- **F** is the one to build if the reader keeps asking "is 66 bad?", and **G** is the one that will matter in a
  month, when there is a pipeline to look at.

E and F are the same family and could ship as one screen (limits above, intervals on the rows); H is a new
screen; G and I are process, and process is what a two-day-old record cannot show.
