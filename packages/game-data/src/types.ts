// Runtime game-data types for @pv/game-data (consumed by PV-3 Match Runner and
// PV-6 desktop). Distances in the effect specs are metres (catalog convention);
// consumers that use world units convert ×100.

export interface Weapon {
  readonly id: string;
  readonly name: string;
  readonly category: string | null;
  readonly cost: number | null;
  readonly fireRate?: number | null;
  readonly magazineSize?: number | null;
  readonly damageRanges?: ReadonlyArray<{
    rangeStartMeters: number; rangeEndMeters: number;
    headDamage: number; bodyDamage: number; legDamage: number;
  }>;
  readonly wallPenetration?: string | null;
  /** "api" when from valorant-api; "manual-approx" when the fallback table is used. */
  readonly provenance: "api" | "manual-approx";
}

export interface AgentAbility {
  readonly slot: string;
  readonly name: string;
  readonly effectTypes: readonly string[];
}
export interface Agent {
  readonly slug: string;
  readonly name: string;
  readonly role: string | null;
  readonly abilities: readonly AgentAbility[];
}

export interface AbilityEffect {
  readonly abilityId: string;
  readonly agentName: string;
  readonly slot: string;
  readonly name: string;
  readonly effectTypes: readonly string[];
  readonly params: Record<string, number | boolean | string | null>;
  readonly verified: boolean;
  readonly sourcePage: string | null;
}

export interface PlayerAttributes {
  readonly [attr: string]: { value: number; uncertainty: number } | unknown;
}
export interface Player {
  readonly playerId: string;
  readonly handle: string | null;
  readonly country: string | null;
  readonly role: string | null;
  readonly attributes: PlayerAttributes | null;
  /** false when no ratings exist for this player (consumer should use league defaults). */
  readonly hasRatings: boolean;
}

export interface RosterEntry { readonly playerId: string; readonly maps: number; }
export interface Team {
  readonly teamId: string;
  readonly name: string | null;
  readonly country: string | null;
  readonly mapPool: Record<string, number> | null;
}

export interface BundleMeta {
  readonly generatedAt: string;
  readonly currentBuild: string;
  readonly disclaimer: string;
  readonly counts: Record<string, number>;
  readonly rosterAsOf: string;
  readonly sources: Record<string, string | null>;
}
