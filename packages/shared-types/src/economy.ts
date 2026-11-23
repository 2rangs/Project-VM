/**
 * Economy-related state carried on the world (README §19, Handoff §16).
 *
 * The concrete numeric *rules* (prices, rewards, loss bonus) live in @pv/game-rules;
 * these are only the per-entity *state* shapes the world tracks. Credits are integers.
 */
import type { AbilityId, PlayerId, Side, TeamId, WeaponId } from "./ids.js";

export type ArmorType = "none" | "light" | "heavy" | "regen";

export interface WeaponState {
  readonly weaponId: WeaponId;
  readonly magazine: number; // rounds in magazine
  readonly reserve: number; // rounds in reserve
}

export interface ArmorState {
  readonly type: ArmorType;
  readonly points: number; // remaining armor points
}

/** Remaining charges of each ability the agent owns this round. */
export interface AbilityChargeState {
  readonly abilityId: AbilityId;
  readonly charges: number;
}

export interface AbilityInventory {
  readonly basic: readonly AbilityChargeState[];
  readonly signature: AbilityChargeState | null;
  /** The ultimate: `ready` means enough points are banked to cast it. */
  readonly ultimate: {
    readonly abilityId: AbilityId;
    readonly points: number;
    readonly required: number;
    readonly ready: boolean;
  };
}

export interface InventoryState {
  readonly primary: WeaponState | null;
  readonly secondary: WeaponState | null;
  readonly armor: ArmorState;
  readonly hasSpike: boolean;
}

/** Team-level economy snapshot (README §19.2). */
export interface TeamEconomyState {
  readonly teamId: TeamId;
  readonly side: Side;
  readonly credits: number; // sum available across the team this buy phase
  readonly lossBonusTier: number; // 0-based index into the loss-bonus ladder
  readonly consecutiveLosses: number;
  /**
   * The team's buy call this round, when the match runner made one ("pistol" | "full" | "half" |
   * "force" | "eco" | "bonus"). Lets the round plan follow the real buy instead of a bank threshold.
   */
  readonly buyCall?: string;
}

/** A single player's buy decision, split team vs. individual (README §19.3). */
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

export interface PlayerBuyIntent {
  readonly playerId: PlayerId;
  readonly action: BuyAction;
}
