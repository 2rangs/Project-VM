/**
 * Match economy: per-player credits, kept equipment, the team buy plan and ultimate points
 * (EC-01/02/03/05, docs/ECONOMY_MODEL.md).
 *
 * State. Each player has credits, the weapon and shield they carry in (a survivor keeps both; a
 * weapon picked up after the round is kept too) and ultimate points. Credits follow the official
 * rules in @pv/game-rules: round win / loss-bonus ladder to every player, the kill reward to the
 * killer, the plant reward to every attacker, the 9000 cap; half time and each overtime round reset.
 *
 * Buy. The team call is the plan that maximises J = E[P(win the map)] over this round and a two-round
 * lookahead (@pv/economy-engine `lookaheadValue`), with the round-win belief fitted to real VCT
 * loadouts (`roundWinBelief`). Candidate plans: max (full buy, or a force when not everyone reaches a
 * rifle), half (SMG + light shield), light (a light shield on the Classic), eco (save everything), and keep
 * (the bonus round: carried guns, no new weapons).
 * Inside a plan each player buys from their own credits; a rich player drops a rifle to a poor one
 * when the second rifle is worth more than the dropper's own utility and shield; the star (highest
 * mechanical rating) is served first. Team traits enter as beliefs: discipline sets how fully the
 * next round is weighed; gameSense how well the opponent's own save/force is read.
 *
 * Ultimates. Points come from the round simulator's outcome (kill / death / plant / defuse) plus
 * ult orbs where the map provides them. With abilities on, a team may hold ready ultimates for a
 * later round; the hold is part of the same objective (an ultimate is loadout value in the round it
 * is used).
 */
import {
  ARMOR_PURCHASES,
  ECONOMY_RULES,
  ROUND_RULES,
  ULTIMATE_POINT_RULES,
  clampCredits,
  lossBonusFor,
  ultimatePointsRequired,
  utilityKitCost,
  weaponPrice,
} from "@pv/game-rules";
import { SIM_ROUND_WIN_BELIEF, lookaheadValue, mapOver, mapWinProbability, roundWinBelief, vctTierForLoadout, type IncomeRules, type LookaheadTeam, type WinBeliefParams } from "@pv/economy-engine";
import { armorMatchedPrice } from "./weapon-worth.js";

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export interface PlayerEconomy {
  readonly credits: number;
  /** Weapon carried into the next buy phase (sim name, e.g. "Vandal"); null = only the free Classic. */
  readonly weapon: string | null;
  /** Shield points carried into the next round (survivors keep what is left). */
  readonly armor: number;
  readonly ultPoints: number;
}

export interface TeamEconomy {
  /** Σ of the players' credits (kept for the UI and the policy view). */
  readonly credits: number;
  readonly consecutiveLosses: number;
  /** Σ of the players' ultimate points. */
  readonly ultPoints: number;
  readonly players: readonly PlayerEconomy[];
  /**
   * What this team has seen of its own survival: players alive at the end of won and lost rounds.
   * It is the team's belief behind "a kept gun is worth this much next round".
   */
  readonly survival: {
    readonly wonRounds: number; readonly wonAlive: number; readonly lostRounds: number; readonly lostAlive: number;
    /** Ultimate points the players earned, over player-rounds played (the team's ult-rate belief). */
    readonly ultEarned: number; readonly playerRounds: number;
  };
}

export type BuyTier = "pistol" | "full" | "half" | "force" | "eco" | "bonus";
export type BuyPlan = "pistol" | "max" | "smg" | "half" | "light" | "sidearms" | "eco" | "keep";

/** One player's buy this round. */
export interface PlayerBuy {
  /** Roster index 0..4 (sim id atk{i+1} / def{i+1}). */
  readonly index: number;
  readonly creditsBefore: number;
  readonly creditsAfter: number;
  /** Spent from this player's own credits (own buys and anything they bought for a teammate). */
  readonly spent: number;
  /** The weapon the player fights with (sim name). */
  readonly weapon: string;
  /** How the weapon was obtained. */
  readonly weaponSource: "kept" | "bought" | "dropped" | "default";
  /** Roster index of the teammate who paid for it, when weaponSource is "dropped". */
  readonly droppedBy?: number;
  /** Shield points at round start, and what was bought this round ("none" = kept or no shield). */
  readonly armor: number;
  readonly armorBought: "light" | "heavy" | "none";
  /** Credits spent on utility. */
  readonly utility: number;
  /** Loadout value (weapon + shield + utility) — what the VCT loadout numbers count. */
  readonly loadoutValue: number;
  /** Ultimate held back this round (abilities on). */
  readonly ultHeld?: boolean;
}

export interface BuyDecision {
  readonly tier: BuyTier;
  /** The weapon most of the team fields (display); per-player weapons are in `players`. */
  readonly weapon: string;
  readonly weaponKey: string;
  /** Credits spent by the whole team this round. */
  readonly cost: number;
  readonly plan: BuyPlan;
  readonly players: readonly PlayerBuy[];
  /** Σ loadout value, and its VCT tier (eco < 5000, semi 5000–20000, full ≥ 20000). */
  readonly loadoutValue: number;
  readonly vctTier: "pistol" | "eco" | "semi" | "full";
  /** Number of weapons bought for a teammate. */
  readonly drops: number;
  /** The plan's objective and the alternatives it beat (empty when the plan was forced). */
  readonly evaluation: readonly { readonly plan: BuyPlan; readonly ultHold: boolean; readonly value: number; readonly winNow: number }[];
  /** Coach economy call honoured this round, if any. */
  readonly call?: EconomyCall;
}

export type EconomyCall = "save" | "force" | "full";

/** Per-player inputs that do not change during the match. */
export interface PlayerContext {
  readonly agent: string;
  /** Star rating: who gets the rifle first when there are not enough (mean mechanical rating). */
  readonly priority: number;
}

/** The team's decision traits (means over its five players), league average 0.6. */
export interface TeamDecisionTraits {
  readonly discipline: number;
  readonly gameSense: number;
}

