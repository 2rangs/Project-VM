// Live match screen — what Match Day shows while a match is being played or watched.
// A full-window "broadcast" layout with two view modes over one persistent PixiJS stage:
//
//   tactical map  the map in the centre and largest; our roster left, opponent + kill feed
//                 right, score/clock on top, transport + coach actions at the bottom.
//   team cams     a wall of six monitors — one per player of OUR team, centred on and rotated
//                 with that player, showing only what they see and hear — plus the team's
//                 shared picture. Click a monitor to focus it.
//
// The coach view is our team's fog of war: our own players, what they observe, what the team
// remembers, what it hears. The opponent's real positions are never drawn unless a player of
// ours sees them. (The fog POV can be switched to the opponent for debugging, as before.)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Replay } from '@pv/replay-engine';
import { valorantApiMinimap } from '@pv/replay-viewer';
import type { MatchSummary, SessionState, TeamOrder, TimeoutLogEntry } from '../../../shared/ipc.ts';
import { ASCENT_TRANSFORM } from '../../../shared/ascent-transform.ts';
import navgraph from '../../../data/sim/ascent.navgraph.json';
import { useT } from '../../i18n/index.tsx';
import { OrdersPanel } from '../OrdersPanel.tsx';
import type { SessionFeedItem } from '../../useMatchSession.ts';
import { buildNav, type NavData } from '../../matchday/nav.ts';
import {
  buildTimeline, playerIdFor, roundIndexAt, roundOver, scoreAt, teamOfId, slotOfId,
  type MatchTimeline, type RoundTimeline, type TeamSlot,
} from '../../matchday/timeline.ts';
import { computeFrame, type Frame } from '../../matchday/frame.ts';
import { formatClock } from '../../matchday/monitor.ts';
import { loadPrefs, savePrefs, type MatchPrefs } from '../../matchday/prefs.ts';
import { rosterHandles } from '../../matchday/roster.ts';
import { usePlayback } from '../../matchday/usePlayback.ts';
import { MatchStage, type StageView } from './MatchStage.ts';
import { AllyPanel, Banners, BottomBar, EnemyPanel, IntelPanel, KillFeed, OrderChip, RoundResult, TopHud, statusText } from './Hud.tsx';
import './matchday.css';

const nav = buildNav(navgraph as unknown as NavData);
const EMPTY: MatchTimeline = { rounds: [], startMs: 0, endMs: 0, hasTracks: false };
const OUR_TEAM: TeamSlot = 'A';
const CAM_SLOTS = [1, 2, 3, 4, 5] as const;

/** Where the viewer was when they left the screen, so re-opening the same match resumes there. */
let resume: { stamp: string; tMs: number } | null = null;

export interface LiveSession {
  state: SessionState;
  busy: boolean;
  error: string | null;
  feed: SessionFeedItem[];
  timeoutLog: TimeoutLogEntry[];
  ordersOpen: boolean;
  onNext: () => void;
  onTimeout: () => void;
  onConfirmOrders: (o: TeamOrder) => void;
  onCancelOrders: () => void;
}

export interface LiveMatchProps {
  replay: Replay | null;
  match: MatchSummary | null;
  teams: MatchSummary['teams'];
  sourceLabel: string;
  /** Present in interactive (round-by-round) mode. */
  session: LiveSession | null;
  autoPlay: boolean;
  onAutoPlay: (v: boolean) => void;
  onExit: () => void;
  onReview: (() => void) | null;
}

interface ViewSpec { key: string; slot: number | null; detail: 'full' | 'compact' }

