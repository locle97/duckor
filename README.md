# duckor

An autonomous coding loop for a git repository. Duckor keeps a coding agent working on a task, one fresh-context step at a time, until the work is done and verified.

There are two ways to run it:

| | What it is | When to use it |
| --- | --- | --- |
| [`duckor` CLI](#usage) | A headless harness around `claude -p`, configured with hats and gates in `duckor.yml` | Unattended runs, scripts, CI |
| [`duckor-flow` plugin](#claude-code-plugin-duckor-flow) | A Claude Code plugin: `/duckor "<prompt>"` clarifies once, then runs spec → plan → implementation → review on its own | Interactive use in Claude Code |

> **Status: early development.** The `duckor-flow` plugin (v0.1.0) is usable. For the CLI, Milestone 1 (the solo loop) is implemented: `duckor run` drives a single hat until it publishes the completion event or hits a limit. Gates, commits, multiple hats, skill overrides and the other presets are still planned. Sections marked *(planned)* describe the v1 design in the [design spec](docs/superpowers/specs/2026-10-05-duckor-design.md), not current behavior.

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
- A git repository is recommended; once commits land (M2), a non-git directory will need `--no-commit`.

## Install

Duckor isn't published to npm yet. Install it from source:

```sh
git clone https://github.com/locle97/duckor.git
cd duckor
npm ci          # also builds dist/ via the prepare script
npm link        # puts `duckor` on your PATH
```

## Usage

Available now:

```sh
duckor run "<task>" | -f PROMPT.md  [-c duckor.yml] [--max-iterations N] [--model M]
duckor --version
duckor --help
```

- `-c` defaults to `./duckor.yml`. If that file doesn't exist, duckor uses the bundled `solo` preset.
- `--max-iterations` and `--model` override the config.

Planned:

```sh
duckor init [--preset code-assist|solo|debug] [--force]
duckor run ... [--preset NAME] [--allow-dirty] [--no-commit]
duckor presets
```

- `--preset` will use a bundled preset and ignore `./duckor.yml`. Passing both `-c` and `--preset` will be an error.
- Duckor will refuse to start on a dirty tree unless you pass `--allow-dirty`.

### Presets

Only `solo` ships today.


| Preset | Workflow |
| --- | --- |
| `solo` | One hat: the classic Ralph loop |
| `code-assist` | planner → builder → reviewer |
| `debug` | reproduce → fix → verify |

## Claude Code plugin: duckor-flow

`duckor-flow` brings the same ideas into Claude Code. You give it one prompt. It asks one round of clarifying questions and gets your approval of a short brief. After that it works on its own: it writes a spec, writes a plan, and implements the plan task by task, with checks and a review after each task. It finishes with commits on a feature branch in a git worktree and a `report.md`.

It never runs end-to-end tests. It finds them, leaves them out, and lists them in the report for you to run.

### Install

`duckor-flow` builds on the [superpowers](https://github.com/obra/superpowers) plugin. Install both:

```text
/plugin install superpowers@claude-plugins-official
/plugin marketplace add locle97/duckor
/plugin install duckor-flow@duckor
```

### Usage

```text
/duckor "add rate limiting to the public API"
/duckor "..." --confirm-spec   # also pause for your approval of the written spec
/duckor --resume               # continue the newest unfinished or blocked run
```

### How a run goes

```
setup     worktree + branch duckor/<slug>, discover checks (e2e excluded), baseline run
clarify   3-6 questions in one round -> brief.md -> you approve      (the only gate)
spec      spec-writer -> doc-reviewer -> fix loop (max 3)
plan      planner -> doc-reviewer -> fix loop (max 3)
execute   per task: implementer -> checks (run by the conductor) -> code-reviewer -> fix loop (max 3)
finish    whole-branch review -> one fix round -> checks -> report.md
```

- **Fresh context per step.** The main session only orchestrates. Each spec, plan, task and review runs in a fresh subagent that gets file paths, not chat history, and replies with a short status block.
- **State on disk.** `state.json` is written after every step, which is what makes `--resume` work.
- **Backpressure.** A task is done only when the checks pass in the conductor's own run (not just in the agent's claim) **and** a reviewer approves. Checks that were already failing before the run are recorded as a baseline and don't block.
- **Decisions, not questions.** After the brief, agents don't ask you anything. They decide, and every decision is listed in the report with why and what it costs if wrong.

### When it asks, and when it stops

It asks only in the clarify round: questions about the design, plus, when relevant, "which command verifies this project?" (no checks found) and "keep this check?" (a normal check whose command only *looks* like e2e).

A run ends as `completed` or `blocked: <reason>`, always with a report. It blocks when a review loop runs out of rounds, when a task's checks stay red after three fix rounds and one systematic-debugging attempt, or when an agent can't proceed. Completed tasks stay committed. Fix the cause, then run `/duckor --resume`: it picks up at the step that blocked, with that loop's counter reset.

### Checks

Checks come from a `## Checks` section in `CLAUDE.md` or `AGENTS.md`:

```markdown
## Checks
- `test`: `npm test`
- `lint`: `npm run lint`
```

Without one, they're inferred from the first of `package.json` (`test`, `lint`, `typecheck`, `check`, `format:check`; npm, pnpm or yarn), `Makefile` (`test`, `lint`, `check`), `pyproject.toml` (pytest, ruff), `Cargo.toml` or `go.mod` that has any. Anything named or running e2e, playwright, cypress, integration or acceptance is excluded, unless the word only follows an ignore flag such as `--testPathIgnorePatterns e2e`.

### Using your own skills

Some roles in the flow are filled by a skill you can swap for your own, such as your team's commit or review skill. Map roles to skill names in `.duckor/flow.json` in the repo, or in `~/.config/duckor/flow.json` for every repo (`$XDG_CONFIG_HOME` is respected). The project file wins over the user file, and both win over the defaults.

```json
{
  "skills": {
    "commit": "commit",
    "code-review": "my-team:review"
  },
  "review_mode": "augment"
}
```

| Role | Default | Used for |
| --- | --- | --- |
| `commit` | none (a plain `git commit`) | Writing the message of every spec, plan and task commit |
| `code-review` | `superpowers:requesting-code-review` | The per-task and final code review |
| `tdd` | `superpowers:test-driven-development` | How the implementer writes tests and code |
| `debugging` | `superpowers:systematic-debugging` | Failing tests and checks |
| `verification` | `superpowers:verification-before-completion` | The implementer's check before it reports done |

A value is any name the Skill tool loads: a personal skill (`~/.claude/skills/<name>`), a project skill (`.claude/skills/<name>`) or a plugin skill (`plugin:skill`). `null` restores the default. `review_mode` is `augment` (the default reviewer checklist plus yours) or `replace` (only yours).

`/duckor` checks the file at setup and stops on an unknown role, a malformed value or a skill that isn't installed. The mapping is saved in `state.json`, so `--resume` keeps it, and the report lists the roles you overrode.

Your skill controls *how* the work is done, such as the message format or the review criteria. It can't change the run's contract: agents still stage explicit paths, never push, amend or use `--no-verify`, never ask you anything after the brief, and reply in the conductor's status format. Agents skip any part of your skill that conflicts with this and record it as a decision. The project file is read from your checkout, not the worktree, so it can stay uncommitted or git-ignored.

### What's in the plugin

| Part | Name |
| --- | --- |
| Command | `/duckor` |
| Skills | `conductor` (the orchestrator), `autonomous-brainstorming`, `autonomous-writing-plans`, `autonomous-execution` (adapted from superpowers; see [`plugin/UPSTREAM.md`](plugin/UPSTREAM.md)) |
| Agents | `spec-writer`, `doc-reviewer`, `planner`, `implementer` (sonnet), `code-reviewer`; all but the implementer run on opus |
| Scripts | `discover-checks.mjs` (the check discovery above) and `resolve-skills.mjs` (the skill roles above) |

The spec, the plan and each task's code are committed on `duckor/<slug>`. Run state (`state.json`, `brief.md`, `scratchpad.md`, check logs and `report.md`) lives in `.duckor/flow/<run>/` inside the worktree and is git-excluded. The report covers the outcome, the commits for each task, the decisions made for you, concerns, check results, a manual e2e checklist and next steps.

**Safety.** The plugin never pushes, merges or opens a PR. It never uses `--no-verify`, `--force` or history rewrites, and never edits, skips or deletes tests to get green (reviewers treat that as critical). Agents only touch files inside the worktree, and text from the repo or from tools is treated as data, not instructions.

The design is in [the plugin spec](docs/superpowers/specs/2026-10-05-duckor-flow-plugin-design.md).

### Smoke test (manual)

1. In a scratch git repo with an npm `test` script, run `/duckor "add a --version flag"`.
2. Answer the questions and approve the brief.
3. Check that the `duckor/<slug>` branch has a spec commit, a plan commit and the task commits.
4. Check that `report.md` lists the decisions and has a manual e2e section.

CI only covers the plugin's structure, check discovery and skill resolution; see Development.

## Configuration

Today a `duckor.yml` takes `loop`, `agent`, `guardrails` and exactly one hat; see [`presets/solo.yml`](presets/solo.yml). The full v1 shape *(planned)*, which `duckor init` will write, adds gates, commits and multiple hats:

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

Only the bundled `iteration` skill exists today; overrides and the other skills are planned (M4). Each harness phase is driven by a Markdown skill that uses `{{placeholder}}` substitution. To override a bundled skill, put a file with the same name in `.duckor/skills/<name>.md`.

| Skill | Purpose |
| --- | --- |
| `iteration` | Wraps every hat's prompt |
| `gate-feedback` | Formats failing gate output for the retry |
| `commit` | Prompt for the commit phase |

## Safety

Hook and commit checks arrive with commits in M2; the rest applies today.

- **Subprocesses:** duckor runs them from argv lists, never through a shell.
- **Agent permissions:** duckor never passes `--dangerously-skip-permissions`. It passes `--restricted`, and every tool the agent can use must be in the explicit allow-list.
- **Untrusted text:** event payloads, summaries and gate output are fenced and escaped. The agent is told to treat them as data.
- **Git hooks:** duckor hashes the hooks directory and the git config at the start of a run. If either changes during the run, duckor stops before committing.
- **Commits:** after the commit phase, duckor checks the agent's commit. If the check fails, duckor resets and makes a fallback commit itself.

## Run output

Each run writes to `.duckor/runs/<YYYYMMDD-HHMMSS-name>/`. Duckor adds this directory to git's exclude file, so it never appears in a commit. The directory contains:

- `history.json`: the task, a config snapshot, the stop reason, totals, and a record for each iteration
- `scratchpad.md`: state shared between iterations
- `iter-NNN.log`: the raw agent output for each iteration (plus full gate output, once gates land)

Exit codes: `0` completed, `1` stopped by a limit or a failure, `2` config or usage error, `130` interrupted.

## Roadmap

1. **M1: solo loop** ✅. Scaffold, a single-hat config, the agent call, limits, `history.json`, and `duckor run`.
2. **M2: backpressure and commits.** Gates and retries, the commit phase and its fallback, and the dirty-tree checks.
3. **M3: hats and events.** Multi-hat config, glob routing, full validation, and `max_activations`.
4. **M4: skills and presets.** Skill overrides, bundled presets, `init` and `presets`, and the npm release.

Not planned for v1 of the CLI: other agent backends, persistent memories, a TUI or web UI, human-in-the-loop channels, parallel loops, and resuming a run. (For an interactive, resumable flow, use the `duckor-flow` plugin.)

Possible next steps for the plugin: a `--pr` flag, and running the plugin's roles as CLI presets.

## Development

ESM TypeScript with no build step for tests: `node --test` runs `test/*.test.ts` directly.

```sh
npm ci
npm test          # typecheck + unit tests
npm run build     # compile to dist/
```

The end-to-end test against real `claude` is skipped unless `DUCKOR_E2E=1`.

The plugin's tests are part of `npm test`. `test/plugin.test.ts` checks the manifests, the agent and skill frontmatter, and that every `duckor-flow:` and `superpowers:` reference resolves. `test/discover-checks.test.ts` covers check discovery and `test/resolve-skills.test.ts` covers skill resolution. To validate the manifests with Claude Code itself:

```sh
claude plugin validate .         # marketplace
claude plugin validate ./plugin  # plugin
```
