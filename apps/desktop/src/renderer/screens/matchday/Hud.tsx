// HUD pieces of the live match screen: the top score bar, the two roster panels, the kill
// feed, the situational banners and the bottom transport / coach bar. All of them are plain
// functions of the current Frame — they hold no match state of their own.
import type { ReactNode } from 'react';
import type { MatchSummary, SessionState } from '../../../shared/ipc.ts';
import type { TFn } from '../../i18n/index.tsx';
import type { Frame, FrameUnit } from '../../matchday/frame.ts';
import type { MonitorStatus } from '../../matchday/monitor.ts';
import { formatClock, planOf, roundMarks } from '../../matchday/monitor.ts';
import { duelCards } from '../../matchday/duels.ts';
import { parseCall, type CallLabel } from '../../decisions.ts';
import { isAlive, teamPlayers, type MatchTimeline, type RoundTimeline, type TeamSlot } from '../../matchday/timeline.ts';
import { TEMPOS, type Tempo, type ViewMode } from '../../matchday/prefs.ts';
import { agentOfSlot } from '../../matchday/roster.ts';
import { buyReason, dropsOf, playerEco, type PlayerEco } from '../../matchday/economy.ts';
import { Icon, ROLE_ICON, STATE_ICON, type IconName } from './Icons.tsx';

export type NameOf = (id: string) => string;
export type ZoneName = (id: string | null | undefined) => string;
const other = (t: TeamSlot): TeamSlot => (t === 'A' ? 'B' : 'A');
/** Engine id of a team's roster slot in the round on screen (atk3 / def3). */
function playerId(round: RoundTimeline | null, team: TeamSlot, slot: number): string {
  const prefix = round && round.attacker === team ? 'atk' : 'def';
  return `${prefix}${slot}`;
}

/** One line describing what a player is doing, for roster rows and monitor captions. */
export function statusText(t: TFn, s: MonitorStatus, zoneName: ZoneName, nameOf: NameOf): string {
  switch (s.state) {
    case 'dead': return s.opponentId ? t('mdx.state.deadBy', { name: nameOf(s.opponentId) }) : t('mdx.state.dead');
    case 'fighting': return s.opponentId ? t('mdx.state.fightingVs', { name: nameOf(s.opponentId) }) : t('mdx.state.fighting');
    case 'planting': return t('mdx.state.planting', { pct: Math.round((s.progress ?? 0) * 100) });
    case 'defusing': return t('mdx.state.defusing', { pct: Math.round((s.progress ?? 0) * 100) });
    case 'moving': return t(s.moveMode === 'walk' ? 'mdx.state.walking' : 'mdx.state.moving', { zone: zoneName(s.toZone) });
    default: return t('mdx.state.holding', { zone: zoneName(s.zone) });
  }
}

/** Role glyph + agent name for an engine slot (identity label; the role name is the tooltip). */
export function AgentTag({ slot, t }: { slot: number; t: TFn }) {
  const agent = agentOfSlot(slot);
  if (!agent) return null;
  return <span className="mdx-agent" title={t(`mdx.role.${agent.role}`)}><Icon name={ROLE_ICON[agent.role]} size={11} />{agent.name}</span>;
}

// ── top bar ────────────────────────────────────────────────────────────────────────────────

function Pips({ alive, team }: { alive: number; team: 'ally' | 'enemy' }) {
  return (
    <span className={`mdx-pips ${team}`} aria-label={`${alive}/5`}>
      {[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < alive ? 'on' : ''} />)}
    </span>
  );
}

