/**
 * Per-map tactical data handed to a team policy: where the sites are, which way the attack comes
 * into each, what a defender on a zone watches, where five defenders start. It is DERIVED from the
 * map by @pv/spatial-engine (`deriveMapTactics`: the rules are there) with a map's small
 * hand-authored file applied on top; this is only the shape a policy reads. Zone ids are plain
 * strings here — the producer is not part of the branded-id world.
 */
export interface SiteTactics {
  /** Site letter: "A", "B", "C". */
  readonly site: string;
  /** The plantable site zone. */
  readonly zone: string;
  /** The choke the attack comes through, or null if the attack cannot reach the site. */
  readonly mainEntry: string | null;
  /** Every way the attack comes in, the main entry first. */
  readonly entries: readonly string[];
  /** Zones worth smoking for an execute onto this site, in order. */
  readonly smokes: readonly string[];
  readonly attackTravelMs: number | null;
  readonly defenseTravelMs: number | null;
}

export interface MapTactics {
  readonly mapId: string;
  readonly attackerSpawn: string;
  readonly defenderSpawn: string;
  readonly sites: readonly SiteTactics[];
  /** The defenders' mid position and what it watches, or null on a map without one. */
  readonly mid: { readonly zone: string; readonly aim: string | null } | null;
  /** What a defender standing on a zone watches (sites and the mid anchor). */
  readonly aim: Readonly<Record<string, string>>;
  /** Zones to smoke per objective zone. */
  readonly smokes: Readonly<Record<string, readonly string[]>>;
  /** Where the five defenders start, by roster index. */
  readonly defenderStarts: readonly string[];
  /**
   * Ground the attack holds first: zones the attackers reach from their spawn before the defenders
   * reach them from theirs (spawns and sites excluded). A defender changing position before the
   * plant goes round it where the map allows.
   */
  readonly attackerGround?: readonly string[];
  /** Which site a zone without a site letter in its name (mid, bridges, ...) leads the attack to. */
  readonly approachSide?: Readonly<Record<string, string>>;
  /** The map's middle: its zones, chokes and what holding it opens (null / omitted = no mid). */
  readonly midArea?: MidAreaTactics | null;
  /** Which values came from the map's hand-authored file rather than the rules. */
  readonly authored: readonly string[];
}

/** The middle of a map as a policy reads it (derived by @pv/spatial-engine `deriveMidArea`). */
export interface MidAreaTactics {
  readonly zones: readonly string[];
  readonly attackEntry: string;
  readonly attackMs: number;
  readonly defenseEntry: string;
  readonly defenseMs: number;
  /** The mid zone where the two sides meet. */
  readonly contest: string;
  readonly chokes: ReadonlyArray<{ readonly zone: string; readonly onto: string; readonly leadsTo: string | null; readonly first: "attack" | "defense" }>;
  /** Per site letter: the way from mid onto the site past its main entry (the second lane of a split), or null. */
  readonly siteLinks: Readonly<Record<string, { readonly from: string; readonly path: readonly string[]; readonly entry: string; readonly travelMs: number } | null>>;
  readonly attackSwitch: ReadonlyArray<{ readonly from: string; readonly to: string; readonly throughMs: number | null; readonly aroundMs: number | null }>;
  readonly defenseRotate: ReadonlyArray<{ readonly from: string; readonly to: string; readonly throughMs: number | null; readonly aroundMs: number | null }>;
  /** Share of the attack's site switch that mid saves, 0..1. */
  readonly attackValue: number;
  /** Share of the defence's rotation that mid saves, 0..1. */
  readonly defenseValue: number;
}
