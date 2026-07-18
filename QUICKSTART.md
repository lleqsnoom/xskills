# Quickstart — Zero to Working Pipeline in 15 Minutes

This guide takes you from fresh install to running the full xskills design-to-review pipeline.

---

## Installation (2 minutes)

```bash
# Install globally for use in all projects
npm install -g xskills

# Or use npx without installing:
npx xskills --version
```

**Verify installation:**

```bash
node bin/install.js list
```

You should see a list of available skills with descriptions. If you see this, xskills is working correctly.

---

## First Project Walkthrough (10 minutes)

This walkthrough covers the complete planning workflow: **design → epic → decompose → implement**.

### Step 1: Design a Feature

Create a design spec that defines *what* to build and *why*. This becomes your source of truth for all subsequent steps.

```bash
# Initialize a new project (if you don't have one)
mkdir my-feature-project && cd my-feature-project
git init

# Run x-design to create a spec
node bin/install.js install x-design
node <path-to>/x-design/scripts/save-spec.js --topic "user-authentication"
```

**What happens:** The script prompts you for requirements and generates `.x-skills/design/DD-MM-YYYY-hh:mm-user-authentication.md` — a structured design document with scope, constraints, and success criteria.

### Step 2: Approve the Spec

Open the generated spec file in your editor. Review it against your actual requirements. Edit until it accurately captures what you want to build. This is the human-in-the-loop gate — never skip review.

**Key sections to verify:**
- **Scope**: Does it cover everything needed? Nothing unnecessary?
- **Constraints**: Are technical limitations documented?
- **Success criteria**: Can you measure completion?

### Step 3: Create an Epic

Once the spec is approved, convert it into user stories grouped as an epic.

```bash
node bin/install.js install x-epic
node <path-to>/x-epic/scripts/save-epic.js --epic "user-authentication"
```

**What happens:** Generates `.x-skills/epics/DD-MM-YYYY-hh:mm-user-authentication.md` — a collection of INVEST-gated user stories with epic-level Definition of Done. Each story is scope-bounded and outcome-focused (not implementation tasks).

### Step 4: Decompose into Tasks

Break each user story into atomic implementation tasks, each estimated at ≤8 hours.

```bash
node bin/install.js install x-decompose
node <path-to>/x-decompose/scripts/save-tasks.js --epic "user-authentication"
```

**What happens:** Generates `.x-skills/tasks/DD-MM-YYYY-hh:mm-user-authentication.md` — atomic tasks with:
- Individual effort estimates (hours)
- Dependencies between tasks
- Test plans for each task
- Definition of Done per task

### Step 5: Implement Tasks

Execute tasks sequentially or in parallel groups. Each task follows TDD: red → green → refactor → commit.

```bash
node bin/install.js install x-implement
# Run from the project root — x-implement reads the task file and executes each one
```

**What happens:** For each unchecked `- [ ]` task in the task file:
1. Writes a failing test for the acceptance criterion
2. Implements minimum code to pass
3. Refactors against SOLID principles
4. Commits via x-commit (validated conventional commit)
5. Marks task complete with `[x]`

---

## Verification (3 minutes)

After completing the walkthrough:

```bash
# Run all tests — should be green
npm test

# Verify installed skills are discoverable
node bin/install.js list

# Check your artifacts exist
ls .x-skills/design/
ls .x-skills/epics/
ls .x-skills/tasks/
```

All tests passing + visible artifact files = successful setup.

---

## Installing Additional Skills

Install any skill from the available list:

```bash
# Install into current project (local)
npx xskills install <skill-name>

# Install globally (all projects)
npx xskills install <skill-name> --global

# Shortcut — just type the name
npx xskills <skill-name>
```

**Common skills to try:**
- `x-commit` — Conventional commit message validation and generation
- `x-review` — AST-based code complexity analysis and review
- `x-fix` — Resolve code review issues from a fix plan file
- `x-api-draft` — Draft API design from requirements

---

## Next Steps

- Read [Skill Authoring Guide](docs/skill-authoring-guide.md) to create your own skills
- View the [Workflow Diagram](docs/workflow-diagram.mmd) for visual overview
- Check [AGENTS.md](./AGENTS.md) for architecture details and conventions
