import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AgentError, bareTools, claudeAgent, claudeArgv, eventSchema, parseEnvelope, parseStructured,
} from "../src/agent.ts";
import type { AgentRequest } from "../src/agent.ts";
import { fakeRunner, ok } from "./helpers.ts";

const REQ: AgentRequest = {
  prompt: "do it",
  tools: ["Read", "Edit", "Bash(npm test *)", "Bash(npm run lint *)"],
  schema: eventSchema(["build.done", "LOOP_COMPLETE"]),
  model: "sonnet",
  timeoutMs: 60_000,
};

const envelope = (so: unknown, extra: object = {}) =>
  JSON.stringify({ type: "result", is_error: false, result: "", total_cost_usd: 0.25, structured_output: so, ...extra });

test("bareTools strips rules and deduplicates", () => {
  assert.deepEqual(bareTools(REQ.tools), ["Read", "Edit", "Bash"]);
});

test("eventSchema limits topics to publishes and requires a summary", () => {
  const s = eventSchema(["a", "b"]) as {
    required: string[];
    properties: { event: { required: string[]; properties: { topic: { enum: string[] } } } };
  };
  assert.deepEqual(s.required, ["summary"]);
  assert.deepEqual(s.properties.event.required, ["topic", "payload"]);
  assert.deepEqual(s.properties.event.properties.topic.enum, ["a", "b"]);
});

test("claudeArgv locks the session down", () => {
  const argv = claudeArgv(REQ);
  assert.deepEqual(argv.slice(0, 4), ["claude", "-p", "--output-format", "json"]);
  assert.equal(argv[argv.indexOf("--json-schema") + 1], JSON.stringify(REQ.schema));
  assert.equal(argv[argv.indexOf("--tools") + 1], "Read,Edit,Bash");
  const at = argv.indexOf("--allowedTools");
  assert.deepEqual(argv.slice(at + 1, at + 5), REQ.tools);
  // The variadic --allowedTools must be followed by another flag.
  assert.equal(argv[at + 5], "--restricted");
  assert.equal(argv[argv.indexOf("--model") + 1], "sonnet");
  for (const f of ["--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands"]) {
    assert.ok(argv.includes(f), f);
  }
  assert.ok(!argv.includes("--dangerously-skip-permissions"));
});

test("claudeArgv drops --json-schema for a plain call", () => {
  assert.ok(!claudeArgv({ ...REQ, schema: null }).includes("--json-schema"));
});

test("parseStructured accepts an event or none", () => {
  assert.deepEqual(parseStructured({ event: { topic: "a", payload: "" }, summary: "s" }),
    { event: { topic: "a", payload: "" }, summary: "s" });
  assert.deepEqual(parseStructured({ summary: "s" }), { event: null, summary: "s" });
});

test("parseStructured rejects a bad shape", () => {
  assert.throws(() => parseStructured("x"), /not an object/);
  assert.throws(() => parseStructured({ event: { topic: "a", payload: "" } }), /summary must be a string/);
  assert.throws(() => parseStructured({ event: { topic: "a" }, summary: "" }), /string topic and payload/);
});

test("parseEnvelope keeps the cost of a failed parse", () => {
  assert.throws(() => parseEnvelope(envelope({ summary: 3 }), true), (e: unknown) => {
    assert.ok(e instanceof AgentError);
    assert.equal(e.costUsd, 0.25);
    return true;
  });
});

test("parseEnvelope reports an is_error envelope", () => {
  assert.throws(() => parseEnvelope(envelope(null, { is_error: true, result: "boom" }), true), /claude error: boom/);
});

test("parseEnvelope without a schema returns the result text", () => {
  const r = parseEnvelope(JSON.stringify({ is_error: false, result: "committed", total_cost_usd: 0.1 }), false);
  assert.deepEqual(r.event, null);
  assert.equal(r.summary, "committed");
  assert.equal(r.costUsd, 0.1);
});

test("claudeAgent runs claude in cwd with the prompt on stdin", async () => {
  const out = envelope({ event: { topic: "build.done", payload: "p" }, summary: "did it" });
  const runner = fakeRunner(ok(out));
  const r = await claudeAgent("/repo", runner)(REQ);
  assert.deepEqual(r, { event: { topic: "build.done", payload: "p" }, summary: "did it", costUsd: 0.25, raw: out });
  assert.equal(runner.calls.length, 1);
  assert.equal(runner.calls[0].stdin, "do it");
  assert.equal(runner.calls[0].cwd, "/repo");
  assert.equal(runner.calls[0].timeoutSec, 60);
  assert.deepEqual(runner.calls[0].argv, claudeArgv(REQ));
});

test("claudeAgent turns a timeout into an AgentError", async () => {
  const runner = fakeRunner({ code: -1, stdout: "", stderr: "timeout" });
  await assert.rejects(claudeAgent("/repo", runner)(REQ), /^AgentError: timeout$/);
});

test("claudeAgent reports a non-zero exit with its cost", async () => {
  const runner = fakeRunner({ code: 1, stdout: envelope(null), stderr: "bad flag\n" });
  await assert.rejects(claudeAgent("/repo", runner)(REQ), (e: unknown) => {
    assert.ok(e instanceof AgentError);
    assert.equal(e.message, "bad flag");
    assert.equal(e.costUsd, 0.25);
    return true;
  });
});

test("claudeAgent rejects non-JSON output", async () => {
  await assert.rejects(claudeAgent("/repo", fakeRunner(ok("oops")))(REQ), /non-JSON output/);
});
