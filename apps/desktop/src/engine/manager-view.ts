// Projection of the managed session's manager layer onto OUR seat (src/shared/manager.ts), shared
// by match-session.ts (seat = engine slot) and series-session.ts (seat ≠ slot on some maps).
import type { ManagedSessionResult, ManagerState } from '../../../../packages/match-runner/src/index.ts';

type Slot = 'A' | 'B';
/** seatOf(engineSlot) → our seat; slotOf(seat) → engine slot. */
export interface SeatMap { seatOf: (s: Slot) => Slot; slotOf: (s: Slot) => Slot }
export const IDENTITY: SeatMap = { seatOf: (s) => s, slotOf: (s) => s };

const bySeat = <T,>(m: SeatMap, rec: Readonly<Record<Slot, T>>): Record<Slot, T> => ({ A: rec[m.slotOf('A')], B: rec[m.slotOf('B')] });

export function managerView(st: ManagerState, m: SeatMap = IDENTITY) {
  return {
    half: st.half,
    timeoutsLeftThisHalf: bySeat(m, st.timeoutsLeftThisHalf),
    shouts: bySeat(m, st.shouts),
    minds: bySeat(m, st.minds),
    alerts: st.alerts.map((a) => ({ ...a, team: m.seatOf(a.team) })),
    halfTime: st.halfTime ? { pending: bySeat(m, st.halfTime.pending), situation: bySeat(m, st.halfTime.situation) } : null,
    strategy: bySeat(m, st.strategy),
    pendingPlanOptions: bySeat(m, st.pendingPlanOptions),
  };
}

export function managerResultView(r: ManagedSessionResult, m: SeatMap = IDENTITY) {
  return {
    decisions: r.decisions.map((d) => ({ ...d, team: m.seatOf(d.team), before: { ...d.before, score: bySeat(m, d.before.score) } })),
    minds: bySeat(m, r.minds),
    tiltByRound: bySeat(m, r.tiltByRound),
  };
}
