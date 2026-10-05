# Upstream provenance

Three duckor-flow skills are adapted from [obra/superpowers](https://github.com/obra/superpowers), pinned at commit `5bf4e78011075bcfc0dc295f0724994cd123ee71` (superpowers 6.4.1, the version `claude-plugins-official` lists). Every other superpowers skill the plugin names is used as-is from the installed `superpowers` plugin.

| duckor-flow skill | Upstream | What changed |
| --- | --- | --- |
| `autonomous-brainstorming` | `skills/brainstorming` | One clarification round (3–6 questions, at most 2 AskUserQuestion calls) ending in a brief that the user approves once. No visual companion, no section-by-section approval, no spec review gate, no handoff. Spec rules moved to Part 2 for the `spec-writer` agent. |
| `autonomous-writing-plans` | `skills/writing-plans` | No execution handoff. Each task lists its checks. E2E is banned from tasks and collected under `## Manual e2e`. |
| `autonomous-execution` | `skills/subagent-driven-development` (and `skills/executing-plans`) | The conductor runs checks itself after every implementer. Fix loops are capped (3 rounds plus one systematic-debugging attempt). Rulings go through the status block into `state.json`. No pauses, no ledger scripts. The final review gets one fix round. |

`skills-lock.json` is deliberately not used for these: it drives installation into `.agents/skills`, and a restore would overwrite the adaptations.

## Resyncing

1. Diff the upstream skill between the pinned commit and the new one: `git diff 5bf4e78..<new> -- skills/<name>`.
2. Port the changes that don't reintroduce a human gate.
3. Update the commit in each adapted `SKILL.md` header, in this file, and in `UPSTREAM_SHA` in `test/plugin.test.ts`.