export interface BuyContext {
  readonly roundNumber: number;
  /** Score before the round: [own, opp]. */
  readonly score: readonly [number, number];
  readonly own: TeamEconomy;
  readonly opp: TeamEconomy;
  readonly ownPlayers: readonly PlayerContext[];
  readonly oppPlayers: readonly PlayerContext[];
  readonly ownTraits?: TeamDecisionTraits;
  readonly oppTraits?: TeamDecisionTraits;
  readonly pistol: boolean;
  /** The side this team plays this round (a defence eco puts a shotgun on a close angle). */
  readonly side?: "attack" | "defense";
  /** Did this team win the previous round (labels a keep plan a bonus round)? */
  readonly wonLastRound?: boolean;
  readonly call?: EconomyCall;
  /** Abilities on: ultimates have value and can be held. */
  readonly abilities?: boolean;
  readonly options?: Partial<EconomyOptions>;
}

/** Tunables of the economy decision (pre-match options; defaults documented in ECONOMY_MODEL.md). */
export interface EconomyOptions {
  /**
   * Change in the weight on the next round per point of team discipline above the league average
   * (0.6). Weight = 1 + slope·(discipline − 0.6), clamped to [0.2, 1.8]. Default 1.
   */
  readonly disciplineFutureSlope: number;
  /**
   * Loadout value (credits) an ultimate is worth in the round it is used, for the buy and hold
   * decision. Only with abilities on. Provisional default 1500 (a shield plus a kit); to be replaced
   * by each ultimate's effect once ability-engine values them.
   */
  readonly ultValueCredits: number;
  /** Prior on the share of the team alive after a won / lost round, before the match shows its own. */
  readonly survivalPriorWon: number;
  readonly survivalPriorLost: number;
  /** Pseudo-rounds behind those priors. */
  readonly survivalPriorRounds: number;
  /**
   * Prior on ultimate points a player earns per round (kill + own death + plant/defuse ≈ 0.67 + 0.67 +
   * 0.1 at ~6.7 kills a round), before the match shows its own rate. Holding a ready ultimate wastes
   * what is earned meanwhile.
   */
  readonly ultPointsPerRoundPrior: number;
  /**
   * The team's round-win belief curve P = σ(β·(g(own) − g(opp))), g(v) = 1 − exp(−v/τ). See
   * docs/ECONOMY_MODEL.md for the VCT fit (β 4.12, τ 10000) and the fit on this simulator's rounds.
   */
  readonly winBelief: WinBeliefParams;
  /**
   * Attack saves follow each player's credits (saveWorth): a gun its holder could buy back next round
   * is not worth giving a round up for. false → the policy's price-only rule. Default true.
   */
  readonly saveByCredits: boolean;
  /**
   * This round's belief reads each gun at its worth against the shields the other team is expected
   * to wear (weapon-worth.ts): against an eco an SMG is worth nearly a rifle. Prices at heavy shields,
   * so full-buy rounds read the same. false → shop prices. Default true.
   */
  readonly armorMatchedValue: boolean;
  /**
   * The eco spends what is above the team's next-buy reserve (`sidearms` plan: Sheriff/Ghost and a
   * light shield, a shotgun for one defender) instead of nothing or a light shield for all (the
   * `eco` and `light` plans are then not offered). Whether to eco at all stays the
   * expected-value choice; how much an eco spends is this rule — under the sim's belief and two-round
   * lookahead, spending the surplus and saving it are within 0.01 of map-win probability, and VCT
   * teams spend it. Also switches the buy ladder to the eco catalogue (Stinger, Ghost) and lets a
   * full buy short of the kit buy part of it. false → the v1.2 buys. Default false until it passes
   * the real-roster gate (docs/handoff/economy.md).
   */
  readonly ecoSidearms: boolean;
}

export const DEFAULT_ECONOMY_OPTIONS: EconomyOptions = {
  disciplineFutureSlope: 1,
  ultValueCredits: 1500,
  survivalPriorWon: 0.5,
  survivalPriorLost: 0.12,
  survivalPriorRounds: 4,
  ultPointsPerRoundPrior: 1.4,
  winBelief: SIM_ROUND_WIN_BELIEF,
  saveByCredits: true,
  armorMatchedValue: true,
  ecoSidearms: false,
};

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

const TEAM_SIZE = 5;
/** VCT tiers (economy-engine vctTierForLoadout): a team loadout under 5,000 is an eco, 20,000+ a full buy. */
const ECO_LOADOUT = 5_000;
const FULL_BUY_LOADOUT = 20_000;
const START = ECONOMY_RULES.startingCredits.value; // 800
const OT_CREDITS = ROUND_RULES.overtimeCredits.value; // 5000
const WIN_REWARD = ECONOMY_RULES.roundWinReward.value; // 3000
const KILL_REWARD = ECONOMY_RULES.killReward.value; // 200
const PLANT_REWARD = ECONOMY_RULES.spikePlantReward.value; // 300 to every attacker
const LIGHT = ARMOR_PURCHASES.find((a) => a.id === "light")!;
const HEAVY = ARMOR_PURCHASES.find((a) => a.id === "heavy")!;
const LIGHT_COST = LIGHT.cost.value;
const HEAVY_COST = HEAVY.cost.value;
const LIGHT_PTS = LIGHT.points.value;
const HEAVY_PTS = HEAVY.points.value;

/** Weapons the round simulator can field (its weapon catalog), cheapest first. */
const RIFLE = "Vandal";
const SMG = "Spectre";
const SIDEARM = "Sheriff";
const LIGHT_SIDEARM = "Ghost";
const SMG_LIGHT = "Stinger";
/** Close-angle guns for a defence eco, best first. */
const SHOTGUNS = ["Bucky", "Shorty"] as const;
const DEFAULT_WEAPON = "Classic";
const RIFLES = new Set(["Vandal", "Phantom", "Operator"]);

export function priceOf(weapon: string | null | undefined): number {
  if (!weapon) return 0;
  return weaponPrice(weapon.toLowerCase())?.price.value ?? 0;
}

function armorValue(points: number): number {
  if (points <= 0) return 0;
  if (points <= LIGHT_PTS) return (points / LIGHT_PTS) * LIGHT_COST;
  return (points / HEAVY_PTS) * HEAVY_COST;
}

function armorCost(points: number): number {
  return points >= HEAVY_PTS ? HEAVY_COST : points >= LIGHT_PTS ? LIGHT_COST : 0;
}

function kitCost(agent: string): number {
  return utilityKitCost(agent) ?? 0;
}

