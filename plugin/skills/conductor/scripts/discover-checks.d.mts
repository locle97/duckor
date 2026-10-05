export interface Check { name: string; cmd: string }
export interface Excluded extends Check { reason: string }
export interface Discovery { checks: Check[]; excluded: Excluded[]; source: "doc" | "inferred" | "none" }
export function discoverChecks(repoDir: string): Discovery;
