// Simulation worker — runs in a SEPARATE process from the renderer (DECISION-007).
// Electron's utilityProcess forks this; the run request is passed as fork ARGS
// (available at spawn), so there is no main→worker message handshake to race on.
// The worker only POSTS progress + the final event log back to main.
import { StubRunner } from '../shared/sim.ts';
import type { SimProgress, SimRunRequest } from '../shared/ipc.ts';

type OutMsg =
  | { type: 'progress'; progress: SimProgress }
  | { type: 'result'; runId: string; events: unknown[] }
  | { type: 'error'; runId: string; message: string };

const parentPort = (process as unknown as { parentPort?: { postMessage(m: OutMsg): void } }).parentPort;
const post = (m: OutMsg) => parentPort?.postMessage(m);

// argv tail: [ runId, <JSON SimRunRequest> ]
const runId = process.argv[process.argv.length - 2] ?? 'run';
let req: SimRunRequest;
try { req = JSON.parse(process.argv[process.argv.length - 1] ?? '{}'); }
catch (e) { post({ type: 'error', runId, message: `bad request: ${(e as Error).message}` }); process.exit(1); }

new StubRunner()
  .run(req, (p) => post({ type: 'progress', progress: { ...p, runId } }))
  .then((events) => post({ type: 'result', runId, events }))
  .catch((err: unknown) => post({ type: 'error', runId, message: (err as Error).message }));
