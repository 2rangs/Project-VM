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
  /** Which values came from the map's hand-authored file rather than the rules. */
  readonly authored: readonly string[];
}
