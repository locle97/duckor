import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { ROOT } from "./helpers.ts";

const PLUGIN = path.join(ROOT, "plugin");

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Parse the leading `---` block of a Markdown file as `key: value` lines. */
function frontmatter(file: string): Record<string, string> {
  const m = fs.readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error(`${file}: no frontmatter`);
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
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
  "spec-writer": { tools: "Read, Grep, Glob, Write, Edit, Bash", model: "opus" },
  "doc-reviewer": { tools: "Read, Grep, Glob", model: "opus" },
  planner: { tools: "Read, Grep, Glob, Write, Edit, Bash", model: "opus" },
  implementer: { tools: "Read, Edit, Write, Glob, Grep, Bash", model: "sonnet" },
  "code-reviewer": { tools: "Read, Grep, Glob, Bash", model: "opus" },
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
  }
});
