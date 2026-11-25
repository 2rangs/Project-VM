/**
 * Reading the noise — the defense's belief about what the attack is doing.
 *
 * Noise is evidence about a hypothesis, never a trigger. The defense keeps a posterior over what
 * is happening on the map RIGHT NOW. With one spike, each site is in one of three roles:
 *
 *     hit    a real hit is under way here
 *     show   a fake: presence put on here to be noticed, the spike going elsewhere
 *     quiet  nothing here (yet)
 *
 * and a state of the world is one role per site with at most one hit and at most one show:
 *     none            every site quiet (the attack has not moved, or approaches in silence)
 *     hit(t)          hit on t, the rest quiet
 *     show(s)         show on s, the real target still quiet (the fake before the hit)
 *     hit(t)+show(s)  hit on t while the show on s goes on
 *
 * BAYES. For every state S:   P(S | e) ∝ P(S) · Π_sites L(e_site | role of that site in S)^τ
 *
 * Evidence per site (what the team observed in the recent window — policy.ts builds it):
 *     n  distinct enemy bodies evidenced there = max(runners heard, enemies seen), 0..N alive
 *     c  contact: an enemy seen or shots / tracers from there
 *     u  utility: an ability cue there (only counted when utility is in play this match)
 *     k/m departures (information layer only): of the m enemies placed on the site's side in the
 *        window, k were then placed off it — rotators leaving
 *
 * Likelihood of a site's evidence under its role (independent factors):
 *     n ~ Binomial(N, p_role)      p: hit 0.80 · show 0.35 · quiet 0.03
 *     c ~ Bernoulli(q_role)        q: hit 0.85 · show 0.15 · quiet 0.03
 *     u ~ Bernoulli(v_role)        v: hit 0.70 · show 0.50 · quiet 0.03
 *     k ~ Binomial(m, r_role)      r: hit 0.10 · show 0.60 · quiet 0.30   (only when m > 0)
 * In words: a real hit brings most of the team, with utility, and it makes contact; a fake uses
 * few players, may throw utility, and avoids the fight; a quiet site has at most a stray lurker.
 * The players of a hit stay; a show's players leave to join the hit, so bodies seen LEAVING a site
 * are evidence of a show there — and, through the hit(t)+show(s) states, of a hit on the other site.
 *
 * Prior (before this round's evidence):
 *     P(none)            ∝ w₀ = 1                         nothing under way is as likely as something
 *     P(hit(t))          ∝ (1 − φ) · π_t
 *     P(show(s))         ∝ ½ φ · Σ_{t≠s} π_t / (K − 1)
 *     P(hit(t)+show(s))  ∝ ½ φ · π_t / (K − 1)
 *   π_t = where this opponent attacks (cross-round model), φ = how often it fakes (cross-round
 *   model, shrunk to a base rate when there is no data) × how feasible a fake still is on the
 *   clock (a show needs time left to cross the map and plant).
 *
 * τ (sharpness) is the team's pattern recognition: a sharper team lets the evidence move it
 * further (τ > 1), a duller one stays nearer its prior (τ < 1). A tempered ("power") likelihood.
 *
 * RESPONSE is proportional to belief (rotationCount): the number of players sent is the belief in
 * a real hit times the players available — a third sure sends the nearest one as support, near
 * certain sends everyone. A strong show belief sends nobody: the posterior mass sits on show(s),
 * not on hit(s).
 */

/** Per-enemy probability of being evidenced at a site, by the site's role. */
export const PRESENCE_RATE = { hit: 0.8, show: 0.35, quiet: 0.03 } as const;
/** Probability of contact (a sighting, shots) at a site, by role. */
export const CONTACT_RATE = { hit: 0.85, show: 0.15, quiet: 0.03 } as const;
/** Probability of a utility cue at a site, by role (when utility is in play). */
export const UTILITY_RATE = { hit: 0.7, show: 0.5, quiet: 0.03 } as const;
/** Probability that an enemy placed at a site is later seen leaving it, by the site's role. */
export const LEAVE_RATE = { hit: 0.1, show: 0.6, quiet: 0.3 } as const;
/** Prior weight of "nothing is under way" against the summed weight (1) of all hit/show states. */
export const NONE_PRIOR_WEIGHT = 1;
/** Base rate of fakes used when the opponent model has no data (the attack's own call mix is ~0.2). */
export const BASE_FAKE_RATE = 0.2;

export type SiteRole = "hit" | "show" | "quiet";

export interface SiteEvidence {
  /** Distinct runners heard toward the site in the recent window. */
  readonly runners: number;
  /** Distinct enemies seen on the site's side in the recent window. */
  readonly seen: number;
  /** Shots / tracers from the site's side, or a sighting there. */
  readonly contact: boolean;
  /** An ability cue on the site's side. */
  readonly utility: boolean;
  /** Information layer: enemies placed on the site's side in the window, and how many then left it. */
  readonly departures?: { readonly placed: number; readonly left: number };
}

export const NO_EVIDENCE: SiteEvidence = { runners: 0, seen: 0, contact: false, utility: false };

