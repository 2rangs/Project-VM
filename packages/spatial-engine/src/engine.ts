import type {
  AudibleZone,
  CoordinateTransform,
  PathResult,
  PlantZone,
  Sightline,
  SoundLink,
  TacticalMapData,
  TravelMode,
  Vec2,
  Vec3,
  Zone,
  ZoneType,
} from "./types.js";
import { MapCoordinateSystem } from "./coordinate.js";
import { ZoneGraph, type PathOptions } from "./pathfinding.js";
import { distance3, pointInPolygon } from "./geometry.js";

export interface SpatialEngineOptions {
  /** Transform supplied separately (e.g. from coordinate-system.json). Falls back to data.transform. */
  transform?: CoordinateTransform;
}

/**
 * Tactical spatial model for a single map (Ascent v0).
 *
 * Provides: coordinate conversion, zone lookup, A* pathfinding + shortest
 * travel time, plant-area judgment, line-of-sight queries and a sound
 * propagation approximation.
 */
export class SpatialEngine {
  readonly mapId: string;
  readonly coords: MapCoordinateSystem;
  private readonly data: TacticalMapData;
  private readonly graph: ZoneGraph;
  private readonly zoneById = new Map<string, Zone>();
  private readonly plantByZone = new Map<string, PlantZone[]>();
  private readonly sightAdj = new Map<string, Map<string, Sightline>>();
  private readonly soundAdj = new Map<string, { to: string; attenuation: number }[]>();

  constructor(data: TacticalMapData, opts: SpatialEngineOptions = {}) {
    this.data = data;
    this.mapId = data.mapId;
    const transform = opts.transform ?? data.transform;
    if (!transform) throw new Error("SpatialEngine: no coordinate transform provided");
    this.coords = new MapCoordinateSystem(transform);

    for (const z of data.zones) this.zoneById.set(z.id, z);

    const m = data.movement;
    this.graph = new ZoneGraph(
      data.zones,
      data.edges,
      m.unitsPerMeter,
      m.runSpeedMetersPerSec,
      m.walkSpeedMetersPerSec,
    );

    for (const pz of data.plantZones) {
      const list = this.plantByZone.get(pz.zoneId) ?? [];
      list.push(pz);
      this.plantByZone.set(pz.zoneId, list);
    }

    for (const s of data.sightlines) {
      this.addSight(s.a, s.b, s);
      this.addSight(s.b, s.a, s);
    }
    for (const l of data.soundLinks) {
      this.addSound(l.a, l.b, l);
      this.addSound(l.b, l.a, l);
    }
  }

  private addSight(from: string, to: string, s: Sightline): void {
    let map = this.sightAdj.get(from);
    if (!map) {
      map = new Map();
      this.sightAdj.set(from, map);
    }
    map.set(to, s);
  }

  private addSound(from: string, to: string, l: SoundLink): void {
    const list = this.soundAdj.get(from) ?? [];
    list.push({ to, attenuation: l.attenuation });
    this.soundAdj.set(from, list);
  }

  // ---- Zone lookup ----

  getZone(id: string): Zone | undefined {
    return this.zoneById.get(id);
  }

  get zones(): Zone[] {
    return this.data.zones;
  }

  zonesByType(type: ZoneType): Zone[] {
    return this.data.zones.filter((z) => z.zoneType === type);
  }

  /** Nearest zone center to a game-world position (3D euclidean). */
  nearestZone(position: Vec3): Zone {
    let best: Zone | null = null;
    let bestD = Infinity;
    for (const z of this.data.zones) {
      const d = distance3(z.position, position);
      if (d < bestD) {
        bestD = d;
        best = z;
      }
    }
    if (!best) throw new Error("map has no zones");
    return best;
  }

  // ---- Pathfinding ----

  findPath(fromId: string, toId: string, mode: TravelMode = "run", opts: PathOptions = {}): PathResult | null {
    const r = this.graph.findPath(fromId, toId, mode, opts);
    if (!r) return null;
    return {
      path: r.path,
      distanceUnits: r.distanceUnits,
      distanceMeters: Number((r.distanceUnits / this.data.movement.unitsPerMeter).toFixed(2)),
      timeMs: r.timeMs,
      mode,
    };
  }

  /** Shortest travel time in ms, or null if unreachable. */
  shortestTravelTimeMs(fromId: string, toId: string, mode: TravelMode = "run", opts: PathOptions = {}): number | null {
    const r = this.graph.findPath(fromId, toId, mode, opts);
    return r ? r.timeMs : null;
  }

  isReachable(fromId: string, toId: string, opts: PathOptions = {}): boolean {
    return this.graph.findPath(fromId, toId, "run", opts) !== null;
  }

  // ---- Plant judgment ----

  /** Whether a zone is a spike-plantable site zone. */
  isPlantableZone(zoneId: string): boolean {
    return this.zoneById.get(zoneId)?.plantable ?? false;
  }

  /** Whether a game-world position falls inside any defined plant polygon. */
  isPointPlantable(position: Vec2 | Vec3): boolean {
    for (const pz of this.data.plantZones) {
      if (pointInPolygon({ x: position.x, y: position.y }, pz.polygon)) return true;
    }
    return false;
  }

  /** The plant zone (A/B) containing a position, if any. */
  plantZoneAt(position: Vec2 | Vec3): PlantZone | null {
    for (const pz of this.data.plantZones) {
      if (pointInPolygon({ x: position.x, y: position.y }, pz.polygon)) return pz;
    }
    return null;
  }

  // ---- Visibility (line of sight) ----

  /**
   * Approximate line-of-sight between two zones using the authored sightline
   * list. If `smokedPairs` contains the pair and the sightline is smokeable,
   * LoS is blocked.
   */
  hasLineOfSight(zoneA: string, zoneB: string, opts: { smokedPairs?: Array<[string, string]> } = {}): boolean {
    if (zoneA === zoneB) return true;
    const s = this.sightAdj.get(zoneA)?.get(zoneB);
    if (!s) return false;
    if (opts.smokedPairs && s.smokeable) {
      for (const [a, b] of opts.smokedPairs) {
        if ((a === zoneA && b === zoneB) || (a === zoneB && b === zoneA)) return false;
      }
    }
    return true;
  }

  /** Zones with a direct authored sightline to the given zone. */
  visibleZonesFrom(zoneId: string): string[] {
    const map = this.sightAdj.get(zoneId);
    return map ? [...map.keys()] : [];
  }

  // ---- Sound propagation (approximation) ----

  /**
   * Zones reachable by sound from an origin, as a BFS over sound links where
   * each hop multiplies the remaining signal by (1 - attenuation). Zones whose
   * resulting strength falls below `threshold` are dropped.
   */
  audibleZones(originZoneId: string, threshold = 0.1): AudibleZone[] {
    if (!this.zoneById.has(originZoneId)) throw new Error(`unknown zone: ${originZoneId}`);
    const best = new Map<string, number>([[originZoneId, 1]]);
    const queue: string[] = [originZoneId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const strength = best.get(cur)!;
      for (const link of this.soundAdj.get(cur) ?? []) {
        const next = strength * (1 - link.attenuation);
        if (next >= threshold && next > (best.get(link.to) ?? 0)) {
          best.set(link.to, next);
          queue.push(link.to);
        }
      }
    }
    best.delete(originZoneId);
    return [...best.entries()]
      .map(([zoneId, strength]) => ({ zoneId, strength: Number(strength.toFixed(3)) }))
      .sort((a, b) => b.strength - a.strength);
  }
}
