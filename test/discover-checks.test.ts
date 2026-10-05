import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { discoverChecks } from "../plugin/skills/conductor/scripts/discover-checks.mjs";
import { ROOT, tmpDir } from "./helpers.ts";

const SCRIPT = path.join(ROOT, "plugin/skills/conductor/scripts/discover-checks.mjs");

function repo(files: Record<string, string>): string {
  const dir = tmpDir();
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

function pkg(scripts: Record<string, string>): string {
  return JSON.stringify({ name: "x", scripts });
}

test("npm scripts become checks and e2e scripts are excluded", () => {
  const d = discoverChecks(repo({
    "package.json": pkg({ test: "node --test", lint: "eslint .", typecheck: "tsc", "test:e2e": "playwright test", build: "tsc -b" }),
  }));
  assert.equal(d.source, "inferred");
  assert.deepEqual(d.checks, [
    { name: "test", cmd: "npm test" },
    { name: "lint", cmd: "npm run lint" },
    { name: "typecheck", cmd: "npm run typecheck" },
  ]);
  assert.equal(d.excluded.length, 1);
  assert.equal(d.excluded[0].name, "test:e2e");
  assert.equal(d.excluded[0].cmd, "npm run test:e2e");
  assert.match(d.excluded[0].reason, /e2e/);
});

test("a test script that runs e2e is excluded as a whole", () => {
  const d = discoverChecks(repo({ "package.json": pkg({ test: "playwright test" }) }));
  assert.deepEqual(d.checks, []);
  assert.deepEqual(d.excluded.map((e) => e.name), ["test"]);
  assert.match(d.excluded[0].reason, /playwright/);
});

test("pnpm and yarn lockfiles pick the package manager", () => {
  const scripts = pkg({ test: "vitest run", lint: "eslint ." });
  assert.deepEqual(discoverChecks(repo({ "package.json": scripts, "pnpm-lock.yaml": "" })).checks, [
    { name: "test", cmd: "pnpm test" },
    { name: "lint", cmd: "pnpm run lint" },
  ]);
  assert.deepEqual(discoverChecks(repo({ "package.json": scripts, "yarn.lock": "" })).checks, [
    { name: "test", cmd: "yarn test" },
    { name: "lint", cmd: "yarn run lint" },
  ]);
});

test("Makefile targets", () => {
  const d = discoverChecks(repo({ Makefile: "test:\n\tgo test\nlint:\n\tgolint\ne2e:\n\t./e2e.sh\nbuild:\n\tgo build\nVAR:=1\n" }));
  assert.deepEqual(d.checks, [
    { name: "test", cmd: "make test" },
    { name: "lint", cmd: "make lint" },
  ]);
  assert.deepEqual(d.excluded.map((e) => e.cmd), ["make e2e"]);
});

test("Cargo and go", () => {
  assert.deepEqual(discoverChecks(repo({ "Cargo.toml": "[package]\nname = \"x\"\n" })).checks, [
    { name: "test", cmd: "cargo test" },
    { name: "clippy", cmd: "cargo clippy" },
  ]);
  assert.deepEqual(discoverChecks(repo({ "go.mod": "module x\n" })).checks, [
    { name: "test", cmd: "go test ./..." },
    { name: "vet", cmd: "go vet ./..." },
  ]);
});

test("pyproject with pytest and ruff", () => {
  const d = discoverChecks(repo({ "pyproject.toml": "[tool.pytest.ini_options]\n\n[tool.ruff]\nline-length = 100\n" }));
  assert.deepEqual(d.checks, [
    { name: "test", cmd: "pytest" },
    { name: "lint", cmd: "ruff check ." },
  ]);
});

test("a Checks section in CLAUDE.md wins and stops at the next heading", () => {
  const d = discoverChecks(repo({
    "CLAUDE.md": "# Repo\n\n## Checks\n- `test`: `npm test -- --quiet`\n- `e2e`: `npx playwright test`\n\n## Other\n- `lint`: `nope`\n",
    "package.json": pkg({ lint: "eslint ." }),
  }));
  assert.equal(d.source, "doc");
  assert.deepEqual(d.checks, [{ name: "test", cmd: "npm test -- --quiet" }]);
  assert.deepEqual(d.excluded.map((e) => e.name), ["e2e"]);
});

test("AGENTS.md is used when CLAUDE.md has no Checks section", () => {
  const d = discoverChecks(repo({
    "CLAUDE.md": "# Repo\n\nNothing here.\n",
    "AGENTS.md": "## Checks\n* `unit`: `make unit`\n",
  }));
  assert.equal(d.source, "doc");
  assert.deepEqual(d.checks, [{ name: "unit", cmd: "make unit" }]);
});

test("nothing found", () => {
  assert.deepEqual(discoverChecks(tmpDir()), { checks: [], excluded: [], source: "none" });
});

test("package.json first when a Makefile also exists", () => {
  const d = discoverChecks(repo({ "package.json": pkg({ test: "node --test" }), Makefile: "test:\n\tnpm test\n" }));
  assert.deepEqual(d.checks, [{ name: "test", cmd: "npm test" }]);
});

test("CLI prints JSON", () => {
  const dir = repo({ "go.mod": "module x\n" });
  const out = execFileSync(process.execPath, [SCRIPT, dir], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(out), discoverChecks(dir));
});
