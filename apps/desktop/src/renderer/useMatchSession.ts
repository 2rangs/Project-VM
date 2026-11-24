// Interactive (tactical-timeout) match orchestration for Match Day. Wraps the
// Electron session bridge: start a session, play round by round, call timeouts and
// set coach orders, and keep a live Replay (fog/belief), match summary and feed as
// rounds stream in. AI-opponent timeouts are detected by watching B's remaining
// count fall across a round and surfaced to the feed.
import { useCallback, useRef, useState } from 'react';
import { fromSimEventLog, type Replay } from '@pv/replay-engine';
import { bridge } from './platform.ts';
import { ASCENT_TRANSFORM } from '../shared/ascent-transform.ts';
import { mergeMatch, type RawMatch } from '../shared/match-merge.ts';
import type {
  MatchOptions, MatchSummary, SessionState, SessionStartRequest, TeamOrder, TeamSlot, TimeoutLogEntry,
} from '../shared/ipc.ts';
// [manager]
import type { AttackStrategy, DefenseStrategy, ManagerResultView, Shouts, TalkReaction, TeamTalk } from '../shared/manager.ts';

type RawRound = RawMatch['rounds'][number];

export interface SessionFeedItem { round: number; kind: 'round' | 'timeout-ai' | 'timeout-you' | 'end'; text: string }

export interface MatchSessionHook {
  active: boolean;
  state: SessionState | null;
  replay: Replay | null;
  match: MatchSummary | null;
  feed: SessionFeedItem[];
  timeoutLog: TimeoutLogEntry[];
  busy: boolean;
  error: string | null;
  start: (req: SessionStartRequest) => Promise<void>;
  playNext: () => Promise<void>;
  callTimeout: (team: TeamSlot) => Promise<void>;
  setOrders: (team: TeamSlot, order: TeamOrder) => Promise<void>;
  stop: () => Promise<void>;
  // [manager] the manager layer (present when the session is a managed one)
  managerResult: ManagerResultView | null;
  /** The last half-time talk's reactions (ours). */
  talkReactions: TalkReaction[] | null;
  setShouts: (team: TeamSlot, shouts: Partial<Shouts>) => Promise<void>;
  setStrategy: (team: TeamSlot, strategy: { attack?: AttackStrategy; defense?: DefenseStrategy; rounds?: number } | null) => Promise<void>;
  teamTalk: (team: TeamSlot, talk: TeamTalk) => Promise<void>;
}