/** Points to cast an agent's ultimate (game-rules, verified table); 7 for an unknown agent. */
export function ultCost(agent: string): number {
  return ultimatePointsRequired(agent) ?? 7;
}

// ---------------------------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------------------------

function team(players: readonly PlayerEconomy[], consecutiveLosses: number, survival: TeamEconomy["survival"]): TeamEconomy {
  return {
    credits: players.reduce((s, p) => s + p.credits, 0),
    consecutiveLosses,
    ultPoints: players.reduce((s, p) => s + p.ultPoints, 0),
    players,
    survival,
  };
}

const NO_SURVIVAL = { wonRounds: 0, wonAlive: 0, lostRounds: 0, lostAlive: 0, ultEarned: 0, playerRounds: 0 } as const;

export function newTeamEconomy(): TeamEconomy {
  return team(Array.from({ length: TEAM_SIZE }, () => ({ credits: START, weapon: null, armor: 0, ultPoints: 0 })), 0, NO_SURVIVAL);
}

/** Half time: everyone back to the pistol credits with nothing carried; ultimate points persist. */
export function halfReset(eco: TeamEconomy): TeamEconomy {
  return team(eco.players.map((p) => ({ credits: START, weapon: null, armor: 0, ultPoints: p.ultPoints })), 0, eco.survival);
}

/** Overtime round: fixed credits, nothing carried (as economy-engine's boundary rules); ults persist. */
export function overtimeReset(eco: TeamEconomy): TeamEconomy {
  return team(eco.players.map((p) => ({ credits: OT_CREDITS, weapon: null, armor: 0, ultPoints: p.ultPoints })), 0, eco.survival);
}

/** Subtract a cost, floored at 0. */
export function spend(credits: number, cost: number): number {
  return Math.max(0, credits - cost);
}

// ---------------------------------------------------------------------------------------------
// Allocation: who buys what inside a plan
// ---------------------------------------------------------------------------------------------

interface Package { readonly weapon: string; readonly armor: number; readonly util: boolean }

/** A player's buy options, best first, and where each plan starts on them. */
interface Ladder {
  readonly pkgs: readonly Package[];
  readonly smg: number;
  readonly half: number;
  readonly light: number;
  /** The eco-catalogue ladder (Stinger, Ghost): a full buy short of the kit also buys part of it. */
  readonly partialKit: boolean;
}
function ladderOf(pkgs: readonly Package[], partialKit: boolean): Ladder {
  return {
    pkgs,
    smg: pkgs.findIndex((p) => p.weapon === SMG && p.armor === HEAVY_PTS && p.util),
    half: pkgs.findIndex((p) => p.weapon === SMG && p.armor === LIGHT_PTS),
    light: pkgs.findIndex((p) => p.weapon === DEFAULT_WEAPON && p.armor === LIGHT_PTS),
    partialKit,
  };
}
const TOP: readonly Package[] = [
  { weapon: RIFLE, armor: HEAVY_PTS, util: true },
  { weapon: RIFLE, armor: HEAVY_PTS, util: false },
  { weapon: RIFLE, armor: LIGHT_PTS, util: false },
  { weapon: SMG, armor: HEAVY_PTS, util: true },
  { weapon: SMG, armor: HEAVY_PTS, util: false },
  { weapon: SMG, armor: LIGHT_PTS, util: false },
];
const BOTTOM: readonly Package[] = [
  { weapon: DEFAULT_WEAPON, armor: LIGHT_PTS, util: false },
  { weapon: DEFAULT_WEAPON, armor: 0, util: false },
];
/** Default (v1.2) ladder: Spectre, Sheriff, Classic. */
const LADDER = ladderOf([...TOP, { weapon: SIDEARM, armor: LIGHT_PTS, util: false }, { weapon: SIDEARM, armor: 0, util: false }, ...BOTTOM], false);
/** Eco-catalogue ladder (EconomyOptions.ecoSidearms): adds the Stinger and the Ghost. */
const ECO_LADDER = ladderOf([
  ...TOP,
  { weapon: SMG_LIGHT, armor: LIGHT_PTS, util: false },
  { weapon: SIDEARM, armor: LIGHT_PTS, util: false },
  { weapon: LIGHT_SIDEARM, armor: LIGHT_PTS, util: false },
  { weapon: SIDEARM, armor: 0, util: false },
  { weapon: LIGHT_SIDEARM, armor: 0, util: false },
  ...BOTTOM,
], true);

interface Slot {
  readonly index: number;
  readonly credits: number;
  readonly carried: string | null;
  readonly carriedArmor: number;
  readonly agent: string;
  readonly priority: number;
}

/** What a package costs this player, given what they carry. */
function packageCost(s: Slot, pkg: Package): { weapon: number; armor: number; util: number } {
  const weapon = priceOf(s.carried) >= priceOf(pkg.weapon) ? 0 : priceOf(pkg.weapon);
  const armor = s.carriedArmor >= pkg.armor ? 0 : armorCost(pkg.armor);
  const util = pkg.util ? kitCost(s.agent) : 0;
  return { weapon, armor, util };
}
const total = (c: { weapon: number; armor: number; util: number }) => c.weapon + c.armor + c.util;

interface Assignment {
  pkg: Package | null; // null: buys nothing
  spentOwn: number;
  droppedBy?: number;
  boughtFor: number; // credits spent on teammates' weapons
  utility: number;
  ultHeld?: boolean;
}

/**
 * Allocate a plan. `startIdx` is the best package the plan aims for; `drops` lets rich players buy
 * the target weapon for poor ones. Players are served in star order.
 */
