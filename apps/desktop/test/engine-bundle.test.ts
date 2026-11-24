// Determinism of the BUNDLED engine. The app runs the simulation from one bundled file
// (out/main/engine-host.js, built from src/engine/host.ts) in a long-lived worker process; the
// reference is the same code run from workspace source through tsx (scripts/*.mts), one process
// per run. For the same request the two must produce the same bytes — a whole map, an interactive
// session, a series and a career series — and the bundle must also run from the staged data copy
// the packaged app ships (scripts/stage-engine-data.mjs), with nothing else from the repository.
//
// Needs `npm run build` (the bundle) and the repo-root install (tsx). Run: npm run test:engine
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fork, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain .mjs build script, no type declarations
import { stageEngineData } from '../scripts/stage-engine-data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const repoRoot = path.resolve(appDir, '..', '..');
const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
const bundle = path.join(appDir, 'out', 'main', 'engine-host.js');

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** A short readable fingerprint for failure messages (the comparison itself is on every byte). */
const signature = (json: string): string => {
  const m = JSON.parse(json) as { winner: string; score: { A: number; B: number }; rounds: Array<{ winner: string; reason: string; kills: { A: number; B: number } }> };
  return `${m.winner} ${m.score.A}-${m.score.B} ${m.rounds.map((r) => `${r.winner}${r.reason[0]}${r.kills.A}${r.kills.B}`).join('')}`;
};

// ── the bundled host, driven over child_process IPC (the app uses Electron's utilityProcess) ──
type HostMsg = { ready?: true; id?: number; ok?: boolean; json?: string; error?: string; event?: string; data?: unknown };
class Host {
  private readonly child: ChildProcess;
  private seq = 0;
  private readonly pending = new Map<number, { resolve: (v: { json: string; events: unknown[] }) => void; reject: (e: Error) => void; events: unknown[] }>();
  private readonly ready: Promise<void>;
  constructor(entry: string, opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
    this.child = fork(entry, [], { cwd: opts.cwd ?? repoRoot, env: opts.env ?? process.env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    this.ready = new Promise<void>((resolve, reject) => {
      this.child.on('message', (m: HostMsg) => {
        if (m.ready) { resolve(); return; }
        const p = this.pending.get(m.id!);
        if (!p) return;
        if (m.event) { p.events.push(m.data); return; }
        this.pending.delete(m.id!);
        if (m.ok) p.resolve({ json: m.json!, events: p.events }); else p.reject(new Error(m.error));
      });
      this.child.on('exit', (code) => { const e = new Error(`engine host exited (${code})`); reject(e); for (const p of this.pending.values()) p.reject(e); });
    });
  }
  async request(op: string, payload?: unknown): Promise<{ json: string; events: unknown[] }> {
    await this.ready;
    return new Promise((resolve, reject) => { const id = ++this.seq; this.pending.set(id, { resolve, reject, events: [] }); this.child.send({ id, op, payload }); });
  }
  async json(op: string, payload?: unknown): Promise<string> { return (await this.request(op, payload)).json; }
  stop(): void { this.child.kill(); }
}

// ── the tsx reference path ──
function tsxMatch(cfg: unknown): { json: string; progress: unknown[] } {
  const res = spawnSync(tsx, [path.join(appDir, 'scripts', 'run-match.mts'), JSON.stringify(cfg)], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 180000 });
  assert.equal(res.status, 0, `run-match.mts failed: ${res.stderr?.slice(-400)}`);
  const progress = res.stderr.split('\n').filter((l) => l.startsWith('PVPROGRESS ')).map((l) => JSON.parse(l.slice(11)));
  return { json: res.stdout, progress };
}
/** Drive a line-protocol script (session / series / career): one reply body (as JSON text) per command. */
async function tsxLines(script: string, args: string[], cmds: Array<Record<string, unknown>>, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const child = spawn(tsx, [path.join(appDir, 'scripts', script), ...args], { cwd: repoRoot, env, stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '';
  const replies: string[] = [];
  const done = new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (d) => {
      buf += String(d);
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const { id: _id, ok, error, ...body } = JSON.parse(line) as { id?: number; ok: boolean; error?: string };
        if (!ok) { reject(new Error(error)); return; }
        replies.push(JSON.stringify(body));
        if (replies.length === cmds.length) resolve();
      }
    });
    child.on('exit', (code) => { if (replies.length < cmds.length) reject(new Error(`${script} exited (${code}) after ${replies.length}/${cmds.length} replies`)); });
  });
  cmds.forEach((c, i) => child.stdin.write(JSON.stringify({ id: i + 1, ...c }) + '\n'));
  try { await done; } finally { child.kill(); }
  return replies;
}

