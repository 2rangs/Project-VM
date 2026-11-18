// Ascent world→minimap transform. COPIED from PV-4
// origin/claude/pv-spatial:datasets/spatial/ascent/coordinate-system.json
// (2026-11-18). Source of truth is PV-4; used here only to attach a transform to
// simulated replays so the viewer can project them. Swap for a Spatial adapter
// at integration (see README "Swap points").
import type { CoordinateTransform } from '@pv/replay-engine';

export const ASCENT_TRANSFORM: CoordinateTransform = {
  xMultiplier: 0.00007,
  yMultiplier: -0.00007,
  xScalarToAdd: 0.813895,
  yScalarToAdd: 0.573242,
};
