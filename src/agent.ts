import type { Event } from "./events.ts";
import { runProcess } from "./proc.ts";
import type { Runner } from "./proc.ts";

export interface AgentRequest {
  prompt: string;
  /** Permission rules for --allowedTools, e.g. `Read` or `Bash(npm test *)`. */
  tools: string[];
  /** JSON schema for the structured output, or null for a plain call. */
  schema: object | null;
  model: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface AgentResult {
  event: Event | null;
  summary: string;
  costUsd: number;
  /** claude's stdout, kept for the iteration log. */
  raw: string;
}

/** Runs one agent session. Rejects with AgentError on failure, AbortedError on Ctrl-C. */
export type AgentFn = (req: AgentRequest) => Promise<AgentResult>;

export class AgentError extends Error {
  costUsd: number;
  raw: string;

  constructor(message: string, costUsd = 0, raw = "") {
    super(message);
    this.name = "AgentError";
    this.costUsd = costUsd;
    this.raw = raw;
  }
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** The structured output a hat must return: an optional event from `publishes`, and a summary. */
export function eventSchema(publishes: readonly string[]): object {
  return {
    type: "object",
    required: ["summary"],
    additionalProperties: false,
    properties: {
      event: {
        type: "object",
        required: ["topic", "payload"],
        additionalProperties: false,
        properties: {
          topic: { type: "string", enum: [...publishes] },
          payload: { type: "string" },
        },
      },
      summary: { type: "string" },
    },
  };
}

/** Bare tool names for --tools: `Bash(npm test *)` becomes `Bash`, deduplicated. */
export function bareTools(rules: readonly string[]): string[] {
  return [...new Set(rules.map((r) => r.replace(/\(.*$/s, "").trim()))];
}

export function claudeArgv(req: AgentRequest): string[] {
  return [
    "claude", "-p", "--output-format", "json",
    ...(req.schema === null ? [] : ["--json-schema", JSON.stringify(req.schema)]),
    "--tools", bareTools(req.tools).join(","),
    // --allowedTools takes several values, so another flag must follow it.
    "--allowedTools", ...req.tools,
    "--restricted",
    "--model", req.model,
    "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands",
  ];
}

/** Check the one shape a hat returns, without a schema library. */
export function parseStructured(so: unknown): { event: Event | null; summary: string } {
  if (!isObj(so)) throw new AgentError("structured_output is not an object");
  if (typeof so.summary !== "string") throw new AgentError("structured_output.summary must be a string");
  const ev = so.event;
  if (ev === undefined || ev === null) return { event: null, summary: so.summary };
  if (!isObj(ev) || typeof ev.topic !== "string" || typeof ev.payload !== "string") {
    throw new AgentError("structured_output.event needs a string topic and payload");
  }
  return { event: { topic: ev.topic, payload: ev.payload }, summary: so.summary };
}

function costOf(env: Obj): number {
  const c = env.total_cost_usd;
  return typeof c === "number" && Number.isFinite(c) ? c : 0;
}

/** Parse claude's --output-format json envelope. */
export function parseEnvelope(stdout: string, structured: boolean): AgentResult {
  let env: unknown;
  try {
    env = JSON.parse(stdout);
  } catch (e) {
    throw new AgentError(`non-JSON output: ${(e as Error).message}`, 0, stdout);
  }
  if (!isObj(env)) throw new AgentError("envelope is not an object", 0, stdout);
  const costUsd = costOf(env);
  if (env.is_error) throw new AgentError(`claude error: ${String(env.result ?? "unknown")}`, costUsd, stdout);
  if (!structured) {
    return { event: null, summary: typeof env.result === "string" ? env.result : "", costUsd, raw: stdout };
  }
  try {
    return { ...parseStructured(env.structured_output), costUsd, raw: stdout };
  } catch (e) {
    if (e instanceof AgentError) throw new AgentError(e.message, costUsd, stdout);
    throw e;
  }
}

/** The real backend: `claude -p` in `cwd`, prompt on stdin. */
export function claudeAgent(cwd: string, runner: Runner = runProcess): AgentFn {
  return async (req) => {
    const res = await runner(claudeArgv(req), req.prompt, req.timeoutMs / 1000, { cwd, signal: req.signal });
    if (res.code === -1) throw new AgentError("timeout", 0, res.stdout);
    if (res.code !== 0) {
      // A failed run can still print its envelope, and with it what it cost.
      let costUsd = 0;
      try {
        const env: unknown = JSON.parse(res.stdout);
        if (isObj(env)) costUsd = costOf(env);
      } catch {
        // no envelope
      }
      throw new AgentError(res.stderr.trim() || `claude exited ${res.code}`, costUsd, res.stdout);
    }
    return parseEnvelope(res.stdout, req.schema !== null);
  };
}
