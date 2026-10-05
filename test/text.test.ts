import assert from "node:assert/strict";
import { test } from "node:test";

import { fence, universalNewlines } from "../src/text.ts";

test("universalNewlines turns \\r\\n and \\r into \\n", () => {
  assert.equal(universalNewlines("a\r\nb\rc\n"), "a\nb\nc\n");
});

test("fence wraps text in a three-backtick text fence", () => {
  assert.equal(fence("hello"), "```text\nhello\n```");
});

test("fence is longer than any backtick run inside the text", () => {
  const out = fence("a ```` b ``` c");
  assert.ok(out.startsWith("`````text\n"));
  assert.ok(out.endsWith("\n`````"));
});