export function useMatchSession(): MatchSessionHook {
  const [state, setState] = useState<SessionState | null>(null);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [match, setMatch] = useState<MatchSummary | null>(null);
  const [feed, setFeed] = useState<SessionFeedItem[]>([]);
  const [timeoutLog, setTimeoutLog] = useState<TimeoutLogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managerResult, setManagerResult] = useState<ManagerResultView | null>(null); // [manager]
  const [talkReactions, setTalkReactions] = useState<TalkReaction[] | null>(null); // [manager]
  const teamsRef = useRef<RawMatch['teams'] | null>(null);
  const roundsRef = useRef<RawRound[]>([]);
  const setupRef = useRef<{ seed: number; options?: MatchOptions }>({ seed: 0 });

  const rebuild = useCallback((finished: boolean, winner: TeamSlot | null) => {
    const teams = teamsRef.current!;
    const rounds = roundsRef.current;
    const last = rounds[rounds.length - 1];
    const score = last ? last.score : { A: 0, B: 0 };
    const raw: RawMatch = {
      teams, map: 'ascent', seed: setupRef.current.seed,
      winner: (winner ?? (score.A >= score.B ? 'A' : 'B')),
      score, wentToOvertime: rounds.some((r) => r.phase === 'overtime'), rounds,
      ...(setupRef.current.options ? { options: setupRef.current.options } : {}),
    };
    const { events, summary, perception } = mergeMatch(raw);
    setMatch(summary);
    if (events.length > 0) {
      setReplay(fromSimEventLog(events, {
        mapId: 'ascent', mapDisplayName: 'Ascent', seed: 0, coordinateTransform: ASCENT_TRANSFORM,
        matchId: `${teams.A.name} vs ${teams.B.name}`, perception,
      }));
    }
  }, []);

  const start = useCallback(async (req: SessionStartRequest) => {
    setBusy(true); setError(null);
    try {
      teamsRef.current = { A: req.teamA, B: req.teamB };
      roundsRef.current = [];
      setupRef.current = { seed: req.seed, options: req.options };
      setReplay(null); setMatch(null); setFeed([]); setTimeoutLog([]); setManagerResult(null); setTalkReactions(null);
      const s = await bridge.sessionStart(req);
      setState(s);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, []);

  const playNext = useCallback(async () => {
    setBusy(true); setError(null);
    const before = state;
    try {
      const { round, state: s } = await bridge.sessionPlayNextRound();
      roundsRef.current = [...roundsRef.current, round as unknown as RawRound];
      // AI opponent (B) timeout detection: its remaining count fell across this round.
      const aiCalled = before && s.timeoutsRemaining.B < before.timeoutsRemaining.B;
      const r = round as unknown as RawRound;
      setFeed((f) => {
        const add: SessionFeedItem[] = [];
        if (aiCalled) add.push({ round: r.roundNumber, kind: 'timeout-ai', text: `상대(AI) 전술 타임아웃 — R${r.roundNumber}` });
        add.push({ round: r.roundNumber, kind: 'round', text: `R${r.roundNumber} · ${r.winner} 라운드 획득 (${r.reason})` });
        if (s.finished) add.push({ round: r.roundNumber, kind: 'end', text: `경기 종료` });
        return [...f, ...add].slice(-30);
      });
      setState(s);
      rebuild(s.finished, s.finished ? (s.score.A > s.score.B ? 'A' : 'B') : null);
      // result() is valid mid-match, so the timeout/order log stays current each round.
      try { const res = await bridge.sessionResult(); setTimeoutLog(res.timeoutLog); setManagerResult(res.manager ?? null); } catch { /* keep */ }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [state, rebuild]);

  const callTimeout = useCallback(async (team: TeamSlot) => {
    setBusy(true); setError(null);
    try {
      const s = await bridge.sessionCallTimeout(team);
      setState(s);
      const item: SessionFeedItem = { round: s.roundNumber, kind: 'timeout-you', text: `전술 타임아웃 호출 — R${s.roundNumber}` };
      setFeed((f) => [...f, item].slice(-30));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, []);

  const setOrders = useCallback(async (team: TeamSlot, order: TeamOrder) => {
    setBusy(true); setError(null);
    try { setState(await bridge.sessionSetOrders(team, order)); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, []);

  // [manager] standing instructions, strategy for the next rounds, the half-time talk
  const managerAct = useCallback(async (fn: () => Promise<SessionState>) => {
    setBusy(true); setError(null);
    try { setState(await fn()); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, []);
  const setShouts = useCallback((team: TeamSlot, shouts: Partial<Shouts>) => managerAct(() => bridge.sessionSetShouts(team, shouts)), [managerAct]);
  const setStrategy = useCallback((team: TeamSlot, strategy: { attack?: AttackStrategy; defense?: DefenseStrategy; rounds?: number } | null) => managerAct(() => bridge.sessionSetStrategy(team, strategy)), [managerAct]);
  const teamTalk = useCallback((team: TeamSlot, talk: TeamTalk) => managerAct(async () => {
    const r = await bridge.sessionTeamTalk(team, talk);
    setTalkReactions(r.reactions);
    return r.state;
  }), [managerAct]);

  const stop = useCallback(async () => {
    try { await bridge.sessionStop(); } catch { /* */ }
    setManagerResult(null); setTalkReactions(null);
    setState(null); setReplay(null); setMatch(null); setFeed([]); setTimeoutLog([]);
    teamsRef.current = null; roundsRef.current = [];
  }, []);

  return {
    active: state != null, state, replay, match, feed, timeoutLog, busy, error,
    start, playNext, callTimeout, setOrders, stop,
    managerResult, talkReactions, setShouts, setStrategy, teamTalk,
  };
}