const missing = !existsSync(bundle) ? `${bundle} is missing — run \`npm run build\` first`
  : !existsSync(tsx) ? `${tsx} is missing — run pnpm install at the repo root` : null;
// A missing prerequisite FAILS (a silently skipped determinism check would read as a pass).
test('prerequisites: the bundle is built and the workspace is installed', () => { assert.equal(missing, null); });

const A = { id: '2', name: 'Alpha' };
const B = { id: '1001', name: 'Bravo' };
const MATCHES: Array<Record<string, unknown>> = [
  { teamA: A, teamB: B, map: 'ascent', seed: 1 },
  { teamA: A, teamB: B, map: 'ascent', seed: 42, options: { opponentMemory: false, minThrowRates: { teams: { '1001': 0.02 } } } },
  { teamA: B, teamB: A, map: 'Haven', seed: 777 },
];
const hosts: Host[] = [];
after(() => { for (const h of hosts) h.stop(); });
const tmpDirs: string[] = [];
after(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }); });

/** Bundle hashes of MATCHES, filled by the first test and reused by the staged-data test. */
const bundleHashes: string[] = [];

test('one-shot match: the bundled host and the tsx source path produce identical bytes', { skip: missing ?? false, timeout: 300000 }, async () => {
  const host = new Host(bundle); hosts.push(host);
  for (const [i, cfg] of MATCHES.entries()) {
    const fromBundle = await host.request('match.run', cfg);
    const fromSource = tsxMatch(cfg);
    assert.equal(signature(fromBundle.json), signature(fromSource.json), `case ${i}: match signature differs`);
    assert.equal(sha(fromBundle.json), sha(fromSource.json), `case ${i}: same signature but the full output differs`);
    assert.deepEqual(fromBundle.events, fromSource.progress, `case ${i}: per-round progress differs`);
    assert.ok(fromBundle.events.length >= 13, 'one progress event per round');
    bundleHashes[i] = sha(fromBundle.json);
  }
  // The host is long-lived and reuses its parsed map data: replaying the first match after the
  // others must give the same bytes again (nothing leaks from one match into the next).
  assert.equal(sha(await host.json('match.run', MATCHES[0])), bundleHashes[0], 'a repeated match in the same host differs');
});

test('interactive session: same replies from the bundled host and the tsx script', { skip: missing ?? false, timeout: 300000 }, async () => {
  const cfg = { teamA: A, teamB: B, map: 'ascent', seed: 7, aiTeams: ['B'], options: {} };
  const cmds: Array<Record<string, unknown>> = [
    { cmd: 'state' }, { cmd: 'playNextRound' }, { cmd: 'callTimeout', team: 'A' },
    { cmd: 'setOrders', team: 'A', order: { strategy: 'aExecute', economy: 'force' } },
    { cmd: 'playNextRound' }, { cmd: 'playNextRound' }, { cmd: 'result' },
  ];
  const host = new Host(bundle); hosts.push(host);
  const fromBundle = [await host.json('session.start', cfg)];
  for (const c of cmds.slice(1)) fromBundle.push(await host.json('session.cmd', c));
  const fromSource = await tsxLines('match-session.mts', [JSON.stringify(cfg)], cmds);
  assert.equal(fromBundle.length, fromSource.length);
  fromBundle.forEach((reply, i) => assert.equal(sha(reply), sha(fromSource[i]!), `reply ${i} (${String(cmds[i]!.cmd)}) differs`));
  // an error is an error on both paths
  await assert.rejects(host.json('session.cmd', { cmd: 'nope' }), /unknown cmd nope/);
  host.stop();
});

