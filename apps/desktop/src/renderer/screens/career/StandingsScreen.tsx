// Standings and the playoff bracket of each stage.
import { useState } from 'react';
import { useLang } from '../../i18n/index.tsx';
import { useCareer } from '../../career/session.ts';
import { groupStandings, GROUPS, SCHEDULE_MODEL, type Fixture, type StageId } from '../../career/world.ts';
import { teamName } from '../../career/view.ts';

export function StandingsScreen() {
  const { t } = useLang();
  const cs = useCareer();
  const c = cs.career!;
  const drawn = c.season.stages.filter((s) => s.start);
  const [stageId, setStageId] = useState<StageId>((drawn.find((s) => !s.champion) ?? drawn[drawn.length - 1] ?? c.season.stages[0]!).id);
  const stage = c.season.stages.find((s) => s.id === stageId)!;
  const po = c.season.fixtures.filter((f) => f.stage === stageId && f.phase === 'playoff');
  const slot = (f: Fixture, side: 'home' | 'away') => {
    const id = f[side];
    const src = side === 'home' ? f.homeFrom : f.awayFrom;
    if (id) return teamName(c, id);
    if (src?.kind === 'seed') return t('stand.seed', { g: t(`career.enum.${src.group}`), n: src.rank });
    return t('home.tbd');
  };
  const match = (f: Fixture) => {
    const won = (side: 'home' | 'away') => f.result && f.result.winner === f[side];
    return (
      <div key={f.id} className="br-match" data-testid={`bracket-${f.round}`}>
        <div className="muted small">{t(`career.enum.${f.round}`)} · {f.date} · {t(`career.enum.${f.format}`)}</div>
        {(['home', 'away'] as const).map((s, i) => (
          <div key={s} className={`br-team ${won(s) ? 'win' : ''} ${f[s] === c.userTeamId ? 'me' : ''}`}>
            <span>{slot(f, s)}</span><b>{f.result ? f.result.mapsWon[i] : ''}</b>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="pad stand" data-testid="standings">
      <div className="sched-head">
        <h2>{t('nav.standings')} <span className="muted small">{c.season.season}</span></h2>
        <div className="md-modetoggle">
          {c.season.stages.map((s) => <button key={s.id} className={s.id === stageId ? 'on' : ''} disabled={!s.start} onClick={() => setStageId(s.id)} data-testid={`stand-${s.id}`}>{t(`career.enum.${s.id}`)}</button>)}
        </div>
      </div>
      {!stage.start ? <div className="muted">{t('sched.stage2Pending')}</div> : (
        <>
          {stage.champion && <div className="home-matchday" data-testid="stand-champion">🏆 {t('stand.champion', { team: teamName(c, stage.champion) })}</div>}
          <div className="stand-groups">
            {GROUPS.map((g) => (
              <section key={g} className="md-card" data-testid={`group-${g}`}>
                <h3>{t('career.group', { g: t(`career.enum.${g}`) })}</h3>
                <table className="nc-table">
                  <thead><tr><th>#</th><th>{t('stand.team')}</th><th>{t('stand.p')}</th><th>{t('stand.w')}</th><th>{t('stand.l')}</th><th>{t('stand.maps')}</th><th>{t('stand.rounds')}</th></tr></thead>
                  <tbody>
                    {groupStandings(c.season, stageId, g).map((r, i) => (
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
            {(['qf', 'sf', 'final'] as const).map((r) => <div key={r} className="br-col">{po.filter((f) => f.round === r).map(match)}</div>)}
          </div>
          <p className="small muted">{t('stand.note')}</p>
        </>
      )}
    </div>
  );
}
