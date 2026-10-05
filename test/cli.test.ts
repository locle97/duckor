import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { main, version } from "../src/cli.ts";
import type { CliDeps } from "../src/cli.ts";
import { runProcess } from "../src/proc.ts";
import { ROOT, reply, scriptedAgent, tmpDir } from "./helpers.ts";
import type { ScriptedAgent, Step } from "./helpers.ts";

function harness(steps: Step[] = [], over: Partial<CliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const cwd = tmpDir();
  let agent: ScriptedAgent | null = null;
  const deps: Partial<CliDeps> = {
    cwd,
    which: (n) => (n === "claude" ? "/usr/bin/claude" : null),
    createAgent: () => (agent = scriptedAgent(steps)),
    runner: runProcess,
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
    ...over,
  };
  return { cwd, out, err, run: (...argv: string[]) => main(argv, deps), agent: () => agent! };
}

const SOLO_FILE = `
hats:
  b:
    name: "🔨 Builder"
    triggers: [work.start, again]
    publishes: [again, LOOP_COMPLETE]
`;

test("--version prints the package version", async () => {
  const h = harness();
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(await h.run("--version"), 0);
  assert.deepEqual(h.out, [`duckor ${pkg.version}`]);
  assert.equal(version(), pkg.version);
});

test("help prints usage", async () => {
  const h = harness();
  assert.equal(await h.run(), 0);
  assert.match(h.out[0], /^usage: duckor run/);
});

test("a usage error exits 2", async () => {
  const h = harness();
  assert.equal(await h.run("run"), 2);
  assert.equal(h.err.at(-1), "duckor: error: give a task or --file");
});

test("run completes with the default solo preset and prints a line per iteration", async () => {
  const h = harness([reply("work.continue", "", 0.5), reply("LOOP_COMPLETE", "", 0.25)]);
  assert.equal(await h.run("run", "Add a flag"), 0);
  assert.deepEqual(h.out.slice(0, 2), [
    "iter 1 | 🔨 Builder | work.start → work.continue | $0.50",
    "iter 2 | 🔨 Builder | work.continue → LOOP_COMPLETE | $0.25",
  ]);
  assert.equal(h.out[2], "Stop: completed");
  assert.equal(h.out[3], "Iterations: 2  Cost: $0.75");
  const historyLine = h.out[4];
  assert.match(historyLine, /^History: \.duckor\/runs\/\d{8}-\d{6}-[a-z]+-[a-z]+\/history\.json$/);
  const history = JSON.parse(fs.readFileSync(path.join(h.cwd, historyLine.slice(9)), "utf8"));
  assert.equal(history.task, "Add a flag");
});

test("run reads ./duckor.yml and the task file, and flags override config", async () => {
  const h = harness([reply("again"), reply("again")]);
  fs.writeFileSync(path.join(h.cwd, "duckor.yml"), SOLO_FILE);
  fs.writeFileSync(path.join(h.cwd, "PROMPT.md"), "Fix the login bug\n");
  assert.equal(await h.run("run", "-f", "PROMPT.md", "--max-iterations", "2", "--model", "opus"), 1);
  assert.equal(h.out.find((l) => l.startsWith("Stop:")), "Stop: max_iterations");
  assert.ok(h.agent().calls[0].prompt.includes("Fix the login bug"));
  assert.equal(h.agent().calls[0].model, "opus");
  assert.match(h.out.at(-1)!, /\/\d{8}-\d{6}-prompt\/history\.json$/);
});

test("an invalid config exits 2 with its path", async () => {
  const h = harness();
  fs.writeFileSync(path.join(h.cwd, "bad.yml"), "colour: red\n");
  assert.equal(await h.run("run", "x", "-c", "bad.yml"), 2);
  assert.deepEqual(h.err, ["bad.yml: colour: unknown key"]);
  assert.ok(!fs.existsSync(path.join(h.cwd, ".duckor")));
});

test("a missing task file exits 2", async () => {
  const h = harness();
  assert.equal(await h.run("run", "-f", "nope.md"), 2);
  assert.match(h.err[0], /^cannot read task file nope\.md/);
});

test("a missing claude CLI exits 2 before anything runs", async () => {
  const h = harness([], { which: () => null });
  assert.equal(await h.run("run", "x"), 2);
  assert.deepEqual(h.err, ["claude CLI not found on PATH (install Claude Code)"]);
  assert.ok(!fs.existsSync(path.join(h.cwd, ".duckor")));
});

test("an interrupted run exits 130", async () => {
  const ac = new AbortController();
  ac.abort();
  const h = harness([], { signal: ac.signal });
  assert.equal(await h.run("run", "x"), 130);
  assert.equal(h.out.find((l) => l.startsWith("Stop:")), "Stop: interrupted");
});

test("an unexpected error exits 1 and names the history", async () => {
  const h = harness([new Error("spawn claude ENOENT")]);
  assert.equal(await h.run("run", "x"), 1);
  assert.equal(h.err[0], "error: spawn claude ENOENT");
  assert.match(h.err[1], /^History: /);
});
