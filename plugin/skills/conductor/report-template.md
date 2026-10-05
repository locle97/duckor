# duckor-flow report: <run id>

## Outcome

**<completed | blocked: reason>**

- Branch: `<branch>`, base `<base_sha>` → head `<HEAD>`
- Worktree: `<worktree>`
- Spec: `<spec>` · Plan: `<plan>` · QA test plan: `<test_plan>` (<test_scenarios> scenarios)
- Skills: <each non-default role as `role: skill (user|project)`, plus `review_mode` if `replace`; or "defaults">

## What was built

<goal from the brief, one or two sentences>

| # | Task | Status | Commits | Fix rounds |
| --- | --- | --- | --- | --- |
| 1 | <title> | done | `<base7>..<head7>` | 0 |

## Decisions made for you

<every entry in `decisions`, one bullet each, in order; "None" if empty>

## Deviations and concerns

<task concerns (DONE_WITH_CONCERNS), open final-review issues, and when blocked: what failed, the last check output tail or review issues, and what was tried; "None" if empty>

## Checks

| Check | Command | Final result |
| --- | --- | --- |
| test | `npm test` | pass |

- Already failing before the run (not caused by this branch): <baseline_failures or "none">
- Minor review findings (not fixed): <minor_issues as bullets or "none">

## Manual e2e checklist

These weren't run. Run them yourself before merging:

- [ ] Hand the QA test plan to QA (or run it yourself): `<test_plan>`, P1 scenarios first
- [ ] `<excluded check command>`: <reason>
- [ ] <each item from the plan's `## Manual e2e` section>

## Next steps

- Review: `git -C <worktree> log --oneline <base_sha>..HEAD` and `git -C <worktree> diff <base_sha>..HEAD`
- Merge or open a PR from `<branch>` when you're satisfied (duckor-flow never pushes).
- Clean up afterwards: `git worktree remove <worktree>`
- If blocked: fix the cause or adjust the plan, then run `/duckor --resume`.
