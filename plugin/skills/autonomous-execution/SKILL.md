---
name: autonomous-execution
description: duckor-flow's execution rules. The conductor part drives the per-task implement → check → review loop with limits; the implementer part governs how one task is built. Use only inside a duckor-flow run.
---

<!-- Adapted from obra/superpowers skills/subagent-driven-development @ 5bf4e78011075bcfc0dc295f0724994cd123ee71 -->

# Autonomous execution

Execute the plan task by task with a fresh implementer per task, the conductor's own check run, and a fresh reviewer per task. Then do one whole-branch review. There are **no pauses** between tasks: the user approved the brief so they would not have to answer "should I continue?".

**Core principle:** an agent's word isn't evidence. A task is done when the conductor has seen the checks pass **and** a reviewer has approved.

## Rulings, not stalls

Conflicts, ambiguities and plan defects get decided, not escalated. The spec is the binding authority, the plan is its argument, and judgment settles what neither covers. Every decision is recorded in the status block's `RULINGS:` section, one line each:

```
- <decision> — <why> — <cost if wrong>
```

The conductor copies them to `state.json.decisions`, and the report lists all of them. A deviation from the plan without a ruling is a decision made in secret.

Only these stop a run (as `blocked`): an exhausted limit, an irreversible or destructive operation, a security-sensitive action, or a plan so broken that every path forward is a guess.

## Part 1: Conductor loop

For each task `n` whose status is not `done`, in order:

1. Record `base = git -C <worktree> rev-parse HEAD` (keep the existing `base` if the task is `in_progress` on resume). Set the status to `in_progress` and write state.
2. **Implement:** dispatch `duckor-flow:implementer` with task `n` (see the conductor's dispatch template).
3. **Verify:** run every check yourself in the worktree (the conductor's "Running checks", step `task<n>-r<round>`), and read only the tail of failing logs. A check fails if it exits non-zero and is not in `baseline_failures`.
4. **Review:** if the checks pass, dispatch `duckor-flow:code-reviewer` (mode `task`, range `base..HEAD`, the task text).
5. **Decide:**
   - Checks pass and `APPROVED` → status `done`, `head = HEAD`, add minor issues to `minor_issues`, write state, and go to the next task.
   - Checks fail → `fix_rounds += 1` and re-dispatch the implementer with `check_output` (the log tail).
   - `NEEDS_FIX` → `fix_rounds += 1` and re-dispatch the implementer with the issues.
   - Implementer `BLOCKED` → treat as a failed round with its summary as the input.
6. **Limits:** after 3 fix rounds:
   - Last round failed on **checks** (or implementer `BLOCKED`): make one extra attempt. Dispatch the implementer with the latest failure and the instruction "Use superpowers:systematic-debugging; find the root cause before changing code." If it's still not checks-green and approved, block with `task <n>`.
   - Last round failed on **review** (checks pass): block with `task <n> review`.

   Blocking sets the task's status to `blocked` and follows the conductor's Blocking section.

Never fix code yourself in the main session. The main session's context is for orchestration. Keep every agent's reply to its status block.

### Final review

After the last task:

1. Set phase `finish`. Dispatch `duckor-flow:code-reviewer` in mode `final`, over `base_sha..HEAD`, with the spec and plan.
2. If it returns `NEEDS_FIX` with critical or important issues: dispatch the implementer **once** with task `final`, those issues, and `base` = the current HEAD, then run the checks. Set `review_rounds.final = 1`.
3. Whatever is still open goes to the report. The run is `completed` if the checks pass, and `blocked: final checks` if they don't.

## Part 2: Implementer rules

- Read the scratchpad, then your task (or the issue list for `final`). Read the spec section the task cites, not the whole plan.
- Work the steps in order under **superpowers:test-driven-development**: write the test, run it, see it fail for the expected reason, implement, run it, see it pass.
- Compare every command against the plan's `Expected:` line. A mismatch means either the code is wrong (use **superpowers:systematic-debugging**) or the plan is wrong (make the smallest change that satisfies the spec, and add a ruling).
- Commit as the plan says, with explicit paths.
- **Completion contract**, before `DONE`, with evidence from this session (**superpowers:verification-before-completion**):
  - every test the task names exists and ran;
  - every command in `checks` was run after your last change and passes (except `baseline_failures`);
  - every deviation has a ruling.
- Append to the scratchpad: what you built, the names later tasks use, and any gotchas.
- Never weaken, skip or delete a test to get green. Never run excluded e2e commands.
