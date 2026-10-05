import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { parse } from "yaml";

import { DEFAULTS } from "../plugin/skills/conductor/scripts/resolve-skills.mjs";
import { ROOT } from "./helpers.ts";

const PLUGIN = path.join(ROOT, "plugin");

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Parse the leading `---` block of a Markdown file as YAML; every value must be a string. */
function frontmatter(file: string): Record<string, string> {
  const m = fs.readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error(`${file}: no frontmatter`);
  const data = parse(m[1]) as Record<string, unknown>;
  for (const [k, v] of Object.entries(data)) assert.equal(typeof v, "string", `${file}: ${k} is not a string`);
  return data as Record<string, string>;
}

test("manifests point at the plugin", () => {
  const market = readJson(path.join(ROOT, ".claude-plugin/marketplace.json"));
  assert.equal(market.name, "duckor");
  assert.ok(market.owner?.name);
  assert.equal(market.plugins.length, 1);
  assert.equal(market.plugins[0].name, "duckor-flow");
  assert.equal(market.plugins[0].source, "./plugin");
  const plugin = readJson(path.join(PLUGIN, ".claude-plugin/plugin.json"));
  assert.equal(plugin.name, "duckor-flow");
  assert.equal(plugin.version, "0.1.0");
  assert.ok(plugin.description);
});

const AGENTS: Record<string, { tools: string; model: string }> = {
  "spec-writer": { tools: "Read, Grep, Glob, Write, Edit, Bash, Skill", model: "opus" },
  "doc-reviewer": { tools: "Read, Grep, Glob", model: "opus" },
  planner: { tools: "Read, Grep, Glob, Write, Edit, Bash, Skill", model: "opus" },
  "test-planner": { tools: "Read, Grep, Glob, Write, Edit, Bash, Skill", model: "opus" },
  implementer: { tools: "Read, Edit, Write, Glob, Grep, Bash, Skill", model: "sonnet" },
  "code-reviewer": { tools: "Read, Grep, Glob, Bash, Skill", model: "opus" },
};

test("agents have valid frontmatter", () => {
  const dir = path.join(PLUGIN, "agents");
  assert.deepEqual(fs.readdirSync(dir).sort(), Object.keys(AGENTS).map((a) => `${a}.md`).sort());
  for (const [name, want] of Object.entries(AGENTS)) {
    const file = path.join(dir, `${name}.md`);
    const fm = frontmatter(file);
    assert.equal(fm.name, name, file);
    assert.ok(fm.description, `${file}: description`);
    assert.equal(fm.tools, want.tools, `${file}: tools`);
    assert.equal(fm.model, want.model, `${file}: model`);
    const body = fs.readFileSync(file, "utf8");
    assert.match(body, /STATUS:/, `${file}: status block`);
    assert.match(body, /worktree/, `${file}: worktree discipline`);
    if (/\b(duckor-flow|superpowers):[a-z]/.test(body.replace(/^---[\s\S]*?---/, "").replace(/description:.*$/m, ""))) {
      assert.match(fm.tools, /\bSkill\b/, `${file}: names skills but cannot load them`);
    }
  }
});

const UPSTREAM_SHA = "5bf4e78011075bcfc0dc295f0724994cd123ee71";
const ADAPTED: Record<string, string> = {
  "autonomous-brainstorming": "brainstorming",
  "autonomous-writing-plans": "writing-plans",
  "autonomous-execution": "subagent-driven-development",
};

function skillNames(): string[] {
  return fs.readdirSync(path.join(PLUGIN, "skills")).filter((d) =>
    fs.existsSync(path.join(PLUGIN, "skills", d, "SKILL.md")));
}

test("skills have valid frontmatter", () => {
  const names = skillNames();
  for (const name of Object.keys(ADAPTED)) assert.ok(names.includes(name), `missing skill ${name}`);
  for (const name of names) {
    const fm = frontmatter(path.join(PLUGIN, "skills", name, "SKILL.md"));
    assert.equal(fm.name, name);
    assert.ok(fm.description, `${name}: description`);
  }
});

test("adapted skills record their upstream", () => {
  const upstream = fs.readFileSync(path.join(PLUGIN, "UPSTREAM.md"), "utf8");
  assert.ok(upstream.includes(UPSTREAM_SHA));
  for (const [name, source] of Object.entries(ADAPTED)) {
    const text = fs.readFileSync(path.join(PLUGIN, "skills", name, "SKILL.md"), "utf8");
    const header = `<!-- Adapted from obra/superpowers skills/${source} @ ${UPSTREAM_SHA} -->`;
    assert.match(text, /^---\n[\s\S]*?\n---\n/);
    assert.ok(text.replace(/^---\n[\s\S]*?\n---\n\s*/, "").startsWith(header), `${name}: provenance header`);
    assert.ok(upstream.includes(name) && upstream.includes(source), `UPSTREAM.md: ${name}`);
  }
});

const KNOWN_SUPERPOWERS = [
  "brainstorming", "dispatching-parallel-agents", "executing-plans", "finishing-a-development-branch",
  "receiving-code-review", "requesting-code-review", "subagent-driven-development", "systematic-debugging",
  "test-driven-development", "using-git-worktrees", "verification-before-completion", "writing-plans",
];

function markdownFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => path.join(e.parentPath, e.name));
}