export function TopHud({
  t, mode, onMode, onExit, onReview, teams, viewTeam, score, frame, round, nextRound, pov, onPov, povLocked,
  belief, onBelief, hasPerception, sourceLabel, mapName, seed,
}: {
  t: TFn; mode: ViewMode; onMode: (m: ViewMode) => void; onExit: () => void; onReview: (() => void) | null;
  teams: MatchSummary['teams']; viewTeam: TeamSlot; score: Record<TeamSlot, number>;
  frame: Frame | null; round: RoundTimeline | null; nextRound: { roundNumber: number; attacker: TeamSlot } | null;
  pov: TeamSlot; onPov: (p: TeamSlot) => void; povLocked: boolean;
  belief: boolean; onBelief: (v: boolean) => void; hasPerception: boolean;
  sourceLabel: string; mapName: string; seed: number | null;
}) {
  const ally = viewTeam, enemy = other(viewTeam);
  const attacker = nextRound?.attacker ?? round?.attacker ?? 'A';
  const sit = frame?.situation;
  const phase = nextRound ? (nextRound.roundNumber === 1 || nextRound.roundNumber === 13 ? 'pistol' : null) : round?.summary?.phase;
  const roundNo = nextRound?.roundNumber ?? round?.roundNum ?? 1;
  const matchPoint = Math.max(score.A, score.B) === 12 && score.A !== score.B; // regulation match point
  const spikeOn = sit && (sit.spike.phase === 'planted' || sit.spike.phase === 'defusing');
  const side = (team: TeamSlot) => (team === attacker ? t('mdx.side.attack') : t('mdx.side.defense'));

  return (
    <header className="mdx-top">
      <div className="mdx-top-left">
        <button className="mdx-crumb" onClick={onExit} data-testid="md-exit" title={t('mdx.exit.hint')}>
          <Icon name="back" size={12} /><span>{t('mdx.exit')}</span><i>//</i><b>{t('mdx.crumb.match')}</b>
        </button>
        <div className="mdx-seg" role="tablist" aria-label={t('mdx.mode.label')} data-testid="view-mode">
          <button role="tab" aria-selected={mode === 'tactical'} className={mode === 'tactical' ? 'on' : ''} onClick={() => onMode('tactical')} data-testid="view-mode-tactical">{t('mdx.mode.tactical')}</button>
          <button role="tab" aria-selected={mode === 'cams'} className={mode === 'cams' ? 'on' : ''} onClick={() => onMode('cams')} data-testid="view-mode-cams">{t('mdx.mode.cams')}</button>
        </div>
      </div>

      <div className="mdx-score" data-testid="scoreboard">
        <div className="mdx-team ally">
          <span className="mdx-team-name">{teams[ally].name}</span>
          <span className="mdx-team-meta"><span className="mdx-sidetag"><Icon name={ally === attacker ? 'attack' : 'defense'} size={11} />{side(ally)}</span><Pips alive={sit?.alive[ally] ?? 5} team="ally" /></span>
        </div>
        <b className="mdx-pts ally">{score[ally]}</b>
        <div className={`mdx-clock ${spikeOn ? 'spike' : ''} ${spikeOn && (sit!.spike.remainingMs ?? 0) < 10000 ? 'urgent' : ''}`}>
          <span className="mdx-clock-label">
            {nextRound ? t('mdx.round.next', { n: roundNo }) : t('mdx.round.n', { n: roundNo })}
            {phase === 'pistol' && <em>{t('mdx.phase.pistol')}</em>}
            {phase === 'overtime' && <em>{t('mdx.phase.ot')}</em>}
            {matchPoint && phase !== 'overtime' && <em className="hot">{t('mdx.phase.matchPoint')}</em>}
            {sit?.buyPhase && !nextRound && <em className="buy">{t('mdx.phase.buy')}</em>}
          </span>
          <strong className="mdx-clock-time">{spikeOn && <Icon name="spike" size={18} />}{sit && !nextRound ? formatClock(sit.clockMs) : formatClock(100000)}</strong>
        </div>
        <b className="mdx-pts enemy">{score[enemy]}</b>
        <div className="mdx-team enemy">
          <span className="mdx-team-name">{teams[enemy].name}</span>
          <span className="mdx-team-meta"><Pips alive={sit?.alive[enemy] ?? 5} team="enemy" /><span className="mdx-sidetag"><Icon name={enemy === attacker ? 'attack' : 'defense'} size={11} />{side(enemy)}</span></span>
        </div>
      </div>

      <div className="mdx-top-right">
        <span className="rv-src rv-src-simulated" title={sourceLabel}>SIMULATED · {mapName}{seed != null ? ` · seed ${seed}` : ''}</span>
        {hasPerception && (
          <>
            <label className="mdx-ctl" title={t('mdx.fog.hint')}>
              <span className="mdx-ctl-tag" data-testid="fog-on">{t('mdx.fog')}</span>
              <select value={pov === 'A' ? 0 : 1} onChange={(e) => onPov(Number(e.target.value) === 0 ? 'A' : 'B')} disabled={povLocked} data-testid="fog-pov">
                <option value={0}>{teams.A.name}</option>
                <option value={1}>{t('mdx.fog.debugPov', { name: teams.B.name })}</option>
              </select>
            </label>
            <label className="mdx-ctl check">
              <input type="checkbox" checked={belief} onChange={(e) => onBelief(e.target.checked)} data-testid="fog-belief" />
              {t('mdx.belief')}
            </label>
          </>
        )}
        {onReview && <button className="mdx-btn ghost" onClick={onReview} data-testid="tab-review">{t('mdx.review')}</button>}
      </div>
    </header>
  );
}

// ── rosters ────────────────────────────────────────────────────────────────────────────────

function TeamHead({ name, sub, right, tone }: { name: string; sub: ReactNode; right: ReactNode; tone: 'ally' | 'enemy' }) {
  return (
    <div className={`mdx-panelhead ${tone}`}>
      <div><b>{name}</b><span className="mdx-sub">{sub}</span></div>
      <div className="mdx-panelhead-right">{right}</div>
    </div>
  );
}

