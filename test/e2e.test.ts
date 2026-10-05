import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { main } from "../src/cli.ts";
import { tmpDir } from "./helpers.ts";

// Runs the real claude CLI and costs money, so it only runs when asked for.
test("a real claude run completes a tiny task", { skip: process.env.DUCKOR_E2E !== "1", timeout: 15 * 60_000 }, async () => {
  const repo = tmpDir();
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const lines: string[] = [];
  const code = await main(
    ["run", "Create a file named hello.txt whose whole content is the word hi.", "--max-iterations", "4"],
    { cwd: repo, stdout: (l) => lines.push(l), stderr: (l) => lines.push(l) },
  );
  assert.equal(code, 0, lines.join("\n"));
  assert.equal(fs.readFileSync(path.join(repo, "hello.txt"), "utf8").trim(), "hi");
});
