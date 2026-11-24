// Standings and brackets of the whole circuit: the three regional stages of any region (groups and
// the playoff bracket), the three international events (groups and the double-elimination
// bracket, with who qualified and how), and the Champions Points race by region.
import { useState } from 'react';
import { useLang } from '../../i18n/index.tsx';
import { useCareer } from '../../career/session.ts';
import {
  eventGroupTable, eventOf, groupStandings, GROUPS, INTL_EVENTS, leaguesOf, regionRanking, REGIONS, SCHEDULE_MODEL,
  type CareerState, type CompetitionId, type Fixture, type IntlEvent, type Region, type StageId,
} from '../../career/world.ts';
import { teamName } from '../../career/view.ts';

type Tab = CompetitionId | 'points';
const STAGES: StageId[] = ['kickoff', 'stage1', 'stage2'];

function Slot({ c, f, side }: { c: CareerState; f: Fixture; side: 'home' | 'away' }) {
  const { t } = useLang();
  const id = f[side];
  const src = side === 'home' ? f.homeFrom : f.awayFrom;
  if (id) return <>{teamName(c, id)}</>;
  if (src?.kind === 'seed') return <>{t('stand.seed', { g: /^[a-d]$/.test(src.group) ? src.group.toUpperCase() : t(`career.enum.${src.group}`), n: src.rank })}</>;
  if (src?.kind === 'loser') return <>{t('stand.loserOf')}</>;
  return <>{t('home.tbd')}</>;
}

function Match({ c, f }: { c: CareerState; f: Fixture }) {
  const { t } = useLang();
  const won = (side: 'home' | 'away') => f.result && f.result.winner === f[side];
  return (
    <div className="br-match" data-testid={`bracket-${f.round}`}>
      <div className="muted small">{t(`career.enum.${f.round}`)} · {f.date} · {t(`career.enum.${f.format}`)}</div>
      {(['home', 'away'] as const).map((s, i) => (
        <div key={s} className={`br-team ${won(s) ? 'win' : ''} ${f[s] === c.userTeamId ? 'me' : ''}`}>
          <span><Slot c={c} f={f} side={s} /></span><b>{f.result ? f.result.mapsWon[i] : ''}</b>
        </div>
      ))}
    </div>
  );
}

