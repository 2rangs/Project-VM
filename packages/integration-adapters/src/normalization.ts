/**
 * Cross-branch identifier & unit normalization (integration glue).
 *
 * Different branches picked slightly different notations. This is the single place that
 * reconciles them at integration, plus a survey of which branch uses what (read-only
 * investigation; update if a branch changes). See docs/archive/INTEGRATION_PLAN.md §Normalization.
 */

/** Agent slug aliases → canonical lowercase slug. PV-1/PV-2 use "kay-o"; scenarios "kayo". */
export const AGENT_SLUG_ALIASES: Readonly<Record<string, string>> = {
  kayo: "kay-o",
  "kay/o": "kay-o",
  "kay-o": "kay-o",
};

/** Canonicalize an agent slug (lowercase + alias map). */
export function normalizeAgentSlug(slug: string): string {
  const lower = slug.trim().toLowerCase();
  return AGENT_SLUG_ALIASES[lower] ?? lower;
}

/** Zone ids are lowercase, hyphenated (e.g. "a-site"); normalize casing/spaces. */
export function normalizeZoneId(id: string): string {
  return id.trim().toLowerCase().replace(/\s+/g, "-");
}

/** Team id: PV-3 uses "team-0"/"team-1"; several branches use teamIdx 0/1. */
export function teamIdToIdx(teamId: string): 0 | 1 {
  return /1$/.test(teamId) ? 1 : 0;
}
export function teamIdxToId(idx: number): string {
  return `team-${idx}`;
}

/**
 * Coordinate frames in play. The adapter (spatial-adapter.ts) converts between them; this
 * table documents the risk so integration verifies the minimapUnits↔normalized mapping.
 */
export const COORDINATE_FRAMES = {
  /**
   * PV-2 scenarios / PV-3 decision layer. CONFIRMED (phase-5 rehearsal) to be the VLR
   * 2D-replay minimap PIXEL frame — observed x≈170..825 in the 10 scenarios; PV-4 reports
   * the full vlr range as x≈92..973, y≈117..844. NOT normalized×1000.
   */
  minimapUnits: { range: "VLR pixels ~92..973 x / 117..844 y", origin: "top-left", axis: "x right, y down" },
  /** PV-4 spatial-engine minimap output (valorant-api transform) — a DIFFERENT frame. */
  normalizedMinimap: { range: "0..1", origin: "top-left", axis: "axis-swapped (minimapX=gameY)" },
  /** PV-4 game-world. */
  gameWorld: { unit: "Unreal uu", unitsPerMeter: 100 },
} as const;

/** All durations/timestamps across the project are milliseconds. */
export const TIME_UNIT = "ms" as const;

/** Per-branch notation survey (as investigated 2026-11-18; read-only). */
export interface BranchNotation {
  readonly branch: string;
  readonly teamNotation: "team-N" | "teamIdx(0|1)" | "n/a";
  readonly coordFrame: keyof typeof COORDINATE_FRAMES;
  readonly agentSlug: "kayo" | "kay-o" | "n/a";
  readonly notes: string;
}

export const BRANCH_NOTATION_SURVEY: readonly BranchNotation[] = [
  { branch: "pv-core (PV-3)", teamNotation: "team-N", coordFrame: "minimapUnits", agentSlug: "kay-o", notes: "scenarios load as team-N; ULTIMATE_COSTS uses kay-o + kayo alias." },
  { branch: "pv-data (PV-2)", teamNotation: "teamIdx(0|1)", coordFrame: "minimapUnits", agentSlug: "kay-o", notes: "DecisionContext uses teamIdx; economy-engine mirrors shared types; eco/full buyThresholds are loadoutValue not bank." },
  { branch: "pv-spatial (PV-4)", teamNotation: "teamIdx(0|1)", coordFrame: "gameWorld", agentSlug: "n/a", notes: "spatial zones in game uu; coords map to normalized[0,1]; combat/ability/perception mirror shared types." },
  { branch: "pv-research (PV-1)", teamNotation: "n/a", coordFrame: "gameWorld", agentSlug: "kay-o", notes: "ability_facts.json keyed by agent:Ability; ultPoints canonical." },
  { branch: "pv-replay (PV-6)", teamNotation: "teamIdx(0|1)", coordFrame: "normalizedMinimap", agentSlug: "n/a", notes: "replay coordinate module; verified minimap transform (3001 samples, inclusion 1.0)." },
  { branch: "pv-mapmesh", teamNotation: "n/a", coordFrame: "gameWorld", agentSlug: "n/a", notes: "map geometry/mesh (no packages yet at survey time)." },
];

/**
 * KNOWN MISMATCHES to resolve at integration:
 * 1. minimapUnits(0..1000) vs normalizedMinimap(0..1): spatial-adapter assumes ×1000 with
 *    same orientation — VERIFY against PV-2's actual scenario frame (flipY option provided).
 * 2. Eco/full thresholds: PV-3 team-engine ECO_BANK_THRESHOLD=2000 (bank credits) vs PV-2
 *    priors buyThresholds ecoMaxCredits=5000 (loadout value). Different metrics — reconcile.
 * 3. Agent slug kay-o vs kayo: use normalizeAgentSlug everywhere ids cross a boundary.
 */
export const KNOWN_MISMATCHES = [
  "COORDINATE (DECIDED phase-5 with PV-4): SpatialQuery + engines use game WORLD UNITS " +
    "internally; minimapUnits (PV-2 VLR pixels) convert ONLY at the data-load boundary " +
    "(scenario loader, UI) via the injected transform. The ×1000 scale path is wrong " +
    "(mapped attacker-spawn→b-main); supply PV-6's vlr-pixel↔game via minimapToGame.",
  "CONTRACT GRANULARITY: PV-4 round-simulator (94fa92f) DecisionPolicy is per-player/tick " +
    "(decide(ctx)→ActionCommand) with no teammates in ctx; PV-3 TeamDecisionPolicy is team/" +
    "round (decide(view,rng)→PolicyDecision). Reconcile (PV-4 aligning per orchestrator).",
  "eco/full thresholds: bank-credits (PV-3) vs loadout-value (PV-2 priors) — different metrics.",
  "agent slug kay-o vs kayo — use normalizeAgentSlug at boundaries.",
  "fromPv2Scenario (PV-4) currently ignores per-player positions/belief (spawns at spawn).",
] as const;
