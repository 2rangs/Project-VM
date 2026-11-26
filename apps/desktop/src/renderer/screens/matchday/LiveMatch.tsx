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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Replay } from '@pv/replay-engine';
import type { MatchSummary, SessionState, TeamOrder, TimeoutLogEntry } from '../../../shared/ipc.ts';
import { ASCENT_TRANSFORM } from '../../../shared/ascent-transform.ts';
import navgraph from '../../../data/sim/ascent.navgraph.json';
import roadmapData from '../../../data/sim/ascent.nav.json';
import { useT } from '../../i18n/index.tsx';
import { OrdersPanel } from '../OrdersPanel.tsx';
import type { SessionFeedItem } from '../../useMatchSession.ts';
import { buildNav, type NavData } from '../../matchday/nav.ts';
import {
  buildTimeline, displayPos, playerIdFor, roundIndexAt, roundOver, scoreAt, teamOfId, slotOfId,
  type MatchTimeline, type RoundTimeline, type TeamSlot,
} from '../../matchday/timeline.ts';
import { computeFrame, type Frame } from '../../matchday/frame.ts';
import { buildRoadmap, navDebugAt, type NavDebugFrame, type RoadmapData } from '../../matchday/navdebug.ts';
import { eventJump, formatClock } from '../../matchday/monitor.ts';
import { loadPrefs, savePrefs, type MatchPrefs } from '../../matchday/prefs.ts';
import { rosterHandles } from '../../matchday/roster.ts';
import { usePlayback } from '../../matchday/usePlayback.ts';
import { MatchStage, type StageView } from './MatchStage.ts';
import type { CamStage3D } from './CamStage3D.ts';
import type { CamView } from './cams3d-loader.ts';
import { createCamStage3D, type PlantZone } from './cams3d-loader.ts';
import { useGraphics } from '../../settings/graphics.tsx';
import { preloadMatchAssets, preparedMesh, preparedMinimapUrl, useMatchAssets } from './assets.ts';
import { AgentTag, AllyPanel, Banners, BuyReasonPanel, BottomBar, EnemyPanel, IntelPanel, KillFeed, MatchupStrip, OrderChip, RoundResult, TopHud, statusText } from './Hud.tsx';
import { Icon, STATE_ICON } from './Icons.tsx';
import { LoadingInline } from '../../loading/Loading.tsx';
import './matchday.css';

const nav = buildNav(navgraph as unknown as NavData);
const PLANT_ZONES: PlantZone[] = (navgraph as unknown as { plantZones?: PlantZone[] }).plantZones ?? [];
/** The engine's navigation roadmap (the floor players walk on) — drawn by the developer overlay. */
const roadmap = buildRoadmap(roadmapData as unknown as RoadmapData);
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
  /** [manager] In-match manager controls drawn over the stage (screens/matchday/ManagerPanel.tsx). */
  managerOverlay?: ReactNode;
}

/** A rectangle of the stage: `map2d` views are drawn by PixiJS, `cam3d` views by three.js. */
interface ViewSpec { key: string; slot: number | null; detail: 'full' | 'compact'; kind: 'map2d' | 'cam3d' }

