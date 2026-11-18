/**
 * CombatEstimator adapter over PV-4's combat-engine.
 *
 * MIRROR SOURCE: origin/claude/pv-spatial @ e3ad1c541e4c5834a2cd4e438199a3ad9557a927
 *   packages/combat-engine/src/{montecarlo.ts (monteCarloDuel, DuelStats), types.ts
 *   (Duel/Combatant/WeaponSpec), weapons.ts (buildCatalog/requireWeapon)}.
 * Calibration target: origin/claude/pv-data @ fe354096
 *   datasets/derived/priors/combat_opening_duel.json (opening-duel win rate by side/map).
 * At merge, import monteCarloDuel/requireWeapon/buildCatalog from "@pv/combat-engine".
 *
 * The estimator builds a Duel from a CombatEstimateInput and returns
 * wins[attacker]/trials. `makeSkills` is injected because combat-engine owns the
 * CombatSkills shape; tests pass a fake. Flash/cover are folded into aim as a proxy until
 * the real ResolveOptions are wired (TODO at integration).
 */
import type { CombatEstimateInput, CombatEstimator } from "@pv/shared-types";

// ---- structural mirror of combat-engine ----
type WeaponSpecLike = unknown;
type CombatSkillsLike = unknown;
type CatalogLike = unknown;
interface CombatantLike {
  readonly id: string;
  readonly teamId: string;
  readonly health: number;
  readonly armor: number;
  readonly weapon: WeaponSpecLike;
  readonly skills: CombatSkillsLike;
  readonly posture: string;
  readonly ammo?: number;
}
interface DuelLike { readonly a: CombatantLike; readonly b: CombatantLike; readonly distanceMeters: number }
interface DuelStatsLike { readonly trials: number; readonly wins: Readonly<Record<string, number>> }

export type MonteCarloDuelLike = (duel: DuelLike, trials: number, baseSeed?: number, opts?: unknown) => DuelStatsLike;
export type RequireWeaponLike = (catalog: CatalogLike, slug: string) => WeaponSpecLike;

export interface CombatAdapterOptions {
  readonly monteCarloDuel: MonteCarloDuelLike;
  readonly requireWeapon: RequireWeaponLike;
  readonly catalog: CatalogLike;
  /** Build combat-engine CombatSkills from an aim proxy in [0,1]. Injected (engine owns it). */
  readonly makeSkills: (aim: number) => CombatSkillsLike;
  readonly trials?: number;
  readonly baseSeed?: number;
  readonly defaultPosture?: string;
  readonly fallbackWeaponSlug?: string;
  readonly defaultDistanceMeters?: number;
  /** Optional opening-duel prior to blend toward (calibration target). */
  readonly openingDuelPrior?: number;
  readonly priorWeight?: number;
}

/** Fold flash/cover into an effective aim proxy (until real ResolveOptions are wired). */
function effectiveAim(aim: number, flashed: boolean, hasCover: boolean): number {
  let a = aim;
  if (flashed) a -= 0.4;
  if (hasCover) a += 0.1;
  return Math.max(0, Math.min(1, a));
}

export function combatEstimatorFromEngine(opts: CombatAdapterOptions): CombatEstimator {
  const trials = opts.trials ?? 200;
  const baseSeed = opts.baseSeed ?? 1;
  const posture = opts.defaultPosture ?? "peek";
  const fallback = opts.fallbackWeaponSlug ?? "classic";
  const dist = opts.defaultDistanceMeters ?? 15;
  const priorWeight = opts.priorWeight ?? 0;

  const weapon = (slug: string | null): WeaponSpecLike =>
    opts.requireWeapon(opts.catalog, slug ?? fallback);

  return {
    estimateDuelWinProb(input: CombatEstimateInput): number {
      const duel: DuelLike = {
        a: {
          id: "a", teamId: "A", health: input.attackerHealth, armor: 0,
          weapon: weapon(input.attackerWeapon),
          skills: opts.makeSkills(effectiveAim(input.attackerAim, input.attackerFlashed, input.attackerHasCover)),
          posture,
        },
        b: {
          id: "b", teamId: "B", health: input.defenderHealth, armor: 0,
          weapon: weapon(input.defenderWeapon),
          skills: opts.makeSkills(effectiveAim(input.defenderAim, input.defenderFlashed, input.defenderHasCover)),
          posture,
        },
        distanceMeters: input.distanceMeters ?? dist,
      };
      const stats = opts.monteCarloDuel(duel, trials, baseSeed);
      const p = stats.trials > 0 ? (stats.wins["a"] ?? 0) / stats.trials : 0.5;
      return opts.openingDuelPrior !== undefined
        ? (1 - priorWeight) * p + priorWeight * opts.openingDuelPrior
        : p;
    },
  };
}
