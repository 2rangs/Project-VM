// The map facts the tactics screen needs (src/shared/manager.ts TacticsMapView): each site's plant
// spots from the engine (round-simulator plantSpotsOf — the same ids the plans are keyed by), the
// site's retake entries, and whether the map has a mid. Positions are world units; the renderer
// projects them onto the minimap with the map's coordinate transform. Read-only: plays nothing.
import { loadSpatial, loadTactics } from '../../../../packages/match-runner/src/setup.ts';
import { plantSpotsOf } from '../../../../packages/match-runner/src/index.ts';

export interface TacticsMapReq { mapId?: string }

export function tacticsMap(req: TacticsMapReq) {
  // Every map is simulated on Ascent's geometry by default (MatchConfig.geometry), so its spots are Ascent's.
  const geometry = 'ascent';
  const spatial = loadSpatial(geometry);
  const tactics = loadTactics(geometry, spatial);
  const sites = [...plantSpotsOf(spatial).values()].map((s) => ({
    site: s.site,
    zone: s.zone,
    retakeEntries: [...s.retakeEntries],
    attackEntries: [...s.attackEntries],
    candidates: s.candidates.map((c) => ({ id: c.id, kind: c.kind, zone: c.zone, x: c.position.x, y: c.position.y, exposure: c.exposure, guardSight: c.guardSight })),
  })).sort((a, b) => a.site.localeCompare(b.site));
  return { map: req.mapId ?? 'Ascent', geometry, sites, hasMid: !!(tactics.mid || tactics.midArea) };
}
