// SimulationRunner interface + StubRunner.
//
// The REAL runner is PV-4's `@pv/round-simulator` (origin/claude/pv-spatial),
// which is not pushed yet. This StubRunner emits a synthetic sim EventLog so the
// desktop's Simulation Runner screen and the main↔worker IPC path can be built
// and tested end-to-end now. At integration, swap StubRunner for the real
// runner behind this same interface (see apps/desktop/README.md "Swap points").
import type { SimEvent } from '@pv/replay-engine';
import type { SimProgress, SimRunRequest } from './ipc.ts';

export interface SimulationRunner {
  readonly kind: 'stub' | 'round-simulator';
  /** Produce a sim event log (convertible via fromSimEventLog), reporting progress. */
  run(req: SimRunRequest, onProgress: (p: Omit<SimProgress, 'runId'>) => void): Promise<SimEvent[]>;
}

// Tiny deterministic LCG so a given seed reproduces the same log (DECISION-010).
function lcg(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

// Plausible Ascent world coords (uu) for two attackers + one defender to walk between.
const PATHS: Record<string, Array<{ x: number; y: number; z: number }>> = {
  atk1: [{ x: 1995, y: -9744, z: 100 }, { x: 3200, y: -6500, z: 250 }, { x: 4489, y: -3014, z: 400 }],
  atk2: [{ x: 1995, y: -9744, z: 100 }, { x: 2600, y: -7800, z: 180 }, { x: 4300, y: -3300, z: 400 }],
  def1: [{ x: 4800, y: -2500, z: 420 }, { x: 4600, y: -3400, z: 400 }, { x: 4300, y: -3300, z: 400 }],
};

export class StubRunner implements SimulationRunner {
  readonly kind = 'stub' as const;

  async run(req: SimRunRequest, onProgress: (p: Omit<SimProgress, 'runId'>) => void): Promise<SimEvent[]> {
    const rng = lcg(req.seed);
    const events: SimEvent[] = [];
    let seq = 0;
    let t = 0;
    const push = (e: Record<string, unknown>) => events.push({ seq: seq++, tick: Math.round(t / 50), timeMs: Math.round(t), ...e } as SimEvent);

    onProgress({ phase: 'start', pct: 0, message: `stub sim · ${req.rounds} round(s) · seed ${req.seed}` });
    const roundMs = 25000;
    for (let r = 1; r <= req.rounds; r++) {
      t = (r - 1) * (roundMs + 5000);
      push({ kind: 'roundStart', roundNumber: r });
      // walk each player along its path across the round
      const steps = 8;
      for (let i = 0; i <= steps; i++) {
        t = (r - 1) * (roundMs + 5000) + (i / steps) * roundMs;
        for (const [pid, path] of Object.entries(PATHS)) {
          const seg = (i / steps) * (path.length - 1);
          const a = path[Math.floor(seg)];
          const b = path[Math.min(path.length - 1, Math.floor(seg) + 1)];
          const u = seg - Math.floor(seg);
          const jitter = (rng() - 0.5) * 40;
          const to = { x: a.x + (b.x - a.x) * u + jitter, y: a.y + (b.y - a.y) * u + jitter, z: a.z };
          push({ kind: 'move', playerId: pid, from: a, to });
        }
      }
      // a kill and a plant mid-round
      t = (r - 1) * (roundMs + 5000) + roundMs * 0.6;
      push({ kind: 'kill', victim: 'def1', killer: 'atk1', cause: 'weapon', weaponId: 'Vandal' });
      t = (r - 1) * (roundMs + 5000) + roundMs * 0.8;
      push({ kind: 'spikePlanted', playerId: 'atk1', at: { x: 4300, y: -3300, z: 400 } });
      t = (r - 1) * (roundMs + 5000) + roundMs;
      push({ kind: 'roundEnd', winner: 'attack', reason: 'spikeDetonation' });
      onProgress({ phase: 'round', pct: r / req.rounds, round: r });
      await new Promise((res) => setTimeout(res, 120)); // simulate work, let progress stream
    }
    onProgress({ phase: 'done', pct: 1 });
    return events;
  }
}
