import fs from "node:fs";

import { YAMLParseError, parse } from "yaml";

export const DEFAULT_TOOLS: readonly string[] = ["Read", "Edit", "Write", "Glob", "Grep"];

export interface LoopConfig {
  startingEvent: string;
  completionEvent: string;
  maxIterations: number;
  maxRuntimeMinutes: number;
  maxCostUsd: number;
  maxFailures: number;
}

export interface AgentConfig {
  model: string;
  allowedTools: string[];
  timeoutMinutes: number;
}

export interface HatConfig {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  publishes: string[];
  instructions: string;
}

export interface Config {
  loop: LoopConfig;
  agent: AgentConfig;
  guardrails: string[];
  hats: HatConfig[];
}

/** A config problem; the message starts with the key path, e.g. `loop.max_iterations: ...`. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function fail(at: string, message: string): never {
  throw new ConfigError(`${at}: ${message}`);
}

const join = (at: string, key: string) => (at ? `${at}.${key}` : key);

function mapping(v: unknown, at: string): Obj {
  if (!isObj(v)) fail(at || "(root)", "expected a mapping");
  return v;
}

function onlyKeys(o: Obj, allowed: readonly string[], at: string): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(join(at, k), "unknown key");
}

function str(o: Obj, key: string, at: string, def?: string): string {
  const v = o[key];
  if (v === undefined && def !== undefined) return def;
  if (typeof v !== "string" || v === "") fail(join(at, key), "expected a non-empty string");
  return v;
}

function text(o: Obj, key: string, at: string): string {
  const v = o[key];
  if (v === undefined) return "";
  if (typeof v !== "string") fail(join(at, key), "expected a string");
  return v;
}

function positive(o: Obj, key: string, at: string, def: number, integer: boolean): number {
  const v = o[key];
  if (v === undefined) return def;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || (integer && !Number.isInteger(v))) {
    fail(join(at, key), integer ? "expected a positive integer" : "expected a positive number");
  }
  return v;
}

function strList(o: Obj, key: string, at: string, def?: readonly string[]): string[] {
  const v = o[key];
  if (v === undefined && def !== undefined) return [...def];
  if (!Array.isArray(v) || v.length === 0) fail(join(at, key), "expected a non-empty list");
  return v.map((x, i) => {
    if (typeof x !== "string" || x === "") fail(`${join(at, key)}[${i}]`, "expected a non-empty string");
    return x;
  });
}

function parseHat(id: string, v: unknown): HatConfig {
  const at = `hats.${id}`;
  const o = mapping(v, at);
  onlyKeys(o, ["name", "description", "triggers", "publishes", "instructions"], at);
  return {
    id,
    name: str(o, "name", at, id),
    description: text(o, "description", at),
    triggers: strList(o, "triggers", at),
    publishes: strList(o, "publishes", at),
    instructions: text(o, "instructions", at),
  };
}

/** Validate a parsed duckor.yml document and fill in defaults. */
export function toConfig(doc: unknown): Config {
  const root = mapping(doc, "");
  onlyKeys(root, ["loop", "agent", "guardrails", "hats"], "");

  const l = mapping(root.loop ?? {}, "loop");
  onlyKeys(l, [
    "starting_event", "completion_event", "max_iterations", "max_runtime_minutes",
    "max_cost_usd", "max_failures",
  ], "loop");
  const loop: LoopConfig = {
    startingEvent: str(l, "starting_event", "loop", "work.start"),
    completionEvent: str(l, "completion_event", "loop", "LOOP_COMPLETE"),
    maxIterations: positive(l, "max_iterations", "loop", 50, true),
    maxRuntimeMinutes: positive(l, "max_runtime_minutes", "loop", 240, false),
    maxCostUsd: positive(l, "max_cost_usd", "loop", 20, false),
    maxFailures: positive(l, "max_failures", "loop", 3, true),
  };

  const a = mapping(root.agent ?? {}, "agent");
  onlyKeys(a, ["model", "allowed_tools", "timeout_minutes"], "agent");
  const agent: AgentConfig = {
    model: str(a, "model", "agent", "sonnet"),
    allowedTools: strList(a, "allowed_tools", "agent", DEFAULT_TOOLS),
    timeoutMinutes: positive(a, "timeout_minutes", "agent", 20, false),
  };

  const guardrails = root.guardrails === undefined ? [] : strList(root, "guardrails", "");

  const h = mapping(root.hats, "hats");
  const ids = Object.keys(h);
  // Multi-hat workflows arrive with routing in a later milestone.
  if (ids.length !== 1) fail("hats", `expected exactly one hat, got ${ids.length}`);
  const hats = ids.map((id) => parseHat(id, h[id]));

  const hat = hats[0];
  if (!hat.triggers.includes(loop.startingEvent)) {
    fail("loop.starting_event", `no hat is triggered by "${loop.startingEvent}"`);
  }
  hat.publishes.forEach((t, i) => {
    if (t !== loop.completionEvent && !hat.triggers.includes(t)) {
      fail(`hats.${hat.id}.publishes[${i}]`, `"${t}" is not the completion event and triggers no hat`);
    }
  });

  return { loop, agent, guardrails, hats };
}

export function parseConfig(source: string): Config {
  let doc: unknown;
  try {
    doc = parse(source);
  } catch (e) {
    if (e instanceof YAMLParseError) throw new ConfigError(`(root): invalid YAML: ${e.message}`);
    throw e;
  }
  return toConfig(doc);
}

export function loadConfig(file: string): Config {
  let source: string;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (e) {
    throw new ConfigError(`(root): cannot read ${file}: ${(e as Error).message}`);
  }
  return parseConfig(source);
}
