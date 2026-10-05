---
name: autonomous-writing-plans
description: duckor-flow's planning rules. The planner agent follows them to turn a spec into a TDD, task-by-task plan with per-task checks and no e2e tasks. Use only inside a duckor-flow run.
---

<!-- Adapted from obra/superpowers skills/writing-plans @ 5bf4e78011075bcfc0dc295f0724994cd123ee71 -->

# Autonomous writing plans

Write the plan for an implementer who has never seen this codebase or spec and who sees **only their own task**. They write idiomatic code once they know the exact interface and the exact test. What they can't know is what you decided: which files, which names and signatures, which values from the spec, and which tests prove each task. Write those down. DRY. YAGNI. TDD. Frequent commits.

Unlike upstream writing-plans, there is **no execution handoff**: the conductor executes the plan. Don't ask anyone anything.

## File structure first

Before writing tasks, map the files to create or modify and what each one is responsible for. Keep each file focused on one thing. Files that change together live together. Follow the repo's patterns.

## Task sizing

A task is the smallest unit with its own test cycle that a reviewer could reject while approving its neighbor. Fold scaffolding, config and docs into the task that needs them. Each task ends in an independently testable deliverable. Order tasks so each one builds on committed work from earlier tasks.

## Plan document

```markdown
# <Feature> Implementation Plan

**Goal:** <one sentence>
**Architecture:** <2–3 sentences>
**Tech Stack:** <key technologies>
**Spec:** <absolute or repo-relative spec path>

## Global Constraints
<project-wide requirements copied verbatim from the spec, one per line>

## Review Focus
<up to five inputs or failure modes the spec implies that are most likely to bite, each pinned by a test in its owning task>

---

### Task N: <component>

**Files:**
- Create: `exact/path`
- Modify: `exact/path`
- Test: `exact/test/path`

**Interfaces:**
- Consumes: <exact names and signatures from earlier tasks>
- Produces: <exact names and signatures later tasks rely on>

**Checks:** `<command>`, `<command>`   ← the commands that prove this task; never an e2e command

- [ ] **Step 1: Write the failing test**: test name and assertions, as code, with the spec's exact values
- [ ] **Step 2: Run it**: `Run: <command>` / `Expected: FAIL with <reason>`
- [ ] **Step 3: Implement** `<signature>` in `<file>`: one line on the approach; a code block only for an algorithm the signature and tests don't determine
- [ ] **Step 4: Run it**: `Run: <command>` / `Expected: PASS`
- [ ] **Step 5: Commit**: `git add <explicit paths> && git commit -m "<type>: <message>"`

## Manual e2e
<every end-to-end or real-service verification the spec implies, as a checklist for the user; "None" if there is none>
```

## Rules

- **Checks per task.** Draw them from the run's checks, or a narrower test command plus the full suite on the last step. A task is done only when its checks pass.
- **No e2e in tasks.** No task writes, changes or runs e2e, browser, or real-external-service tests. Those go to `## Manual e2e`. The run's excluded check commands never appear in a task.
- **One reasonable reading per step.** Lines that decide nothing ("handle edge cases", "add validation", "write tests") are gaps. Function bodies that the signature and tests already determine are transcripts. Fix both.
- **Proportion.** A plan several times longer than the spec has written the code instead. Use signatures, test names and assertions, not bodies.

## Self-review before committing

1. **Spec coverage:** point to a task for every spec requirement and add any that are missing.
2. **Step scan:** each step is unambiguous and not a transcript.
3. **Type consistency:** names and signatures match across Interfaces blocks.
4. **Review Focus:** each line has a pinning test in its owning task.
5. **E2E:** no task touches e2e, and `## Manual e2e` is present.

Fix issues inline. Record any decision the spec didn't make as a `RULINGS:` line in your status block.