function buyLine(t: TFn, round: RoundTimeline | null, team: TeamSlot): ReactNode {
  const buy = round?.summary?.buys[team];
  if (!buy) return '—';
  return <><span className={`mdx-buy buy-${buy.tier}`}>{t(`buy.${buy.tier}`)}</span> {buy.weapon}</>;
}

/** Weapon + where it came from + (for our players) what they have to spend, as one compact cell. */
function EcoCell({ t, eco, weapon, alive, nameOfSlot, kills }: { t: TFn; eco: PlayerEco | null; weapon: string; alive: boolean; nameOfSlot: (slot: number) => string; kills: number }) {
  const src = eco?.source;
  const tag = src === 'kept' ? t('mdx.eco.kept') : src === 'dropped' ? t('mdx.eco.dropped', { name: eco!.droppedBySlot ? nameOfSlot(eco!.droppedBySlot) : '?' }) : src === 'bought' ? t('mdx.eco.bought') : '';
  return (
    <span className="mdx-row-side">
      <span className="mdx-weapon" title={tag}>
        {alive ? <>{weapon}{tag && <em className={`mdx-ecotag ${src}`}>{tag}</em>}</> : <Icon name="dead" size={11} />}
      </span>
      {eco ? (
        <span className="mdx-k mdx-eco" title={t('mdx.eco.tip', { spent: eco.spent, util: eco.utility, armor: eco.armor })}>
          <Icon name="credits" size={9} />{eco.creditsBefore.toLocaleString()}
          {eco.ultBefore > 0 && <span className="mdx-ultpts"><Icon name="ult" size={9} />{eco.ultBefore}</span>}
          {kills > 0 && <b>{t('mdx.kills', { n: kills })}</b>}
        </span>
      ) : <span className="mdx-k">{kills > 0 ? t('mdx.kills', { n: kills }) : ''}</span>}
    </span>
  );
}

/** Why our team bought what it did (the plan, the call that forced it, the alternative it beat), and who got a dropped weapon. */
export function BuyReasonPanel({ t, frame, nameOf }: { t: TFn; frame: Frame | null; nameOf: NameOf }) {
  const round = frame?.round;
  const buy = round?.summary?.buys[frame!.team];
  const reason = buyReason(buy);
  if (!round || !reason) return null;
  const drops = dropsOf(buy);
  const slotName = (slot: number) => nameOf(`${round.players.find((p) => p.team === frame!.team)?.id.replace(/\d+$/, '') ?? 'atk'}${slot}`);
  return (
    <div className="mdx-intel mdx-buyreason" data-testid="buy-reason">
      <div className="mdx-feedhead"><i>//</i>{t('mdx.buy')}</div>
      <p className="mdx-buyline"><b>{t(`mdx.plan.${reason.plan}`)}</b>
        {reason.loadoutValue != null && <span>{t('mdx.buy.value', { n: reason.loadoutValue.toLocaleString() })}</span>}
        {reason.vctTier && <span className={`mdx-buy buy-${reason.tier}`}>{reason.vctTier}</span>}
      </p>
      {reason.call && <p className="mdx-buynote call">{t('mdx.buy.call', { call: t(`oecon.${reason.call}`) })}</p>}
      {reason.chosen && reason.beat && (
        <p className="mdx-buynote" title={t('mdx.buy.beat.tip')}>{t('mdx.buy.beat', { a: t(`mdx.plan.${reason.chosen.plan}`), av: reason.chosen.value.toFixed(2), b: t(`mdx.plan.${reason.beat.plan}`), bv: reason.beat.value.toFixed(2) })}</p>
      )}
      {drops.length > 0 && <p className="mdx-buynote">{drops.map((d) => t('mdx.buy.drop', { from: slotName(d.from), to: slotName(d.to), weapon: d.weapon })).join(' · ')}</p>}
    </div>
  );
}

