import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { ConfigError, DEFAULT_TOOLS, loadConfig, parseConfig } from "../src/config.ts";
import { PRESETS_DIR } from "../src/paths.ts";
import { tmpDir } from "./helpers.ts";

const MINIMAL = `
hats:
  builder:
    triggers: [work.start]
    publishes: [LOOP_COMPLETE]
`;

function rejects(source: string, message: string): void {
  assert.throws(() => parseConfig(source), (e: unknown) => {
    assert.ok(e instanceof ConfigError);
    assert.equal(e.message, message);
    return true;
  });
}

test("a minimal config gets every default", () => {
  const c = parseConfig(MINIMAL);
  assert.deepEqual(c.loop, {
    startingEvent: "work.start",
    completionEvent: "LOOP_COMPLETE",
    maxIterations: 50,
    maxRuntimeMinutes: 240,
    maxCostUsd: 20,
    maxFailures: 3,
  });
  assert.deepEqual(c.agent, { model: "sonnet", allowedTools: [...DEFAULT_TOOLS], timeoutMinutes: 20 });
  assert.deepEqual(c.guardrails, []);
  assert.deepEqual(c.hats, [{
    id: "builder",
    name: "builder",
    description: "",
    triggers: ["work.start"],
    publishes: ["LOOP_COMPLETE"],
    instructions: "",
  }]);
});

test("explicit values override the defaults", () => {
  const c = parseConfig(`
loop:
  starting_event: go
  completion_event: done
  max_iterations: 5
  max_cost_usd: 1.5
agent:
  model: opus
  allowed_tools: [Read, "Bash(npm test *)"]
guardrails: [be careful]
hats:
  b:
    name: "🔨 Builder"
    triggers: [go, again]
    publishes: [again, done]
    instructions: do it
`);
  assert.equal(c.loop.startingEvent, "go");
  assert.equal(c.loop.maxIterations, 5);
  assert.equal(c.loop.maxCostUsd, 1.5);
  assert.deepEqual(c.agent.allowedTools, ["Read", "Bash(npm test *)"]);
  assert.deepEqual(c.guardrails, ["be careful"]);
  assert.equal(c.hats[0].name, "🔨 Builder");
  assert.equal(c.hats[0].instructions, "do it");
});

test("unknown keys are rejected with their path", () => {
  rejects(`colour: red\n${MINIMAL}`, "colour: unknown key");
  rejects(`loop: {max_iteration: 3}\n${MINIMAL}`, "loop.max_iteration: unknown key");
  rejects(`
hats:
  builder:
    triggers: [work.start]
    publishes: [LOOP_COMPLETE]
    gates: [test]
`, "hats.builder.gates: unknown key");
});

test("bad values are rejected with their path", () => {
  rejects(`loop: {max_iterations: 0}\n${MINIMAL}`, "loop.max_iterations: expected a positive integer");
  rejects(`loop: {max_iterations: 2.5}\n${MINIMAL}`, "loop.max_iterations: expected a positive integer");
  rejects(`loop: {max_cost_usd: "lots"}\n${MINIMAL}`, "loop.max_cost_usd: expected a positive number");
  rejects(`agent: {allowed_tools: []}\n${MINIMAL}`, "agent.allowed_tools: expected a non-empty list");
  rejects(`agent: {allowed_tools: [Read, 3]}\n${MINIMAL}`, "agent.allowed_tools[1]: expected a non-empty string");
  rejects(`agent: {model: ""}\n${MINIMAL}`, "agent.model: expected a non-empty string");
  rejects(`loop: [1]\n${MINIMAL}`, "loop: expected a mapping");
});

test("the document must be a mapping with hats", () => {
  rejects("", "(root): expected a mapping");
  rejects("- a\n- b\n", "(root): expected a mapping");
  rejects("loop: {}\n", "hats: expected a mapping");
});

test("invalid YAML is a config error", () => {
  assert.throws(() => parseConfig("hats: [\n"), /^ConfigError: \(root\): invalid YAML/);
});

test("exactly one hat is supported", () => {
  rejects("hats: {}\n", "hats: expected exactly one hat, got 0");
  rejects(`${MINIMAL}
  other:
    triggers: [x]
    publishes: [LOOP_COMPLETE]
`, "hats: expected exactly one hat, got 2");
});

test("a hat needs triggers and publishes", () => {
  rejects("hats: {b: {publishes: [LOOP_COMPLETE]}}\n", "hats.b.triggers: expected a non-empty list");
  rejects("hats: {b: {triggers: [work.start], publishes: []}}\n", "hats.b.publishes: expected a non-empty list");
});

test("the starting event must trigger the hat", () => {
  rejects("hats: {b: {triggers: [go], publishes: [LOOP_COMPLETE]}}\n",
    'loop.starting_event: no hat is triggered by "work.start"');
});

test("every published topic must complete the loop or trigger a hat", () => {
  rejects("hats: {b: {triggers: [work.start], publishes: [LOOP_COMPLETE, lost]}}\n",
    'hats.b.publishes[1]: "lost" is not the completion event and triggers no hat');
});

test("loadConfig reads a file and reports a missing one", () => {
  const dir = tmpDir();
  const file = path.join(dir, "duckor.yml");
  fs.writeFileSync(file, MINIMAL);
  assert.equal(loadConfig(file).hats[0].id, "builder");
  assert.throws(() => loadConfig(path.join(dir, "nope.yml")), /^ConfigError: \(root\): cannot read/);
});

test("the bundled solo preset is valid", () => {
  const c = loadConfig(path.join(PRESETS_DIR, "solo.yml"));
  assert.equal(c.hats.length, 1);
  assert.deepEqual(c.hats[0].publishes, ["work.continue", "LOOP_COMPLETE"]);
});
