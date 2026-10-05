import fs from "node:fs";
import path from "node:path";

import { HELP, USAGE, UsageError, parseArgs } from "./args.ts";
import type { RunArgs } from "./args.ts";
import { claudeAgent } from "./agent.ts";
import type { AgentFn } from "./agent.ts";
import { ConfigError, loadConfig } from "./config.ts";
import type { Config } from "./config.ts";
import { Orchestrator, iterationLine } from "./loop.ts";
import type { StopReason } from "./loop.ts";
import { PACKAGE_JSON, PRESETS_DIR } from "./paths.ts";
import { runProcess } from "./proc.ts";
import type { Runner } from "./proc.ts";
import { createRun, excludeRuns } from "./rundir.ts";
import { loadSkill } from "./skills.ts";

export function version(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

/** The first executable called `name` on PATH. */
export function which(name: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, name);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      if (fs.statSync(p).isFile()) return p;
    } catch {
      // not here
    }
  }
  return null;
}

export interface CliDeps {
  cwd: string;
  which(name: string): string | null;
  createAgent(cwd: string): AgentFn;
  runner: Runner;
  stdout(line: string): void;
  stderr(line: string): void;
  signal: AbortSignal;
}

const DEFAULT_DEPS: CliDeps = {
  cwd: process.cwd(),
  which,
  createAgent: (cwd) => claudeAgent(cwd),
  runner: runProcess,
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
  signal: new AbortController().signal,
};

export const EXIT_CODES: Record<StopReason, number> = {
  completed: 0,
  max_iterations: 1,
  max_runtime: 1,
  max_cost: 1,
  agent_failed: 1,
  unrouted: 1,
  error: 1,
  interrupted: 130,
};

/** ./duckor.yml, or -c FILE, or the bundled solo preset when neither exists. */
function configFile(deps: CliDeps, args: RunArgs): string {
  if (args.config !== null) return path.resolve(deps.cwd, args.config);
  const local = path.join(deps.cwd, "duckor.yml");
  return fs.existsSync(local) ? local : path.join(PRESETS_DIR, "solo.yml");
}

function applyFlags(config: Config, args: RunArgs): Config {
  return {
    ...config,
    loop: { ...config.loop, maxIterations: args.maxIterations ?? config.loop.maxIterations },
    agent: { ...config.agent, model: args.model ?? config.agent.model },
  };
}

async function runCommand(deps: CliDeps, args: RunArgs): Promise<number> {
  let task = args.task;
  if (args.file !== null) {
    try {
      task = fs.readFileSync(path.resolve(deps.cwd, args.file), "utf8");
    } catch (e) {
      deps.stderr(`cannot read task file ${args.file}: ${(e as Error).message}`);
      return 2;
    }
  }
  const file = configFile(deps, args);
  let config: Config;
  try {
    config = applyFlags(loadConfig(file), args);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    deps.stderr(`${path.relative(deps.cwd, file) || file}: ${e.message}`);
    return 2;
  }
  const template = loadSkill("iteration");
  if (!deps.which("claude")) {
    deps.stderr("claude CLI not found on PATH (install Claude Code)");
    return 2;
  }

  await excludeRuns(deps.cwd, deps.runner);
  const run = createRun(deps.cwd, args.file);
  const names = new Map(config.hats.map((h) => [h.id, h.name]));
  const orch = new Orchestrator({
    config,
    task: task!,
    agent: deps.createAgent(deps.cwd),
    run,
    repoRoot: deps.cwd,
    template,
    signal: deps.signal,
    onIteration: (rec) => deps.stdout(iterationLine(rec, names.get(rec.hat) ?? rec.hat)),
  });
  const history = path.relative(deps.cwd, run.history);
  try {
    const s = await orch.run();
    deps.stdout(`Stop: ${s.stopReason}`);
    deps.stdout(`Iterations: ${s.iterations}  Cost: $${s.costUsd.toFixed(2)}`);
    deps.stdout(`History: ${history}`);
    return EXIT_CODES[s.stopReason];
  } catch (e) {
    deps.stderr(e instanceof Error ? `error: ${e.message}` : `error: ${String(e)}`);
    deps.stderr(`History: ${history}`);
    return 1;
  }
}

export async function main(argv: string[], overrides: Partial<CliDeps> = {}): Promise<number> {
  const deps: CliDeps = { ...DEFAULT_DEPS, ...overrides };
  try {
    const parsed = parseArgs(argv);
    if (parsed.kind === "help") {
      deps.stdout(HELP);
      return 0;
    }
    if (parsed.kind === "version") {
      deps.stdout(`duckor ${version()}`);
      return 0;
    }
    return await runCommand(deps, parsed.args);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    deps.stderr(USAGE);
    deps.stderr(`duckor: error: ${e.message}`);
    return 2;
  }
}
