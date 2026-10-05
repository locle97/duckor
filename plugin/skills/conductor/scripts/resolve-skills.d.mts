export type Role = "commit" | "code-review" | "tdd" | "debugging" | "verification";
export type ReviewMode = "augment" | "replace";
export const DEFAULTS: Record<Role, string | null>;
export const REVIEW_MODES: ReviewMode[];
export const PROJECT_CONFIG: string;
export function defaultUserConfig(): string;
export interface Resolution {
  skills: Record<Role, string | null>;
  review_mode: ReviewMode;
  sources: Record<Role, "default" | "user" | "project">;
  errors: string[];
}
export function resolveSkills(repoDir: string, opts?: { userConfig?: string | null }): Resolution;
