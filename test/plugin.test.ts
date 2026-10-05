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