export function AllyPanel({ t, frame, teamName, nameOf, zoneName, bank, onPick, focusId, children }: {
  t: TFn; frame: Frame | null; teamName: string; nameOf: NameOf; zoneName: ZoneName;
  bank: { credits: number; ultPoints: number } | null; onPick?: (u: FrameUnit) => void; focusId?: string | null; children?: ReactNode;
}) {
  const round = frame?.round ?? null;
  const weapon = round?.summary?.buys[frame!.team].weapon ?? '';
  return (
    <aside className="mdx-panel ally" data-testid="ally-panel">
      <TeamHead tone="ally" name={teamName} sub={frame ? buyLine(t, round, frame.team) : t('mdx.waiting')}
        right={bank ? <><span className="mdx-credits"><Icon name="credits" size={12} />{bank.credits.toLocaleString()}</span><span className="mdx-ult"><Icon name="ult" size={10} />{t('mdx.ult', { n: bank.ultPoints })}</span></> : null} />
      <ul className="mdx-rows">
        {(frame?.units ?? []).map((u) => (
          <li key={u.slot} className={`mdx-row ally st-${u.status.state} ${focusId === u.id ? 'focus' : ''}`} onClick={onPick ? () => onPick(u) : undefined} data-clickable={onPick ? '' : undefined}>
            <span className="mdx-slot">{u.slot}</span>
            <span className="mdx-row-main">
              <span className="mdx-nameline"><b className="mdx-name">{nameOf(u.id)}</b><AgentTag slot={u.slot} t={t} /></span>
              <span className="mdx-status"><Icon name={STATE_ICON[u.status.state] ?? 'hold'} size={11} />{statusText(t, u.status, zoneName, nameOf)}</span>
            </span>
            <EcoCell t={t} eco={playerEco(round?.summary ?? null, round?.prevSummary ?? null, frame!.team, u.slot, !!frame?.situation.over)} weapon={playerEco(round?.summary ?? null, round?.prevSummary ?? null, frame!.team, u.slot, false)?.weapon ?? weapon} alive={u.pose.alive} nameOfSlot={(sl) => nameOf(playerId(round, frame!.team, sl))} kills={u.kills} />
            {(u.status.state === 'planting' || u.status.state === 'defusing') && <i className="mdx-progress" style={{ width: `${Math.round((u.status.progress ?? 0) * 100)}%` }} />}
          </li>
        ))}
      </ul>
      {children}
    </aside>
  );
}

export function EnemyPanel({ t, frame, teamName, nameOf, zoneName, bank, children }: {
  t: TFn; frame: Frame | null; teamName: string; nameOf: NameOf; zoneName: ZoneName;
  bank: { credits: number; ultPoints: number } | null; children?: ReactNode;
}) {
  const round = frame?.round ?? null;
  const enemy = frame ? other(frame.team) : 'B';
  const players = round ? teamPlayers(round, enemy) : [];
  const weapon = round?.summary?.buys[enemy].weapon ?? '';
  return (
    <aside className="mdx-panel enemy" data-testid="enemy-panel">
      <TeamHead tone="enemy" name={teamName} sub={frame ? buyLine(t, round, enemy) : t('mdx.waiting')}
        right={bank ? <><span className="mdx-credits"><Icon name="credits" size={12} />{bank.credits.toLocaleString()}</span><span className="mdx-ult"><Icon name="ult" size={10} />{t('mdx.ult', { n: bank.ultPoints })}</span></> : null} />
      <ul className="mdx-rows">
        {players.map((p) => {
          const alive = isAlive(p, frame!.tMs);
          const known = frame!.lastKnown.get(p.id);
          const intel = !alive ? t('mdx.intel.dead')
            : known?.visible ? t('mdx.intel.visible', { zone: zoneName(known.zone) })
            : known ? t('mdx.intel.lastSeen', { zone: zoneName(known.zone), s: Math.round(known.ageMs / 1000) })
            : t('mdx.intel.unknown');
          return (
            <li key={p.slot} className={`mdx-row enemy ${alive ? '' : 'st-dead'} ${known?.visible && alive ? 'st-fighting' : ''}`}>
              <span className="mdx-slot">{p.slot}</span>
              <span className="mdx-row-main">
                <span className="mdx-nameline"><b className="mdx-name">{nameOf(p.id)}</b><AgentTag slot={p.slot} t={t} /></span>
                <span className="mdx-status">{intel}</span>
              </span>
              <span className="mdx-row-side"><span className="mdx-weapon">{alive ? (round?.summary?.buys[enemy].players?.[p.slot - 1]?.weapon ?? weapon) : <Icon name="dead" size={11} />}</span></span>
            </li>
          );
        })}
      </ul>
      {children}
    </aside>
  );
}

export function KillFeed({ t, frame, nameOf, zoneName, limit = 6 }: { t: TFn; frame: Frame | null; nameOf: NameOf; zoneName: ZoneName; limit?: number }) {
  if (!frame) return <div className="mdx-feed" data-testid="event-feed"><div className="mdx-feedhead"><i>//</i>{t('mdx.feed')}</div><p className="mdx-empty">{t('mdx.feed.empty')}</p></div>;
  const { round, tMs, team } = frame;
  type Item = { tMs: number; node: ReactNode; key: string };
  const items: Item[] = frame.kills.map((k, i) => ({
    tMs: k.tMs, key: `k${i}`,
    node: (
      <>
        <b className={k.killerTeam === team ? 'ally' : 'enemy'}>{k.killerId ? nameOf(k.killerId) : '—'}</b>
        <Icon name="kill" size={12} className="mdx-killmark" title={t('mdx.feed.killed')} />
        <b className={k.victimTeam === team ? 'ally' : 'enemy'}>{nameOf(k.victimId)}</b>
        {k.zone && <span className="mdx-feed-zone">{zoneName(k.zone)}</span>}
      </>
    ),
  }));
  if (round.plant && tMs >= round.plant.tMs) items.push({ tMs: round.plant.tMs, key: 'plant', node: <><Icon name="spike" size={13} className="hot" /><span className="mdx-feed-note">{t('mdx.feed.plant', { name: round.plant.playerId ? nameOf(round.plant.playerId) : '—', site: round.plant.site ?? '?' })}</span></> });
  if (round.defuse && tMs >= round.defuse.tMs) items.push({ tMs: round.defuse.tMs, key: 'defuse', node: <><Icon name="spike" size={13} className="safe" /><span className="mdx-feed-note">{t('mdx.feed.defuse', { name: round.defuse.playerId ? nameOf(round.defuse.playerId) : '—' })}</span></> });
  items.sort((a, b) => b.tMs - a.tMs);
  return (
    <div className="mdx-feed" data-testid="event-feed">
      <div className="mdx-feedhead"><i>//</i>{t('mdx.feed')}</div>
      {items.length === 0 && <p className="mdx-empty">{t('mdx.feed.empty')}</p>}
      <ol>
        {items.slice(0, limit).map((it) => (
          <li key={it.key}><span className="mdx-feed-t">{formatClock(it.tMs - round.startMs)}</span>{it.node}</li>
        ))}
      </ol>
    </div>
  );
}

