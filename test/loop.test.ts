import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { AgentError } from "../src/agent.ts";
import { parseConfig } from "../src/config.ts";
import type { Config } from "../src/config.ts";
import { Orchestrator, iterationLine } from "../src/loop.ts";
import type { IterationRecord, OrchestratorOptions } from "../src/loop.ts";
import { AbortedError } from "../src/proc.ts";
import { createRun } from "../src/rundir.ts";
import { loadSkill } from "../src/skills.ts";
import { reply, scriptedAgent, tmpDir } from "./helpers.ts";
import type { Step } from "./helpers.ts";

const SOLO = `
loop:
  max_failures: 2
hats:
  builder:
    name: "🔨 Builder"
    triggers: [work.start, work.continue]
    publishes: [work.continue, LOOP_COMPLETE]
    instructions: Build it.
`;

function setup(steps: Step[], opts: Partial<OrchestratorOptions> & { yaml?: string } = {}) {
  const repo = tmpDir();
  const config: Config = parseConfig(opts.yaml ?? SOLO);
  const agent = scriptedAgent(steps);
  const run = createRun(repo, null);
  const seen: IterationRecord[] = [];
  const orch = new Orchestrator({
    config, task: "Add a flag", agent, run, repoRoot: repo, template: loadSkill("iteration"),
    onIteration: (r) => seen.push(r),
    ...opts,
  });
  const history = () => JSON.parse(fs.readFileSync(run.history, "utf8"));
  return { orch, agent, run, seen, history, config };
}

test("solo loop runs until the completion event", async () => {
  const { orch, agent, seen, history } = setup([
    reply("work.continue", "next: tests", 0.5, "planned"),
    reply("LOOP_COMPLETE", "", 0.25, "done"),
  ]);
  const s = await orch.run();
  assert.equal(s.stopReason, "completed");
  assert.equal(s.iterations, 2);
  assert.equal(s.costUsd, 0.75);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map((r) => r.outcome), ["ok", "ok"]);
  assert.deepEqual(seen[1].inputEvent, { topic: "work.continue", payload: "next: tests" });
  // The first event carries the task; the second the previous hat's payload.
  assert.ok(agent.calls[0].prompt.includes("Topic: `work.start`"));
  assert.ok(agent.calls[1].prompt.includes("```text\nnext: tests\n```"));
  assert.ok(agent.calls[1].prompt.includes("This is iteration 2."));
  const h = history();
  assert.equal(h.stopReason, "completed");
  assert.equal(h.task, "Add a flag");
  assert.deepEqual(h.totals, { iterations: 2, costUsd: 0.75 });
  assert.equal(h.iterations[0].summary, "planned");
  assert.equal(h.config.hats[0].id, "builder");
});

test("the agent request carries the hat's schema, tools, model and timeout", async () => {
  const { orch, agent, run, config } = setup([reply("LOOP_COMPLETE")]);
  await orch.run();
  const req = agent.calls[0];
  assert.deepEqual(req.tools, config.agent.allowedTools);
  assert.equal(req.model, "sonnet");
  assert.equal(req.timeoutMs, 20 * 60_000);
  assert.ok(JSON.stringify(req.schema).includes('"enum":["work.continue","LOOP_COMPLETE"]'));
  assert.ok(req.prompt.includes(".duckor/runs/"));
  assert.ok(fs.existsSync(run.iterLog(1)));
});

test("an agent failure retries the same event and is recorded", async () => {
  const { orch, agent, seen, run } = setup([
    new AgentError("timeout", 0.1, "partial"),
    reply("LOOP_COMPLETE", "", 0.2),
  ]);
  const s = await orch.run();
  assert.equal(s.stopReason, "completed");
  assert.ok(Math.abs(s.costUsd - 0.3) < 1e-9);
  assert.equal(seen[0].outcome, "agent_failed");
  assert.equal(seen[0].error, "timeout");
  assert.equal(seen[0].costUsd, 0.1);
  assert.ok(agent.calls[1].prompt.includes("Topic: `work.start`"));
  assert.equal(fs.readFileSync(run.iterLog(1), "utf8"), "partial\nerror: timeout\n");
});

