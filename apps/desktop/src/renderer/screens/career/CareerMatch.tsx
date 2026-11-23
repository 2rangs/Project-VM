// The manager's match day, in two steps:
//  1. lineup — pick today's five from the squad (roster + academy), seeing each player's form,
//     fatigue, sharpness and the readiness that scales their attributes for this match
//     (career/readiness.ts); or take an instant result;
//  2. series — the existing series screen (veto, then each map one-shot or round by round in
//     Match Day) with the chosen fives (readiness applied), our analyst and both teams' map
//     practice. The finished series is recorded into the career (standings, minutes, K/D, form).
import { useState } from 'react';
import type { ScreenCtx } from '../../App.tsx';
import { useLang } from '../../i18n/index.tsx';
import { chooseLineup, recordUserSeries, useCareer } from '../../career/session.ts';
import { dayAgenda, fatigueOf, lineupFor, quickSeries, readiness, scoutedAbility, seriesRequest, sharpnessOf } from '../../career/world.ts';
import { fixtureLabel, opponentOf, outcomeFromSeries, seriesSetup, teamName } from '../../career/view.ts';
import { SeriesScreen } from '../series/SeriesScreen.tsx';

const pct = (v: number) => Math.round(v * 100);

export function CareerMatch({ ctx, onDone }: { ctx: ScreenCtx; onDone: () => void }) {
  const { t } = useLang();
  const cs = useCareer();
  const c = cs.career!;
  const f = dayAgenda(c).userFixture;
  const [step, setStep] = useState<'lineup' | 'series'>('lineup');
  const [picked, setPicked] = useState<string[]>(() => lineupFor(c, c.userTeamId));
  if (!f) {
    return (
      <div className="pad" data-testid="career-match-none">
        <div className="muted">{t('career.match.none')}</div>
        <button className="ord-cancel mt" onClick={onDone}>{t('career.match.back')}</button>
      </div>
    );
  }
  /** Skip the match: the quick estimate plays it from the two fives' ability today (FM's instant result). */
  const instant = async () => {
    if (picked.length === 5) chooseLineup(picked);
    const req = seriesRequest(c, f);
    const out = quickSeries(req, c);
    await recordUserSeries(f.id, { ...out, lineups: { home: req.home.lineup, away: req.away.lineup } });
    onDone();
  };

  if (step === 'lineup') {
    const team = c.world.teams[c.userTeamId]!;
    const squad = [...team.roster, ...team.academy].map((id) => c.world.players[id]!).filter(Boolean);
    const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 5 ? p : [...p, id]));
    return (
      <div className="pad" data-testid="career-lineup">
        <h2>{t('lineup.title')} <span className="muted small">{fixtureLabel(t, f)} · {teamName(c, c.userTeamId)} vs {teamName(c, opponentOf(c, f))}</span></h2>
        <p className="small muted">{t('lineup.hint')}</p>
        <table className="nc-table lineup-table">
          <thead><tr><th /><th>{t('home.squad.player')}</th><th>{t('col.role')}</th><th>CA</th><th>{t('home.squad.form')}</th><th>{t('home.squad.maps')}</th><th>{t('lineup.fatigue')}</th><th>{t('lineup.sharpness')}</th><th>{t('lineup.readiness')}</th></tr></thead>
          <tbody>
            {squad.map((p) => {
              const on = picked.includes(p.playerId);
              const s = c.stats[p.playerId];
              const fat = fatigueOf(c.world, p.playerId);
              const r = readiness(c, p.playerId);
              return (
                <tr key={p.playerId} className={on ? 'me' : ''} onClick={() => toggle(p.playerId)} style={{ cursor: 'pointer' }} data-testid={`lineup-row-${p.playerId}`}>
                  <td><input type="checkbox" checked={on} readOnly data-testid={`lineup-pick-${p.playerId}`} /></td>
                  <td><b>{p.handle ?? p.playerId}</b>{p.status === 'academy' && <span className="soon-tag">{t('lineup.academy')}</span>}</td>
                  <td className="muted">{p.role ?? '—'}</td>
                  <td>{scoutedAbility(c.world, c.userTeamId, p).ca}</td>
                  <td>{s ? pct(s.form) : '—'}</td>
                  <td>{s?.maps ?? 0}</td>
                  <td className={fat > 0.3 ? 'form-down' : ''}>{pct(fat)}</td>
                  <td>{pct(sharpnessOf(c, p.playerId))}</td>
                  <td className={r < 0.97 ? 'form-down' : 'form-up'}>{pct(r)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="small muted">{t('lineup.formula')}</p>
        <div className="nc-actions">
          <button className="ord-cancel" onClick={onDone}>{t('career.match.back')}</button>
          <button className="ord-cancel" onClick={() => void instant()} disabled={!!cs.busy || picked.length !== 5} data-testid="career-instant" title={t('career.match.instantHint')}>{t('career.match.instant')}</button>
          <button className="md-run" disabled={picked.length !== 5} onClick={() => { chooseLineup(picked); setStep('series'); }} data-testid="lineup-confirm">
            {t('lineup.confirm', { n: picked.length })}
          </button>
        </div>
      </div>
    );
  }

  const setup = seriesSetup(c, f);
  return (
    <SeriesScreen
      key={`${f.id}:${(c.lineup ?? []).join(',')}`}
      ctx={ctx}
      fixture={{
        ...setup,
        label: `${fixtureLabel(t, f)} · ${f.date}`,
        onBack: () => setStep('lineup'),
        onFinished: async (view) => { await recordUserSeries(f.id, outcomeFromSeries(c, f, view)); onDone(); },
      }}
    />
  );
}