export function LiveMatch({ replay, match, teams, sourceLabel, session, autoPlay, onAutoPlay, onExit, onReview, managerOverlay }: LiveMatchProps) {
  const t = useT();
  const { config: gfx } = useGraphics();
  const [prefs, setPrefs] = useState<MatchPrefs>(loadPrefs);
  const [pov, setPov] = useState<TeamSlot>(OUR_TEAM);
  const [focus, setFocus] = useState<string | null>(null);
  const [selSlot, setSelSlot] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mapOk, setMapOk] = useState<boolean | null>(null);
  const [showGraph, setShowGraph] = useState(false); // developer: navigation debug overlay (never on by default, not persisted)
  const update = useCallback((patch: Partial<MatchPrefs>) => setPrefs((p) => { const n = { ...p, ...patch }; savePrefs(n); return n; }), []);

  const tl = useMemo(() => (replay ? buildTimeline(replay, match, nav) : EMPTY), [replay, match]);
  const playback = usePlayback(tl, prefs.tempo, gfx.fpsCap);
  const { seek } = playback;

  // Low graphics drops the 3D team cams entirely: the view is pinned to the tactical 2D map.
  const mode = gfx.cams3d ? prefs.mode : 'tactical';
  // The monitors are always OUR players; the debug POV only applies to the tactical map.
  const viewTeam: TeamSlot = mode === 'cams' ? OUR_TEAM : pov;
  const hasPerception = !!replay?.perception?.length;

  const round: RoundTimeline | null = tl.rounds.length > 0 ? tl.rounds[roundIndexAt(tl, playback.tMs)] : null;
  const latest = tl.rounds[tl.rounds.length - 1] ?? null;
  const frame: Frame | null = useMemo(
    () => (replay && tl.rounds.length > 0 ? computeFrame(replay, tl, nav, viewTeam, playback.tMs) : null),
    [replay, tl, viewTeam, playback.tMs],
  );
  // Developer view: what the navigation layer planned for the viewed team at this instant.
  const navDebug: NavDebugFrame | null = useMemo(
    () => (showGraph && round ? navDebugAt(round, viewTeam, playback.tMs, (p) => displayPos(p, playback.tMs), (id) => nav.zone(id)?.name ?? id) : null),
    [showGraph, round, viewTeam, playback.tMs],
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
    else if (session) seek(tl.rounds[tl.rounds.length - 1].buyStartMs, { play: true });
    else seek(tl.rounds[0].buyStartMs, { play: true });
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
      if (next) seek(next.buyStartMs, { play: true });
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

  // How far each round has been watched: the timeline only marks events up to there.
  const watched = useRef(new Map<number, number>());
  if (round) watched.current.set(round.roundNum, Math.max(watched.current.get(round.roundNum) ?? round.buyStartMs, playback.tMs));
  const watchedTo = round ? watched.current.get(round.roundNum) ?? round.buyStartMs : 0;
  const jumpEvent = useCallback((dir: 1 | -1) => {
    if (!round) return;
    const to = eventJump(round, playback.now(), dir);
    if (to != null) seek(to);
  }, [round, playback, seek]);
  const skipToEnd = useCallback(() => { if (round) seek(round.endMs, { play: false }); }, [round, seek]);

  const togglePlay = useCallback(() => {
    if (!round) return;
    if (!playback.playing && roundOver(round, playback.now())) {
      const next = tl.rounds[tl.rounds.indexOf(round) + 1];
      seek(next ? next.buyStartMs : round.buyStartMs, { play: true });
    } else playback.toggle();
  }, [round, playback, tl, seek]);
  const callTimeout = useCallback(() => {
    if (latest) seek(latest.endMs, { play: false }); // timeouts are called between rounds
    session?.onTimeout();
  }, [latest, seek, session]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      const ours = e.code === 'Space' || e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'KeyM';
      // A HUD button keeps focus after a click; playback keys must not re-activate it.
      if (ours && el?.tagName === 'BUTTON') { e.preventDefault(); el.blur(); }
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.code === 'ArrowLeft') jumpEvent(-1);
      else if (e.code === 'ArrowRight') jumpEvent(1);
      else if (e.code === 'KeyM' && gfx.cams3d) update({ mode: mode === 'tactical' ? 'cams' : 'tactical' });
      else if (e.code === 'Escape') { if (focus) setFocus(null); else setSelSlot(null); }
      else if (/^Digit[1-5]$/.test(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey) { const n = Number(e.code.slice(5)); setSelSlot((c) => (c === n ? null : n)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, jumpEvent, update, mode, focus, gfx.cams3d]);

  // ── stage ────────────────────────────────────────────────────────────────────────────────
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<MatchStage | null>(null);
  const viewEls = useRef(new Map<string, HTMLElement>());
  const setViewEl = useCallback((key: string) => (el: HTMLElement | null) => { if (el) viewEls.current.set(key, el); else viewEls.current.delete(key); }, []);
  // View rectangles are measured only when the layout can have changed (window resize, or a React
  // re-render that bumps `version`) — never every frame. getBoundingClientRect forces a layout
  // sync, so calling it per frame while a round plays was pure overhead on weak hardware.
  const layoutNonce = useRef(0);
  const layoutCache = useRef<{ specs: ViewSpec[] | null; nonce: number; rects: Array<{ s: ViewSpec; rect: { x: number; y: number; w: number; h: number } }> }>({ specs: null, nonce: -1, rects: [] });

  const specs: ViewSpec[] = useMemo(() => (
    mode === 'tactical'
      ? [{ key: 'map', slot: null, detail: 'full' as const, kind: 'map2d' as const }]
      : [
          // each monitor: a first-person 3D view plus a small 2D radar inset centred on the player
          ...CAM_SLOTS.map((slot) => ({ key: `cam${slot}`, slot, detail: 'compact' as const, kind: 'cam3d' as const })),
          ...CAM_SLOTS.map((slot) => ({ key: `radar${slot}`, slot, detail: 'compact' as const, kind: 'map2d' as const })),
          { key: 'team', slot: null, detail: focus === 'team' ? 'full' as const : 'compact' as const, kind: 'map2d' as const },
        ]
  ), [mode, focus]);

  const highlightId = selSlot != null ? frame?.units.find((u) => u.slot === selSlot)?.id ?? null : null;
  const liveRef = useRef({ replay, tl, viewTeam, specs, belief: prefs.belief, highlightId, showGraph, nameOf, version: 0 });
  liveRef.current = { replay, tl, viewTeam, specs, belief: prefs.belief, highlightId, showGraph, nameOf, version: liveRef.current.version + 1 };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const stage = new MatchStage(nav, replay?.meta.coordinateTransform ?? ASCENT_TRANSFORM);
    stage.setRoadmap(roadmap);
    stageRef.current = stage;
    let alive = true;
    void stage.init(host, { dprMax: gfx.dprMax, antialias: !gfx.minAnim }).then(async () => {
      await preloadMatchAssets('ascent', 20000, gfx.cams3d); // normally already settled: the loading screen waited for it
      const ok = await stage.setMap(preparedMinimapUrl());
      if (alive) setMapOk(ok);
    });
    const ro = new ResizeObserver(() => { layoutNonce.current++; stage.resize(host.clientWidth, host.clientHeight); });
    ro.observe(host);
    return () => { alive = false; ro.disconnect(); stage.destroy(); stageRef.current = null; };
    // The stage is created once per screen; the transform does not change within a match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // three.js stage for the cams. The whole 3D stack (three.js, models, blockout) is lazily imported
  // and the stage is built only when the graphics quality offers the cams — on low it never loads.
  // Given the map mesh the loading screen already prepared, opening the cams starts no load.
  const host3dRef = useRef<HTMLDivElement>(null);
  const camStageRef = useRef<CamStage3D | null>(null);
  const [cam3dReady, setCam3dReady] = useState(false);
  const assets = useMatchAssets();
  const [mapMesh, setMapMesh] = useState<'blockout' | 'glb'>('blockout');
  useEffect(() => {
    if (!gfx.cams3d) return; // low graphics: no 3D wall at all
    const host = host3dRef.current;
    if (!host) return;
    let alive = true; let ro: ResizeObserver | null = null;
    void createCamStage3D(nav, PLANT_ZONES, { dprMax: gfx.dprMax, shadows: gfx.shadows, fpsCap: gfx.fpsCap }).then((stage) => {
      if (!alive) { stage.destroy(); return; }
      stage.init(host);
      camStageRef.current = stage;
      (window as unknown as { __mdxPerf?: unknown }).__mdxPerf = stage.perf;
      void preloadMatchAssets('ascent', 20000, true); // covers re-opening the view
      ro = new ResizeObserver(() => stage.resize(host.clientWidth, host.clientHeight));
      ro.observe(host);
      setCam3dReady(true);
    });
    return () => { alive = false; ro?.disconnect(); camStageRef.current?.destroy(); camStageRef.current = null; setCam3dReady(false); };
  }, [gfx.cams3d, gfx.dprMax, gfx.shadows, gfx.fpsCap]);
  useEffect(() => {
    const stage = camStageRef.current; const root = preparedMesh();
    if (!stage || assets.mesh !== 'ready' || !root) return;
    stage.setMapScene(root as Parameters<typeof stage.setMapScene>[0]);
    stage.warmUp();
    setMapMesh('glb');
  }, [assets.mesh, cam3dReady]);

  useEffect(() => {
    let lastSig = ''; let lastDone = true;
    return playback.subscribe((tMs) => {
      const stage = stageRef.current; const host = hostRef.current;
      if (!stage?.isReady || !host) return;
      const L = liveRef.current;
      // 1. where every view is. The rectangles only move on a window resize (nonce) or a React
      //    re-render (version), so they are measured then and cached — not on every played frame.
      //    The whole input of a frame is the playhead, the render counter and the layout nonce; a
      //    paused screen skips the (expensive) frame below.
      const lc = layoutCache.current;
      // Recompute only when the view set changes (mode/focus → a new `specs` array), on a window
      // resize (nonce), or while nothing has measured yet (elements still sizing on first mount).
      if (lc.specs !== L.specs || lc.nonce !== layoutNonce.current || lc.rects.length === 0) {
        const base = host.getBoundingClientRect();
        const next: typeof lc.rects = [];
        for (const s of L.specs) {
          const el = viewEls.current.get(s.key);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 8 || r.height < 8) continue;
          next.push({ s, rect: { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height } });
        }
        lc.rects = next; lc.specs = L.specs; lc.nonce = layoutNonce.current;
      }
      const rects = lc.rects;
      const sig = `${tMs}|${L.version}|${mapOk}|${layoutNonce.current}`;
      if (sig === lastSig && lastDone) return; // paused and nothing moved: keep the last picture
      // 2. the frame (team knowledge at this instant), computed once for both stages
      const frameNow = L.replay && L.tl.rounds.length > 0 ? computeFrame(L.replay, L.tl, nav, L.viewTeam, tMs) : null;
      const views: StageView[] = [];
      const cams: CamView[] = [];
      for (const { s, rect } of rects) {
        const followId = s.slot != null && frameNow ? playerIdFor(OUR_TEAM, s.slot, frameNow.round.attacker) : null;
        if (s.kind === 'cam3d') { if (followId) cams.push({ key: s.key, ...rect, followId }); }
        else views.push({ key: s.key, ...rect, followId, detail: s.detail });
      }
      // The 3D wall paces itself (CAMS_FPS); it reports false while it still owes this frame.
      const done3d = camStageRef.current ? camStageRef.current.render(frameNow, cams, { nameOf: L.nameOf }) : true;
      if (sig !== lastSig) {
        const dbg = L.showGraph && frameNow
          ? navDebugAt(frameNow.round, L.viewTeam, frameNow.tMs, (p) => displayPos(p, frameNow.tMs))
          : null;
        stage.render(frameNow, views, { showBelief: L.belief, highlightId: L.highlightId, showGraph: L.showGraph, navDebug: dbg, nameOf: L.nameOf });
      }
      lastSig = sig; lastDone = done3d;
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
  // Continue from the round summary: the next recorded round, or the next round of the session.
  const upcoming = idx >= 0 ? tl.rounds[idx + 1] ?? null : null;
  const nextLabel = upcoming ? t('mdx.watchNext', { n: upcoming.roundNum })
    : st && !st.finished && atLiveEdge ? t('mdx.next', { n: st.roundNumber }) : null;
  const continueNext = () => { if (upcoming) seek(upcoming.buyStartMs, { play: true }); else session?.onNext(); };
  const roundTimeouts = round ? [...new Set((session?.timeoutLog ?? []).filter((e) => e.round === round.roundNum).map((e) => e.team))] : [];
  // The order our coach set for the round on screen (orders are logged against the round they precede).
  const orderRound = nextRound?.roundNumber ?? round?.roundNum ?? 0;
  const activeOrder = viewTeam === OUR_TEAM
    ? session?.timeoutLog.find((e) => e.team === OUR_TEAM && e.by === 'human' && e.round === orderRound)?.order ?? null
    : null;

  const overlays = (
    <>
      <Banners t={t} frame={frame} nameOf={nameOf} viewTeam={viewTeam} />
      {round && over && !session?.ordersOpen && (
        <RoundResult t={t} round={round} viewTeam={viewTeam} score={score} teams={teams} hint={resultHint}
          nextLabel={nextLabel} onNext={continueNext} nextDisabled={!!session?.busy} nameOf={nameOf} zoneName={zoneName} />
      )}
      {preRound && !session!.ordersOpen && (
        <div className="mdx-result neutral" data-testid="pre-match">
          <span className="mdx-result-kicker">{t('mdx.pre.title')}</span>
          <div className="mdx-versus"><b className="ally">{teams.A.name}</b><i>VS</i><b className="enemy">{teams.B.name}</b></div>
          <span className="mdx-result-hint">{t('mdx.pre.hint')}</span>
        </div>
      )}
      {session?.busy && !session.ordersOpen && <div className="mdx-loadchip center"><LoadingInline label={t('load.round', { n: session.state.roundNumber })} testId="loading-round" /></div>}
      {toast && <div className="mdx-toast" role="status">{toast}</div>}
      {managerOverlay /* [manager] */}
      {session?.error && <div className="mdx-toast err" role="alert"><Icon name="warn" size={12} /> {session.error}</div>}
      {replay && tl.rounds.length > 0 && !tl.hasTracks && <div className="mdx-toast warn">{t('mdx.noTracks')}</div>}
    </>
  );

  // Developer view: the navigation panel (why each player walks where it walks), beside the map.
  const navPanel = showGraph ? (
    <div className="mdx-navdbg" data-testid="nav-debug-panel">
      <div className="mdx-navdbg-head">
        <b>{t('mdx.nav.title')}</b>
        <span data-testid="nav-debug-zones">{t('mdx.nav.zones', { ok: roadmap.connectedZones, n: roadmap.zones.length })}</span>
        <span>{t('mdx.nav.floor', { nodes: roadmap.nodes.length, edges: roadmap.segments.length })}</span>
        {navDebug && <span data-testid="nav-debug-counts">{t('mdx.nav.counts', navDebug.counts)}</span>}
      </div>
      {round && !round.summary?.nav && <div className="mdx-navdbg-row warn">{t('mdx.nav.noTrace')}</div>}
      {navDebug?.plans.map((p) => (
        <div key={p.playerId} className={`mdx-navdbg-row ${p.failure ? 'fail' : ''}`} data-testid={`nav-debug-row-${p.slot}`}>
          <i className={`pref ${(p.event?.preference ?? (p.failure ? 'FAIL' : 'NONE')).toLowerCase()}`} />
          <b>{p.slot} {nameOf(p.playerId)}</b>
          <span>{p.why || t('mdx.nav.dead')}</span>
          {p.replans.length > 0 && <em>{t('mdx.nav.replans', { n: p.replans.length })}</em>}
          {p.failures.length > 0 && <em className="fail">{t('mdx.nav.failures', { n: p.failures.length })}</em>}
        </div>
      ))}
      <div className="mdx-navdbg-legend" aria-hidden>
        <span><i className="pref fastest" />{t('mdx.nav.lg.fastest')}</span>
        <span><i className="pref safest" />{t('mdx.nav.lg.safest')}</span>
        <span><i className="pref stealth" />{t('mdx.nav.lg.stealth')}</span>
        <span><i className="pref tactical" />{t('mdx.nav.lg.tactical')}</span>
        <span><i className="lgn trail" />{t('mdx.nav.lg.trail')}</span>
        <span><i className="lgn replan" />{t('mdx.nav.lg.replan')}</span>
        <span><i className="lgn fail" />{t('mdx.nav.lg.fail')}</span>
        <span><i className="lgn zone-ok" />{t('mdx.nav.lg.zoneOk')}</span>
        <span><i className="lgn zone-bad" />{t('mdx.nav.lg.zoneBad')}</span>
        <span><i className="lgn drop" />{t('mdx.nav.lg.drop')}</span>
      </div>
    </div>
  ) : null;

  return (
    <div className={`mdx mode-${mode}`} data-testid="live-match" data-mode={mode}>
      <TopHud
        t={t} mode={mode} onMode={(m) => update({ mode: m })} onExit={onExit} onReview={onReview}
        teams={teams} viewTeam={viewTeam} score={score} frame={frame} round={round} nextRound={nextRound}
        pov={pov} onPov={setPov} povLocked={mode === 'cams'} belief={prefs.belief} onBelief={(v) => update({ belief: v })} cams3d={gfx.cams3d}
        hasPerception={hasPerception} sourceLabel={sourceLabel} mapName={replay?.meta.mapDisplayName ?? 'Ascent'} seed={match?.seed ?? replay?.meta.seed ?? null}
      />

      <div className="mdx-body">
        <div className="mdx-canvas" ref={host3dRef} data-testid="three-stage" data-map={mapMesh} />
        <div className="mdx-canvas" ref={hostRef} data-testid="pixi-stage" />

        {mode === 'tactical' ? (
          <div className="mdx-tac">
            <AllyPanel t={t} frame={frame} teamName={teams[viewTeam].name} nameOf={nameOf} zoneName={zoneName} bank={bankOf(viewTeam)}
              focusId={highlightId} onPick={(u) => setSelSlot((c) => (c === u.slot ? null : u.slot))}>
              <OrderChip t={t} order={activeOrder} />
              {viewTeam === OUR_TEAM && <BuyReasonPanel t={t} frame={frame} nameOf={nameOf} />}
              <IntelPanel t={t} frame={frame} nameOf={nameOf} zoneName={zoneName} />
            </AllyPanel>
            <div className="mdx-mapcol">
              <div className="mdx-map" ref={setViewEl('map')} data-testid="tactical-map">
                {overlays}
                <MatchupStrip t={t} frame={frame} />
                <div className="mdx-keys" aria-hidden>{t('mdx.keys')}</div>
                {mapOk === null && <div className="mdx-loadchip corner"><LoadingInline label={t('load.assets.map')} testId="loading-map" /></div>}
                {mapOk === false && <span className="mdx-maphint">{t('mdx.mapOffline')}</span>}
                <label className="mdx-ctl check mdx-debugctl" title={t('mdx.graph.hint')}>
                  <input type="checkbox" checked={showGraph} onChange={(e) => setShowGraph(e.target.checked)} data-testid="debug-graph" />
                  {t('mdx.graph')}
                </label>
                <div className="mdx-legend" aria-hidden>
                  <span><i className="lg ally" />{t('mdx.legend.ally')}</span>
                  <span><i className="lg enemy" />{t('mdx.legend.enemy')}</span>
                  <span><i className="lg ghost" />{t('mdx.legend.ghost')}</span>
                  <span><i className="lg sound" />{t('mdx.legend.sound')}</span>
                  <span><i className="lg dest" />{t('mdx.legend.dest')}</span>
                  {frame && <span className={`lg-src ${frame.sightSource}`} data-testid="sight-source" title={t(`mdx.sight.${frame.sightSource}.hint`)}>{t(`mdx.sight.${frame.sightSource}`)}</span>}
                </div>
              </div>
            </div>
            <EnemyPanel t={t} frame={frame} teamName={teams[enemyTeam].name} nameOf={nameOf} zoneName={zoneName} bank={bankOf(enemyTeam)}>
              {navPanel}
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
                    <span className="mdx-osd tl"><b>CAM {String(slot).padStart(2, '0')}</b>{unit ? nameOf(unit.id) : handles[OUR_TEAM][slot - 1]}<AgentTag slot={slot} t={t} /></span>
                    <span className="mdx-osd tr">
                      {state === 'dead' ? <em className="lost">{t('mdx.cam.offline')}</em> : <em className="live"><i />{t('mdx.cam.live')}</em>}
                      {round ? `R${round.roundNum} ${formatClock(playback.tMs - round.startMs).padStart(4, '0')}` : ''}
                    </span>
                    <span className="mdx-osd bl">
                      {unit ? <><Icon name={STATE_ICON[state] ?? 'hold'} size={12} className={`mdx-stateicon st-${state}`} />{statusText(t, unit.status, zoneName, nameOf)}</> : t('mdx.waiting')}
                    </span>
                    <span className="mdx-osd br">
                      {unit && unit.pose.alive ? <>{zoneName(unit.pose.zone)}{unit.blind && <em className="blind">{t('mdx.gaze.blind')}</em>}{unit.gaze && <em className="gaze">{t(`mdx.gaze.${unit.gaze}`)}</em>}{unit.view.enemies.length > 0 && <em className="contact">{t('mdx.cam.contact', { n: unit.view.enemies.length })}</em>}</> : ''}
                    </span>
                    {state !== 'dead' && <><i className="mdx-xhair" aria-hidden /><span className="mdx-radar" ref={setViewEl(`radar${slot}`)} aria-hidden /></>}
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
              <div className="mdx-wall-overlay">
                {overlays}
                {assets.mesh === 'loading' && <div className="mdx-loadchip corner"><LoadingInline label={t('load.assets.mesh')} testId="loading-mesh" /></div>}
                {assets.mesh === 'failed' && <div className="mdx-loadchip corner"><span className="pvl-inline" data-testid="mesh-failed">{t('load.assets.meshFailed')}</span></div>}
              </div>
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
        onRound={(r) => seek(r.buyStartMs, { play: true })} viewTeam={viewTeam}
        session={session ? { state: session.state, busy: session.busy, ordersOpen: session.ordersOpen } : null}
        autoPlay={autoPlay} onAutoPlay={onAutoPlay} onNext={() => session?.onNext()} onTimeout={callTimeout} canAdvance={atLiveEdge || preRound}
        watchedTo={watchedTo} timeouts={roundTimeouts} onPrevEvent={() => jumpEvent(-1)} onNextEvent={() => jumpEvent(1)} onSkipEnd={skipToEnd}
      />
    </div>
  );
}
