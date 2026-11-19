/**
 * Opponent model — what a team has LEARNED about the other team across the rounds of a match.
 *
 * A team does not know the opponent's plan; it only sees what happened in front of it (where the
 * spike went down, where it ran into enemies). Each such observation is a count in a categorical
 * tendency, estimated as a Dirichlet posterior:
 *
 *     P(category k) = (n_k + α) / (N + K·α)            posterior mean, α = prior pseudo-count
 *     confidence    = N / (N + K·α)                    0 with no data → 1 with a lot
 *
 * so one round barely moves the estimate and the team never becomes certain. Older rounds fade
 * (each new observation multiplies the existing counts by `decay`), because opponents adapt: a
 * read that was right five rounds ago may be exactly what they have moved away from.
 *
 * The model is evidence for decisions, never a prediction that is assumed true — callers weigh a
 * tendency by its confidence and keep sampling among all options (see igl.ts).
 */
export type SiteKey = "A" | "B";

export interface TendencyEstimate<K extends string> {
  /** Posterior mean per category (sums to 1). */
  readonly probability: Readonly<Record<K, number>>;
  /** 0..1 — how much data backs the estimate. */
  readonly confidence: number;
  /** Effective (decayed) number of observations. */
  readonly samples: number;
}

/** A decaying categorical tendency over a fixed set of categories. */
export class Tendency<K extends string> {
  private readonly counts: Record<K, number>;
  /** [series] Standing pseudo-counts (a conviction held before the match): never decayed. */
  private readonly standing: Record<K, number>;

  constructor(
    private readonly keys: readonly K[],
    private readonly priorPseudoCount = 1,
    private readonly decay = 0.85,
  ) {
    this.counts = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
    this.standing = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  }

  /** Record one observation of `key` (optionally fractional weight); older evidence fades first. */
  observe(key: K, weight = 1): void {
    for (const k of this.keys) this.counts[k] *= this.decay;
    this.counts[key] += weight;
  }

  estimate(): TendencyEstimate<K> {
    // [series] `standing` is 0 unless seeded, so an unseeded tendency estimates exactly as before.
    const n = this.keys.reduce((s, k) => s + this.counts[k] + this.standing[k], 0);
    const denom = n + this.keys.length * this.priorPseudoCount;
    const probability = Object.fromEntries(
      this.keys.map((k) => [k, (this.counts[k] + this.standing[k] + this.priorPseudoCount) / denom]),
    ) as Record<K, number>;
    return { probability, confidence: denom === 0 ? 0 : n / denom, samples: n };
  }

  snapshot(): Readonly<Record<K, number>> {
    return { ...this.counts };
  }

  /**
   * [series] Add pseudo-observations held BEFORE the first round (docs/SERIES_AND_VETO.md §4):
   *  - evidence-like (default): added to the decaying counts WITHOUT fading what is there, so it
   *    is worth exactly that many past observations and fades like them as rounds are observed;
   *  - `standing`: a conviction that does not fade — in-match evidence has to outweigh it.
   * Negative / non-finite entries are ignored. The estimate formula is unchanged.
   */
  seed(counts: Readonly<Partial<Record<K, number>>>, standing = false): void {
    for (const k of this.keys) {
      const c = counts[k];
      if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) continue;
      if (standing) this.standing[k] += c;
      else this.counts[k] += c;
    }
  }
}

/** What one team observed about the opponent in one finished round. All fields are things it saw. */
export interface RoundObservation {
  /** The side the OPPONENT played this round. */
  readonly opponentSide: "attack" | "defense";
  /** Opponent attacking: the site their spike was planted on (public), if any. */
  readonly plantSite?: SiteKey | null;
  /** Opponent attacking: the site where we first ran into them, if any. */
  readonly firstContactSite?: SiteKey | null;
  /** Opponent defending: how many of their players we met on each site. */
  readonly defendersMet?: Readonly<Partial<Record<SiteKey, number>>>;
  /** Opponent defending: they gave up a post-plant (we saw the spike detonate with them alive). */
  readonly savedPostPlant?: boolean;
}

