---
name: x-unbloat
description: Cut code to what the task needs — a YAGNI ladder that removes needless abstractions, wrappers, unused options and dead code, keeps behavior and protective code, and measures the result. Use when asked to unbloat, simplify, or remove over-engineering; x-implement, x-review and x-refactor run it as a pass.
version: 1.7.0
author: Community
tags: [yagni, kiss, simplify, over-engineering, dead-code, refactoring, code-cleaning]
user-invocable: true
---

# X-Unbloat — The Least Code That Works

Every line must be read, tested and maintained. Before you add code, ask if it needs to exist. Before you keep
code, ask if it still does.

## Two Ways It Runs

**As a pass inside another skill.** No record, and do not stop on uncommitted work: that work is the task.
The host's scope replaces step 3's. Which steps run depends on whether the host edits code:

- **x-review** (reports only): steps 3 and 5. List findings under `[Bloat]`, each with the rung it fails.
  Needless abstraction is MAJOR. Dead code and unused options are MINOR.
- **x-refactor** (suggests only): steps 3 and 5. Prefer deleting and inlining to extracting. A new layer must
  name the second caller that needs it.
- **x-implement** (edits): step 3 before GREEN, to decide what to write; steps 3, 5 and 7 in REFACTOR. Cut
  only code the current task wrote, so the cuts belong in its commit. Report older bloat for a standalone run.
- **x-fix** (edits): steps 5 and 7 for each `[Bloat]` finding in a review plan.

**On its own**, when the user asks to unbloat or simplify: run all nine steps.

## The Ladder

Stop at the first rung that holds:

1. **Does it need to exist?** Not asked for and not needed → do not write it.
2. **Is it already in the codebase?** Reuse it.
3. **Does the standard library do it?** Use it.
4. **Does the platform do it?** Use it: CSS over JS, a database constraint over app code.
5. **Does an installed dependency do it?** Use it. Never add a dependency for what 3–4 cover.
6. **Is it one line?** Write one line, if it reads as easily.
7. **Only then** write the minimum that works for today's inputs.

## Bloat, Unless…

| Bloat | Fix | Keep it if |
|-------|-----|------------|
| Interface, base class or factory with one implementation | Use the concrete thing | It is a test seam or a published boundary |
| Wrapper that only passes arguments on | Call the target | It isolates a third-party API |
| Class with one method and no state | A function | The framework needs a class |
| Option or parameter no caller passes | Delete it | Code outside this repo calls it |
| Config value that never changes | A constant | It changes per environment |
| "Manager", "helper" or "util" layer used once | Inline it | More than one caller uses it |
| Own version of a stdlib or platform feature | Use the built-in | The supported runtime lacks it |
| New dependency for a few lines | Write the lines | It is crypto, a file format parser, or time zones |
| Dead code, commented-out code | Delete it | Code outside this repo uses it |
| Check for a state the types or internal callers rule out | Remove the check | The input crosses a trust boundary |
| Variable whose name adds nothing (`const r = f(); return r`) | Use the value | The name labels a step |
| Hook for a "future" case (registry with one entry) | Remove it | The second case is in this task |

Extracting is fine when the same logic is in two or more places.

A **unit** is anything you can remove whole: a function, class, module, file or dependency. A **trust
boundary** is any input the code does not build itself: public API arguments, requests, files, environment,
I/O.

## Never Cut

- Validation at a trust boundary.
- Error handling that prevents data loss.
- Security: auth, escaping, secrets, permissions.
- Accessibility: labels, roles, focus, contrast.
- Anything the user asked for. Suggest the simpler option instead.
- Tests. A test that fails after a cut means behavior changed.

If you do not know why code exists, find out first (`git blame`, `git log -L :functionName:path/to/file`,
callers, tests). Delete it only when the reason is gone.

## Steps

Run the scripts from this skill's folder: `~/.agents/skills/x-unbloat/scripts/` for a global install, or
`.agents/skills/x-unbloat/scripts/` for a local one. The commands below use the global path.

1. **Check the tree.** If it has changes that are not part of this task, stop and tell the user.
2. **Start the record**:
   ```bash
   node ~/.agents/skills/x-unbloat/scripts/verdicts.mjs new --slug my-topic
   ```
   It saves the current commit as the base and prints the path of a new `Enn-unbloat.md` in the run folder.
   `RECORD` in the commands below means that path.
3. **Use the ladder** on each unit in scope: what the user points at, or else the files this branch changed
   (`git diff --name-only main...HEAD`; use `master` if that is the default branch). If that list is empty,
   ask the user what to unbloat. Do not touch the rest of the repo.
4. **Record each verdict** as a table row: unit, `keep` or `cut`, why (the rung, table row, or Never Cut
   rule), call sites.
5. **Check callers.** Find every call site before you inline or delete. If code outside the repo uses it,
   report it and keep it.
6. **Cover it.** If a unit you will cut has no test, write one that pins its current behavior.
7. **Cut one thing at a time.** Run the tests after each cut. If they fail, revert that cut.
8. **Measure**:
   ```bash
   node ~/.agents/skills/x-unbloat/scripts/measure.mjs --record RECORD
   ```
   It reads the base from the record, counts lines added and removed, files touched, and dependencies added
   or removed, and writes the result into `## Measure`. Exit 1 means a dependency was added: say why.
   `netLines` includes the tests from step 6. Use the per-file list it prints to report the cut without them.
9. **Check the record.** Fill in `## Left for the user`, or write `nothing`. Then run:
   ```bash
   node ~/.agents/skills/x-unbloat/scripts/verdicts.mjs check --file RECORD
   ```
   It also fails a `cut` row when no line removed since the base names that unit, so name units the way the
   code does. Exit 0 means done. Exit 1 lists what is missing. Tell the user what you cut (with `netLines`), what you
   kept and why, and what is left for them.

## Rules

- Clearer code is the goal. Fewer lines is only the result. No clever one-liners or nested ternaries.
- Follow the project's style.
- On its own, commit the simplification by itself, apart from feature work.
- If a cut removes a capability on purpose, say so.
