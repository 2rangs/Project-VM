// Pistol engagement diagnostic (PV-2 session A): plays round 1 both ways round (seeds side-swapped so
// roster strength cancels) with traceEngagements on, and reports the opening-duel posture distribution
// that explains the pistol attack rate — first-sight, moving flags, crossfire, info, readyMs — pooled and
// per seed range. Scratch tool, not wired into CI. See docs/handoff/pistol-movement.md §1.
//   npx tsx tools/data-validator/scripts/pistol-engagements.mts --seeds 1..480
import { runMatch, simulatableTeamRefs } from "../../../packages/match-runner/src/index.ts";

const a = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1]! : d; };
const [s0, s1] = arg("seeds", "1..480").split("..").map(Number);
const weaponModes = a.includes("--weapon-modes");
const teams = simulatableTeamRefs();
const side = (id?: string) => (id?.startsWith("atk") ? "attack" : id?.startsWith("def") ? "defense" : undefined);

interface Acc {
  rn: number; rw: number; nE: number;
  aMov: number; dMov: number; aMovDstand: number;
  xAtk: number; xDef: number; iAtk: number; iDef: number;
  atkFirst: number; defFirst: number; mutual: number;
  mutN: number; mutAtkWin: number; rdAtkFirst: number; rdSum: number; rdN: number;
  sumDist: number; nDist: number;
}
const mk = (): Acc => ({ rn: 0, rw: 0, nE: 0, aMov: 0, dMov: 0, aMovDstand: 0, xAtk: 0, xDef: 0, iAtk: 0, iDef: 0, atkFirst: 0, defFirst: 0, mutual: 0, mutN: 0, mutAtkWin: 0, rdAtkFirst: 0, rdSum: 0, rdN: 0, sumDist: 0, nDist: 0 });

function run(lo: number, hi: number): Acc {
  const c = mk();
  for (let s = lo; s <= hi; s++) {
    const i = s - 1;
    const A = teams[(2 * i) % teams.length]!, B = teams[(2 * i + 1) % teams.length]!;
    for (const [ta, tb] of [[A, B], [B, A]] as const) {
      const m = runMatch({ teamA: ta, teamB: tb, map: "Ascent", seed: s, maxRounds: 1, traceEngagements: true, ...(weaponModes ? { weaponModes: true } : {}) });
      const r = m.rounds[0]!;
      c.rn++; if (r.winnerSide === "attack") c.rw++;
      const kills = r.events.filter((e) => e.kind === "kill");
      const engs = (r as unknown as { engagements?: Array<Record<string, unknown>> }).engagements;
      if (!engs?.length) continue;
      for (const e of engs) {
        c.nE++;
        if (e.attackerMoving) c.aMov++;
        if (e.defenderMoving) c.dMov++;
        if (e.attackerMoving && !e.defenderMoving) c.aMovDstand++;
        const xf = e.crossfire as { attacker?: boolean; defender?: boolean } | undefined;
        if (xf?.attacker) c.xAtk++; if (xf?.defender) c.xDef++;
        const info = e.info as { attacker?: boolean; defender?: boolean } | undefined;
        if (info?.attacker) c.iAtk++; if (info?.defender) c.iDef++;
        if (e.firstSight === "attacker") c.atkFirst++;
        else if (e.firstSight === "defender") c.defFirst++;
        else c.mutual++;
      }
      const e0 = engs[0]!;
      c.sumDist += Number(e0.distanceMeters); c.nDist++;
      const rd = e0.readyMs as { attacker: number; defender: number } | undefined;
      if (e0.firstSight === "mutual" && rd) { c.rdN++; const d = rd.attacker - rd.defender; c.rdSum += d; if (d < -1) c.rdAtkFirst++; }
      if (e0.firstSight === "mutual" && kills[0]) { c.mutN++; if (side(kills[0].actor as string) === "attack") c.mutAtkWin++; }
    }
  }
  return c;
}

function report(label: string, c: Acc): void {
  const p = (x: number, d = c.nE) => (d ? (x / d).toFixed(3) : "-");
  console.log(`\n=== ${label} (${c.rn} rounds, ${c.nE} engagements, ${(c.nE / c.rn).toFixed(2)}/round) ===`);
  console.log(`round attack win:  ${p(c.rw, c.rn)}  (${c.rw}/${c.rn})`);
  console.log(`first-eng dist(m): ${(c.sumDist / c.nDist).toFixed(1)}`);
  console.log(`first-sight:       atk ${p(c.atkFirst)} def ${p(c.defFirst)} mutual ${p(c.mutual)}`);
  console.log(`moving:            atk ${p(c.aMov)} def ${p(c.dMov)} | movingAtk-vs-standDef ${p(c.aMovDstand)}`);
  console.log(`crossfire caught:  atk ${p(c.xAtk)} def ${p(c.xDef)}`);
  console.log(`info edge:         atk ${p(c.iAtk)} def ${p(c.iDef)}`);
  console.log(`mutual 1st-eng:    atk fires first ${p(c.rdAtkFirst, c.rdN)} (readyMs atk−def mean ${(c.rdSum / c.rdN).toFixed(1)}ms); atk won duel ${p(c.mutAtkWin, c.mutN)}`);
}

const whole = mk();
for (const [lo, hi] of [[s0!, Math.min(s0! + Math.floor((s1! - s0!) / 3), s1!)]] as const) void lo, hi;
// per-range thirds + pooled
const n = s1! - s0! + 1;
const b1 = s0! + Math.floor(n / 3) - 1, b2 = s0! + Math.floor((2 * n) / 3) - 1;
for (const [lo, hi] of [[s0!, b1], [b1 + 1, b2], [b2 + 1, s1!]] as const) {
  const c = run(lo, hi);
  report(`seeds ${lo}-${hi}${weaponModes ? " [weaponModes]" : ""}`, c);
  for (const k of Object.keys(whole) as (keyof Acc)[]) whole[k] += c[k];
}
report(`POOLED ${s0}-${s1}${weaponModes ? " [weaponModes]" : ""}`, whole);