export interface OpponentRead {
  /** Where the opponent tends to attack. */
  readonly attackSite: TendencyEstimate<SiteKey>;
  /** Where the opponent tends to put its defenders. */
  readonly defenseSite: TendencyEstimate<SiteKey>;
}

/**
 * One team's model of its opponent. `patternRecognition` (0..1, a roster trait) sets how quickly
 * it trusts a pattern: a sharper team needs fewer rounds (smaller prior pseudo-count).
 */
export class OpponentModel {
  private readonly attackSite: Tendency<SiteKey>;
  private readonly defenseSite: Tendency<SiteKey>;
  private rounds = 0;

  constructor(patternRecognition = 0.6, decay = 0.85) {
    // prior pseudo-count per category: 1.5 at recognition 0.2 → 1.0 at 0.6 → 0.5 at 1.0
    const prior = Math.min(2, Math.max(0.25, 1 - (patternRecognition - 0.6) * 1.25));
    this.attackSite = new Tendency<SiteKey>(["A", "B"], prior, decay);
    this.defenseSite = new Tendency<SiteKey>(["A", "B"], prior, decay);
  }

  /** Fold one finished round's observations in. Rounds with nothing observed teach nothing. */
  observeRound(obs: RoundObservation): void {
    this.rounds += 1;
    if (obs.opponentSide === "attack") {
      // The plant is the firm fact; a first contact without a plant is weaker evidence (could be a fake).
      if (obs.plantSite) this.attackSite.observe(obs.plantSite, 1);
      else if (obs.firstContactSite) this.attackSite.observe(obs.firstContactSite, 0.5);
    } else {
      const met = obs.defendersMet ?? {};
      const total = (met.A ?? 0) + (met.B ?? 0);
      if (total > 0) {
        // One round is one observation, split by where their defenders actually were.
        if (met.A) this.defenseSite.observe("A", met.A / total);
        if (met.B) this.defenseSite.observe("B", met.B / total);
      }
    }
  }

  read(): OpponentRead {
    return { attackSite: this.attackSite.estimate(), defenseSite: this.defenseSite.estimate() };
  }

  get roundsObserved(): number {
    return this.rounds;
  }

  /**
   * [series] Start the match with prior knowledge of the opponent (a scouting report, or the
   * team's own game plan) instead of a blank model. The prior is pseudo-observations in the same
   * Dirichlet estimate, so its confidence is N / (N + K·α) like any other evidence: a thin report
   * barely tilts the opening call, and what the opponent actually does in the match overrides it.
   */
  seed(prior: OpponentPrior, options: { readonly standing?: boolean } = {}): void {
    if (prior.attackSite) this.attackSite.seed(prior.attackSite, options.standing ?? false);
    if (prior.defenseSite) this.defenseSite.seed(prior.defenseSite, options.standing ?? false);
  }
}

/** [series] Pseudo-observation counts per tendency (see OpponentModel.seed). */
export interface OpponentPrior {
  /** Where the opponent attacks: pseudo-counts of plants per site. */
  readonly attackSite?: Readonly<Partial<Record<SiteKey, number>>>;
  /** Where the opponent defends: pseudo-counts of defenders met per site. */
  readonly defenseSite?: Readonly<Partial<Record<SiteKey, number>>>;
}

/**
 * How strongly a tendency should tilt a choice toward `key`: confidence × (P(key) − 1/K) × K/(K−1),
 * in [−1, 1]. Zero with no data or an even split; never ±1 unless the data is overwhelming.
 */
export function tendencyLean<K extends string>(est: TendencyEstimate<K>, key: K): number {
  const k = Object.keys(est.probability).length;
  if (k < 2) return 0;
  return est.confidence * (est.probability[key] - 1 / k) * (k / (k - 1));
}