export interface HitBeliefInput {
  readonly sites: readonly string[];
  readonly evidence: Readonly<Record<string, SiteEvidence>>;
  /** Enemies alive (public: the kill feed). */
  readonly enemiesAlive: number;
  /** π — where the opponent attacks (any positive weights; a missing site counts as an even share). */
  readonly attackPrior?: Readonly<Record<string, number>>;
  /** φ — the opponent's fake rate (0..1). */
  readonly fakeRate?: number;
  /** 0..1 — how feasible a fake still is on the clock. */
  readonly fakeFeasibility?: number;
  /** Whether abilities are in play (absence of utility is only informative if they are). */
  readonly utilityInPlay?: boolean;
  /** τ — how sharply the team weighs evidence. 1 = plain Bayes. */
  readonly sharpness?: number;
}

export interface HitBelief {
  /** P(a real hit is under way on the site), per site. */
  readonly hit: Readonly<Record<string, number>>;
  /** P(a show is being put on at the site), per site. */
  readonly show: Readonly<Record<string, number>>;
  /** P(what the team is noticing is a fake) = Σ show(s) with the target still quiet. */
  readonly fake: number;
  /** P(nothing is under way). */
  readonly none: number;
  /** The site with the highest hit belief (null when there are no sites). */
  readonly likeliest: string | null;
}

function binomial(n: number, k: number, p: number): number {
  if (k < 0 || k > n) return 0;
  let c = 1;
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
  return c * Math.pow(p, k) * Math.pow(1 - p, n - k);
}

/** L(e | role): the likelihood of one site's evidence under a role. */
export function siteLikelihood(e: SiteEvidence, role: SiteRole, enemiesAlive: number, utilityInPlay: boolean): number {
  const n = Math.max(0, Math.round(Math.max(e.runners, e.seen)));
  const N = Math.max(1, Math.round(enemiesAlive), n);
  let l = binomial(N, Math.min(n, N), PRESENCE_RATE[role]);
  l *= e.contact ? CONTACT_RATE[role] : 1 - CONTACT_RATE[role];
  if (utilityInPlay) l *= e.utility ? UTILITY_RATE[role] : 1 - UTILITY_RATE[role];
  const d = e.departures;
  if (d && d.placed > 0) l *= binomial(d.placed, Math.min(d.left, d.placed), LEAVE_RATE[role]);
  return l;
}

/** The posterior over what the attack is doing (see the header for the model). */
export function updateHitBelief(input: HitBeliefInput): HitBelief {
  const sites = input.sites;
  const K = sites.length;
  const zero = () => Object.fromEntries(sites.map((s) => [s, 0])) as Record<string, number>;
  if (K === 0) return { hit: {}, show: {}, fake: 0, none: 1, likeliest: null };
  const tau = input.sharpness ?? 1;
  const phi = Math.min(1, Math.max(0, (input.fakeRate ?? BASE_FAKE_RATE) * (input.fakeFeasibility ?? 1)));
  // π: the model's estimate where it has one, an even share otherwise; normalised over the sites.
  const piRaw = sites.map((s) => Math.max(0, input.attackPrior?.[s] ?? 1 / K));
  const piSum = piRaw.reduce((a, b) => a + b, 0);
  const prior = (i: number) => (piSum > 0 ? piRaw[i]! / piSum : 1 / K);

  const L = (s: string, role: SiteRole) =>
    Math.pow(siteLikelihood(input.evidence[s] ?? NO_EVIDENCE, role, input.enemiesAlive, input.utilityInPlay ?? false), tau);
  const quietAll = sites.reduce((p, s) => p * L(s, "quiet"), 1);
  /** Likelihood of a state: every site quiet except the given roles. */
  const state = (roles: ReadonlyArray<readonly [string, SiteRole]>) =>
    roles.reduce((p, [s, role]) => (L(s, "quiet") > 0 ? (p / L(s, "quiet")) * L(s, role) : 0), quietAll);

  const hit = zero();
  const show = zero();
  let none = NONE_PRIOR_WEIGHT * quietAll;
  let fake = 0;
  let total = none;
  sites.forEach((t, ti) => {
    const wHit = (1 - phi) * prior(ti) * state([[t, "hit"]]);
    hit[t]! += wHit;
    total += wHit;
    if (K < 2) return;
    sites.forEach((s) => {
      if (s === t) return;
      const share = (0.5 * phi * prior(ti)) / (K - 1);
      const wShow = share * state([[s, "show"]]); // show on s, target t still quiet
      const wBoth = share * state([[t, "hit"], [s, "show"]]);
      show[s]! += wShow + wBoth;
      fake += wShow;
      hit[t]! += wBoth;
      total += wShow + wBoth;
    });
  });
  if (!(total > 0)) return { hit: zero(), show: zero(), fake: 0, none: 1, likeliest: sites[0]! };
  for (const s of sites) { hit[s] = hit[s]! / total; show[s] = show[s]! / total; }
  none /= total;
  fake /= total;
  let likeliest = sites[0]!;
  for (const s of sites) if (hit[s]! > hit[likeliest]!) likeliest = s;
  return { hit, show, fake, none, likeliest };
}

/**
 * How many of the `available` players (those not already defending the site) go to a site whose
 * hit belief is `pHit`: the proportional share, round(pHit × available). With three available:
 * below 1/6 nobody, to 1/2 one (support — the far anchors stay), to 5/6 two, above it everyone.
 */
export function rotationCount(pHit: number, available: number): number {
  if (available <= 0) return 0;
  return Math.max(0, Math.min(available, Math.round(Math.min(1, Math.max(0, pHit)) * available)));
}
