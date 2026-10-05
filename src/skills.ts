import fs from "node:fs";
import path from "node:path";

import { SKILLS_DIR } from "./paths.ts";

export const SKILL_NAMES = ["iteration"] as const;
export type SkillName = (typeof SKILL_NAMES)[number];

export function skillPath(name: SkillName): string {
  return path.join(SKILLS_DIR, `${name}.md`);
}

/** The bundled skill's text. Repo overrides (.duckor/skills) arrive in a later milestone. */
export function loadSkill(name: SkillName): string {
  return fs.readFileSync(skillPath(name), "utf8");
}