const SOUND_KEYS: Record<string, string> = { footstep: 'footstep', gunfire: 'gunfire', landing: 'landing', spikeDefuse: 'defuse', spikePlant: 'plant', abilityCast: 'ability' };
const SOUND_ICONS: Record<string, IconName> = { footstep: 'footstep', gunfire: 'gunfire', landing: 'footstep', spikeDefuse: 'spike', spikePlant: 'spike', abilityCast: 'ult' };

/** What the team knows about the enemy right now: contacts, remembered sightings, sound cues. */
export function IntelPanel({ t, frame, nameOf, zoneName, limit = 6 }: { t: TFn; frame: Frame | null; nameOf: NameOf; zoneName: ZoneName; limit?: number }) {
  const rows: Array<{ key: string; cls: string; icon: IconName; text: string; right: string }> = [];
  if (frame) {
    for (const e of frame.seen) rows.push({ key: `s${e.id}`, cls: 'enemy', icon: 'eye', text: t('mdx.intel.row.visible', { name: nameOf(e.id) }), right: zoneName(e.zone) });
    for (const g of frame.ghosts) rows.push({ key: `g${g.id}`, cls: 'enemy', icon: 'lastSeen', text: t('mdx.intel.row.ghost', { name: nameOf(g.id), s: Math.round(g.ageMs / 1000) }), right: zoneName(g.zone) });
    for (const s of frame.sounds) {
      if (s.kind !== 'footstep' && s.ageMs > 3000) continue;
      const label = t(`mdx.sound.${SOUND_KEYS[s.kind] ?? 'other'}`);
      rows.push({ key: `a${s.zone}${s.kind}`, cls: s.masked ? 'sound masked' : 'sound', icon: SOUND_ICONS[s.kind] ?? 'footstep', text: s.masked ? `${label} · ${t('mdx.sound.masked')}` : label, right: zoneName(s.zone) });
    }
  }
  return (
    <div className="mdx-intel" data-testid="intel-panel">
      <div className="mdx-feedhead"><i>//</i>{t('mdx.intel')}</div>
      {rows.length === 0 && <p className="mdx-empty">{t('mdx.intel.empty')}</p>}
      <ul>
        {rows.slice(0, limit).map((r) => <li key={r.key} className={r.cls}><Icon name={r.icon} size={12} /><span>{r.text}</span><span>{r.right}</span></li>)}
      </ul>
    </div>
  );
}

/** The coach order in force for the round on screen (set during a tactical timeout). */
export function OrderChip({ t, order }: { t: TFn; order: { strategy?: string; economy?: string; tempo?: string } | null }) {
  if (!order) return null;
  const parts = [order.strategy && t(`ostrat.${order.strategy}`), order.economy && t(`oecon.${order.economy}`), order.tempo && t(`otempo.${order.tempo}`)].filter(Boolean);
  return <div className="mdx-order" data-testid="order-chip"><b>{t('mdx.order')}</b><span>{parts.join(' · ') || '—'}</span></div>;
}

// ── banners over the stage ─────────────────────────────────────────────────────────────────

