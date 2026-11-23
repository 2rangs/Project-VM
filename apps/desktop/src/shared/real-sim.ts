// Real Match Runner — wraps PV-4's @pv/round-simulator (deterministic fixed-tick
// 5v5 round loop over the spatial/combat/perception/ability engines) behind the
// same SimulationRunner interface the stub used. Runs N rounds, converts each to
// PV-6 sim events via the simulator's own toPv6ReplayFormat seam, offsets them
// onto a single match timeline, and returns the merged event log.
//
// The engines are pure TS (no third-party deps) and are bundled from source via
// Vite aliases; their data inputs are the copied JSON in ../data/sim.
import { createEngine } from '@pv/spatial-engine';
import { buildCatalog } from '@pv/combat-engine';
import {
  RoundSimulator, ScriptedPolicy, makeSyntheticRound, SYNTHETIC_DEFENSE_ANCHORS,
  SpatialQueryAdapter, toPv6ReplayFormat,
} from '@pv/round-simulator';
import type { SimEvent } from '@pv/replay-engine';
import type { SimProgress, SimRunRequest } from './ipc.ts';
import type { SimulationRunner } from './sim.ts';

import nav from '../data/sim/ascent.navgraph.json';
import roadmap from '../data/sim/ascent.nav.json';
import visibility from '../data/sim/ascent.vis.json';
import cs from '../data/sim/coordinate-system.json';
import weaponsData from '../data/sim/weapons.json';

const GAP_MS = 5000; // break between rounds on the match timeline

export class RealMatchRunner implements SimulationRunner {
  readonly kind = 'round-simulator' as const;

  async run(req: SimRunRequest, onProgress: (p: Omit<SimProgress, 'runId'>) => void): Promise<SimEvent[]> {
    onProgress({ phase: 'start', pct: 0, message: `round-simulator · ${req.rounds} round(s) · seed ${req.seed}` });

    const spatial = createEngine(
      nav as unknown as Parameters<typeof createEngine>[0],
      (cs as { transform: unknown }).transform as Parameters<typeof createEngine>[1],
      // the navigation roadmap: players move on it; the simulator refuses to run without one
      roadmap as unknown as Parameters<typeof createEngine>[2],
      // measured line of sight between roadmap nodes: who sees whom is decided by where they stand
      visibility as unknown as Parameters<typeof createEngine>[3],
    );
    const sq = new SpatialQueryAdapter(spatial);
    const weapons = buildCatalog(
      (weaponsData as { weapons: unknown[] }).weapons as Parameters<typeof buildCatalog>[0],
    );

    const all: SimEvent[] = [];
    let offset = 0;
    let seq = 0;
    for (let r = 0; r < req.rounds; r++) {
      const sim = new RoundSimulator({
        spatial, weapons, abilities: {},
        policies: {
          attack: new ScriptedPolicy(sq, { attackSite: r % 2 === 0 ? 'a-site' : 'b-site' }),
          defense: new ScriptedPolicy(sq, { defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }),
        },
        config: { seed: req.seed + r, recordTracks: true },
      });
      const result = sim.runRound(makeSyntheticRound(spatial));
      const { events } = toPv6ReplayFormat(result, { mapId: req.mapId });
      for (const src of events as unknown as Record<string, unknown>[]) {
        const ev: Record<string, unknown> = { ...src, timeMs: (src.timeMs as number) + offset, seq: seq++ };
        if (ev.kind === 'roundStart') ev.roundNumber = r + 1;
        all.push(ev as unknown as SimEvent);
      }
      offset += result.endedAtElapsedMs + GAP_MS;
      onProgress({ phase: 'round', pct: (r + 1) / req.rounds, round: r + 1, message: `R${r + 1}: ${result.winner} (${result.reason})` });
      await new Promise((res) => setTimeout(res, 0)); // yield so progress streams
    }
    onProgress({ phase: 'done', pct: 1 });
    return all;
  }
}
