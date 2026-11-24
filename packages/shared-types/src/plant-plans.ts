/**
 * Plant spots and post-plant plans — the manager's pre-match options (docs/ENGINE_TRUTH.md §12).
 *
 * A team's tactics screen sets, per site letter:
 *   - where the spike goes down (PlantChoice),
 *   - on attack, what the team does once it is down (PostPlantPlan),
 *   - on defence, how it retakes (RetakePlan),
 * the plans keyed by plant spot: "*" (any spot on the site), a spot kind, or a spot id. The most
 * specific key wins field by field (spot id > kind > "*"); a field left out, or "auto", is the
 * IGL's call from the situation and the players' attributes. Spot ids and kinds come from the
 * map (round-simulator plantSpotsOf: `<site zone>/plant/<kind>[-<zone>]`).
 *
 * Every chosen value is recorded per round (match-runner RoundRecord.plant and
 * decisions.plans[team].postPlant / .retake) with whether the manager or the IGL chose it.
 */

/** Kinds of plant spot a site offers (derived from the map; see round-simulator plant-spot.ts). */
export type PlantSpotKind = "default" | "safe" | "open" | "cover" | "near";

/** Where to plant on one site: the carrier's call, a kind of spot, or one specific spot. */
export type PlantChoice = "auto" | PlantSpotKind | { readonly spotId: string };
/** Plant choice per site letter ("A", "B", "C"); a missing site is "auto". */
export type PlantPreferences = Readonly<Record<string, PlantChoice>>;

/** ATTACK after the plant. */
export interface PostPlantPlan {
  /**
   * Where the guards stand: on the site with the spike, off it in the attack's own ways in
   * (playing from main / from a distance), or "auto" (each guard by the post-plant geometry and
   * its game sense — round-simulator guard posts).
   */
  readonly hold?: "auto" | "onSpike" | "offSpike";
  /** One guard watches the flank: the way a defender comes round behind the attack's main entry. */
  readonly flankWatch?: "auto" | boolean;
  /**
   * Ground utility (fire, slow fields): keep it for after the plant (to deny the defuse), spend it
   * as the pre-plant fight wants, or "auto" (keep the team's last charge).
   */
  readonly utility?: "auto" | "savePostPlant" | "spend";
  /** Outnumbered after the plant: keep the posts, fall back off the site to play the clock, or "auto". */
  readonly outnumbered?: "auto" | "hold" | "retreat";
}

/** DEFENCE once the spike is down. */
export interface RetakePlan {
  /** The way in: a zone joined to the site, or "auto" (each retaker's least-watched approach that fits the clock). */
  readonly entry?: string;
  /** All through one entry, split over the two best, or "auto" (each by its own approach). */
  readonly approach?: "auto" | "stack" | "split";
  /**
   * When to give the round up and save: below these thresholds (save when the known attackers
   * outnumber the defenders by more than `maxManDeficit`, or when less than `minSpareMs` is left
   * after the slowest retaker's travel and a full defuse), "never", or "auto" (the Lanchester rule).
   */
  readonly save?: "auto" | "never" | { readonly maxManDeficit?: number; readonly minSpareMs?: number };
}

/** Plans per site letter, then per spot key ("*", a PlantSpotKind, or a spot id). */
export type SpotPlans<T> = Readonly<Record<string, Readonly<Record<string, T>>>>;
export type PostPlantPlans = SpotPlans<PostPlantPlan>;
export type RetakePlans = SpotPlans<RetakePlan>;

/** A plant spot as the plans address it. */
export interface PlantSpotRef {
  readonly site: string;
  readonly id: string | null;
  readonly kind: PlantSpotKind | "other";
}

/**
 * The plan for a planted spike: "*", then its kind, then its id, merged field by field (the more
 * specific wins). Fields left "auto" or absent are absent in the result. Null without any plan.
 */
export function planForSpot<T extends object>(plans: SpotPlans<T> | null | undefined, spot: PlantSpotRef | null): Partial<T> | null {
  if (!plans || !spot) return null;
  const site = plans[spot.site];
  if (!site) return null;
  const layers = [site["*"], spot.kind !== "other" ? site[spot.kind] : undefined, spot.id ? site[spot.id] : undefined];
  let out: Record<string, unknown> | null = null;
  for (const layer of layers) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) {
      if (v === undefined || v === "auto") continue;
      (out ??= {})[k] = v;
    }
  }
  return out as Partial<T> | null;
}

/** What the attack did after the plant, as recorded for Review (team-engine PlanSummary.postPlant). */
export interface PostPlantDecision {
  readonly spot: PlantSpotRef | null;
  /** "auto": each guard chose between the site and the attack's entries by geometry and game sense. */
  readonly hold: "auto" | "onSpike" | "offSpike";
  /** The attack entry guards held from when off the spike (or retreating). */
  readonly offZone: string | null;
  readonly flankWatch: boolean;
  /** Where the flank watcher stood and the way it watched. */
  readonly flank: { readonly zone: string; readonly watches: string } | null;
  readonly utility: "savePostPlant" | "spend" | "keepLast";
  readonly outnumbered: "hold" | "retreat" | "auto";
  /** Round clock (ms remaining) when the guards fell back, if they did. */
  readonly retreatedAtMs: number | null;
  /** Which fields the manager set (the rest were the IGL's call). */
  readonly byManager: readonly string[];
}

/** What the defence did once the spike was down (team-engine PlanSummary.retake). */
export interface RetakeDecision {
  readonly spot: PlantSpotRef | null;
  readonly approach: "auto" | "stack" | "split";
  /** The entry each retaker was sent through (player id → zone). */
  readonly entries: Readonly<Record<string, string>>;
  readonly save: "auto" | "never" | { readonly maxManDeficit?: number; readonly minSpareMs?: number };
  /** Round clock (ms remaining) when the retake was given up, if it was. */
  readonly savedAtMs: number | null;
  readonly byManager: readonly string[];
}
