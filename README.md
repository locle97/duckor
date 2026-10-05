# duckor

An autonomous coding loop for a git repository. Duckor keeps a coding agent (`claude -p`) working on a task, one fresh-context iteration at a time, until the work is done and verified.

> **Status: design stage.** Nothing is implemented yet. This README describes the planned v1 from the [design spec](docs/superpowers/specs/2026-10-05-duckor-design.md). Commands and config below show the intended interface, and they don't work yet.

Duckor borrows its core ideas from [ralph-orchestrator](https://github.com/mikeyobrien/ralph-orchestrator):

- **Hats** are roles (planner, builder, reviewer, ...) that hand work to each other through events.
- **Gates** are commands such as tests and linters. Any work that fails them is rejected and sent back to the agent with feedback.
- **A scratchpad** carries state from one iteration to the next.

The project structure and conventions follow [duckwright](https://github.com/locle97/duckwright).

## How it works

The harness owns the loop. Each iteration:

1. Routes the current event to the one hat it triggers.
2. Runs that hat as a tool-using `claude -p` session. The session ends by returning a single structured event.
3. Validates the event, then runs the hat's gates. If a gate fails, the same hat retries with the gate output as feedback.
4. If the tree changed and the gates passed, commits the change.
5. Stops on the completion event or when a limit is reached. Otherwise, it routes the new event to the next hat.

```
iter 3 | 🔨 Builder | review.rejected → build.done | gates: test ✓ lint ✓ | a1b2c3d | $0.41
```

## Requirements

- Node.js >= 22.18
- [Claude Code](https://claude.com/claude-code) CLI. It must be a version that supports `--restricted`; duckwright was tested with 2.1.288.
- A git repository. Without git, you must pass `--no-commit`.

## Usage (planned)

```sh
duckor init [--preset code-assist|solo|debug] [--force]
duckor run "<task>" | -f PROMPT.md  [-c duckor.yml] [--preset NAME]
           [--max-iterations N] [--model M] [--allow-dirty] [--no-commit]
duckor presets
duckor --version
```

- `-c` defaults to `./duckor.yml`. If that file doesn't exist and you don't pass `--preset`, duckor uses the `solo` preset.
- `--preset` uses a bundled preset and ignores `./duckor.yml`. Passing both `-c` and `--preset` is an error.
- Flags override config.
- Duckor refuses to start on a dirty tree unless you pass `--allow-dirty`.

### Presets

| Preset | Workflow |
| --- | --- |
| `solo` | One hat: the classic Ralph loop |
| `code-assist` | planner → builder → reviewer |
| `debug` | reproduce → fix → verify |

## Configuration

`duckor init` writes a `duckor.yml`:

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

Duckor validates the config at load time. On any error, it exits with code 2 and names the bad path, for example `hats.builder.gates[0]: unknown gate "lint"`. The rules:

- Unknown keys are rejected.
- Each topic triggers at most one hat, and the starting event triggers exactly one hat.
- Every published topic either triggers a hat or is the completion event.

If you don't set `agent.allowed_tools`, it defaults to `Read`, `Edit`, `Write`, `Glob` and `Grep`, plus one exact `Bash(...)` rule per gate. That lets the agent run the gates itself and nothing broader.

## Skills

Each harness phase is driven by a Markdown skill that uses `{{placeholder}}` substitution. To override a bundled skill, put a file with the same name in `.duckor/skills/<name>.md`.

| Skill | Purpose |
| --- | --- |
| `iteration` | Wraps every hat's prompt |
| `gate-feedback` | Formats failing gate output for the retry |
| `commit` | Prompt for the commit phase |

## Safety

- **Subprocesses:** duckor runs them from argv lists, never through a shell.
- **Agent permissions:** duckor never passes `--dangerously-skip-permissions`. It passes `--restricted`, and every tool the agent can use must be in the explicit allow-list.
- **Untrusted text:** event payloads, summaries and gate output are fenced and escaped. The agent is told to treat them as data.
- **Git hooks:** duckor hashes the hooks directory and the git config at the start of a run. If either changes during the run, duckor stops before committing.
- **Commits:** after the commit phase, duckor checks the agent's commit. If the check fails, duckor resets and makes a fallback commit itself.

## Run output

Each run writes to `.duckor/runs/<YYYYMMDD-HHMMSS-name>/`. Duckor adds this directory to git's exclude file, so it never appears in a commit. The directory contains:

- `history.json`: the task, a config snapshot, the stop reason, totals, and a record for each iteration
- `scratchpad.md`: state shared between iterations
- `iter-NNN.log`: the raw agent output and the full gate output for each iteration

Exit codes: `0` completed, `1` stopped by a limit or a failure, `2` config or usage error, `130` interrupted.

## Roadmap

1. **M1: solo loop.** Scaffold, a single-hat config, the agent call, limits, `history.json`, and `duckor run`.
2. **M2: backpressure and commits.** Gates and retries, the commit phase and its fallback, and the dirty-tree checks.
3. **M3: hats and events.** Multi-hat config, glob routing, full validation, and `max_activations`.
4. **M4: skills and presets.** Skill overrides, bundled presets, `init` and `presets`, and the npm release.

Not planned for v1: other agent backends, persistent memories, a TUI or web UI, human-in-the-loop channels, parallel loops, and resuming a run.

## Development

Planned: ESM TypeScript, with tests in `test/*.test.ts` run by `node --test`.

```sh
npm ci
npm test
npm run build
```
