import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AgentFn, AgentRequest, AgentResult } from "../src/agent.ts";
import type { ProcResult, Runner } from "../src/proc.ts";

export interface Call {
  argv: string[];
  stdin: string | null;
  timeoutSec: number;
  cwd?: string;
  signal?: AbortSignal;
}

export type FakeRunner = Runner & { calls: Call[] };

export function fakeRunner(
  result: ProcResult | ((argv: string[], stdin: string | null) => ProcResult),
): FakeRunner {
  const calls: Call[] = [];
  const run = async (
    argv: string[], stdin: string | null, timeoutSec: number,
    opts?: { cwd?: string; signal?: AbortSignal },
  ): Promise<ProcResult> => {
    calls.push({ argv, stdin, timeoutSec, cwd: opts?.cwd, signal: opts?.signal });
    return typeof result === "function" ? result(argv, stdin) : result;
  };
  return Object.assign(run, { calls });
}

export function ok(stdout = ""): ProcResult {
  return { code: 0, stdout, stderr: "" };
}

export function tmpDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "duckor-")));
}

export const ROOT = path.resolve(import.meta.dirname, "..");

/** An agent's reply in a script: a result, an error to throw, or a function of the request. */
export type Step = AgentResult | Error | ((req: AgentRequest) => AgentResult | Promise<AgentResult>);

export type ScriptedAgent = AgentFn & { calls: AgentRequest[] };

/** A fake AgentFn that plays `steps` in order and records every request. */
export function scriptedAgent(steps: Step[]): ScriptedAgent {
  const calls: AgentRequest[] = [];
  const agent = async (req: AgentRequest): Promise<AgentResult> => {
    calls.push(req);
    const step = steps.shift();
    if (step === undefined) throw new Error("scripted agent: no steps left");
    if (step instanceof Error) throw step;
    return typeof step === "function" ? step(req) : step;
  };
  return Object.assign(agent, { calls });
}

export function reply(topic: string | null, payload = "", costUsd = 0, summary = ""): AgentResult {
  return { event: topic === null ? null : { topic, payload }, summary, costUsd, raw: `{"topic":${JSON.stringify(topic)}}` };
}