function allocate(slots: readonly Slot[], ladder: Ladder, startIdx: number, drops: boolean): Assignment[] {
  const LADDER = ladder.pkgs;
  const order = [...slots].sort((a, b) => b.priority - a.priority || a.index - b.index);
  const out: Assignment[] = slots.map(() => ({ pkg: null, spentOwn: 0, boughtFor: 0, utility: 0 }));
  const spare = (i: number) => slots[i]!.credits - out[i]!.spentOwn - out[i]!.boughtFor;
  const target = LADDER[startIdx]!;

  // 1. Everyone buys the best package from the plan's level down that they can afford alone.
  for (const s of order) {
    for (let k = startIdx; k < LADDER.length; k++) {
      const c = packageCost(s, LADDER[k]!);
      if (total(c) <= s.credits) {
        out[s.index] = { pkg: LADDER[k]!, spentOwn: total(c), boughtFor: 0, utility: c.util };
        break;
      }
    }
  }
  if (!drops) return out;

  // 2. Drops: a player short of the target weapon gets it from the richest teammate who can pay,
  //    star first. The receiver pays their own shield; the drop happens only if the gun is worth
  //    more than what the donor gives up for it (their utility, then their heavy shield).
  for (const r of order) {
    const got = out[r.index]!.pkg;
    if (priceOf(effectiveWeapon(r, got)) >= priceOf(target.weapon)) continue;
    const gunPrice = priceOf(target.weapon);
    // Receiver's own part: the best shield they can afford with the target gun.
    const ownOptions = LADDER.filter((p) => p.weapon === target.weapon && !p.util);
    const own = ownOptions.find((p) => packageCost(r, p).armor <= r.credits) ?? null;
    if (!own) continue;
    const ownArmorCost = packageCost(r, own).armor;
    const gain = gunPrice - priceOf(effectiveWeapon(r, got)) + (armorValue(Math.max(r.carriedArmor, own.armor)) - armorValue(Math.max(r.carriedArmor, got?.armor ?? 0)));
    const donors = order
      .filter((d) => d.index !== r.index)
      .map((d) => ({ d, room: spare(d.index) }))
      .sort((a, b) => b.room - a.room || a.d.index - b.d.index);
    for (const { d } of donors) {
      let room = spare(d.index);
      const dAsg = out[d.index]!;
      let give = 0; // value the donor gives up to afford the drop
      let newPkg = dAsg.pkg;
      // Downgrade the donor (utility first, then heavy → light) only while the drop is still worth it.
      while (room < gunPrice && newPkg) {
        const k = LADDER.indexOf(newPkg);
        const next = LADDER.slice(k + 1).find((p) => p.weapon === newPkg!.weapon);
        if (!next) break;
        const saved = total(packageCost(d, newPkg)) - total(packageCost(d, next));
        give += saved;
        room += saved;
        newPkg = next;
      }
      if (room < gunPrice || give >= gain) continue;
      const c = newPkg ? packageCost(d, newPkg) : { weapon: 0, armor: 0, util: 0 };
      out[d.index] = { ...dAsg, pkg: newPkg, spentOwn: total(c), utility: c.util, boughtFor: dAsg.boughtFor + gunPrice };
      out[r.index] = { pkg: own, spentOwn: ownArmorCost, droppedBy: d.index, boughtFor: out[r.index]!.boughtFor, utility: 0 };
      break;
    }
  }
  // 3. A full buy short of the whole kit buys what of it the credits left allow (a rifle and a heavy
  //    shield, then utility — the kit is not all-or-nothing).
  if (startIdx === 0 && ladder.partialKit) {
    for (const s of slots) {
      const a = out[s.index]!;
      if (!a.pkg || a.pkg.util || a.pkg.armor < HEAVY_PTS || !RIFLES.has(effectiveWeapon(s, a.pkg))) continue;
      const left = s.credits - a.spentOwn - a.boughtFor;
      const util = Math.min(kitCost(s.agent), Math.max(0, left));
      if (util > 0) out[s.index] = { ...a, spentOwn: a.spentOwn + util, utility: a.utility + util };
    }
  }
  return out;
}

function effectiveWeapon(s: Slot, pkg: Package | null): string {
  const bought = pkg?.weapon ?? DEFAULT_WEAPON;
  return priceOf(s.carried) >= priceOf(bought) ? s.carried ?? DEFAULT_WEAPON : bought;
}

/** Keep plan (bonus / save with guns): no weapon purchases; a light shield for a gun carrier who lacks one. */
function allocateKeep(slots: readonly Slot[]): Assignment[] {
  return slots.map((s) => {
    const wantsShield = s.carried !== null && s.carriedArmor < LIGHT_PTS && s.credits >= LIGHT_COST;
    return wantsShield
      ? { pkg: { weapon: s.carried!, armor: LIGHT_PTS, util: false }, spentOwn: LIGHT_COST, boughtFor: 0, utility: 0 }
      : { pkg: null, spentOwn: 0, boughtFor: 0, utility: 0 };
  });
}

/** Pistol round: a light shield and as much of the kit as the rest of the credits buy. */
function allocatePistol(slots: readonly Slot[]): Assignment[] {
  return slots.map((s) => {
    const armor = s.credits >= LIGHT_COST ? LIGHT_COST : 0;
    const util = Math.min(kitCost(s.agent), s.credits - armor);
    return { pkg: { weapon: DEFAULT_WEAPON, armor: armor ? LIGHT_PTS : 0, util: false }, spentOwn: armor + util, boughtFor: 0, utility: util };
  });
}

/**
 * Eco that spends only what next round does not need. Each player keeps a reserve: the credits that,
 * with the loss bonus they get if this round is lost, still buy their share of a VCT full buy next
 * round (nextBuyReserve); and the eco stays an eco (team loadout under 5,000). What is above it buys the eco
 * ladder (Sheriff/Ghost with a light shield, then the sidearm alone, then a light shield), star first,
 * each player from their own credits. On defence one player (the last in star order who can) takes a
 * shotgun for a close angle instead. VCT international ecos (vct.duckdb, non-pistol rounds, team
 * loadout < 5,000): loadout mean 2,736 (median 2,700, 4% under 1,000), bank 8,684.
 */