function RegionalStage({ c, region, stageId }: { c: CareerState; region: Region; stageId: StageId }) {
  const { t } = useLang();
  const league = leaguesOf(c).find((l) => l.region === region)!;
  const stage = league.stages.find((s) => s.id === stageId)!;
  const po = league.fixtures.filter((f) => f.stage === stageId && f.phase === 'playoff');
  if (!stage.start) return <div className="muted">{t('sched.stagePending')}</div>;
  return (
    <>
      {stage.champion && <div className="home-matchday" data-testid="stand-champion">🏆 {t('stand.champion', { team: teamName(c, stage.champion) })}</div>}
      <div className="stand-groups">
        {GROUPS.map((g) => (
          <section key={g} className="md-card" data-testid={`group-${g}`}>
            <h3>{t('career.group', { g: t(`career.enum.${g}`) })}</h3>
            <table className="nc-table">
              <thead><tr><th>#</th><th>{t('stand.team')}</th><th>{t('stand.p')}</th><th>{t('stand.w')}</th><th>{t('stand.l')}</th><th>{t('stand.maps')}</th><th>{t('stand.rounds')}</th></tr></thead>
              <tbody>
                {groupStandings(league, stageId, g).map((r, i) => (
                  <tr key={r.teamId} className={`${r.teamId === c.userTeamId ? 'me' : ''} ${i < SCHEDULE_MODEL.playoffPerGroup ? 'qual' : ''}`} data-testid={`stand-row-${r.teamId}`}>
                    <td>{i + 1}</td><td>{teamName(c, r.teamId)}</td><td>{r.played}</td><td>{r.wins}</td><td>{r.losses}</td>
                    <td>{r.mapsWon}–{r.mapsLost}</td><td className="muted">{r.roundsWon - r.roundsLost >= 0 ? '+' : ''}{r.roundsWon - r.roundsLost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
      <h3 className="mt">{t('stand.bracket')}</h3>
      <div className="bracket" data-testid="bracket">
        {(['qf', 'sf', 'final'] as const).map((r) => <div key={r} className="br-col">{po.filter((f) => f.round === r).map((f) => <Match key={f.id} c={c} f={f} />)}</div>)}
      </div>
      <p className="small muted">{t('stand.note')}</p>
    </>
  );
}

function InternationalEvent({ c, ev }: { c: CareerState; ev: IntlEvent }) {
  const { t } = useLang();
  if (!ev.start) return <div className="muted" data-testid="intl-pending">{t('stand.intlPending', { event: t(`career.enum.${ev.id}`) })}</div>;
  const rounds = (rs: string[]) => rs.map((r) => <div key={r} className="br-col">{ev.fixtures.filter((f) => f.round === r).map((f) => <Match key={f.id} c={c} f={f} />)}</div>);
  return (
    <>
      {ev.champion && <div className="home-matchday" data-testid="stand-champion">🏆 {t('stand.champion', { team: teamName(c, ev.champion) })} <span className="muted small">({t(`career.region.${c.world.teams[ev.champion]?.region ?? 'emea'}`)})</span></div>}
      <div className="small muted">{t('stand.intlField', { n: ev.teams.length, start: ev.start, end: ev.end ?? '' })}</div>
      <div className="chips" data-testid="intl-field">
        {ev.teams.map((id, i) => <span key={id} className={`ser-chip ${id === c.userTeamId ? 'me' : ''}`} title={t(`career.region.${ev.qualified[id]?.region ?? 'emea'}`)}>{i + 1}. {teamName(c, id)} <span className="muted">{ev.qualified[id]?.points ?? 0}</span></span>)}
      </div>
      <div className="stand-groups">
        {Object.keys(ev.groups).sort().map((g) => (
          <section key={g} className="md-card" data-testid={`intl-group-${g}`}>
            <h3>{t('career.group', { g: g.toUpperCase() })}</h3>
            <table className="nc-table">
              <thead><tr><th>#</th><th>{t('stand.team')}</th><th>{t('stand.p')}</th><th>{t('stand.w')}</th><th>{t('stand.l')}</th><th>{t('stand.maps')}</th></tr></thead>
              <tbody>
                {eventGroupTable(ev, g).map((r, i) => (
                  <tr key={r.teamId} className={`${r.teamId === c.userTeamId ? 'me' : ''} ${i < 2 ? 'qual' : ''}`}>
                    <td>{i + 1}</td><td>{teamName(c, r.teamId)}</td><td>{r.played}</td><td>{r.wins}</td><td>{r.losses}</td><td>{r.mapsWon}–{r.mapsLost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
      <h3 className="mt">{t('stand.upper')}</h3>
      <div className="bracket de" data-testid="de-upper">{rounds(['ubr1', 'ubr2', 'ubf'])}</div>
      <h3 className="mt">{t('stand.lower')}</h3>
      <div className="bracket de four" data-testid="de-lower">{rounds(['lbr1', 'lbr2', 'lbr3', 'lbf'])}</div>
      <h3 className="mt">{t('stand.grandFinal')}</h3>
      <div className="bracket de one" data-testid="de-final">{rounds(['gf'])}</div>
      <p className="small muted">{t('stand.deNote')}</p>
    </>
  );
}

function PointsRace({ c }: { c: CareerState }) {
  const { t } = useLang();
  return (
    <div className="stand-groups" data-testid="points-race">
      {REGIONS.map((r) => {
        const league = leaguesOf(c).find((l) => l.region === r)!;
        const rank = regionRanking(c.world, c.circuit, r, league.teams);
        return (
          <section key={r} className="md-card" data-testid={`points-${r}`}>
            <h3>{t(`career.region.${r}`)}</h3>
            <table className="nc-table">
              <thead><tr><th>#</th><th>{t('stand.team')}</th><th>{t('stand.cp')}</th><th>{t('stand.qual')}</th></tr></thead>
              <tbody>
                {rank.map((id, i) => {
                  const inEv = INTL_EVENTS.filter((e) => eventOf(c.circuit, e).teams.includes(id));
                  return (
                    <tr key={id} className={`${id === c.userTeamId ? 'me' : ''}`}>
                      <td>{i + 1}</td><td>{teamName(c, id)}</td><td>{c.circuit.points[id] ?? 0}</td>
                      <td className="small muted">{inEv.map((e) => t(`career.enum.${e}`)).join(', ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}

export function StandingsScreen() {
  const { t } = useLang();
  const cs = useCareer();
  const c = cs.career!;
  const started = (id: CompetitionId) => (STAGES as string[]).includes(id) ? !!c.season.stages.find((s) => s.id === id)?.start : !!eventOf(c.circuit, id as never).start;
  const order: CompetitionId[] = ['kickoff', 'stage1', 'masters1', 'stage2', 'masters2', 'champions'];
  const finished = (id: CompetitionId) => ((STAGES as string[]).includes(id) ? !!c.season.stages.find((s) => s.id === id)?.champion : !!eventOf(c.circuit, id as never).champion);
  // The competition being played now, else the latest one started.
  const current = order.find((id) => started(id) && !finished(id)) ?? [...order].reverse().find(started) ?? 'kickoff';
  const [tab, setTab] = useState<Tab>(current);
  const [region, setRegion] = useState<Region>(c.region);
  const isStage = (STAGES as string[]).includes(tab);
  return (
    <div className="pad stand" data-testid="standings">
      <div className="sched-head">
        <h2>{t('nav.standings')} <span className="muted small">{c.season.season}</span></h2>
        <div className="md-modetoggle" data-testid="stand-tabs">
          {order.map((id) => <button key={id} className={id === tab ? 'on' : ''} disabled={!started(id)} onClick={() => setTab(id)} data-testid={`stand-${id}`}>{t(`career.enum.${id}`)}</button>)}
          <button className={tab === 'points' ? 'on' : ''} onClick={() => setTab('points')} data-testid="stand-points">{t('stand.cp')}</button>
        </div>
      </div>
      {isStage && (
        <div className="md-modetoggle" style={{ marginBottom: 10 }} data-testid="stand-regions">
          {REGIONS.map((r) => <button key={r} className={r === region ? 'on' : ''} onClick={() => setRegion(r)} data-testid={`stand-region-${r}`}>{t(`career.region.${r}`)}</button>)}
        </div>
      )}
      {isStage && <RegionalStage c={c} region={region} stageId={tab as StageId} />}
      {!isStage && tab !== 'points' && <InternationalEvent c={c} ev={eventOf(c.circuit, tab as never)} />}
      {tab === 'points' && <PointsRace c={c} />}
    </div>
  );
}
