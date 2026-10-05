# state.json

The conductor writes `<worktree>/.duckor/flow/<run>/state.json` after every step. Paths are relative to `worktree` unless noted.

```json
{
  "version": 1,
  "run": "20261005-142000-add-auth",
  "prompt": "add auth",
  "phase": "execute",
  "blocked_reason": null,
  "blocked_phase": null,
  "options": { "confirm_spec": false },
  "branch": "duckor/add-auth",
  "worktree": "/abs/path/to/worktree",
  "base_sha": "abc1234",
  "checks": [{ "name": "test", "cmd": "npm test" }],
  "plugin_root": "/abs/path/to/duckor-flow",
  "skills": { "commit": "commit", "code-review": "superpowers:requesting-code-review", "tdd": "superpowers:test-driven-development", "debugging": "superpowers:systematic-debugging", "verification": "superpowers:verification-before-completion" },
  "review_mode": "augment",
  "skill_sources": { "commit": "user", "code-review": "default", "tdd": "default", "debugging": "default", "verification": "default" },
  "excluded_checks": [{ "name": "test:e2e", "cmd": "npm run test:e2e", "reason": "looks like an end-to-end check (\"e2e\")", "confirm": false }],
  "baseline_failures": [],
  "brief": ".duckor/flow/20261005-142000-add-auth/brief.md",
  "spec": "docs/superpowers/specs/2026-10-05-add-auth-design.md",
  "plan": "docs/superpowers/plans/2026-10-05-add-auth.md",
  "test_plan": "docs/superpowers/test-plans/2026-10-05-add-auth-test-plan.md",
  "test_scenarios": 14,
  "review_rounds": { "spec": 1, "plan": 0, "test_plan": 0, "final": 0 },
  "tasks": [
    { "n": 1, "title": "Token model", "status": "done", "base": "abc1234", "head": "def5678", "fix_rounds": 1, "concerns": [] }
  ],
  "decisions": ["Chose JWT over sessions — brief says stateless API — swap middleware if wrong"],
  "minor_issues": ["src/auth.ts:40 magic number for token TTL"]
}
```

| Field | Meaning |
| --- | --- |
| `version` | Schema version, `1` |
| `run` | Run id `<YYYYMMDD-HHMMSS>-<slug>`, also the run dir name |
| `prompt` | The user's original prompt, verbatim |
| `phase` | `setup`, `clarify`, `spec`, `plan`, `test_plan`, `execute`, `finish`, `completed`, `blocked` |
| `blocked_reason` | `null`, or one of `spec_review`, `plan_review`, `test_plan_review`, `spec_writer`, `plan_writer`, `test_plan_writer`, `task <n>`, `task <n> review`, `final checks`, `cancelled at brief`, `cancelled at spec` |
| `blocked_phase` | The phase the run was in when it blocked; `--resume` restores it (`null` unless blocked) |
| `options` | Flags for the run: `confirm_spec` |
| `branch` | `duckor/<slug>` |
| `worktree` | Absolute path to the worktree |
| `base_sha` | HEAD when the run started; the final review covers `base_sha..HEAD` |
| `checks` | `[{name, cmd}]` that gate every task |
| `plugin_root` | Absolute path to the installed duckor-flow plugin, passed to every agent |
| `skills` | Role → skill name (`commit`, `code-review`, `tdd`, `debugging`, `verification`), from `resolve-skills.mjs`; `commit: null` means a plain `git commit`. Passed to every agent |
| `review_mode` | `augment` or `replace`: how a configured `code-review` skill combines with the default |
| `skill_sources` | Where each role came from: `default`, `user` or `project`; the report lists the non-default ones |
| `excluded_checks` | `[{name, cmd, reason, confirm}]`, never run, copied into the report's manual e2e list. `confirm: true` means it was excluded only because of its command; clarify asks about it |
| `baseline_failures` | Names of checks already failing at setup; they don't block |
| `brief` | Path to `brief.md` |
| `spec` | Spec path, once written |
| `plan` | Plan path, once written |
| `test_plan` | QA test plan path, once written |
| `test_scenarios` | Number of `TS-` scenarios in the approved test plan |
| `review_rounds` | Fix rounds used per document review (`spec`, `plan`, `test_plan`) and for the final review |
| `tasks` | One entry per plan task: `n`, `title`, `status` (`pending`, `in_progress`, `done`, `blocked`), `base`, `head`, `fix_rounds`, `concerns` |
| `decisions` | Every ruling made for the user, `<decision> — <why> — <cost if wrong>` |
| `minor_issues` | Minor review findings, reported but not fixed |