function allocateSidearms(slots: readonly Slot[], reserve: readonly number[], defense: boolean): Assignment[] {
  const order = [...slots].sort((a, b) => b.priority - a.priority || a.index - b.index);
  const out: Assignment[] = slots.map(() => ({ pkg: null, spentOwn: 0, boughtFor: 0, utility: 0 }));
  const ladder = ECO_LADDER.pkgs.slice(ECO_LADDER.pkgs.findIndex((p) => p.weapon === SIDEARM && p.armor === LIGHT_PTS));
  // An eco stays an eco: the team's loadout stays under the VCT eco line.
  const keptValue = sum(slots.map((s) => priceOf(s.carried) + armorValue(s.carriedArmor)));
  let budget = ECO_LOADOUT - 1 - keptValue;
  const take = (s: Slot, pkgs: readonly Package[]): boolean => {
    for (const pkg of pkgs) {
      const c = total(packageCost(s, pkg));
      if (c === 0) return false; // already carries as much
      if (c <= Math.min(budget, s.credits - (reserve[s.index] ?? 0))) { out[s.index] = { pkg, spentOwn: c, boughtFor: 0, utility: 0 }; budget -= c; return true; }
    }
    return false;
  };
  if (defense) {
    for (const s of [...order].reverse()) {
      if (priceOf(s.carried) > 0) continue;
      if (take(s, SHOTGUNS.flatMap((g) => [{ weapon: g, armor: LIGHT_PTS, util: false }, { weapon: g, armor: 0, util: false }]))) break;
    }
  }
  for (const s of order) if (!out[s.index]!.pkg) take(s, ladder);
  return out;
}

function toPlayerBuys(slots: readonly Slot[], asg: readonly Assignment[]): PlayerBuy[] {
  return slots.map((s) => {
    const a = asg[s.index]!;
    const weapon = effectiveWeapon(s, a.pkg);
    const armor = Math.max(s.carriedArmor, a.pkg?.armor ?? 0);
    const boughtArmor = (a.pkg?.armor ?? 0) > s.carriedArmor ? (a.pkg!.armor >= HEAVY_PTS ? "heavy" : "light") : "none";
    const weaponSource: PlayerBuy["weaponSource"] =
      a.droppedBy !== undefined ? "dropped"
      : s.carried && weapon === s.carried ? "kept"
      : weapon === DEFAULT_WEAPON ? "default" : "bought";
    const spent = a.spentOwn + a.boughtFor;
    return {
      index: s.index,
      creditsBefore: s.credits,
      creditsAfter: s.credits - spent,
      spent,
      weapon,
      weaponSource,
      ...(a.droppedBy !== undefined ? { droppedBy: a.droppedBy } : {}),
      armor,
      armorBought: boughtArmor,
      utility: a.utility,
      loadoutValue: priceOf(weapon) + armorValue(armor) + a.utility,
      ...(a.ultHeld ? { ultHeld: true } : {}),
    };
  });
}

function slotsOf(eco: TeamEconomy, ctx: readonly PlayerContext[]): Slot[] {
  return eco.players.map((p, i) => ({
    index: i,
    credits: p.credits,
    carried: p.weapon,
    carriedArmor: p.armor,
    agent: ctx[i]?.agent ?? "",
    priority: ctx[i]?.priority ?? 0.6,
  }));
}

function planBuys(plan: BuyPlan, slots: readonly Slot[], eco?: { reserve: readonly number[]; defense: boolean; catalogue: boolean }): PlayerBuy[] {
  const L = eco?.catalogue ? ECO_LADDER : LADDER;
  switch (plan) {
    case "pistol": return toPlayerBuys(slots, allocatePistol(slots));
    case "max": return toPlayerBuys(slots, allocate(slots, L, 0, true));
    case "smg": return toPlayerBuys(slots, allocate(slots, L, L.smg, false));
    case "half": return toPlayerBuys(slots, allocate(slots, L, L.half, false));
    case "light": return toPlayerBuys(slots, allocate(slots, L, L.light, false));
    case "sidearms": return toPlayerBuys(slots, allocateSidearms(slots, eco?.reserve ?? slots.map(() => 0), eco?.defense ?? false));
    case "keep": return toPlayerBuys(slots, allocateKeep(slots));
    case "eco": return toPlayerBuys(slots, slots.map(() => ({ pkg: null, spentOwn: 0, boughtFor: 0, utility: 0 })));
  }
}

// ---------------------------------------------------------------------------------------------
// Valuation
// ---------------------------------------------------------------------------------------------

const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

const INCOME: IncomeRules = { win: WIN_REWARD, lossBonus: lossBonusFor, maxCredits: ECONOMY_RULES.maxCredits.value };

/** Future rounds the buy plans for, after this one (each a buy-or-save choice). */
const LOOKAHEAD_DEPTH = 2;

function survivalBelief(eco: TeamEconomy, o: EconomyOptions): { won: number; lost: number } {
  const s = eco.survival;
  const k = o.survivalPriorRounds;
  return {
    won: (s.wonAlive / TEAM_SIZE + k * o.survivalPriorWon) / (s.wonRounds + k),
    lost: (s.lostAlive / TEAM_SIZE + k * o.survivalPriorLost) / (s.lostRounds + k),
  };
}

/** The lookahead's view of a team right after this round's buy, as of the start of the next round. */
function lookaheadAfter(eco: TeamEconomy, ctx: readonly PlayerContext[], buys: readonly PlayerBuy[], won: boolean, survive: { won: number; lost: number }, extraValue = 0): LookaheadTeam {
  const share = won ? survive.won : survive.lost;
  const income = won ? WIN_REWARD : lossBonusFor(eco.consecutiveLosses + 1);
  return {
    credits: buys.map((b) => clampCredits(b.creditsAfter + income)),
    kept: buys.map((b) => share * (b.loadoutValue - b.utility)),
    caps: ctx.map((p) => priceOf(RIFLE) + HEAVY_COST + kitCost(p.agent)),
    dropPrice: priceOf(RIFLE),
    lossStreak: won ? 0 : eco.consecutiveLosses + 1,
    keptIfWon: survive.won,
    keptIfLost: survive.lost,
    extraValue,
  };
}

interface Candidate {
  readonly plan: BuyPlan;
  readonly ultHold: boolean;
  readonly buys: PlayerBuy[];
  readonly value: number; // loadout value this round, incl. ultimates used
}

function readyUlts(eco: TeamEconomy, ctx: readonly PlayerContext[]): number {
  return eco.players.filter((p, i) => p.ultPoints >= ultCost(ctx[i]?.agent ?? "")).length;
}

/**
 * Each player's reserve: credits that, with the next loss bonus, still buy their share of a VCT full
 * buy next round — a team loadout of 20,000 (`FULL_BUY_LOADOUT`): a rifle, a heavy shield and the
 * first of the kit (4,000 each). Per player, because next round's drops do not pool credits freely
 * (a team-level reserve left half the next buys short of full). After two losses that is
 * 4,000 − 2,400 = 1,600 each, 8,000 for the team; VCT eco teams bank 8,684.
 */
