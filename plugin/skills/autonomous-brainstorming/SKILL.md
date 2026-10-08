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
- Ask only about what changes the design: purpose and users, scope edges, constraints (compatibility, dependencies, performance), the external surface (screens, endpoints, commands) when the prompt leaves it open, behavior on the important error cases, and what "done" means.
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
- SC1: <an observable outcome, provable by the checks, by review, or by a QA scenario against a contract — never by an e2e check in the run>

## Assumptions
- <every decision you made without asking, one line each>
```

### 4. Get approval: the only gate

First print the brief in full as ordinary message text (the whole `brief.md` content, every section, rendered as markdown), then give the path to `brief.md`. The user may be on a surface where they can't open worktree files, so a path or a summary in the question is never a substitute. Do not call AskUserQuestion until the full brief has been output in the conversation.

Then ask, with AskUserQuestion, "Approve this brief and run autonomously from here?" with the options **Approve**, **Revise** and **Cancel**. Keep the question text short; it must not carry the brief.

- **Revise:** ask what to change in one open question, update the brief, and print the full updated brief again before asking for approval.
- **Cancel:** stop. The conductor prints how to remove the worktree.
- **Approve:** clarification is over. From now on, nothing asks the user anything (except the optional `--confirm-spec` gate).

## Part 2: Spec rules (spec-writer)

Write the spec as a design document an engineer who has never seen the repo could plan from.

**Required sections, in this order:**

1. **Summary**: what is being built and why, in a paragraph.
2. **Decisions**: a table of topic → decision. **Every brief assumption appears here** as an explicit decision, along with any choice you made while writing.
3. **Architecture / Components**: units with one clear purpose each, how they talk, and what they depend on. Name files and modules; follow the repo's existing patterns.
4. **Contracts**: every external surface the change adds or changes (see Contracts below). The implementation plan builds to them and the QA test plan tests against them, so both meet the same goal.
5. **Data flow**: how input becomes output, step by step.
6. **Error handling**: a table of failure → behavior. Every failure a caller can see also appears in its contract's Errors.
7. **Testing**: what the unit and integration tests prove, and which check commands run them. Then a table mapping each success criterion (`SC1`, …) to its contracts and how it's proved: a check, review, or QA scenarios in the test plan. **E2E tests are never part of the run's verification.** If the feature needs e2e coverage beyond the QA test plan (a real external service, a deploy), list it under a "Manual e2e" heading for the user.
8. **Out of scope**: the brief's Out of scope list, plus anything you cut.

### Contracts

One entry per surface a user or a client can reach: a UI screen or component, an HTTP/RPC endpoint, a CLI command, a public library API, an emitted event, a file format. Internal functions are not contracts; their names belong to the plan.

```markdown
### C1: <name> (API | UI | CLI | Library | Event | File)

- **Surface:** `POST /api/v1/tokens` · the `/settings/tokens` screen · `tool export <file>` · `export function parse(text: string): Doc`
- **Who:** <who may use it, and what happens to anyone else; omit if anyone may>
- **Input:** <each field or argument: name, type, required or optional, default, limits>
- **Output:** <the success result: status or exit code, and each field with its exact name and type; for UI, what the user sees and where they end up>
- **Errors:** <each condition → exact status or exit code, error code and message>
- **States (UI only):** <loading, empty, error, success, each with its exact copy>
- **Criteria:** SC1, SC3
```

If the change has no external surface (a pure refactor or internal fix), write `None: <why>` and name the existing surfaces it must not change.

**Rules:**

- **YAGNI.** Build what the brief asks for and nothing more. Cut speculative options, configs and abstractions.
- **No placeholders:** no TODO, TBD, "handle appropriately" or "etc.". If it's undecided, decide it and add a Decisions row.
- Units small enough to hold in context. If a file you'll modify is already sprawling, a targeted split is fair. Unrelated refactors are not.
- Exact values (names, limits, messages, formats) are written into the spec, so the plan can copy them.
- The brief's success criteria must each map to something in Testing. Every success criterion about behavior names at least one contract, and every contract names at least one criterion.
- Contracts are exact. Two engineers reading the same contract build the same response, and a tester who has never seen the code can check it.