export function Banners({ t, frame, nameOf, viewTeam }: { t: TFn; frame: Frame | null; nameOf: NameOf; viewTeam: TeamSlot }) {
  if (!frame || frame.situation.over) return null;
  const { spike, clutch } = frame.situation;
  const planted = spike.phase === 'planted' || spike.phase === 'defusing';
  return (
    <div className="mdx-banners" aria-live="polite">
      {spike.phase === 'planting' && <div className="mdx-banner spike soft">{t('mdx.spike.planting')}</div>}
      {planted && (
        <div className={`mdx-banner spike ${(spike.remainingMs ?? 0) < 10000 ? 'urgent' : ''}`} data-testid="spike-banner">
          <Icon name="spike" size={16} className="hot" />
          <span>{t('mdx.spike.planted', { site: spike.site ?? '?' })}</span>
          <strong>{formatClock(spike.remainingMs ?? 0)}</strong>
          <i className="mdx-banner-bar" style={{ width: `${Math.max(0, Math.min(100, ((spike.remainingMs ?? 0) / 45000) * 100))}%` }} />
        </div>
      )}
      {clutch && (
        <div className={`mdx-banner clutch ${clutch.team === viewTeam ? 'ally' : 'enemy'}`} data-testid="clutch-banner">
          <Icon name="fight" size={14} /><strong>1 v {clutch.versus}</strong>
          <span>{t('mdx.clutch', { name: nameOf(clutch.playerId) })}</span>
        </div>
      )}
    </div>
  );
}

/** A plan call in the same words the Review uses ("A 실행", "A 사이트 커밋", "… (슬로우)"). */
export function callText(t: TFn, text: string): string {
  const c: CallLabel = parseCall(text);
  if (c.kind === 'commit') return t('rev.dec.call.commit', { site: c.site });
  if (c.kind === 'raw') return c.text;
  const key = `ostrat.${c.id}`; const label = t(key); const base = label === key ? c.id : label;
  return c.slow ? t('rev.dec.call.slow', { call: base }) : base;
}

/** Duel cards: for each fight of the round, who saw first, who was pre-aimed, who was crossfired, what the angle cost. */
export function DuelCards({ t, round, viewTeam, nameOf, zoneName }: { t: TFn; round: RoundTimeline; viewTeam: TeamSlot; nameOf: NameOf; zoneName: ZoneName }) {
  const cards = duelCards(round.summary?.engagement, round.startMs, round.attacker, viewTeam);
  if (cards.length === 0) return <p className="mdx-duel-none" data-testid="duel-cards-none">{t('mdx.duel.none')}</p>;
  const side = (f: typeof cards[number]['ours']) => [
    f.preAim && t('mdx.duel.preaim'), f.moving && t('mdx.duel.moving'), f.crossfire && t('mdx.duel.crossfire'), f.info && t('mdx.duel.info'),
    f.angleDelayMs != null && f.angleDelayMs > 0 && t('mdx.duel.angle', { ms: Math.round(f.angleDelayMs) }), f.flashedMs > 0 && t('mdx.duel.flashed'),
  ].filter(Boolean).join(' · ') || '—';
  return (
    <ol className="mdx-duels" data-testid="duel-cards">
      {cards.slice(0, 8).map((c, i) => (
        <li key={i} className={c.winner ?? ''}>
          <header><span>{formatClock(c.tMs - round.startMs)}</span><b className="ally">{nameOf(c.ours.id)}</b><i>vs</i><b className="enemy">{nameOf(c.theirs.id)}</b><em>{zoneName(c.zone)} · {c.distanceM}m</em></header>
          <p className="first">{t(`mdx.duel.first.${c.firstSight}`)}{c.winner && <span className={c.winner}>{t(`mdx.duel.won.${c.winner}`)}</span>}</p>
          <p><b className="ally">{nameOf(c.ours.id)}</b> {side(c.ours)}</p>
          <p><b className="enemy">{nameOf(c.theirs.id)}</b> {side(c.theirs)}</p>
        </li>
      ))}
    </ol>
  );
}

/** Plan data a round may carry (RoundRecord.decisions, when the bridge passes it through). */
interface PlanLike { opening?: string | null; strategy?: string | null; feint?: string | null; revisions?: ReadonlyArray<{ atMs: number; from: string; to: string; reason?: string }> }

/**
 * Between-rounds summary: shown only once playback has reached the end of the round. Result and
 * reason, kills, economy after the round, our own plan changes (never the opponent's), and the
 * way forward.
 */