function refs(text: string, prefix: string): Set<string> {
  return new Set([...text.matchAll(new RegExp(`\\b${prefix}:([a-z][a-z0-9-]*)`, "g"))].map((m) => m[1]));
}

const CONDUCTOR = path.join(PLUGIN, "skills/conductor");

test("the conductor dispatches every agent and only real ones", () => {
  const text = fs.readFileSync(path.join(CONDUCTOR, "SKILL.md"), "utf8");
  const agents = [...refs(text, "duckor-flow")].filter((r) => !skillNames().includes(r)).sort();
  assert.deepEqual(agents, Object.keys(AGENTS).sort());
});

test("every plugin ref resolves", () => {
  const skills = skillNames();
  for (const file of markdownFiles(PLUGIN)) {
    const text = fs.readFileSync(file, "utf8");
    for (const r of refs(text, "duckor-flow")) {
      assert.ok(skills.includes(r) || r in AGENTS, `${file}: unknown duckor-flow:${r}`);
    }
    for (const r of refs(text, "superpowers")) {
      assert.ok(KNOWN_SUPERPOWERS.includes(r), `${file}: unknown superpowers:${r}`);
    }
  }
});

test("the command loads the conductor", () => {
  const file = path.join(PLUGIN, "commands/duckor.md");
  const fm = frontmatter(file);
  assert.ok(fm.description);
  assert.ok(fm["argument-hint"]);
  const body = fs.readFileSync(file, "utf8");
  assert.ok(body.includes("duckor-flow:conductor"));
  assert.ok(body.includes("$ARGUMENTS"));
});

test("state.md documents every state field", () => {
  const text = fs.readFileSync(path.join(CONDUCTOR, "state.md"), "utf8");
  for (const key of [
    "version", "run", "prompt", "phase", "blocked_reason", "blocked_phase", "options", "plugin_root", "skills", "review_mode",
    "skill_sources", "branch", "worktree", "base_sha",
    "checks", "excluded_checks", "baseline_failures", "brief", "spec", "plan", "test_plan", "test_scenarios", "review_rounds", "tasks",
    "decisions", "minor_issues",
  ]) assert.ok(text.includes(`\`${key}\``), `state.md: ${key}`);
});

test("the report template has the seven sections", () => {
  const text = fs.readFileSync(path.join(CONDUCTOR, "report-template.md"), "utf8");
  const headings = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(headings, [
    "Outcome", "What was built", "Decisions made for you", "Deviations and concerns", "Checks",
    "Manual e2e checklist", "Next steps",
  ]);
});

test("skill roles match resolve-skills.mjs", () => {
  const roles = Object.keys(DEFAULTS);
  for (const name of Object.values(DEFAULTS)) {
    if (name !== null) assert.ok(KNOWN_SUPERPOWERS.includes(name.replace(/^superpowers:/, "")), `default ${name}`);
  }
  const conductor = fs.readFileSync(path.join(CONDUCTOR, "SKILL.md"), "utf8");
  const table = conductor.slice(conductor.indexOf("## Skill roles"));
  const documented = [...table.matchAll(/^\| `([a-z-]+)` \| (.+?) \|/gm)].map((m) => [m[1], m[2]] as const);
  assert.deepEqual(documented.map(([r]) => r), roles);
  for (const [role, def] of documented) {
    const want = DEFAULTS[role as keyof typeof DEFAULTS];
    if (want !== null) assert.ok(def.includes(want), `conductor: default for ${role}`);
  }
  for (const file of markdownFiles(PLUGIN)) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/`skills\.([a-z-]+)`/g)) assert.ok(roles.includes(m[1]), `${file}: unknown role ${m[1]}`);
  }
});

test("agents that load skills are given the skills map", () => {
  for (const name of Object.keys(AGENTS)) {
    const body = fs.readFileSync(path.join(PLUGIN, "agents", `${name}.md`), "utf8");
    if (!/`skills\.[a-z-]+`/.test(body)) continue;
    assert.match(body, /- `skills`, `review_mode`:/, `${name}: skills input`);
    assert.match(body, /## Skills/, `${name}: skills contract`);
  }
});

test("the spec, the plan and the test plan share contracts", () => {
  const read = (p: string) => fs.readFileSync(path.join(PLUGIN, p), "utf8");
  const spec = read("skills/autonomous-brainstorming/SKILL.md");
  const sections = [...spec.slice(spec.indexOf("**Required sections")).matchAll(/^\d+\. \*\*(.+?)\*\*/gm)].map((m) => m[1]);
  assert.deepEqual(sections, [
    "Summary", "Decisions", "Architecture / Components", "Contracts", "Data flow", "Error handling", "Testing", "Out of scope",
  ]);
  assert.match(spec, /- SC1: /, "brief numbers its success criteria");
  assert.match(read("skills/autonomous-writing-plans/SKILL.md"), /^\*\*Contracts:\*\*/m, "plan tasks list contracts");
  const tests = read("skills/autonomous-writing-test-plans/SKILL.md");
  for (const heading of ["## Environment", "## Test data", "## Coverage", "## Scenarios", "## Regression", "## Out of scope"]) {
    assert.ok(tests.includes(heading), `test plan template: ${heading}`);
  }
  assert.match(read("agents/test-planner.md"), /Don't read the implementation plan/);
  assert.match(read("agents/doc-reviewer.md"), /\*\*mode `test-plan`:\*\*/);
});
