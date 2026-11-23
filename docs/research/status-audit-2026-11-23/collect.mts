// usage: tsx collect.mts <seedStart> <count> <out.jsonl> [map] [abilities]
import { writeFileSync, appendFileSync } from "node:fs";
import { runMatch } from "../audit/packages/match-runner/src/index.ts";
import { loadSpatial } from "../audit/packages/match-runner/src/setup.ts";
import * as gd from "../audit/packages/game-data/src/index.ts";
const [s0, n, out, mapArg, ab] = process.argv.slice(2);
const map = mapArg ?? "Ascent";
const teams = (gd as any).listSimulatableTeams().map((t: any) => ({ id: t.id, name: t.name }));
const sp = loadSpatial(map.toLowerCase());
const nav = sp.nav!;
const zcache = new Map<string, string | null>();
const zoneAt = (p: any) => { const k = `${Math.round(p.x/25)},${Math.round(p.y/25)},${Math.round(p.z/50)}`; if (!zcache.has(k)) zcache.set(k, nav.zoneAt(p)); return zcache.get(k)!; };
writeFileSync(out, "");
for (let i = 0; i < Number(n); i++) {
  const seed = Number(s0) + i; const mi = seed - 1;
  const teamA = teams[(2 * mi) % teams.length], teamB = teams[(2 * mi + 1) % teams.length];
  const t0 = performance.now();
  const m = runMatch({ teamA, teamB, map, seed, recordTracks: true, ...(ab ? { enableAbilities: true } : {}) } as any);
  const ms = performance.now() - t0;
  const rows: any[] = [];
  for (const r of m.rounds as any[]) {
    const atkTeam = r.attacker === "A" ? teamA.id : teamB.id, defTeam = r.attacker === "A" ? teamB.id : teamA.id;
    const ev = r.events as any[];
    const end = ev.find((e) => e.kind === "roundEnd");
    const plantedEv = ev.find((e) => e.kind === "planted");
    const kills = ev.filter((e) => e.kind === "kill");
    const side = (id: string) => (id?.startsWith("atk") ? "attack" : "defense");
    // alive tracking, clutch
    let alive = { attack: 5, defense: 5 } as any; let clutch: any = null;
    for (const k of kills) { alive[side(k.target)]--; if (!clutch) for (const s of ["attack", "defense"]) { const o = s === "attack" ? "defense" : "attack"; if (alive[s] === 1 && alive[o] >= 1 && alive[o] >= 1) { clutch = { side: s, vs: alive[o] }; break; } } }
    // movement from replay move events
    const mv = (r.replay.events as any[]).filter((e) => e.kind === "move");
    const byTick = new Map<number, any[]>();
    for (const e of mv) { (byTick.get(e.tick) ?? byTick.set(e.tick, []).get(e.tick)!).push(e); }
    const dead = new Map<string, number>(); for (const k of kills) dead.set(k.target, k.tick);
    const dist: Record<string, number> = {}; const idleRun: Record<string, number> = {}; let longIdle = 0; const idleMax: Record<string, number> = {};
    let overlapTicks = 0, ticks = 0, minPair = Infinity; const lastMoveTick: Record<string, number> = {};
    const objective = r.decisions.plans[r.attacker]?.objective as string | null;
    const target = plantedEv?.zoneId ?? objective;
    const arrive: Record<string, number> = {};
    const pos = new Map<string, any>(); const endTick = end?.tick ?? 0;
    for (const e of byTick.get(0) ?? []) pos.set(e.playerId, e.to);
    const snap: Record<number, Map<string, any>> = {};
    for (let tick = 1; tick <= endTick; tick++) {
      ticks++;
      const es = byTick.get(tick) ?? []; const movedNow = new Set<string>();
      for (const e of es) { const d = Math.hypot(e.to.x - e.from.x, e.to.y - e.from.y); dist[e.playerId] = (dist[e.playerId] ?? 0) + d; pos.set(e.playerId, e.to); movedNow.add(e.playerId); }
      const liveIds = [...pos.keys()].filter((id) => !(dead.has(id) && dead.get(id)! <= tick));
      for (const id of liveIds) {
        if (movedNow.has(id)) { if ((idleRun[id] ?? 0) >= 35) longIdle++; idleRun[id] = 0; }
        else { idleRun[id] = (idleRun[id] ?? 0) + 1; idleMax[id] = Math.max(idleMax[id] ?? 0, idleRun[id]); }
        if (target && id.startsWith("atk") && arrive[id] === undefined && tick % 5 === 0 && zoneAt(pos.get(id)) === target) arrive[id] = tick;
      }
      if (tick === 150 || tick === 300) snap[tick] = new Map(liveIds.map((id) => [id, pos.get(id)]));
      if (tick % 2 === 0) { let ov = false;
        for (let a = 0; a < liveIds.length; a++) for (let b = a + 1; b < liveIds.length; b++) {
          const p = pos.get(liveIds[a]), q = pos.get(liveIds[b]); if (Math.abs(p.z - q.z) > 120) continue;
          const dd = Math.hypot(p.x - q.x, p.y - q.y); if (dd < minPair) minPair = dd; if (dd < 30) ov = true; }
        if (ov) overlapTicks++; }
    }
    let diedMoving = 0;
    for (const k of kills) { const pe = byTick.get(k.tick - 1)?.find((e) => e.playerId === k.target); if (pe && Math.hypot(pe.to.x - pe.from.x, pe.to.y - pe.from.y) >= 1) diedMoving++; }
    const nk: Record<string, number> = {}; const ratios: number[] = []; const routes: string[] = [];
    for (const e of r.navTrace ?? []) { nk[e.kind] = (nk[e.kind] ?? 0) + 1;
      if (e.kind === "planned" && e.waypoints?.length && e.pathLength > 0) { const w = e.waypoints[e.waypoints.length - 1]; const sl = Math.hypot(w.x - e.from.x, w.y - e.from.y); if (sl > 500) ratios.push(e.pathLength / sl); }
      if (e.kind === "planned" && e.playerId.startsWith("atk") && e.zones) routes.push(e.zones.join(">")); }
    // defender setup at 15s
    const defZones = [...(snap[150]?.entries() ?? [])].filter(([id]) => id.startsWith("def")).map(([, p]) => zoneAt(p)).sort();
    const atkZones30 = [...(snap[300]?.entries() ?? [])].filter(([id]) => id.startsWith("atk")).map(([, p]) => zoneAt(p)).sort();
    const arr = Object.values(arrive) as number[];
    rows.push({ seed, round: r.roundNumber, phase: r.phase, atkTeam, defTeam, winnerSide: r.winnerSide, reason: r.reason, planted: r.planted,
      plantZone: plantedEv?.zoneId ?? null, plantMs: plantedEv?.elapsedMs ?? null, endMs: end?.elapsedMs ?? null,
      aliveEnd: alive, killsN: kills.length, firstKill: kills[0] ? side(kills[0].actor) : null, firstKillMs: kills[0]?.elapsedMs ?? null, clutch,
      buyAtk: r.buys[r.attacker].tier, buyDef: r.buys[r.attacker === "A" ? "B" : "A"].tier,
      strategy: r.decisions.plans[r.attacker]?.strategy, objective, feint: r.decisions.plans[r.attacker]?.feint ?? null,
      atkRevisions: r.decisions.plans[r.attacker]?.revisions?.length ?? 0, defRevisions: r.decisions.plans[r.attacker === "A" ? "B" : "A"]?.revisions?.length ?? 0,
      defRotations: (r.decisions.plans[r.attacker === "A" ? "B" : "A"]?.rotations ?? []).map((x: any) => [x.atMs, x.site, x.count]),
      defStrategy: r.decisions.plans[r.attacker === "A" ? "B" : "A"]?.strategy,
      dist, idleMax, longIdle, overlapTicks, ticks, minPair, diedMoving, nav: nk, ratios, routes: [...new Set(routes)].slice(0, 12),
      firstArriveTick: arr.length ? Math.min(...arr) : null, lastArriveTick: arr.length ? Math.max(...arr) : null, arrivedN: arr.length,
      defZones15: defZones, atkZones30, abilityEvents: ev.filter((e) => /cast|smoke|flash|molly|abilit/i.test(e.kind)).length });
  }
  appendFileSync(out, JSON.stringify({ seed, teamA: teamA.id, teamB: teamB.id, winner: m.winner, score: m.score, ot: m.wentToOvertime, ms, rss: process.memoryUsage().rss, rows }) + "\n");
}
