#!/usr/bin/env node
// Resolve which skill fills each duckor-flow role: built-in defaults, overridden by the user config, then the project config.
// Usage: node resolve-skills.mjs <repoDir> [--user-config <path>]   -> prints { skills, review_mode, sources, errors } as JSON.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** `null` means duckor-flow's built-in behavior (for `commit`: a plain `git commit` with the given message). */
export const DEFAULTS = {
  commit: null,
  "code-review": "superpowers:requesting-code-review",
  tdd: "superpowers:test-driven-development",
  debugging: "superpowers:systematic-debugging",
  verification: "superpowers:verification-before-completion",
};
export const REVIEW_MODES = ["augment", "replace"];
export const PROJECT_CONFIG = ".duckor/flow.json";

const SKILL_NAME = /^[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)?$/;

export function defaultUserConfig() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "duckor", "flow.json");
}

/** Read one config file. Returns null when it doesn't exist. */
function load(file, label, errors) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    errors.push(`${label}: not valid JSON (${e.message})`);
    return null;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    errors.push(`${label}: must be a JSON object`);
    return null;
  }
  const out = { skills: {}, review_mode: undefined };
  for (const key of Object.keys(data)) {
    if (key !== "skills" && key !== "review_mode") errors.push(`${label}: unknown key "${key}"`);
  }
  if (data.review_mode !== undefined) {
    if (REVIEW_MODES.includes(data.review_mode)) out.review_mode = data.review_mode;
    else errors.push(`${label}: review_mode must be one of ${REVIEW_MODES.join(", ")}`);
  }
  const skills = data.skills ?? {};
  if (skills === null || typeof skills !== "object" || Array.isArray(skills)) {
    errors.push(`${label}: skills must be an object of role -> skill name`);
    return out;
  }
  for (const [role, name] of Object.entries(skills)) {
    if (!(role in DEFAULTS)) {
      errors.push(`${label}: unknown role "${role}" (roles: ${Object.keys(DEFAULTS).join(", ")})`);
    } else if (name === null) {
      out.skills[role] = DEFAULTS[role];
    } else if (typeof name !== "string" || !SKILL_NAME.test(name)) {
      errors.push(`${label}: skills.${role} must be a skill name like "commit" or "plugin:skill", or null for the default`);
    } else {
      out.skills[role] = name;
    }
  }
  return out;
}

/**
 * @param {string} repoDir
 * @param {{ userConfig?: string | null }} [opts] `userConfig: null` skips the user config.
 */
export function resolveSkills(repoDir, opts = {}) {
  const errors = [];
  const skills = { ...DEFAULTS };
  const sources = Object.fromEntries(Object.keys(DEFAULTS).map((r) => [r, "default"]));
  let reviewMode = "augment";
  const userFile = opts.userConfig === undefined ? defaultUserConfig() : opts.userConfig;
  const layers = [
    userFile ? { file: userFile, label: userFile, source: "user" } : null,
    { file: path.join(repoDir, PROJECT_CONFIG), label: PROJECT_CONFIG, source: "project" },
  ].filter(Boolean);
  for (const layer of layers) {
    const cfg = load(layer.file, layer.label, errors);
    if (!cfg) continue;
    for (const [role, name] of Object.entries(cfg.skills)) {
      skills[role] = name;
      sources[role] = layer.source;
    }
    if (cfg.review_mode) reviewMode = cfg.review_mode;
  }
  return { skills, review_mode: reviewMode, sources, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--user-config");
  const userConfig = i >= 0 ? args.splice(i, 2)[1] : undefined;
  const dir = args[0];
  if (!dir || (i >= 0 && !userConfig)) {
    process.stderr.write("usage: resolve-skills.mjs <repoDir> [--user-config <path>]\n");
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(resolveSkills(path.resolve(dir), { userConfig }), null, 2) + "\n");
}