function nextBuyReserve(eco: TeamEconomy): number[] {
  const income = lossBonusFor(eco.consecutiveLosses + 1);
  const perPlayer = FULL_BUY_LOADOUT / TEAM_SIZE;
  return eco.players.map((p) => {
    const kept = priceOf(p.weapon) >= priceOf(RIFLE) ? priceOf(p.weapon) : 0;
    return Math.max(0, perPlayer - kept - income);
  });
}

function candidates(c: { eco: TeamEconomy; ctx: readonly PlayerContext[]; pistol: boolean; call?: EconomyCall; ultValue: number; side?: "attack" | "defense"; sidearms: boolean }): Candidate[] {
  const slots = slotsOf(c.eco, c.ctx);
  const plans: BuyPlan[] = c.pistol ? ["pistol"]
    : c.call === "save" ? ["eco"] // a save order spends nothing (kept guns still play)
    : c.call === "force" || c.call === "full" ? ["max"]
    : c.sidearms ? ["max", "smg", "half", "keep", "sidearms"] // the eco's spend (shields up to sidearms) is the reserve rule
    : ["max", "smg", "half", "keep", "light", "eco"];
  const ecoCtx = { reserve: nextBuyReserve(c.eco), defense: c.side === "defense", catalogue: c.sidearms };
  const ready = c.ultValue > 0 ? readyUlts(c.eco, c.ctx) : 0;
  const out: Candidate[] = [];
  for (const plan of plans) {
    if (plan === "keep" && !c.eco.players.some((p) => p.weapon)) continue;
    const buys = planBuys(plan, slots, ecoCtx);
    const base = sum(buys.map((b) => b.loadoutValue));
    out.push({ plan, ultHold: false, buys, value: base + ready * c.ultValue });
    if (ready > 0 && !c.pistol) out.push({ plan, ultHold: true, buys, value: base });
  }
  return out;
}

function ultRate(eco: TeamEconomy, o: EconomyOptions): number {
  const s = eco.survival;
  const k = o.survivalPriorRounds * TEAM_SIZE;
  return (s.ultEarned + k * o.ultPointsPerRoundPrior) / (s.playerRounds + k);
}

function meanUltCost(ctx: readonly PlayerContext[]): number {
  return ctx.length ? sum(ctx.map((p) => ultCost(p.agent))) / ctx.length : 7;
}

function futureWeight(t: TeamDecisionTraits | undefined, o: EconomyOptions): number {
  const d = t?.discipline ?? 0.6;
  return Math.min(1.8, Math.max(0.2, 1 + o.disciplineFutureSlope * (d - 0.6)));
}

/**
 * Credits to add to a loadout's value for this round's belief: each gun at its worth against the
 * shields the other team is expected to wear (mean over its players) instead of its price.
 */
function armorMatchDelta(buys: readonly PlayerBuy[], against: readonly PlayerBuy[]): number {
  if (!against.length) return 0;
  let d = 0;
  for (const b of buys) {
    const price = priceOf(b.weapon);
    if (price <= 0) continue;
    const worth = sum(against.map((t) => armorMatchedPrice(b.weapon, price, t.armor))) / against.length;
    d += worth - price;
  }
  return d;
}

interface Scored extends Candidate { readonly j: number; readonly winNow: number }

/**
 * Score every candidate: J = E[P(map win)] over this round (the team's round-win belief from the two
 * loadouts) and a lookahead over the next rounds, against an opponent expected to field `opp.value`
 * now with `opp.buys`.
 */
function score(
  cands: readonly Candidate[], side: { eco: TeamEconomy; ctx: readonly PlayerContext[]; traits?: TeamDecisionTraits },
  opp: { eco: TeamEconomy; ctx: readonly PlayerContext[]; buys: readonly PlayerBuy[]; value: number },
  roundNumber: number, scoreline: readonly [number, number], ultValue: number, o: EconomyOptions,
): Scored[] {
  const ownS = survivalBelief(side.eco, o);
  const oppS = survivalBelief(opp.eco, o);
  const ready = ultValue > 0 ? readyUlts(side.eco, side.ctx) : 0;
  const [a, b] = scoreline;
  const w = futureWeight(side.traits, o);
  return cands.map((c) => {
    const winNow = o.armorMatchedValue
      ? roundWinBelief(c.value + armorMatchDelta(c.buys, opp.buys), opp.value + armorMatchDelta(opp.buys, c.buys), o.winBelief)
      : roundWinBelief(c.value, opp.value, o.winBelief);
    // A held ultimate is fielded next round; using it now restarts the charge, and the points earned
    // over the lookahead (a held, full ultimate wastes them) are counted as that share of an ultimate.
    const progress = Math.min(1, (LOOKAHEAD_DEPTH * ultRate(side.eco, o)) / meanUltCost(side.ctx));
    const held = ready * ultValue * (c.ultHold ? 1 : progress);
    const after = (won: boolean): number => {
      const score2: [number, number] = won ? [a + 1, b] : [a, b + 1];
      if (mapOver(score2[0], score2[1])) return mapWinProbability(score2[0], score2[1]);
      return lookaheadValue({
        roundNum: roundNumber + 1,
        score: score2,
        own: lookaheadAfter(side.eco, side.ctx, c.buys, won, ownS, held),
        opp: lookaheadAfter(opp.eco, opp.ctx, opp.buys, !won, oppS),
        depth: LOOKAHEAD_DEPTH,
        rules: INCOME,
        futureWeight: w,
        belief: o.winBelief,
      });
    };
    const j = winNow * after(true) + (1 - winNow) * after(false);
    return { ...c, j, winNow };
  });
}

/** Highest J; ties go to the earlier candidate (max, half, keep, eco; use before hold). */
function best(scored: readonly Scored[]): Scored {
  return scored.reduce((a, b) => (b.j > a.j + 1e-12 ? b : a));
}

function maxValue(cands: readonly Candidate[]): Candidate {
  return cands.reduce((a, b) => (b.value > a.value ? b : a));
}

