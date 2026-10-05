#!/usr/bin/env node
// Discover the commands that verify a repo (tests, lint, typecheck), leaving out e2e.
// Usage: node discover-checks.mjs <repoDir>   -> prints { checks, excluded, source } as JSON.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const E2E = /e2e|playwright|cypress|integration|acceptance/i;
const NPM_NAMES = ["test", "lint", "typecheck", "check", "format:check"];
const MAKE_NAMES = ["test", "lint", "check"];
// Arguments that exclude paths (e.g. `--testPathIgnorePatterns e2e`) say the opposite of "runs e2e".
const IGNORE_ARG = /(?:--[\w-]*(?:ignore|exclude|skip)[\w-]*|-k\s+["']?not)(?:=|\s+)\S+|!\S+/gi;

function read(dir, name) {
  try {
    return fs.readFileSync(path.join(dir, name), "utf8");
  } catch {
    return null;
  }
}

/** Why an item looks like e2e, and whether that came from its name (certain) or only its command. */
function e2eMatch(name, body) {
  const byName = name.match(E2E);
  if (byName) return { reason: `looks like an end-to-end check ("${byName[0]}")`, byCommand: false };
  const byBody = body.replace(IGNORE_ARG, " ").match(E2E);
  if (byBody) return { reason: `its command looks like an end-to-end run ("${byBody[0]}")`, byCommand: true };
  return null;
}

/**
 * Split candidates into checks and excluded; extras are only ever excluded.
 * `confirm` marks a candidate excluded only because of its command: the conductor asks the user about it.
 */
function classify(candidates, extras = []) {
  const checks = [];
  const excluded = [];
  for (const c of candidates) {
    const m = e2eMatch(c.name, c.body ?? c.cmd);
    if (m) excluded.push({ name: c.name, cmd: c.cmd, reason: m.reason, confirm: m.byCommand });
    else checks.push({ name: c.name, cmd: c.cmd });
  }
  for (const c of extras) {
    const m = e2eMatch(c.name, c.body ?? c.cmd);
    if (m) excluded.push({ name: c.name, cmd: c.cmd, reason: m.reason, confirm: false });
  }
  return { checks, excluded };
}

function fromDoc(dir) {
  for (const file of ["CLAUDE.md", "AGENTS.md"]) {
    const text = read(dir, file);
    if (text === null) continue;
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((l) => /^##\s+Checks\s*$/i.test(l));
    if (start < 0) continue;
    const items = [];
    let fenced = false;
    for (const line of lines.slice(start + 1)) {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) continue;
      if (/^#{1,2}\s/.test(line)) break;
      const m = line.match(/^\s*[-*]\s+`([^`]+)`:\s+`([^`]+)`/);
      if (m) items.push({ name: m[1], cmd: m[2] });
    }
    if (items.length > 0) return classify(items);
  }
  return null;
}

function fromPackageJson(dir) {
  const text = read(dir, "package.json");
  if (text === null) return null;
  let scripts;
  try {
    scripts = JSON.parse(text).scripts ?? {};
  } catch {
    return null;
  }
  const pm = fs.existsSync(path.join(dir, "pnpm-lock.yaml")) ? "pnpm"
    : fs.existsSync(path.join(dir, "yarn.lock")) ? "yarn" : "npm";
  const toCmd = (name) => (name === "test" ? `${pm} test` : `${pm} run ${name}`);
  const candidates = NPM_NAMES.filter((n) => typeof scripts[n] === "string")
    .map((name) => ({ name, cmd: toCmd(name), body: `${toCmd(name)} ${scripts[name]}` }));
  const extras = Object.keys(scripts).filter((n) => !NPM_NAMES.includes(n))
    .map((name) => ({ name, cmd: toCmd(name), body: `${toCmd(name)} ${scripts[name]}` }));
  return classify(candidates, extras);
}

function fromMakefile(dir) {
  const text = read(dir, "GNUmakefile") ?? read(dir, "makefile") ?? read(dir, "Makefile");
  if (text === null) return null;
  const recipes = new Map();
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-][A-Za-z0-9_.-]*):(?!=)(.*)$/);
    if (m) {
      current = m[1];
      recipes.set(current, m[2]);
    } else if (current && line.startsWith("\t")) {
      recipes.set(current, `${recipes.get(current)}\n${line}`);
    } else if (line.trim() !== "") {
      current = null;
    }
  }
  const targets = [...recipes.keys()];
  const toItem = (name) => ({ name, cmd: `make ${name}`, body: `make ${name} ${recipes.get(name)}` });
  return classify(
    MAKE_NAMES.filter((n) => targets.includes(n)).map(toItem),
    targets.filter((n) => !MAKE_NAMES.includes(n)).map(toItem),
  );
}

function fromPyproject(dir) {
  const text = read(dir, "pyproject.toml");
  if (text === null) return null;
  const items = [];
  if (/\[tool\.pytest|\bpytest\b/.test(text)) items.push({ name: "test", cmd: "pytest" });
  if (/\[tool\.ruff|\bruff\b/.test(text)) items.push({ name: "lint", cmd: "ruff check ." });
  return classify(items);
}

function fromCargo(dir) {
  if (read(dir, "Cargo.toml") === null) return null;
  return classify([{ name: "test", cmd: "cargo test" }, { name: "clippy", cmd: "cargo clippy" }]);
}

function fromGo(dir) {
  if (read(dir, "go.mod") === null) return null;
  return classify([{ name: "test", cmd: "go test ./..." }, { name: "vet", cmd: "go vet ./..." }]);
}

/** @param {string} repoDir */
export function discoverChecks(repoDir) {
  const doc = fromDoc(repoDir);
  if (doc) return { ...doc, source: "doc" };
  // The first ecosystem with at least one check wins; exclusions from every ecosystem are kept.
  const excluded = [];
  for (const infer of [fromPackageJson, fromMakefile, fromPyproject, fromCargo, fromGo]) {
    const found = infer(repoDir);
    if (!found) continue;
    excluded.push(...found.excluded);
    if (found.checks.length > 0) return { checks: found.checks, excluded, source: "inferred" };
  }
  return { checks: [], excluded, source: "none" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const dir = process.argv[2];
  if (!dir) {
    process.stderr.write("usage: discover-checks.mjs <repoDir>\n");
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(discoverChecks(path.resolve(dir)), null, 2) + "\n");
}
