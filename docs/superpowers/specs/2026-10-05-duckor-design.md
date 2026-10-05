# Duckor: design

Date: 2026-10-05
Status: approved in brainstorming, pending spec review

## Summary

Duckor is an autonomous coding loop for a git repository. It keeps a coding agent (`claude -p`) working on a task, one fresh-context iteration at a time, until the work is done and verified. It borrows the core ideas of [ralph-orchestrator](https://github.com/mikeyobrien/ralph-orchestrator): hats that coordinate through events, backpressure gates that reject unverified work, and a scratchpad that carries state between iterations. It is written in TypeScript and follows the structure and conventions of [duckwright](https://github.com/locle97/duckwright).

The harness owns the loop. Each iteration, one hat runs as a tool-using `claude -p` session and ends by returning a single structured event. The harness validates that event, runs the gates, commits the verified change, and routes the event to the next hat.

## Goals

- Run an agent on a repo until a task is complete, with every completed step verified by gates and committed.
- Let users define a workflow as hats and events in `duckor.yml`, with bundled presets for common workflows.
- Make each harness phase (iteration prompt, gate feedback, commit) driven by a Markdown skill that a repo can override.
- Keep duckwright's safety stance: argv-only subprocesses, an explicit tool allow-list, untrusted text fenced as data.

## Non-goals (v1)

Other agent backends, persistent memories, a task store, TUI or web UI, Telegram or other human-in-the-loop channels, an MCP server, parallel loops, resuming a run, and a `duckor plan` command. The agent interface leaves room for other backends later.

## Decisions

| Topic | Decision |
| --- | --- |
| Primary use | Autonomous coding on a repo |
| Backend | Claude Code only (`claude -p`), behind an `AgentFn` interface |
| Orchestration | Full hats and events, configured in YAML |
| Config format | `duckor.yml`, parsed with the `yaml` package (the only runtime dependency) |
| State between iterations | One `scratchpad.md` per run; long-lived knowledge stays in the repo's `CLAUDE.md` / `AGENTS.md` |
| Agent permissions | Configurable `allowed_tools` allow-list with a safe default; never `--dangerously-skip-permissions` |
| Commits | Harness decides when; a `commit` skill run as a locked-down agent call decides how |
| Event emission | Structured final output via `--output-format json --json-schema` |
| Customization | Each phase is a skill file; `.duckor/skills/<name>.md` overrides the bundled `skills/<name>.md` |

## Project layout

Same shape as duckwright: ESM TypeScript, Node >= 22.18, flat `src/*.ts`, tests in `test/*.test.ts` run with `node --test`, `tsc` for typecheck and build, `bin` in `dist/bin.js`.

```
src/
  bin.ts        entry point
  cli.ts        subcommands: run, init, presets, --version
  args.ts       flag parsing
  config.ts     load and validate duckor.yml or a preset; typed Config with defaults
  events.ts     Event type, glob topic matching, routing an event to a hat
  skills.ts     resolve a skill: .duckor/skills/<name>.md, else bundled skills/<name>.md
  prompt.ts     build the iteration prompt
  agent.ts      run claude -p for one hat; AgentFn interface
  gates.ts      run gate commands, collect results
  commit.ts     commit phase: run the commit skill, verify, fall back
  git.ts        dirty check, HEAD sha, changed-since check
  loop.ts       Orchestrator
  rundir.ts     .duckor/runs/<timestamp-name>/
  proc.ts       spawn runner with timeout and abort (from duckwright)
  text.ts       text helpers (from duckwright)
  paths.ts      package asset paths (from duckwright)
skills/
  iteration.md
  gate-feedback.md
  commit.md
presets/
  solo.yml          one hat: the classic Ralph loop
  code-assist.yml   planner -> builder -> reviewer
  debug.yml         reproduce -> fix -> verify
test/
```

`package.json` `files` includes `dist`, `skills` and `presets`.

## Configuration

`duckor init --preset <name>` writes a `duckor.yml`. Example:

```yaml
loop:
  starting_event: work.start
  completion_event: LOOP_COMPLETE
  max_iterations: 50
  max_runtime_minutes: 240
  max_cost_usd: 20
  max_failures: 3         # consecutive agent failures before stopping
  max_gate_retries: 3     # consecutive gate failures for one event before stopping

agent:
  model: sonnet
  allowed_tools: [Read, Edit, Write, Glob, Grep, "Bash(npm test *)"]
  timeout_minutes: 20

guardrails:
  - "Fresh context each iteration: re-read the scratchpad."

gates:
  - name: test
    command: [npm, test]
    timeout_minutes: 10
    on_fail: "Tests failed. Fix them before finishing."

commit:
  enabled: true

hats:
  builder:
    name: "🔨 Builder"
    description: "Implements the next step"
    triggers: [work.start, review.rejected]
    publishes: [build.done, build.blocked]
    default_publishes: build.done
    gates: [test]          # omitted = all gates; [] = none
    max_activations: 20
    instructions: |
      Implement the next unchecked step in the task...
```

Rules enforced at load time (any violation exits with code 2 and names the path, e.g. `hats.builder.gates[0]: unknown gate "lint"`):

- Unknown keys are rejected.
- Every hat has at least one trigger and at least one publish topic.
- No two hats can be triggered by the same concrete topic. For glob triggers, overlap is checked against every topic that is published anywhere plus the starting event.
- The starting event triggers exactly one hat.
- Every published topic is either the completion event or triggers some hat.
- `default_publishes`, if set, is in `publishes`.
- Every name in a hat's `gates` exists in `gates`.
- Gate `command` is a non-empty string array.

Defaults: `agent.allowed_tools` defaults to `[Read, Edit, Write, Glob, Grep]` plus `Bash(<full gate argv> *)` for each gate (e.g. `Bash(npm test *)`, not `Bash(npm *)`), so the agent can run the gates itself and nothing broader. Limits default to the values in the example.

`.duckor/` is the per-repo directory: `.duckor/skills/` holds overrides and is committed; `.duckor/runs/` holds run output and is never committed. Every `duckor run` (with or without `init`) ensures `.duckor/runs/` is listed in `.git/info/exclude`, which changes no tracked file. `duckor init` also adds it to `.gitignore`. All harness change detection and staging additionally pass the pathspec `:!.duckor/runs`, so run output can never make the tree look changed or end up in a commit.

The task comes from `duckor run "<task>"` or `-f PROMPT.md`. It is the payload of the starting event and is included in every iteration prompt.

## Skills

A skill is a Markdown file with `{{placeholder}}` substitution. `skills.ts` looks for `.duckor/skills/<name>.md` in the repo and falls back to the bundled `skills/<name>.md`. Unknown placeholders are left as is.

| Skill | Used | Placeholders |
| --- | --- | --- |
| `iteration` | Wraps every hat's prompt | `{{task}}`, `{{hat_name}}`, `{{hat_instructions}}`, `{{event_topic}}`, `{{event_payload}}`, `{{publishes}}`, `{{scratchpad_path}}`, `{{guardrails}}`, `{{gate_feedback}}`, `{{iteration}}` |
| `gate-feedback` | Rendered once per failing gate, results joined with blank lines into `{{gate_feedback}}` when retrying | `{{gate_name}}`, `{{on_fail}}`, `{{output}}`, `{{attempt}}` |
| `commit` | The commit phase prompt | `{{hat_name}}`, `{{iteration}}`, `{{event_topic}}`, `{{summary}}`, `{{diff_stat}}`, `{{do_not_stage}}` |

Text from the agent or tools (event payloads, summaries, gate output) is fenced and escaped when substituted, and the bundled `iteration` skill tells the agent to treat fenced blocks as data.

## Data flow

The loop holds one current event; every iteration consumes one event and produces at most one, so no queue is needed.

**Iteration = one hat run.** Every run of a hat is an iteration, including retries after an agent failure or a gate failure. Each iteration increments the counter used for `{{iteration}}`, `iter-NNN.log` and `max_iterations`, counts toward `max_activations`, and gets its own `IterationRecord` with an `outcome` of `ok`, `agent_failed` or `gates_failed`. The commit phase belongs to the iteration that triggered it.

**Change baseline.** At run start the harness records the set of already-dirty paths (empty unless `--allow-dirty`). "The tree changed" means `git status --porcelain -- . :!.duckor/runs` lists a path that is not in that baseline. The baseline is not reset between iterations or retries; HEAD moves only through duckor commits, so uncommitted edits from a failed attempt are still "changed" when a later retry passes and are committed then. Baseline paths are never staged: the commit skill receives them as a do-not-stage list, and the fallback stages explicit paths, excluding them. (If a hat edits a baseline path, that edit stays uncommitted; this is a documented limitation of `--allow-dirty`.)

```
event <- starting_event(task)
loop:
  check limits (iterations, runtime, cost) and abort signal; iteration++
  hat <- route(event)                          # none: stop "unrouted"
  hat.activations++ > max_activations           # stop "hat_exhausted:<hat>"
  prompt <- iteration skill + hat + event + scratchpad path + guardrails + feedback
  result <- agent(prompt, schema(hat.publishes))
    failure: record (agent_failed); failures++, retry same event; failures >= max_failures: stop "agent_failed"
  out <- result.event ?? hat.default_publishes  # neither: agent failure
  gates <- run(hat.gates)
    any fail: record (gates_failed); gateRetries++, feedback <- gate-feedback skill, retry same event
              gateRetries > max_gate_retries: stop "gates_failed"
  if tree changed (vs baseline) and commit.enabled: commit phase
  record iteration (outcome ok); reset failures, gateRetries, feedback
  if out.topic == completion_event: stop "completed"
  event <- out
```

`max_activations` counts every run of a hat, including retries.

### Agent call

`agent.ts` runs, with `cwd` set to the repo root:

```
claude -p --output-format json --json-schema <schema>
  --tools <tools> --allowedTools <tools...>
  --model <model>
  --no-session-persistence --strict-mcp-config --disable-slash-commands
```

`--tools` and `--allowedTools` both get the allow-list, so tools outside it are not available at all (as in duckwright). `--allowedTools` is variadic and is always followed by another flag. The prompt goes on stdin.

`AgentFn` is `(req: { prompt, tools, schema | null, model, timeoutMs, signal }) => Promise<AgentResult>`. Both the hat call and the commit call go through it, so loop tests can script both. The schema requires:

```json
{ "event": { "topic": "<enum of hat.publishes>", "payload": "string" }, "summary": "string" }
```

`event` is optional so that `default_publishes` can apply; when `event` is present, `topic` and `payload` are both required (`payload` may be empty). The harness parses the `claude` JSON envelope (result, cost) and re-validates the structured output with a small hand-written validator for this one shape (no schema library at runtime), and returns `{ event, summary, costUsd, raw }`. Tests inject a fake `AgentFn`.

### Gates

Each gate runs as an argv list (no shell) in the repo root with its own timeout. A missing command or timeout counts as a failure. Output (stdout + stderr) is trimmed to the last 4,000 characters for feedback and saved in full to the iteration log.

### Commit phase

Runs only when the working tree differs from its state at iteration start, gates passed, and `commit.enabled` is true. It calls `claude -p` with the `commit` skill and a fixed allow-list: `Bash(git add *)`, `Bash(git commit *)`, `Bash(git status *)`, `Bash(git diff *)`. It runs with no JSON schema. Afterwards the harness checks that HEAD moved, that no changed path (vs baseline) is left uncommitted, and that the new commit touches no baseline path. If any check fails, it records `commit_failed`; if HEAD moved, it resets it back softly (`git reset --soft <previous HEAD>`) and then makes a fallback commit itself: `git add -- <changed paths>` then `git commit -m "duckor: <hat> iter <n>"`.

Hook safety: hats have Write access, so at run start the harness hashes `.git/hooks/` and records `core.hooksPath`. Before each commit phase it re-checks both; any change stops the run with `hooks_tampered` before anything is committed. Because hooks are verified unchanged, the repo's own hooks run normally for both the skill's commit and the fallback commit. Commit costs count toward `max_cost_usd`.

## Run output

`.duckor/runs/<YYYYMMDD-HHMMSS-name>/`:

- `history.json`: task, config snapshot, stop reason, totals, and one `IterationRecord` per iteration: `{ iteration, hat, outcome, inputEvent, outputEvent, summary, gates: [{name, passed, durationMs}], commit: {sha, fallback} | null, costUsd, durationMs, error? }`. Written after every iteration and on stop.
- `scratchpad.md`: created empty at start; hats read and update it (it is inside the repo, so `Read`/`Edit` reach it, and it is excluded from git as above).
- `iter-NNN.log`: raw `claude` JSON for the hat and commit calls, plus full gate output.

Console, one line per iteration:

```
iter 3 | 🔨 Builder | review.rejected → build.done | gates: test ✓ lint ✓ | a1b2c3d | $0.41
```

And a final summary: stop reason, iterations, total cost, commits, history path.

## Error handling

| Failure | Behavior |
| --- | --- |
| Invalid config | Exit 2 before spawning anything, with a path-qualified message |
| Dirty tree at start | Refuse unless `--allow-dirty` |
| Not a git repo with `commit.enabled` | Refuse to start |
| `claude` non-zero exit, timeout, bad JSON, schema mismatch | Agent failure; retry same event; stop after `max_failures` in a row |
| Topic outside `publishes` | Prevented by schema enum; re-checked; agent failure if it slips through |
| No event and no `default_publishes` | Agent failure |
| Gate missing, failing or timing out | Gate failure; retry hat with feedback; stop after `max_gate_retries` |
| Commit phase leaves HEAD unmoved, changes uncommitted, or commits a baseline path | Record `commit_failed`, soft-reset if needed, make fallback commit |
| `.git/hooks` or `core.hooksPath` changed during the run | Stop `hooks_tampered` before committing |
| `max_activations` exceeded | Stop `hat_exhausted:<hat>` |
| Ctrl-C | SIGTERM the child, record the partial iteration, write history, exit 130 |

Exit codes: 0 completed; 1 limit or failure stop; 2 config or usage error; 130 interrupted.

## CLI

```
duckor run "<task>" | -f PROMPT.md   [-c duckor.yml] [--preset NAME]
           [--max-iterations N] [--model M] [--allow-dirty] [--no-commit]
duckor init [--preset code-assist|solo|debug] [--force]
duckor presets
duckor --version
```

`-c` defaults to `./duckor.yml`; if it does not exist and no `--preset` is given, the `solo` preset is used. `--preset` uses the bundled preset and ignores `./duckor.yml`; passing both `-c` and `--preset` is a usage error. Flags override config. `init` refuses to overwrite an existing `duckor.yml` without `--force`.

## Testing

- Unit tests per module: config validation and defaults, glob matching and routing, skill override resolution, prompt assembly and fencing, agent argv/schema/parsing with a fake `Runner`, gates with tiny real commands (`node -e`), commit verification and fallback in a temporary git repo.
- `loop.test.ts`: `Orchestrator` with a scripted fake `AgentFn`, real gates and a real temporary git repo. Scenarios: solo completion; planner → builder → reviewer with a rejection loop; gate failure then recovery; gate retries exhausted; each limit; unrouted; abort; commit fallback.
- `cli.test.ts` and `packaging.test.ts`: flags, `init` output and `.gitignore`, `--version`, bundled skills and presets shipped.
- Optional end-to-end test against real `claude`, skipped unless `DUCKOR_E2E=1`.
- CI: duckwright's Node job (Node 22 and 24: `npm ci`, `npm test`, `npm run build`, `scripts/smoke_install.sh`) and its npm release workflow.

## Milestones

Each milestone is shippable and fully tested.

1. **M1, solo loop**: project scaffold (package.json, tsconfig, CI), `proc`, `text`, `paths`, `config` (single hat), `prompt` with bundled `iteration` skill, `agent`, `rundir`, `loop` with completion event, limits, abort and `history.json`, `duckor run`.
2. **M2, backpressure and commits**: `gates`, `gate-feedback` skill and retries, `git`, `commit` phase with skill and fallback, dirty-tree check, `--allow-dirty`, `--no-commit`.
3. **M3, hats and events**: multi-hat config, glob routing, full load-time validation, `max_activations`, `default_publishes`.
4. **M4, skills and presets**: `.duckor/skills` overrides, bundled presets, `duckor init` and `duckor presets`, README, packaging test, npm release.
