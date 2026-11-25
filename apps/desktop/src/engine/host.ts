// Engine host — the simulation engine (@pv/match-runner and everything under it) bundled into ONE
// file (out/main/engine-host.js) and run in its own process, off the UI thread (DECISION-007).
// It replaces the `npx tsx scripts/*.mts` subprocesses: no workspace, no node_modules and no
// TypeScript loader are needed at run time, and the process stays alive between matches, so map
// data is parsed once (packages/match-runner/src/setup.ts caches it per process).
//
// Transport: Electron utilityProcess (process.parentPort) in the app; plain Node child_process.fork
// (process.send) in tests — same messages either way (see protocol.ts). The engine is synchronous:
// requests are handled one at a time, in order.
import { engineRoot } from './root.ts';
import { runMatchCompact, type RunMatchCfg } from './run-match.ts';
import { createMatchSessionHost, type CommandHost, type MatchSessionCfg } from './match-session.ts';
import { createSeriesHost, type SeriesCfg } from './series-session.ts';
import { playCareerSeries } from './career-sim.ts';
import { prematchReport, type PrematchReq } from './prematch.ts';
import { tacticsMap, type TacticsMapReq } from './tactics-map.ts';
import type { CareerSimRequest } from '../shared/career.ts';
import type { EngineMessage, EngineRequest } from './protocol.ts';

interface ParentPort { postMessage(m: unknown): void; on(ev: 'message', cb: (e: { data: unknown }) => void): void }
const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
const post = (m: EngineMessage): void => {
  if (parentPort) parentPort.postMessage(m);
  else process.send?.(m);
};

let session: CommandHost | null = null;
let series: CommandHost | null = null;

function run(req: EngineRequest): unknown {
  const payload = (req.payload ?? {}) as Record<string, unknown>;
  switch (req.op) {
    case 'ping': return { pong: true, root: engineRoot() };
    case 'match.run':
      return runMatchCompact(payload as RunMatchCfg, (p) => post({ id: req.id, event: 'progress', data: p }));
    case 'session.start':
      session = createMatchSessionHost(payload as MatchSessionCfg);
      return session.handle({ cmd: 'state' });
    case 'session.cmd':
      if (!session) throw new Error('no active session');
      return session.handle(payload);
    case 'session.stop': session = null; return {};
    case 'series.start':
      series = null;
      series = createSeriesHost(payload as unknown as SeriesCfg);
      return series.handle({ cmd: 'view' });
    case 'series.cmd':
      if (!series) throw new Error('no active series');
      return series.handle(payload);
    case 'series.stop': series = null; return {};
    case 'career.series': return { outcome: playCareerSeries(payload as unknown as CareerSimRequest) };
    case 'prematch.report': return prematchReport(payload as unknown as PrematchReq);
    case 'tactics.map': return tacticsMap(payload as TacticsMapReq);
    default: throw new Error(`unknown op ${String(req.op)}`);
  }
}

function onMessage(raw: unknown): void {
  const req = raw as EngineRequest;
  if (!req || typeof req.id !== 'number') return;
  try {
    post({ id: req.id, ok: true, json: JSON.stringify(run(req) ?? {}) });
  } catch (e) {
    post({ id: req.id, ok: false, error: (e as Error).message });
  }
}

if (parentPort) parentPort.on('message', (e) => onMessage(e.data));
else {
  process.on('message', onMessage);
  process.on('disconnect', () => process.exit(0)); // the test that forked us went away
}
post({ ready: true, pid: process.pid });
