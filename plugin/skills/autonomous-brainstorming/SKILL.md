---
name: autonomous-brainstorming
description: duckor-flow's one-round clarification and spec rules. Part 1 is run by the conductor to turn a single prompt into a user-approved brief; Part 2 is followed by the spec-writer agent. Use only inside a duckor-flow run.
---

<!-- Adapted from obra/superpowers skills/brainstorming @ 5bf4e78011075bcfc0dc295f0724994cd123ee71 -->

# Autonomous brainstorming

This is superpowers brainstorming squeezed into **one** human touchpoint. The user gave one prompt and wants the rest done for them. Ask what only they can answer, all at once, then stop asking.

## Part 1: Clarify (main session only)

Subagents can't talk to the user, so this part runs in the main session, under the conductor.

### 1. Explore before asking

Read enough of the worktree to avoid asking what the repo already answers: README, CLAUDE.md / AGENTS.md, the directory layout, the code the prompt names, and recent commits (`git log --oneline -15`). Note the language, the test setup and the conventions.

If the prompt describes several independent subsystems, say so in the brief and scope the run to the first sub-project. Put the rest under Out of scope as follow-ups.

### 2. Ask one round of questions

- Ask **3–6 questions** in total, in **at most 2** AskUserQuestion calls (at most 4 questions per call).
- If the conductor reports **no checks found**, one of these questions must be: "No checks found. Which command verifies this project?" Offer the likeliest candidates as options. It counts toward the 6.
- If the conductor reports an excluded check with `confirm: true` (a normal check whose command only *looks* like e2e, e.g. `npm test` running `jest --selectProjects integration`), ask whether to keep it as a check. It also counts toward the 6.
- Ask only about what changes the design: purpose and users, scope edges, constraints (compatibility, dependencies, performance), behavior on the important error cases, and what "done" means.
- Prefer multiple choice. Put your recommended option first and mark it "(Recommended)".
- Don't ask about what you can decide by convention or from the repo. Decide those, and list them as assumptions.

### 3. Write the brief

Write `brief.md` in the run directory:

```markdown
# Brief: <title>

**Prompt:** <the user's original prompt, verbatim>

## Goal
<one or two sentences>

## In scope
- ...

## Out of scope
- ...

## Constraints
- ...

## Success criteria
- <observable outcomes; each one testable by the checks or by review — never by e2e>

## Assumptions
- <every decision you made without asking, one line each>
```

### 4. Get approval: the only gate

Show the brief in full and ask, with AskUserQuestion, "Approve this brief and run autonomously from here?" with the options **Approve**, **Revise** and **Cancel**.

- **Revise:** ask what to change in one open question, update the brief, and show it again.
- **Cancel:** stop. The conductor prints how to remove the worktree.
- **Approve:** clarification is over. From now on, nothing asks the user anything (except the optional `--confirm-spec` gate).

## Part 2: Spec rules (spec-writer)

Write the spec as a design document an engineer who has never seen the repo could plan from.

**Required sections, in this order:**

1. **Summary**: what is being built and why, in a paragraph.
2. **Decisions**: a table of topic → decision. **Every brief assumption appears here** as an explicit decision, along with any choice you made while writing.
3. **Architecture / Components**: units with one clear purpose each, how they talk, and what they depend on. Name files and modules; follow the repo's existing patterns.
4. **Data flow**: how input becomes output, step by step.
5. **Error handling**: a table of failure → behavior.
6. **Testing**: what the unit and integration tests prove, and which check commands run them. **E2E tests are never part of verification.** If the feature needs e2e coverage, list it under a "Manual e2e" heading for the user.
7. **Out of scope**: the brief's Out of scope list, plus anything you cut.

**Rules:**

- **YAGNI.** Build what the brief asks for and nothing more. Cut speculative options, configs and abstractions.
- **No placeholders:** no TODO, TBD, "handle appropriately" or "etc.". If it's undecided, decide it and add a Decisions row.
- Units small enough to hold in context. If a file you'll modify is already sprawling, a targeted split is fair. Unrelated refactors are not.
- Exact values (names, limits, messages, formats) are written into the spec, so the plan can copy them.
- The brief's success criteria must each map to something in Testing.
