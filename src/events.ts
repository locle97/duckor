import type { HatConfig } from "./config.ts";

export interface Event {
  topic: string;
  payload: string;
}

/** The hat triggered by `topic`, or null. Exact match for now; glob triggers come later. */
export function route(hats: readonly HatConfig[], topic: string): HatConfig | null {
  return hats.find((h) => h.triggers.includes(topic)) ?? null;
}
