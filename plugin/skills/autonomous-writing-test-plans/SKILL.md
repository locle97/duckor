---
name: autonomous-writing-test-plans
description: duckor-flow's QA test plan rules. The test-planner agent follows them to turn a spec's Contracts into black-box UI/API scenarios for QA, independent of the implementation plan. Use only inside a duckor-flow run.
---

# Autonomous writing test plans

Write the test plan for a QA engineer who has never seen this codebase and never will: they see the running product and this document. The spec's **Contracts** section is the source of truth. The implementation plan is somebody else's argument for how to meet it, so don't read it. A test plan written from the plan only checks that the plan was followed. A test plan written from the contracts checks that the goal was met.

Unit and integration tests are the implementer's job and already run as the run's checks. Don't repeat them here. Every scenario goes through a surface a user or a client can reach: a screen, an HTTP endpoint, a CLI command, a public library API, an emitted event or a written file. Nothing calls an internal function or reads internal state.

The run never executes this plan (no e2e). QA does, after the branch is built. Don't ask anyone anything.

## Before writing

1. Read the spec's **Contracts**, **Error handling**, **Testing** and **Decisions**, and the brief's **Success criteria** (`SC1`, `SC2`, …).
2. Read just enough of the repo to say how QA reaches each surface: the start command, the base URL or port, the CLI entry point, the route of each screen, how to get an account or a token, and how to seed data. Use the repo's existing commands. If the repo doesn't say, decide, and record a ruling.

## Scenarios each contract needs

- **Happy path:** at least one, with exact input and the exact expected output.
- **Every error row:** one scenario per error condition the contract lists, checking the exact status, code and message.
- **Boundaries:** each limit the contract names (lengths, ranges, counts, sizes), at the limit and one past it.
- **UI contracts:** each listed state (loading, empty, error, success), the exact visible copy, and where the user ends up afterwards (URL, screen, focus).
- **Access:** when the contract names who may call it, one allowed and one refused caller.
- **Regression:** for each existing surface the spec changes, one scenario showing that its old behavior still holds, unless the spec changes that behavior on purpose.

Don't invent behavior the spec doesn't define. If a scenario needs an answer the spec doesn't give, test the part the spec does define and add a `CONCERNS` line.

## Test plan document

```markdown
# <Feature> QA Test Plan

**Goal:** <the brief's goal, one sentence>
**Spec:** <repo-relative spec path>
**Scope:** Black-box UI/API scenarios against the spec's Contracts. Unit and integration tests are covered by the implementation and are not repeated here.

## Environment
- Start: `<command>` → <base URL, port or entry point>
- Accounts / auth: <how to get a user, a role or a token>
- Reset: <how to return to a clean state between runs>

## Test data
- <each fixture, with exact values, referenced by name in the scenarios>

## Coverage

| Criterion | Contracts | Scenarios |
| --- | --- | --- |
| SC1 | C1, C2 | TS-1, TS-2, TS-5 |

## Scenarios

### TS-1: <what is being proved>

**Contract:** C1 · **Criteria:** SC1 · **Type:** API | UI | CLI | Library | Event | File · **Priority:** P1 | P2 | P3

**Preconditions:** <state and test data, by name>

**Steps:**
1. <one action against the public surface, with exact input>

**Expected:**
- <an observable result with the spec's exact value: status code, response field, visible text, URL, exit code, file content>

## Regression
<TS scenarios for existing surfaces the change touches, in the same format; "None" if the change touches no existing surface>

## Out of scope
- Unit and integration tests (run as checks during implementation)
- <anything the spec's Out of scope excludes>
```

## Rules

- **Priorities:** P1 is the happy path of every success criterion. P2 is each error row and boundary. P3 is everything else. QA runs all P1 scenarios first.
- **Exact values.** Inputs and expected results quote the spec: field names, status codes, error codes, messages and copy, character for character. "Shows an error" or "returns the right data" is a gap.
- **Observable only.** Every expected line is something QA can see or capture from outside: a response, a screen, a log line the spec defines as output, a file. Never "the function is called" or "the row is updated", unless the contract makes it visible.
- **Reproducible.** Preconditions name the test data. A scenario never depends on another scenario's leftovers unless its preconditions say so.
- **One reasonable reading per step.** Each step is one action. No "etc.", no TODO, no "as appropriate".
- **Proportion.** Cover every contract and every success criterion. Don't multiply scenarios that prove the same thing with different values.
- **No contracts:** if the spec says the change has no external surface, the plan is the Regression section for the surfaces it could affect, and the Coverage table maps each criterion to them.

## Self-review before committing

1. **Coverage:** every success criterion and every contract appears in the Coverage table with at least one scenario. Every contract has a happy path and a scenario for each of its error rows.
2. **Black box:** no scenario restates a unit test or reaches past the public surface.
3. **Exactness:** every expected value matches the spec, character for character.
4. **Runnable:** Environment and Test data are enough to start from a clean state.

Fix issues inline. Record any decision the spec didn't make as a `RULINGS:` line in your status block.