test("consecutive agent failures stop the run", async () => {
  const { orch, seen } = setup([
    new AgentError("boom"),
    reply("work.continue"),
    new AgentError("boom"),
    new AgentError("boom"),
  ]);
  const s = await orch.run();
  assert.equal(s.stopReason, "agent_failed");
  assert.deepEqual(seen.map((r) => r.outcome), ["agent_failed", "ok", "agent_failed", "agent_failed"]);
});

test("a missing event or an unknown topic is an agent failure", async () => {
  const { orch, seen } = setup([reply(null), reply("build.done")]);
  const s = await orch.run();
  assert.equal(s.stopReason, "agent_failed");
  assert.equal(seen[0].error, "no event returned");
  assert.equal(seen[1].error, 'topic "build.done" is not in publishes');
});

test("max_iterations stops the run", async () => {
  const { orch } = setup([reply("work.continue"), reply("work.continue"), reply("work.continue")], {
    yaml: SOLO.replace("max_failures: 2", "max_iterations: 2"),
  });
  const s = await orch.run();
  assert.equal(s.stopReason, "max_iterations");
  assert.equal(s.iterations, 2);
});

test("max_cost_usd stops the run", async () => {
  const { orch } = setup([reply("work.continue", "", 15), reply("work.continue", "", 6), reply("work.continue")]);
  const s = await orch.run();
  assert.equal(s.stopReason, "max_cost");
  assert.equal(s.iterations, 2);
});

test("max_runtime_minutes stops the run", async () => {
  let t = 0;
  const step = () => {
    t += 150 * 60_000;
    return reply("work.continue");
  };
  const { orch } = setup([step, step, step], { now: () => t });
  const s = await orch.run();
  assert.equal(s.stopReason, "max_runtime");
  assert.equal(s.iterations, 2);
});

test("an event no hat handles stops the run as unrouted", async () => {
  const { orch, config } = setup([reply("work.continue")]);
  // Valid configs cannot produce this, so drop the trigger after validation.
  config.hats[0].triggers = ["work.start"];
  const s = await orch.run();
  assert.equal(s.stopReason, "unrouted");
  assert.equal(s.iterations, 1);
});

test("an abort before the first iteration runs nothing", async () => {
  const ac = new AbortController();
  ac.abort();
  const { orch, agent, history } = setup([reply("LOOP_COMPLETE")], { signal: ac.signal });
  const s = await orch.run();
  assert.equal(s.stopReason, "interrupted");
  assert.equal(agent.calls.length, 0);
  assert.equal(history().stopReason, "interrupted");
});

test("an abort mid-iteration records the partial iteration", async () => {
  const ac = new AbortController();
  const { orch, seen, history } = setup([
    () => {
      ac.abort();
      throw new AbortedError();
    },
  ], { signal: ac.signal });
  const s = await orch.run();
  assert.equal(s.stopReason, "interrupted");
  assert.equal(seen[0].outcome, "interrupted");
  assert.equal(history().iterations.length, 1);
});

test("an unexpected error writes history before it propagates", async () => {
  const { orch, history } = setup([new Error("spawn claude ENOENT")]);
  await assert.rejects(orch.run(), /ENOENT/);
  assert.equal(history().stopReason, "error");
});

test("iterationLine shows the hat, events and cost", () => {
  const base = {
    iteration: 3, hat: "builder", inputEvent: { topic: "work.start", payload: "" }, summary: "",
    gates: [], commit: null, costUsd: 0.414, durationMs: 1,
  };
  assert.equal(
    iterationLine({ ...base, outcome: "ok", outputEvent: { topic: "work.continue", payload: "" } }, "🔨 Builder"),
    "iter 3 | 🔨 Builder | work.start → work.continue | $0.41",
  );
  assert.equal(
    iterationLine({ ...base, outcome: "agent_failed", outputEvent: null, error: "timeout" }, "🔨 Builder"),
    "iter 3 | 🔨 Builder | work.start → agent failed: timeout | $0.41",
  );
});
