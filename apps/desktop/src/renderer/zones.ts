// Zone id → world centroid, from the Ascent navgraph. The fog-of-war belief
// heatmap and sound cues are keyed by zone id (perception output); this maps
// each to the world position the replay's coordinate transform projects to pixels.
import type { Vec3 } from '@pv/replay-engine';
import navgraph from '../data/sim/ascent.navgraph.json';

interface NavZone { id: string; position?: Vec3 }

export const ZONE_POSITIONS: Record<string, Vec3> = Object.fromEntries(
  ((navgraph as { zones?: NavZone[] }).zones ?? [])
    .filter((z): z is NavZone & { position: Vec3 } => !!z.position)
    .map((z) => [z.id, z.position]),
);
