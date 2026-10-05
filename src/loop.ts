import fs from "node:fs";
import path from "node:path";

import { AgentError, eventSchema } from "./agent.ts";
import type { AgentFn, AgentResult } from "./agent.ts";
import type { Config, HatConfig } from "./config.ts";
import { route } from "./events.ts";
import type { Event } from "./events.ts";
import { AbortedError } from "./proc.ts";
import { buildIterationPrompt } from "./prompt.ts";
import type { RunPaths } from "./rundir.ts";

export type Outcome = "ok" | "agent_failed" | "interrupted";

export type StopReason =
  | "completed" | "max_iterations" | "max_runtime" | "max_cost" | "agent_failed" | "unrouted"
  | "interrupted" | "error";

export interface GateRecord {
  name: string;
  passed: boolean;
  durationMs: number;
}

export interface IterationRecord {
  iteration: number;
  hat: string;
  outcome: Outcome;
  inputEvent: Event;
  outputEvent: Event | null;
  summary: string;
  gates: GateRecord[];
  commit: { sha: string; fallback: boolean } | null;
  costUsd: number;
  durationMs: number;
  error?: string;
}

export interface RunSummary {
  stopReason: StopReason;
  iterations: number;
  costUsd: number;
  records: IterationRecord[];
}

export interface OrchestratorOptions {
  config: Config;
  task: string;
  agent: AgentFn;
  run: RunPaths;
  repoRoot: string;
  /** The iteration skill's text. */
  template: string;
  signal?: AbortSignal;
  /** Milliseconds; injectable so tests can move time. */
  now?: () => number;
  onIteration?: (rec: IterationRecord) => void;
}

export class Orchestrator {
  private readonly opts: OrchestratorOptions;
  private readonly now: () => number;
  private readonly records: IterationRecord[] = [];
  private costUsd = 0;

  constructor(opts: OrchestratorOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  async run(): Promise<RunSummary> {
    let stop: StopReason;
    try {
      stop = await this.loop();
    } catch (e) {
      this.writeHistory("error");
      throw e;
    }
    this.writeHistory(stop);
    return { stopReason: stop, iterations: this.records.length, costUsd: this.costUsd, records: this.records };
  }

  private async loop(): Promise<StopReason> {
    const { config, task, signal } = this.opts;
    const limits = config.loop;
    const start = this.now();
    let event: Event = { topic: limits.startingEvent, payload: task };
    let failures = 0;
    this.writeHistory(null);
    for (;;) {
      if (signal?.aborted) return "interrupted";
      if (this.records.length >= limits.maxIterations) return "max_iterations";
      if (this.now() - start >= limits.maxRuntimeMinutes * 60_000) return "max_runtime";
      if (this.costUsd >= limits.maxCostUsd) return "max_cost";
      const hat = route(config.hats, event.topic);
      if (hat === null) return "unrouted";

      const rec = await this.iteration(this.records.length + 1, hat, event);
      this.records.push(rec);
      this.writeHistory(null);
      this.opts.onIteration?.(rec);

      if (rec.outcome === "interrupted") return "interrupted";
      if (rec.outcome === "agent_failed") {
        failures += 1;
        if (failures >= limits.maxFailures) return "agent_failed";
        continue;
      }
      failures = 0;
      const out = rec.outputEvent!;
      if (out.topic === limits.completionEvent) return "completed";
      event = out;
    }
  }

  private async iteration(n: number, hat: HatConfig, event: Event): Promise<IterationRecord> {
    const { config, run, repoRoot, signal } = this.opts;
    const started = this.now();
    const prompt = buildIterationPrompt(this.opts.template, {
      task: this.opts.task,
      hat,
      event,
      scratchpadPath: path.relative(repoRoot, run.scratchpad),
      guardrails: config.guardrails,
      gateFeedback: "",
      iteration: n,
    });
    const record = (
      fields: Pick<IterationRecord, "outcome" | "outputEvent" | "summary" | "costUsd"> & { error?: string },
      raw: string,
    ): IterationRecord => {
      fs.writeFileSync(run.iterLog(n), fields.error ? `${raw}\nerror: ${fields.error}\n` : `${raw}\n`);
      return {
        iteration: n, hat: hat.id, inputEvent: event, gates: [], commit: null,
        ...fields, durationMs: this.now() - started,
      };
    };

    let res: AgentResult;
    try {
      res = await this.opts.agent({
        prompt,
        tools: config.agent.allowedTools,
        schema: eventSchema(hat.publishes),
        model: config.agent.model,
        timeoutMs: config.agent.timeoutMinutes * 60_000,
        signal,
      });
    } catch (e) {
      const costUsd = e instanceof AgentError ? e.costUsd : 0;
      const raw = e instanceof AgentError ? e.raw : "";
      this.costUsd += costUsd;
      // Ctrl-C reaches claude too, and its exit can arrive before the abort does.
      if (e instanceof AbortedError || signal?.aborted) {
        return record({ outcome: "interrupted", outputEvent: null, summary: "", costUsd, error: "interrupted" }, raw);
      }
      if (!(e instanceof AgentError)) throw e;
      return record({ outcome: "agent_failed", outputEvent: null, summary: "", costUsd, error: e.message }, raw);
    }

    this.costUsd += res.costUsd;
    const out = res.event;
    const error = out === null
      ? "no event returned"
      : hat.publishes.includes(out.topic) ? undefined : `topic "${out.topic}" is not in publishes`;
    if (error !== undefined) {
      return record({ outcome: "agent_failed", outputEvent: null, summary: res.summary, costUsd: res.costUsd, error }, res.raw);
    }
    return record({ outcome: "ok", outputEvent: out, summary: res.summary, costUsd: res.costUsd }, res.raw);
  }

  private writeHistory(stopReason: StopReason | null): void {
    const data = {
      task: this.opts.task,
      config: this.opts.config,
      stopReason,
      totals: { iterations: this.records.length, costUsd: this.costUsd },
      iterations: this.records,
    };
    fs.writeFileSync(this.opts.run.history, `${JSON.stringify(data, null, 2)}\n`);
  }
}

/** One console line, e.g. `iter 3 | 🔨 Builder | work.start → work.continue | $0.41`. */
export function iterationLine(rec: IterationRecord, hatName: string): string {
  const result = rec.outcome === "ok"
    ? rec.outputEvent!.topic
    : rec.outcome === "interrupted" ? "interrupted" : `agent failed: ${rec.error}`;
  return `iter ${rec.iteration} | ${hatName} | ${rec.inputEvent.topic} → ${result} | $${rec.costUsd.toFixed(2)}`;
}
