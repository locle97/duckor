import assert from "node:assert/strict";
import { test } from "node:test";

import { UsageError, parseArgs } from "../src/args.ts";

const run = (...argv: string[]) => {
  const p = parseArgs(["run", ...argv]);
  assert.equal(p.kind, "run");
  return p.kind === "run" ? p.args : null!;
};

test("top-level help and version", () => {
  assert.deepEqual(parseArgs([]), { kind: "help" });
  assert.deepEqual(parseArgs(["--help"]), { kind: "help" });
  assert.deepEqual(parseArgs(["--version"]), { kind: "version" });
  assert.deepEqual(parseArgs(["run", "-h"]), { kind: "help" });
});

test("run takes a task and options", () => {
  assert.deepEqual(run("Add a flag", "-c", "x.yml", "--max-iterations", "5", "--model=opus"), {
    task: "Add a flag", file: null, config: "x.yml", maxIterations: 5, model: "opus",
  });
  assert.deepEqual(run("-f", "PROMPT.md"), {
    task: null, file: "PROMPT.md", config: null, maxIterations: null, model: null,
  });
  assert.equal(run("--file=PROMPT.md").file, "PROMPT.md");
});

test("usage errors", () => {
  const bad: [string[], RegExp][] = [
    [["frobnicate"], /unknown command: frobnicate/],
    [["run"], /give a task or --file$/],
    [["run", "x", "-f", "y"], /not both/],
    [["run", "x", "y"], /unexpected argument: y/],
    [["run", "x", "--colour"], /unrecognized argument: --colour/],
    [["run", "x", "--model"], /--model needs a value/],
    [["run", "x", "--max-iterations", "0"], /expected a positive integer, got "0"/],
  ];
  for (const [argv, re] of bad) assert.throws(() => parseArgs(argv), (e: unknown) => e instanceof UsageError && re.test(e.message), argv.join(" "));
});
