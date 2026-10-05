import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { DEFAULTS, defaultUserConfig, resolveSkills } from "../plugin/skills/conductor/scripts/resolve-skills.mjs";
import { ROOT, tmpDir } from "./helpers.ts";

const SCRIPT = path.join(ROOT, "plugin/skills/conductor/scripts/resolve-skills.mjs");

function repo(config?: unknown): string {
  const dir = tmpDir();
  if (config !== undefined) {
    fs.mkdirSync(path.join(dir, ".duckor"));
    fs.writeFileSync(path.join(dir, ".duckor/flow.json"), typeof config === "string" ? config : JSON.stringify(config));
  }
  return dir;
}

function userFile(config: unknown): string {
  const file = path.join(tmpDir(), "flow.json");
  fs.writeFileSync(file, typeof config === "string" ? config : JSON.stringify(config));
  return file;
}

test("no config gives the defaults", () => {
  const r = resolveSkills(repo(), { userConfig: null });
  assert.deepEqual(r.skills, DEFAULTS);
  assert.equal(r.review_mode, "augment");
  assert.deepEqual(Object.values(r.sources), Object.keys(DEFAULTS).map(() => "default"));
  assert.deepEqual(r.errors, []);
  assert.equal(DEFAULTS.commit, null);
});

test("the project config overrides the user config, which overrides the defaults", () => {
  const user = userFile({ skills: { commit: "commit", tdd: "me:tdd" }, review_mode: "replace" });
  const r = resolveSkills(repo({ skills: { commit: "team:commit", "code-review": "team:review" } }), { userConfig: user });
  assert.equal(r.skills.commit, "team:commit");
  assert.equal(r.skills["code-review"], "team:review");
  assert.equal(r.skills.tdd, "me:tdd");
  assert.equal(r.skills.debugging, DEFAULTS.debugging);
  assert.equal(r.review_mode, "replace");
  assert.deepEqual(r.sources, {
    commit: "project", "code-review": "project", tdd: "user", debugging: "default", verification: "default",
  });
  assert.deepEqual(r.errors, []);
});

test("null restores the default", () => {
  const user = userFile({ skills: { "code-review": "me:review" } });
  const r = resolveSkills(repo({ skills: { "code-review": null } }), { userConfig: user });
  assert.equal(r.skills["code-review"], DEFAULTS["code-review"]);
  assert.equal(r.sources["code-review"], "project");
});

test("a missing user config is ignored", () => {
  const r = resolveSkills(repo(), { userConfig: path.join(tmpDir(), "nope.json") });
  assert.deepEqual(r.errors, []);
});

test("bad configs are reported, not applied", () => {
  const r = resolveSkills(repo({
    skills: { commit: "has space", "code-review": 3, deploy: "x" },
    review_mode: "merge",
    extra: true,
  }), { userConfig: null });
  assert.deepEqual(r.skills, DEFAULTS);
  assert.equal(r.review_mode, "augment");
  assert.equal(r.errors.length, 5);
  assert.ok(r.errors.every((e) => e.startsWith(".duckor/flow.json: ")));
  assert.ok(r.errors.some((e) => e.includes('unknown role "deploy"')));
  assert.ok(r.errors.some((e) => e.includes('unknown key "extra"')));
  assert.ok(r.errors.some((e) => e.includes("review_mode")));
});

test("invalid JSON and non-objects are reported", () => {
  assert.match(resolveSkills(repo("{"), { userConfig: null }).errors[0], /not valid JSON/);
  assert.match(resolveSkills(repo("[]"), { userConfig: null }).errors[0], /JSON object/);
  assert.match(resolveSkills(repo({ skills: ["commit"] }), { userConfig: null }).errors[0], /skills must be an object/);
});

test("the user config defaults to XDG_CONFIG_HOME", () => {
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/xdg";
  try {
    assert.equal(defaultUserConfig(), path.join("/xdg", "duckor", "flow.json"));
  } finally {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
  }
});

test("the CLI prints the same resolution", () => {
  const dir = repo({ skills: { commit: "commit" } });
  const user = userFile({ skills: { tdd: "me:tdd" } });
  const out = execFileSync(process.execPath, [SCRIPT, dir, "--user-config", user], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(out), resolveSkills(dir, { userConfig: user }));
});