export function LiveMatch({ replay, match, teams, sourceLabel, session, autoPlay, onAutoPlay, onExit, onReview }: LiveMatchProps) {
  const t = useT();
  const [prefs, setPrefs] = useState<MatchPrefs>(loadPrefs);
  const [pov, setPov] = useState<TeamSlot>(OUR_TEAM);
  const [focus, setFocus] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mapOk, setMapOk] = useState<boolean | null>(null);
  const update = useCallback((patch: Partial<MatchPrefs>) => setPrefs((p) => { const n = { ...p, ...patch }; savePrefs(n); return n; }), []);

  const tl = useMemo(() => (replay ? buildTimeline(replay, match, nav) : EMPTY), [replay, match]);
  const playback = usePlayback(tl, prefs.tempo);
  const { seek } = playback;

  const mode = prefs.mode;
  // The monitors are always OUR players; the debug POV only applies to the tactical map.
  const viewTeam: TeamSlot = mode === 'cams' ? OUR_TEAM : pov;
  const hasPerception = !!replay?.perception?.length;

  const round: RoundTimeline | null = tl.rounds.length > 0 ? tl.rounds[roundIndexAt(tl, playback.tMs)] : null;
  const latest = tl.rounds[tl.rounds.length - 1] ?? null;
  const frame: Frame | null = useMemo(
    () => (replay && tl.rounds.length > 0 ? computeFrame(replay, tl, nav, viewTeam, playback.tMs) : null),
    [replay, tl, viewTeam, playback.tMs],
  );
  const over = !!round && roundOver(round, playback.tMs);
  const atLiveEdge = !!round && round === latest && over;
  const score = useMemo(() => scoreAt(tl, playback.tMs), [tl, playback.tMs]);

  const handles = useMemo(() => ({ A: rosterHandles(teams.A.id), B: rosterHandles(teams.B.id) }), [teams.A.id, teams.B.id]);
  const attacker = round?.attacker ?? 'A';
  const nameOf = useCallback((id: string) => handles[teamOfId(id, attacker)][slotOfId(id) - 1] ?? id, [handles, attacker]);
  const zoneName = useCallback((id: string | null | undefined) => (id ? (nav.zone(id)?.name ?? id).toUpperCase() : '—'), []);

  // ── round flow ───────────────────────────────────────────────────────────────────────────
  // A new replay either extends the live session by one round (play it) or is a fresh match.
  const seenRounds = useRef(0);
  const seenReplay = useRef<Replay | null>(null);
  useEffect(() => {
    if (!replay || tl.rounds.length === 0) { seenRounds.current = 0; seenReplay.current = replay; return; }
    if (seenReplay.current === replay) return;
    const stamp = `${replay.meta.generatedAt}:${tl.rounds.length}`;
    const first = seenReplay.current === null && seenRounds.current === 0;
    if (first && resume?.stamp === stamp) seek(resume.tMs, { play: false });
    else if (session) seek(tl.rounds[tl.rounds.length - 1].startMs, { play: true });
    else seek(tl.rounds[0].startMs, { play: true });
    seenRounds.current = tl.rounds.length;
    seenReplay.current = replay;
  }, [replay, tl, session, seek]);
  useEffect(() => () => {
    const r = seenReplay.current;
    if (r) resume = { stamp: `${r.meta.generatedAt}:${seenRounds.current}`, tMs: playback.now() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-advance: next round of the session, or the next recorded round when just watching.
  const finished = session?.state.finished ?? false;
  const idx = round ? tl.rounds.indexOf(round) : -1;
  useEffect(() => {
    if (!autoPlay || !over || playback.playing) return;
    const id = setTimeout(() => {
      const next = tl.rounds[idx + 1];
      if (next) seek(next.startMs, { play: true });
      else if (session && !finished && !session.busy && !session.ordersOpen) session.onNext();
    }, 1800);
    return () => clearTimeout(id);
  }, [autoPlay, over, playback.playing, idx, tl, session, finished, seek]);
  // Session start with auto-play on and nothing played yet.
  useEffect(() => {
    if (!autoPlay || !session || tl.rounds.length > 0 || session.busy || session.ordersOpen || finished) return;
    const id = setTimeout(() => session.onNext(), 900);
    return () => clearTimeout(id);
  }, [autoPlay, session, tl.rounds.length, finished]);

  // Opponent timeouts surface as a short toast (they change what you are about to face).
  const feedLen = useRef(session?.feed.length ?? 0);
  useEffect(() => {
    const feed = session?.feed ?? [];
    const fresh = feed.slice(feedLen.current);
    feedLen.current = feed.length;
    if (fresh.some((f) => f.kind === 'timeout-ai')) {
      setToast(t('mdx.toast.oppTimeout', { name: teams.B.name }));
      const id = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [session?.feed, t, teams.B.name]);

  const togglePlay = useCallback(() => {
    if (!round) return;
    if (!playback.playing && roundOver(round, playback.now())) {
      const next = tl.rounds[tl.rounds.indexOf(round) + 1];
      seek(next ? next.startMs : round.startMs, { play: true });
    } else playback.toggle();
  }, [round, playback, tl, seek]);
  const callTimeout = useCallback(() => {
    if (latest) seek(latest.endMs, { play: false }); // timeouts are called between rounds
    session?.onTimeout();
  }, [latest, seek, session]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.code === 'ArrowLeft') seek(playback.now() - 5000);
      else if (e.code === 'ArrowRight' && round) seek(Math.min(round.endMs, playback.now() + 5000));
      else if (e.code === 'KeyM') update({ mode: mode === 'tactical' ? 'cams' : 'tactical' });
      else if (e.code === 'Escape' && focus) setFocus(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, seek, playback, round, update, mode, focus]);

  // ── stage ────────────────────────────────────────────────────────────────────────────────
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<MatchStage | null>(null);
  const viewEls = useRef(new Map<string, HTMLElement>());
  const setViewEl = useCallback((key: string) => (el: HTMLElement | null) => { if (el) viewEls.current.set(key, el); else viewEls.current.delete(key); }, []);

  const specs: ViewSpec[] = useMemo(() => (
    mode === 'tactical'
      ? [{ key: 'map', slot: null, detail: 'full' as const }]
      : [
          ...CAM_SLOTS.map((slot) => ({ key: `cam${slot}`, slot, detail: focus === `cam${slot}` ? 'full' as const : 'compact' as const })),
          { key: 'team', slot: null, detail: focus === 'team' ? 'full' as const : 'compact' as const },
        ]
  ), [mode, focus]);

  const liveRef = useRef({ replay, tl, viewTeam, specs, belief: prefs.belief, nameOf, version: 0 });
  liveRef.current = { replay, tl, viewTeam, specs, belief: prefs.belief, nameOf, version: liveRef.current.version + 1 };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const stage = new MatchStage(nav, replay?.meta.coordinateTransform ?? ASCENT_TRANSFORM);
    stageRef.current = stage;
    let alive = true;
    void stage.init(host).then(async () => {
      const url = await valorantApiMinimap('Ascent');
      const ok = await stage.setMap(url);
      if (alive) setMapOk(ok);
    });
    const ro = new ResizeObserver(() => stage.resize(host.clientWidth, host.clientHeight));
    ro.observe(host);
    return () => { alive = false; ro.disconnect(); stage.destroy(); stageRef.current = null; };
    // The stage is created once per screen; the transform does not change within a match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let lastSig = '';
    return playback.subscribe((tMs) => {
      const stage = stageRef.current; const host = hostRef.current;
      if (!stage?.isReady || !host) return;
      const L = liveRef.current;
      const base = host.getBoundingClientRect();
      const frameNow = L.replay && L.tl.rounds.length > 0 ? computeFrame(L.replay, L.tl, nav, L.viewTeam, tMs) : null;
      const views: StageView[] = [];
      let sig = `${tMs}|${L.version}|${mapOk}`;
      for (const s of L.specs) {
        const el = viewEls.current.get(s.key);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        const followId = s.slot != null && frameNow ? playerIdFor(OUR_TEAM, s.slot, frameNow.round.attacker) : null;
        views.push({ key: s.key, x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height, followId, detail: s.detail });
        sig += `|${s.key}:${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
      }
      if (sig === lastSig) return; // paused and nothing moved: keep the last picture
      lastSig = sig;
      stage.render(frameNow, views, { showBelief: L.belief, nameOf: L.nameOf });
    });
  }, [playback.subscribe, mapOk]);

  // ── derived HUD bits ─────────────────────────────────────────────────────────────────────
  const st = session?.state ?? null;
  const preRound = !!session && tl.rounds.length === 0;
  const nextRound = st && !st.finished && (preRound || atLiveEdge) ? { roundNumber: st.roundNumber, attacker: st.attacker } : null;
  const bankOf = (team: TeamSlot) => {
    if (st && (preRound || atLiveEdge)) return { credits: st.economy[team].credits, ultPoints: st.economy[team].ultPoints };
    const prev = round ? tl.rounds[tl.rounds.indexOf(round) - (over ? 0 : 1)]?.summary : null;
    return prev ? prev.economy[team] : null;
  };
  const resultHint = !over ? null
    : st ? (st.finished ? t('mdx.hint.finished') : atLiveEdge ? t('mdx.hint.between') : null)
    : idx < tl.rounds.length - 1 ? t('mdx.hint.watchNext') : t('mdx.hint.finished');
  const enemyTeam: TeamSlot = viewTeam === 'A' ? 'B' : 'A';
  // The order our coach set for the round on screen (orders are logged against the round they precede).
  const orderRound = nextRound?.roundNumber ?? round?.roundNum ?? 0;
  const activeOrder = viewTeam === OUR_TEAM
    ? session?.timeoutLog.find((e) => e.team === OUR_TEAM && e.by === 'human' && e.round === orderRound)?.order ?? null
    : null;

  const overlays = (
    <>
      <Banners t={t} frame={frame} nameOf={nameOf} viewTeam={viewTeam} />
      {round && over && !session?.ordersOpen && <RoundResult t={t} round={round} viewTeam={viewTeam} score={score} teams={teams} hint={resultHint} />}
      {preRound && !session!.ordersOpen && (
        <div className="mdx-result neutral" data-testid="pre-match">
          <span className="mdx-result-kicker">{teams.A.name} vs {teams.B.name}</span>
          <strong>{t('mdx.pre.title')}</strong>
          <span className="mdx-result-hint">{t('mdx.pre.hint')}</span>
        </div>
      )}
      {toast && <div className="mdx-toast" role="status">{toast}</div>}
      {session?.error && <div className="mdx-toast err" role="alert">⚠ {session.error}</div>}
      {replay && tl.rounds.length > 0 && !tl.hasTracks && <div className="mdx-toast warn">{t('mdx.noTracks')}</div>}
    </>
  );

  return (
    <div className={`mdx mode-${mode}`} data-testid="live-match" data-mode={mode}>
      <TopHud
        t={t} mode={mode} onMode={(m) => update({ mode: m })} onExit={onExit} onReview={onReview}
        teams={teams} viewTeam={viewTeam} score={score} frame={frame} round={round} nextRound={nextRound}
        pov={pov} onPov={setPov} povLocked={mode === 'cams'} belief={prefs.belief} onBelief={(v) => update({ belief: v })}
        hasPerception={hasPerception} sourceLabel={sourceLabel} mapName={replay?.meta.mapDisplayName ?? 'Ascent'} seed={match?.seed ?? replay?.meta.seed ?? null}
      />

      <div className="mdx-body">
        <div className="mdx-canvas" ref={hostRef} data-testid="pixi-stage" />

        {mode === 'tactical' ? (
          <div className="mdx-tac">
            <AllyPanel t={t} frame={frame} teamName={teams[viewTeam].name} nameOf={nameOf} zoneName={zoneName} bank={bankOf(viewTeam)}>
              <OrderChip t={t} order={activeOrder} />
              <IntelPanel t={t} frame={frame} nameOf={nameOf} zoneName={zoneName} />
            </AllyPanel>
            <div className="mdx-mapcol">
              <div className="mdx-map" ref={setViewEl('map')} data-testid="tactical-map">
                {overlays}
                {mapOk === false && <span className="mdx-maphint">{t('mdx.mapOffline')}</span>}
                <div className="mdx-legend" aria-hidden>
                  <span><i className="lg ally" />{t('mdx.legend.ally')}</span>
                  <span><i className="lg enemy" />{t('mdx.legend.enemy')}</span>
                  <span><i className="lg ghost" />{t('mdx.legend.ghost')}</span>
                  <span><i className="lg sound" />{t('mdx.legend.sound')}</span>
                </div>
              </div>
            </div>
            <EnemyPanel t={t} frame={frame} teamName={teams[enemyTeam].name} nameOf={nameOf} zoneName={zoneName} bank={bankOf(enemyTeam)}>
              <KillFeed t={t} frame={frame} nameOf={nameOf} zoneName={zoneName} />
            </EnemyPanel>
          </div>
        ) : (
          <div className="mdx-cams">
            <div className={`mdx-wall ${focus ? 'has-focus' : ''}`} data-testid="cam-wall">
              {CAM_SLOTS.map((slot) => {
                const key = `cam${slot}`;
                const unit = frame?.units.find((u) => u.slot === slot) ?? null;
                const state = unit?.status.state ?? 'holding';
                return (
                  <button key={key} className={`mdx-mon st-${state} ${focus === key ? 'focus' : ''}`} ref={setViewEl(key)}
                    onClick={() => setFocus(focus === key ? null : key)} data-testid={`cam-${slot}`} aria-pressed={focus === key}
                    title={focus === key ? t('mdx.cam.unfocus') : t('mdx.cam.focus')}>
                    <span className="mdx-osd tl"><b>CAM {String(slot).padStart(2, '0')}</b>{unit ? nameOf(unit.id) : handles[OUR_TEAM][slot - 1]}</span>
                    <span className="mdx-osd tr">
                      {state === 'dead' ? <em className="lost">{t('mdx.cam.offline')}</em> : <em className="live"><i />{t('mdx.cam.live')}</em>}
                      {round ? `R${round.roundNum} ${formatClock(playback.tMs - round.startMs).padStart(4, '0')}` : ''}
                    </span>
                    <span className="mdx-osd bl">
                      {unit ? <><i className={`mdx-statedot st-${state}`} />{statusText(t, unit.status, zoneName, nameOf)}</> : t('mdx.waiting')}
                    </span>
                    <span className="mdx-osd br">
                      {unit && unit.pose.alive ? <>{zoneName(unit.pose.zone)}{unit.view.enemies.length > 0 && <em className="contact">{t('mdx.cam.contact', { n: unit.view.enemies.length })}</em>}</> : ''}
                    </span>
                    {state === 'dead' && (
                      <span className="mdx-lost">
                        <strong>{t('mdx.cam.signalLost')}</strong>
                        <small>{unit?.status.opponentId ? t('mdx.cam.killedBy', { name: nameOf(unit.status.opponentId), zone: zoneName(unit.status.zone) }) : ''}</small>
                      </span>
                    )}
                    {(state === 'planting' || state === 'defusing') && <i className="mdx-monbar" style={{ width: `${Math.round((unit?.status.progress ?? 0) * 100)}%` }} />}
                  </button>
                );
              })}
              <button className={`mdx-mon team ${focus === 'team' ? 'focus' : ''}`} ref={setViewEl('team')}
                onClick={() => setFocus(focus === 'team' ? null : 'team')} data-testid="cam-team" aria-pressed={focus === 'team'}>
                <span className="mdx-osd tl"><b>TEAM</b>{t('mdx.cam.team')}</span>
                <span className="mdx-osd tr"><em className="live"><i />{t('mdx.cam.live')}</em></span>
                <span className="mdx-osd bl">{frame ? t('mdx.cam.teamLine', { seen: frame.seen.length, ghosts: frame.ghosts.length, sounds: frame.sounds.length }) : t('mdx.waiting')}</span>
              </button>
              <div className="mdx-wall-overlay">{overlays}</div>
            </div>
            <EnemyPanel t={t} frame={frame} teamName={teams[enemyTeam].name} nameOf={nameOf} zoneName={zoneName} bank={bankOf(enemyTeam)}>
              <KillFeed t={t} frame={frame} nameOf={nameOf} zoneName={zoneName} />
            </EnemyPanel>
          </div>
        )}

        {session?.ordersOpen && (
          <div className="mdx-modal" role="dialog" aria-modal="true" aria-label={t('orders.title')}>
            <div className="mdx-modal-card">
              <div className="mdx-modal-kicker">{t('mdx.timeout.kicker', { n: session.state.roundNumber })}</div>
              <OrdersPanel state={session.state} match={match} team="A" onConfirm={session.onConfirmOrders} onCancel={session.onCancelOrders} />
            </div>
          </div>
        )}
      </div>

      <BottomBar
        t={t} tl={tl} round={round} tMs={playback.tMs} playing={playback.playing} onToggle={togglePlay}
        tempo={prefs.tempo} onTempo={(v) => update({ tempo: v })} onSeek={(ms) => seek(ms, { play: false })}
        onRound={(r) => seek(r.startMs, { play: true })} viewTeam={viewTeam}
        session={session ? { state: session.state, busy: session.busy, ordersOpen: session.ordersOpen } : null}
        autoPlay={autoPlay} onAutoPlay={onAutoPlay} onNext={() => session?.onNext()} onTimeout={callTimeout} canAdvance={atLiveEdge || preRound}
      />
    </div>
  );
}
