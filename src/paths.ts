import path from "node:path";
import { fileURLToPath } from "node:url";

// The package root, one level up from both src/ (tests) and dist/ (installed).
export const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const PACKAGE_JSON = path.join(PACKAGE_ROOT, "package.json");
export const SKILLS_DIR = path.join(PACKAGE_ROOT, "skills");
export const PRESETS_DIR = path.join(PACKAGE_ROOT, "presets");
