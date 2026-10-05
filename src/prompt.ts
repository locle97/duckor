import type { HatConfig } from "./config.ts";
import type { Event } from "./events.ts";
import { fence } from "./text.ts";

/**
 * Replace each `{{name}}` with values[name] in a single pass, so substituted text is never
 * expanded again. Unknown placeholders are left as is.
 */
export function render(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{([a-z_]+)\}\}/g, (m, key: string) => (Object.hasOwn(values, key) ? values[key] : m));
}

export interface IterationContext {
  task: string;
  hat: HatConfig;
  event: Event;
  scratchpadPath: string;
  guardrails: readonly string[];
  gateFeedback: string;
  iteration: number;
}

export function buildIterationPrompt(template: string, ctx: IterationContext): string {
  return render(template, {
    task: ctx.task,
    hat_name: ctx.hat.name,
    hat_instructions: ctx.hat.instructions.trim(),
    event_topic: ctx.event.topic,
    // The payload was written by an agent (or is the task): data, never instructions.
    event_payload: fence(ctx.event.payload),
    publishes: ctx.hat.publishes.map((t) => `\`${t}\``).join(", "),
    scratchpad_path: ctx.scratchpadPath,
    guardrails: ctx.guardrails.length ? ctx.guardrails.map((g) => `- ${g}`).join("\n") : "(none)",
    gate_feedback: ctx.gateFeedback,
    iteration: String(ctx.iteration),
  });
}
