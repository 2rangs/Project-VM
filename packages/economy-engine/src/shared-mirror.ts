/**
 * Field-level mirror of the @pv/shared-types vocabulary this engine needs.
 *
 * PV-core owns `@pv/shared-types` (packages/shared-types on origin/claude/pv-core). To keep this
 * package independently buildable before the monorepo is wired, we mirror the exact field shapes
 * here. At integration, delete this file and `import` from "@pv/shared-types" instead — the names
 * and fields are kept identical on purpose. (Same approach PV-4 used in perception-engine.)
 */

// ids.ts — branded in shared-types; plain string here (brand is erased at runtime anyway).
export type PlayerId = string;
export type TeamId = string;
export type AgentId = string;
export type WeaponId = string;

/** ids.ts */
export type Side = "attack" | "defense";

/** economy.ts */
export type ArmorType = "none" | "light" | "heavy" | "regen";

/** economy.ts — BuyAction */
export type BuyAction =
  | "fullBuy"
  | "halfBuy"
  | "forceBuy"
  | "eco"
  | "bonus"
  | "save"
  | "dropWeapon"
  | "buyTeammate"
  | "preserveWeapon"
  | "upgradeWeapon";

/** economy.ts — TeamEconomyState */
export interface TeamEconomyState {
  readonly teamId: TeamId;
  readonly side: Side;
  readonly credits: number;
  readonly lossBonusTier: number;
  readonly consecutiveLosses: number;
  /**
   * The team's buy call this round, when the match runner made one ("pistol" | "full" | "half" |
   * "force" | "eco" | "bonus"). Lets the round plan follow the real buy instead of a bank threshold.
   */
  readonly buyCall?: string;
}

/** Team index convention used across PROJECT V datasets (0 = team0, 1 = team1). */
export type TeamIdx = 0 | 1;
