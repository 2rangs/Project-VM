// Identifier normalization for @pv/game-data. Mirrors PV-3
// packages/integration-adapters/src/normalization.ts so every branch resolves
// the same slugs (e.g. "kayo" / "kay/o" -> "kay-o").

export const AGENT_SLUG_ALIASES: Readonly<Record<string, string>> = {
  kayo: "kay-o",
  "kay/o": "kay-o",
  "kay-o": "kay-o",
};

/** Canonicalize an agent slug: lowercase, strip junk, apply alias map. */
export function normalizeAgentSlug(slug: string): string {
  const lower = slug.trim().toLowerCase().replace(/[^a-z0-9/-]/g, "");
  return AGENT_SLUG_ALIASES[lower] ?? lower;
}

/** Team/player ids in VCT Reference are numeric strings; normalize to string. */
export function normalizeId(id: string | number): string {
  return String(id).trim();
}