export function RoundResult({ t, round, viewTeam, score, teams, hint, nextLabel, onNext, nextDisabled, nameOf, zoneName }: {
  t: TFn; round: RoundTimeline; viewTeam: TeamSlot; score: Record<TeamSlot, number>; teams: MatchSummary['teams']; hint: string | null; nameOf: NameOf; zoneName: ZoneName;
  nextLabel: string | null; onNext: () => void; nextDisabled: boolean;
}) {
  const sum = round.summary;
  const winner = sum?.winner;
  if (!winner || !sum) return null;
  const won = winner === viewTeam;
  const enemy = other(viewTeam);
  const plan = (sum as unknown as { decisions?: { plans?: Partial<Record<TeamSlot, PlanLike | null>> } | null }).decisions?.plans?.[viewTeam] ?? null;
  return (
    <div className={`mdx-result ${won ? 'won' : 'lost'}`} data-testid="round-result">
      <span className="mdx-result-kicker">{t('mdx.round.n', { n: round.roundNum })} · {t(`reason.${round.endReason ?? 'elimination'}`)}</span>
      <strong>{won ? t('mdx.result.won') : t('mdx.result.lost')}</strong>
      <span className="mdx-result-score">{teams[viewTeam].name} <b>{score[viewTeam]}</b> : <b>{score[enemy]}</b> {teams[enemy].name}</span>
      <dl className="mdx-result-facts">
        <div><dt>{t('mdx.sum.kills')}</dt><dd><b className="ally">{sum.kills[viewTeam]}</b> – <b className="enemy">{sum.kills[enemy]}</b></dd></div>
        <div><dt>{t('mdx.sum.economy')}</dt><dd>{sum.economy[viewTeam].credits.toLocaleString()} / {sum.economy[enemy].credits.toLocaleString()}</dd></div>
        <div><dt>{t('mdx.sum.buys')}</dt><dd>{t(`buy.${sum.buys[viewTeam].tier}`)} / {t(`buy.${sum.buys[enemy].tier}`)}</dd></div>
        {plan && (
          <div className="wide"><dt>{t('mdx.sum.plan')}</dt>
            <dd>{callText(t, plan.opening ?? '—')}{plan.strategy && plan.strategy !== plan.opening ? ` → ${callText(t, plan.strategy)}` : ''}
              {plan.feint && <span className="mdx-result-rev">{t('mdx.plan.feint', { site: plan.feint.replace(/^([a-z])-.*/, (_m, c) => c.toUpperCase()) })}</span>}
              {(plan.revisions ?? []).map((r, i) => <span key={i} className="mdx-result-rev">{formatClock(r.atMs)} {callText(t, r.from)} → {callText(t, r.to)}{r.reason ? ` (${r.reason})` : ''}</span>)}
            </dd>
          </div>
        )}
      </dl>
      {round.summary?.engagement !== undefined && (
        <details className="mdx-duelbox"><summary>{t('mdx.duel.title')}</summary><DuelCards t={t} round={round} viewTeam={viewTeam} nameOf={nameOf} zoneName={zoneName} /></details>
      )}
      {hint && <span className="mdx-result-hint">{hint}</span>}
      {nextLabel && <button className="mdx-btn primary" onClick={onNext} disabled={nextDisabled} data-testid="summary-next"><Icon name="play" size={13} />{nextLabel}</button>}
    </div>
  );
}

// ── bottom bar ─────────────────────────────────────────────────────────────────────────────

