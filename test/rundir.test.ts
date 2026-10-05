import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { runProcess } from "../src/proc.ts";
import { EXCLUDE_LINE, createRun, excludeRuns, makeRunDir, runLabel, slugify } from "../src/rundir.ts";
import { tmpDir } from "./helpers.ts";

const NOW = new Date(2026, 9, 5, 14, 3, 9);

test("slugify keeps ASCII letters and digits", () => {
  assert.equal(slugify("Add --verbose Flag!"), "add-verbose-flag");
  assert.equal(slugify("Đăng nhập"), "dang-nhap");
  assert.equal(slugify("x".repeat(50)).length, 40);
});

test("runLabel uses the task file name, else random words", () => {
  assert.equal(runLabel("tasks/Fix Login.md"), "fix-login");
  assert.equal(runLabel(null, () => 0), "brave-acorn");
});

test("makeRunDir stamps the folder and avoids clashes", () => {
  const root = path.join(tmpDir(), "runs");
  const a = makeRunDir(root, "fix.md", NOW);
  const b = makeRunDir(root, "fix.md", NOW);
  assert.equal(path.basename(a), "20261005-140309-fix");
  assert.equal(path.basename(b), "20261005-140309-fix-2");
});

test("createRun makes the run folder with an empty scratchpad", () => {
  const repo = tmpDir();
  const run = createRun(repo, null, NOW, () => 0);
  assert.equal(run.dir, path.join(repo, ".duckor", "runs", "20261005-140309-brave-acorn"));
  assert.equal(fs.readFileSync(run.scratchpad, "utf8"), "");
  assert.equal(run.history, path.join(run.dir, "history.json"));
  assert.equal(run.iterLog(7), path.join(run.dir, "iter-007.log"));
});

test("excludeRuns adds the runs folder to the git exclude file once", async () => {
  const repo = tmpDir();
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const exclude = path.join(repo, ".git", "info", "exclude");
  fs.writeFileSync(exclude, "*.tmp");
  assert.equal(await excludeRuns(repo, runProcess), true);
  assert.equal(await excludeRuns(repo, runProcess), true);
  assert.equal(fs.readFileSync(exclude, "utf8"), `*.tmp\n${EXCLUDE_LINE}\n`);
  createRun(repo, null, NOW);
  assert.equal(execFileSync("git", ["status", "--porcelain", "-uall"], { cwd: repo, encoding: "utf8" }), "");
});

test("excludeRuns does nothing outside a git repository", async () => {
  const dir = tmpDir();
  assert.equal(await excludeRuns(dir, runProcess), false);
  assert.ok(!fs.existsSync(path.join(dir, ".git")));
});