function tierOf(plan: BuyPlan, buys: readonly PlayerBuy[], wonLastRound: boolean): BuyTier {
  switch (plan) {
    case "pistol": return "pistol";
    case "max":
      if (buys.every((b) => RIFLES.has(b.weapon) && b.armor >= LIGHT_PTS)) return "full";
      // Won the last round and playing mostly on the guns it kept: the bonus round, topped up.
      return wonLastRound && buys.filter((b) => b.weaponSource === "kept").length >= 3 ? "bonus" : "force";
    case "smg":
    case "half": return "half";
    case "light":
    case "sidearms": return "eco";
    case "keep": return wonLastRound ? "bonus" : "eco";
    case "eco": return "eco";
  }
}

function modalWeapon(buys: readonly PlayerBuy[]): string {
  const counts = new Map<string, number>();
  for (const b of buys) counts.set(b.weapon, (counts.get(b.weapon) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || priceOf(b[0]) - priceOf(a[0]))[0]![0];
}

/**
 * The team's buy for this round. The opponent's buy is predicted with the same objective, one level
 * deep (it is assumed to expect our maximum buy); a team with gameSense g weighs that prediction by
 * g against the cautious read that the opponent fields everything it can.
 */
export function decideTeamBuy(ctx: BuyContext): BuyDecision {
  const o: EconomyOptions = { ...DEFAULT_ECONOMY_OPTIONS, ...(ctx.options ?? {}) };
  const ultValue = ctx.abilities ? o.ultValueCredits : 0;
  const own = { eco: ctx.own, ctx: ctx.ownPlayers, ...(ctx.ownTraits ? { traits: ctx.ownTraits } : {}) };
  const oppSide = { eco: ctx.opp, ctx: ctx.oppPlayers, ...(ctx.oppTraits ? { traits: ctx.oppTraits } : {}) };
  const oppSideOf = ctx.side === "attack" ? "defense" : ctx.side === "defense" ? "attack" : undefined;
  const ownCands = candidates({ eco: ctx.own, ctx: ctx.ownPlayers, pistol: ctx.pistol, ...(ctx.call ? { call: ctx.call } : {}), ultValue, ...(ctx.side ? { side: ctx.side } : {}), sidearms: o.ecoSidearms });
  const oppCands = candidates({ eco: ctx.opp, ctx: ctx.oppPlayers, pistol: ctx.pistol, ultValue, ...(oppSideOf ? { side: oppSideOf } : {}), sidearms: o.ecoSidearms });

  let chosen: Scored;
  let evaluation: Scored[] = [];
  if (ownCands.length === 1) {
    chosen = { ...ownCands[0]!, j: Number.NaN, winNow: Number.NaN };
  } else {
    // Level 0: the opponent's own pick, against our maximum.
    const ourMax = maxValue(ownCands);
    const oppScored = score(oppCands, oppSide, { ...own, buys: ourMax.buys, value: ourMax.value }, ctx.roundNumber, [ctx.score[1], ctx.score[0]], ultValue, o);
    const oppPick = best(oppScored);
    const oppMax = maxValue(oppCands);
    const g = Math.min(1, Math.max(0, ctx.ownTraits?.gameSense ?? 0.6));
    const oppValue = g * oppPick.value + (1 - g) * oppMax.value;
    const oppBuys = g >= 0.5 ? oppPick.buys : oppMax.buys;
    evaluation = score(ownCands, own, { ...oppSide, buys: oppBuys, value: oppValue }, ctx.roundNumber, ctx.score, ultValue, o);
    chosen = best(evaluation);
  }

  const buys = chosen.ultHold ? chosen.buys.map((b) => (ctx.own.players[b.index]!.ultPoints >= ultCost(ctx.ownPlayers[b.index]?.agent ?? "") ? { ...b, ultHeld: true } : b)) : chosen.buys;
  const weapon = modalWeapon(buys);
  const loadoutValue = sum(buys.map((b) => b.loadoutValue));
  return {
    tier: tierOf(chosen.plan, buys, ctx.wonLastRound ?? false),
    weapon,
    weaponKey: weapon.toLowerCase(),
    cost: sum(buys.map((b) => b.spent)),
    plan: chosen.plan,
    players: buys,
    loadoutValue,
    vctTier: ctx.pistol ? "pistol" : vctTierForLoadout(loadoutValue),
    drops: buys.filter((b) => b.weaponSource === "dropped").length,
    evaluation: evaluation.map((e) => ({ plan: e.plan, ultHold: e.ultHold, value: round4(e.j), winNow: round4(e.winNow) })),
    ...(ctx.call ? { call: ctx.call } : {}),
  };
}

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

/**
 * Is each player's gear worth a save this round? A player who loses the round gets the next loss
 * bonus; if that plus what they have left after this buy re-buys their weapon and a heavy shield,
 * keeping the gun does not change their next buy, so it is not worth giving the round up for it.
 * Roster order (sim id atk{i+1} / def{i+1}).
 */
export function saveWorth(eco: TeamEconomy, buy: BuyDecision): boolean[] {
  const next = lossBonusFor(eco.consecutiveLosses + 1);
  return buy.players.map((b) => clampCredits(b.creditsAfter + next) < priceOf(b.weapon) + HEAVY_COST);
}

/** After the buy: each player's credits are what they have left. */
export function afterBuy(eco: TeamEconomy, buy: BuyDecision): TeamEconomy {
  return team(eco.players.map((p, i) => ({ ...p, credits: buy.players[i]?.creditsAfter ?? p.credits })), eco.consecutiveLosses, eco.survival);
}

// ---------------------------------------------------------------------------------------------
// Round settlement
// ---------------------------------------------------------------------------------------------

/** End-of-round state of one player, in roster order (from runMatchRound's PlayerRoundOutcome). */
export interface PlayerSettlement {
  readonly alive: boolean;
  readonly kills: number;
  /** Weapon the player ends with: their own if they survived, or one they picked up. */
  readonly weaponAfter: string | null;
  readonly armorRetained: number;
  readonly ultimatePointsEnd: number;
  /** Ult orbs collected this round (0 until the maps/sim provide orbs). */
  readonly orbs?: number;
  /** Ultimate points earned this round (kills, death, plant, defuse) — feeds the team's ult-rate belief. */
  readonly ultimatePointsEarned?: number;
}

/**
 * Apply a round's result to a team's (post-buy) economy: per player, leftover + win reward or the
 * loss-bonus ladder + kill rewards + the plant reward (attackers), capped at 9000; survivors keep
 * their weapon (or a better one picked up) and shield; ultimate points as the round left them.
 */
export function settleRound(
  eco: TeamEconomy,
  r: { readonly won: boolean; readonly planted: boolean; readonly attacking: boolean; readonly players: readonly PlayerSettlement[]; readonly ultCosts?: readonly number[] },
): TeamEconomy {
  const income = r.won ? WIN_REWARD : lossBonusFor(eco.consecutiveLosses + 1);
  const plant = r.planted && r.attacking ? PLANT_REWARD : 0;
  const orbPoint = ULTIMATE_POINT_RULES.pointForOrb.value;
  const players = eco.players.map((p, i): PlayerEconomy => {
    const s = r.players[i];
    if (!s) return p;
    const cap = r.ultCosts?.[i] ?? Number.POSITIVE_INFINITY;
    return {
      credits: clampCredits(p.credits + income + s.kills * KILL_REWARD + plant),
      weapon: s.alive && s.weaponAfter && s.weaponAfter !== DEFAULT_WEAPON ? s.weaponAfter : null,
      armor: s.alive ? s.armorRetained : 0,
      ultPoints: Math.min(cap, s.ultimatePointsEnd + (s.orbs ?? 0) * orbPoint),
    };
  });
  const alive = r.players.filter((s) => s.alive).length;
  const sv = eco.survival;
  const survival = r.won
    ? { ...sv, wonRounds: sv.wonRounds + 1, wonAlive: sv.wonAlive + alive }
    : { ...sv, lostRounds: sv.lostRounds + 1, lostAlive: sv.lostAlive + alive };
  const earned = sum(r.players.map((p) => (p.ultimatePointsEarned ?? 0) + (p.orbs ?? 0) * orbPoint));
  return team(players, r.won ? 0 : eco.consecutiveLosses + 1, { ...survival, ultEarned: survival.ultEarned + earned, playerRounds: survival.playerRounds + r.players.length });
}

/**
 * What lies where each player died after the round's mid-round pickups (round-simulator
 * `weaponPickup` events: actor took detail "<taken>|<dropped>" from target). A player dies with the
 * gun they held last; a gun taken from a body is replaced there by the taker's old one.
 */
export function floorAfterRound(
  startWeapon: ReadonlyMap<string, string>,
  events: readonly { readonly kind: string; readonly actor?: string; readonly target?: string; readonly detail?: string }[],
): Map<string, string> {
  const held = new Map(startWeapon);
  const floor = new Map<string, string>();
  const dead = new Set<string>();
  for (const e of events) {
    if (e.kind === "kill" && e.target) dead.add(String(e.target));
    if (e.kind !== "weaponPickup" || !e.actor || !e.detail) continue;
    const [taken, dropped] = e.detail.split("|");
    if (!taken) continue;
    held.set(String(e.actor), taken);
    // Taken from a body: the taker's old gun lies there now. (From a living swapper: not a body.)
    if (e.target && dead.has(String(e.target))) floor.set(String(e.target), dropped || DEFAULT_WEAPON);
  }
  const out = new Map(held);
  for (const [id, w] of floor) out.set(id, w);
  return out;
}

/** A weapon picked up off the floor after the round. */
export interface Pickup {
  readonly playerId: string;
  readonly weapon: string;
  /** Who dropped it (died with it). */
  readonly from: string;
}

/**
 * Post-round pickups (EC-03). Every player who died drops the weapon they fought with where they
 * died. In the moments after the round a survivor picks one up when it is worth more than what they
 * hold and they can reach it: they killed its owner (they were in the duel), or they ended the round
 * in the zone where it lies. Most valuable weapon first; one pickup per survivor.
 */
export function postRoundPickups(input: {
  readonly kills: readonly { readonly killer?: string; readonly victim: string; readonly zoneId?: string }[];
  readonly startWeapon: ReadonlyMap<string, string>;
  /** Survivors and the weapon they hold now. */
  readonly survivors: ReadonlyMap<string, string>;
  /** Where each survivor ended the round, when the simulator reports it. */
  readonly endZone?: ReadonlyMap<string, string | undefined>;
}): Pickup[] {
  const drops = input.kills
    .map((k) => ({ ...k, weapon: input.startWeapon.get(k.victim) ?? DEFAULT_WEAPON }))
    .filter((d) => d.weapon !== DEFAULT_WEAPON)
    .sort((a, b) => priceOf(b.weapon) - priceOf(a.weapon) || a.victim.localeCompare(b.victim));
  const holding = new Map(input.survivors);
  const taken = new Set<string>();
  const out: Pickup[] = [];
  for (const d of drops) {
    const reach = [...holding.keys()].filter((id) =>
      !taken.has(id) && (id === d.killer || (d.zoneId !== undefined && input.endZone?.get(id) === d.zoneId)));
    const gain = (id: string) => priceOf(d.weapon) - priceOf(holding.get(id));
    const pick = reach.filter((id) => gain(id) > 0).sort((a, b) => gain(b) - gain(a) || a.localeCompare(b))[0];
    if (!pick) continue;
    taken.add(pick);
    holding.set(pick, d.weapon);
    out.push({ playerId: pick, weapon: d.weapon, from: d.victim });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Compatibility helpers (team-level, kept for callers and tests that predate the per-player model)
// ---------------------------------------------------------------------------------------------

/** Team-level threshold buy (the pre-EC-01 model), kept for tools that only have a single bank. */
export function decideBuy(credits: number, isPistol: boolean): Pick<BuyDecision, "tier" | "weapon" | "weaponKey" | "cost"> {
  if (isPistol) return { tier: "pistol", weapon: DEFAULT_WEAPON, weaponKey: "classic", cost: 0 };
  const fullCost = priceOf(RIFLE) + HEAVY_COST;
  const forceCost = priceOf(SMG) + LIGHT_COST;
  if (credits >= fullCost) return { tier: "full", weapon: RIFLE, weaponKey: "vandal", cost: fullCost };
  if (credits >= forceCost) return { tier: "force", weapon: SMG, weaponKey: "spectre", cost: forceCost };
  return { tier: "eco", weapon: DEFAULT_WEAPON, weaponKey: "classic", cost: 0 };
}