test('series (veto → one map) and a career series: same results on both paths', { skip: missing ?? false, timeout: 600000 }, async () => {
  const env = { ...process.env, PV_SERIES_FILM: '1' };
  const cfg = { teamA: A, teamB: B, format: 'bo1', seed: 11 };
  const host = new Host(bundle, { env }); hosts.push(host);
  // walk the veto with the engine's own recommendation on our steps, then play the map
  const fromBundle = [await host.json('series.start', cfg)];
  const cmds: Array<Record<string, unknown>> = [{ cmd: 'view' }];
  for (let guard = 0; guard < 16; guard++) {
    const view = (JSON.parse(fromBundle[fromBundle.length - 1]!) as { view: { phase: string; veto: { pending: null | { ai: boolean; recommendation: { choice: string } } } } }).view;
    if (view.phase !== 'veto' || !view.veto.pending) break;
    const cmd = view.veto.pending.ai ? { cmd: 'aiStep' } : { cmd: 'chooseVeto', choice: view.veto.pending.recommendation.choice };
    cmds.push(cmd);
    fromBundle.push(await host.json('series.cmd', cmd));
  }
  cmds.push({ cmd: 'playGame' });
  fromBundle.push(await host.json('series.cmd', { cmd: 'playGame' }));
  assert.ok(cmds.length >= 3, 'the veto had at least one step');
  const fromSource = await tsxLines('series-session.mts', [JSON.stringify(cfg)], cmds, env);
  fromBundle.forEach((reply, i) => assert.equal(sha(reply), sha(fromSource[i]!), `series reply ${i} (${String(cmds[i]!.cmd)}) differs`));

  // career: one AI-vs-AI series with real rosters
  const rosters = JSON.parse(readFileSync(path.join(repoRoot, 'packages/game-data/data/rosters.json'), 'utf8')) as Record<string, Array<{ playerId: string }>>;
  const players = new Map((JSON.parse(readFileSync(path.join(repoRoot, 'packages/game-data/data/players.json'), 'utf8')) as Array<{ playerId: string; attributes: unknown; hasRatings: boolean }>).map((p) => [p.playerId, p]));
  const side = (t: { id: string; name: string }) => ({
    teamId: t.id, name: t.name, analyst: 0.5,
    roster: rosters[t.id]!.slice(0, 5).map((r) => { const p = players.get(r.playerId)!; return { playerId: p.playerId, attributes: p.attributes, hasRatings: p.hasRatings }; }),
  });
  const req = { fixtureId: 'fx-1', seed: 5, format: 'bo1', home: side(A), away: side(B) };
  const career = await host.json('career.series', req);
  const [careerSource] = await tsxLines('career-sim.mts', [], [{ cmd: 'series', req }]);
  assert.equal(career, careerSource, 'career series outcome differs');
  assert.equal((JSON.parse(career) as { outcome: { fixtureId: string } }).outcome.fixtureId, 'fx-1');
  host.stop();
});

test('packaged layout: the bundle runs from the staged engine data alone and matches the source path', { skip: missing ?? false, timeout: 600000 }, async () => {
  // A copy of the built main bundle and the staged data in a temp dir, cwd outside the repository:
  // exactly what the packaged app has (out/main in the asar, the data under <resources>/engine).
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'pv-engine-')); tmpDirs.push(tmp);
  cpSync(path.join(appDir, 'out', 'main'), path.join(tmp, 'main'), { recursive: true });
  const { files } = stageEngineData(path.join(tmp, 'engine')) as { files: string[]; bytes: number };
  // nothing that must not ship: no meshes / media / raw extractions, only JSON the engine reads
  assert.ok(files.every((f) => f.endsWith('.json')), 'only JSON is staged');
  assert.ok(!files.some((f) => /\/mesh\/|\.raw\.json$|\.source\.json$|\.authoring\.json$/.test(f)), 'no raw map extraction is staged');
  const staged = new Host(path.join(tmp, 'main', 'engine-host.js'), { cwd: tmp, env: { ...process.env, PV_ENGINE_ROOT: path.join(tmp, 'engine'), PV_SERIES_FILM: '1' } });
  hosts.push(staged);
  assert.equal((JSON.parse(await staged.json('ping')) as { root: string }).root, path.join(tmp, 'engine'));
  for (const [i, cfg] of MATCHES.entries()) {
    assert.equal(sha(await staged.json('match.run', cfg)), bundleHashes[i], `case ${i}: staged-data run differs from the repository run`);
  }
  // every map of the series pool loads and plays from the staged copy (a missing data file throws)
  const view = (JSON.parse(await staged.json('series.start', { teamA: A, teamB: B, format: 'bo1', seed: 3 })) as { view: { pool: string[] } }).view;
  assert.ok(view.pool.length >= 5);
  for (const map of view.pool) {
    const m = JSON.parse(await staged.json('match.run', { teamA: A, teamB: B, map, seed: 2, recordPerception: false })) as { rounds: unknown[] };
    assert.ok(m.rounds.length >= 13, `${map} played from staged data`);
  }
  // …and every map directory that is staged has the six files the engine opens, or fewer only where the repo has fewer
  const maps = readdirSync(path.join(tmp, 'engine', 'datasets', 'spatial'));
  for (const m of maps) for (const f of [`${m}.navgraph.json`, `${m}.nav.json`, 'coordinate-system.json']) {
    assert.ok(existsSync(path.join(tmp, 'engine', 'datasets', 'spatial', m, f)), `${m}/${f} staged`);
  }
  staged.stop();
});