export function BottomBar({
  t, tl, round, tMs, playing, onToggle, tempo, onTempo, onSeek, onRound, viewTeam, session, autoPlay, onAutoPlay,
  onNext, onTimeout, canAdvance, watchedTo, timeouts, onPrevEvent, onNextEvent, onSkipEnd,
}: {
  /** Furthest point of this round the viewer has reached: later events stay unmarked (no spoilers). */
  watchedTo: number;
  /** Teams that called a tactical timeout before this round. */
  timeouts: readonly TeamSlot[];
  onPrevEvent: () => void; onNextEvent: () => void; onSkipEnd: () => void;
  t: TFn; tl: MatchTimeline; round: RoundTimeline | null; tMs: number; playing: boolean; onToggle: () => void;
  tempo: Tempo; onTempo: (v: Tempo) => void; onSeek: (ms: number) => void; onRound: (r: RoundTimeline) => void;
  viewTeam: TeamSlot; session: { state: SessionState; busy: boolean; ordersOpen: boolean } | null;
  autoPlay: boolean; onAutoPlay: (v: boolean) => void; onNext: () => void; onTimeout: () => void; canAdvance: boolean;
}) {
  const span = round ? Math.max(1, round.endMs - round.buyStartMs) : 1;
  const pct = (ms: number) => `${Math.max(0, Math.min(100, ((ms - (round?.buyStartMs ?? 0)) / span) * 100))}%`;
  const st = session?.state;
  return (
    <footer className="mdx-bottom">
      <div className="mdx-transport">
        <button className="mdx-play" onClick={onToggle} disabled={!round} data-testid="playpause" data-playing={playing ? '' : undefined} aria-label={playing ? t('mdx.pause') : t('mdx.play')}>
          <Icon name={playing ? 'pause' : 'play'} size={18} />
        </button>
        <div className="mdx-seg small icons" aria-label={t('mdx.events')}>
          <button onClick={onPrevEvent} disabled={!round} data-testid="prev-event" title={t('mdx.prevEvent')} aria-label={t('mdx.prevEvent')}><Icon name="prev" size={13} /></button>
          <button onClick={onNextEvent} disabled={!round} data-testid="next-event" title={t('mdx.nextEvent')} aria-label={t('mdx.nextEvent')}><Icon name="next" size={13} /></button>
          <button onClick={onSkipEnd} disabled={!round} data-testid="skip-end" title={t('mdx.skipEnd')} aria-label={t('mdx.skipEnd')}><Icon name="end" size={13} /></button>
        </div>
        <div className="mdx-seg small" aria-label={t('mdx.tempo')}>
          {TEMPOS.map((v) => (
            <button key={v} className={tempo === v ? 'on' : ''} onClick={() => onTempo(v)} data-testid={`tempo-${v}`}>{v}×</button>
          ))}
        </div>
      </div>

      <div className="mdx-timeline">
        <div className="mdx-chips" data-testid="roundstrip">
          {tl.rounds.map((r) => {
            const done = r.endReason != null && (r.roundNum < (round?.roundNum ?? 0) || (r === round && tMs >= r.endMs));
            const winner = done ? r.summary?.winner : undefined;
            const cls = winner ? (winner === viewTeam ? 'won' : 'lost') : '';
            return (
              <button key={r.roundNum} className={`mdx-chip ${cls} ${r === round ? 'cur' : ''} ${r.summary?.phase === 'pistol' ? 'pistol' : ''}`}
                onClick={() => onRound(r)} data-testid={`round-chip-${r.roundNum}`} title={t('mdx.round.n', { n: r.roundNum })}>
                {r.roundNum}
              </button>
            );
          })}
          {tl.rounds.length === 0 && <span className="mdx-empty">{t('mdx.timeline.empty')}</span>}
        </div>
        <div className="mdx-scrubrow">
          <span className="mdx-time">{formatClock(round ? tMs - round.startMs : 0).padStart(4, '0')}</span>
          <div className="mdx-scrub">
            <i className="mdx-scrub-fill" style={{ width: round ? pct(tMs) : '0%' }} />
            {timeouts.map((team) => <i key={team} className={`mdx-tick timeout ${team === viewTeam ? 'ally' : 'enemy'}`} style={{ left: 0 }} title={t('mdx.timeout')} />)}
            {/* our plan's mid-round revisions (our team only), revealed as they are reached */}
            {round && planOf(round, viewTeam)?.marks.filter((m) => m.tMs <= watchedTo).map((m, i) => (
              <i key={`pl${i}`} className="mdx-tick plan" style={{ left: pct(m.tMs) }} title={`${callText(t, m.from)} → ${callText(t, m.to)}${m.reason ? ` (${m.reason})` : ''}`} />
            ))}
            {/* events appear on the timeline as they are reached — the future stays unmarked */}
            {round && roundMarks(round).filter((m) => m.tMs <= watchedTo && m.kind !== 'end').map((m, i) => (
              <i key={i} className={`mdx-tick ${m.kind === 'kill' ? (m.team === viewTeam ? 'ally' : 'enemy') : m.kind === 'plant' ? 'spike' : 'defuse'}`} style={{ left: pct(m.tMs) }} />
            ))}
            <input className="rv-scrub" type="range" min={round?.buyStartMs ?? 0} max={round?.endMs ?? 0} step={50} value={round ? tMs : 0}
              onChange={(e) => onSeek(Number(e.target.value))} disabled={!round} aria-label={t('mdx.scrub')} />
          </div>
          <span className="mdx-time">{formatClock(round ? round.endMs - round.startMs : 0).padStart(4, '0')}</span>
        </div>
      </div>

      <div className="mdx-coach" data-testid={st ? 'session-bar' : 'watch-bar'}>
        {st ? (
          !st.finished ? (
            <>
              <button className="mdx-btn warn" onClick={onTimeout} data-testid="call-timeout"
                disabled={session!.busy || session!.ordersOpen || st.timeoutsRemaining.A <= 0 || st.timeoutActive.A}>
                <Icon name="timeout" size={14} /><span>{st.timeoutActive.A ? t('mdx.timeout.active') : t('mdx.timeout')}</span>
                <span className="mdx-tokens">{[0, 1].map((i) => <i key={i} className={i < st.timeoutsRemaining.A ? 'on' : ''} />)}</span>
              </button>
              <label className="mdx-ctl check"><input type="checkbox" checked={autoPlay} onChange={(e) => onAutoPlay(e.target.checked)} data-testid="auto-play" />{t('mdx.auto')}</label>
              <button className={`mdx-btn primary ${canAdvance ? 'ready' : ''}`} onClick={onNext} disabled={session!.busy || session!.ordersOpen} data-testid="next-round">
                {session!.busy ? t('mdx.simulating') : <><Icon name="play" size={13} />{t('mdx.next', { n: st.roundNumber })}</>}
              </button>
            </>
          ) : <span className="mdx-done">{t('mdx.finished')}</span>
        ) : (
          <label className="mdx-ctl check"><input type="checkbox" checked={autoPlay} onChange={(e) => onAutoPlay(e.target.checked)} data-testid="auto-play" />{t('mdx.autoWatch')}</label>
        )}
      </div>
    </footer>
  );
}
