import assert from "node:assert/strict";
import { test } from "node:test";

import type { HatConfig } from "../src/config.ts";
import { route } from "../src/events.ts";

const hat = (id: string, triggers: string[]): HatConfig =>
  ({ id, name: id, description: "", triggers, publishes: ["LOOP_COMPLETE"], instructions: "" });

test("route finds the hat whose triggers include the topic", () => {
  const hats = [hat("a", ["work.start"]), hat("b", ["build.done"])];
  assert.equal(route(hats, "build.done")?.id, "b");
});

test("route returns null for an unrouted topic", () => {
  assert.equal(route([hat("a", ["work.start"])], "build.*"), null);
});
