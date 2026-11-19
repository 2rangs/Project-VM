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
  MatchSummary, SessionState, SessionStartRequest, TeamOrder, TeamSlot, TimeoutLogEntry,
} from '../shared/ipc.ts';

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
}

export function useMatchSession(): MatchSessionHook {
  const [state, setState] = useState<SessionState | null>(null);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [match, setMatch] = useState<MatchSummary | null>(null);
  const [feed, setFeed] = useState<SessionFeedItem[]>([]);
  const [timeoutLog, setTimeoutLog] = useState<TimeoutLogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const teamsRef = useRef<RawMatch['teams'] | null>(null);
  const roundsRef = useRef<RawRound[]>([]);

  const rebuild = useCallback((finished: boolean, winner: TeamSlot | null) => {
    const teams = teamsRef.current!;
    const rounds = roundsRef.current;
    const last = rounds[rounds.length - 1];
    const score = last ? last.score : { A: 0, B: 0 };
    const raw: RawMatch = {
      teams, map: 'ascent', seed: 0,
      winner: (winner ?? (score.A >= score.B ? 'A' : 'B')),
      score, wentToOvertime: rounds.some((r) => r.phase === 'overtime'), rounds,
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
      setReplay(null); setMatch(null); setFeed([]); setTimeoutLog([]);
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
      try { setTimeoutLog((await bridge.sessionResult()).timeoutLog); } catch { /* keep */ }
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

  const stop = useCallback(async () => {
    try { await bridge.sessionStop(); } catch { /* */ }
    setState(null); setReplay(null); setMatch(null); setFeed([]); setTimeoutLog([]);
    teamsRef.current = null; roundsRef.current = [];
  }, []);

  return {
    active: state != null, state, replay, match, feed, timeoutLog, busy, error,
    start, playNext, callTimeout, setOrders, stop,
  };
}
