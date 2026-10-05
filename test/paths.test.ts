import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { PACKAGE_JSON, PACKAGE_ROOT, PRESETS_DIR, SKILLS_DIR } from "../src/paths.ts";
import { ROOT } from "./helpers.ts";

test("asset paths point at the package root", () => {
  assert.equal(path.resolve(PACKAGE_ROOT), ROOT);
  assert.equal(PACKAGE_JSON, path.join(ROOT, "package.json"));
  assert.equal(SKILLS_DIR, path.join(ROOT, "skills"));
  assert.equal(PRESETS_DIR, path.join(ROOT, "presets"));
});
