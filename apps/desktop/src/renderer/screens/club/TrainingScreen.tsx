// Training: the weekly team focus (and the map for tactics weeks) and each player's individual
// focus, with fatigue and where this season's development is heading. Training changes inputs of
// existing formulas only: development focus factors and map-practice games (docs/CLUB_OPERATIONS.md §5).
import type { DetailPanel } from '../../App.tsx';
import { DataTable, type Column } from '../../ui.tsx';
import { useT } from '../../i18n/index.tsx';
import { updateWorld, useWorld } from '../../career/store.ts';
import { INDIV_FOCI, TEAM_FOCI, setIndividualFocus, setTrainingPlan, defaultPlan, type IndivFocus, type TeamFocus } from '../../career/world.ts';
import { trainingRows, userTeamId, type TrainingRow } from '../../career/club.ts';
import { ContractPanel } from './ContractPanel.tsx';
import { ClubClock } from './FinanceScreen.tsx';
import './club.css';

/** The competitive map rotation the series layer uses by default (docs/SERIES_AND_VETO.md). */
export const PRACTICE_MAPS = ['Abyss', 'Ascent', 'Haven', 'Lotus', 'Split', 'Summit', 'Sunset'];

export function TrainingScreen({ setDetail }: { setDetail: (d: DetailPanel) => void }) {
  const t = useT();
  const w = useWorld();
  const uid = userTeamId(w);
  if (!uid) return <div className="pad">{t('club.noClub')}</div>;
  const plan = w.club!.training.plans[uid] ?? defaultPlan();
  const practice = w.club!.training.mapPractice[uid] ?? {};
  const rows = trainingRows(w);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const cols: Column<TrainingRow>[] = [
    { key: 'handle', header: t('col.handle'), render: (r) => <b>{r.handle}</b>, sortValue: (r) => r.handle, width: '16%' },
    { key: 'role', header: t('col.role'), render: (r) => r.role, sortValue: (r) => r.role, width: '11%' },
    { key: 'age', header: t('col.age'), render: (r) => r.age, sortValue: (r) => r.age, width: '6%' },
    {
      key: 'focus', header: t('club.train.indiv'), width: '18%',
      render: (r) => (
        <select value={r.focus} onClick={(e) => e.stopPropagation()} onChange={(e) => updateWorld((x) => setIndividualFocus(x, uid, r.playerId, e.target.value as IndivFocus))} data-testid={`indiv-${r.playerId}`}>
          {INDIV_FOCI.map((f) => <option key={f} value={f}>{t(`club.focus.${f}`)}</option>)}
        </select>
      ),
    },
    { key: 'fatigue', header: t('club.train.fatigue'), render: (r) => <span className={r.fatigue > 0.3 ? 'warn' : ''}>{pct(r.fatigue)}</span>, sortValue: (r) => r.fatigue, width: '10%' },
    {
      key: 'dir', header: t('club.train.direction'),
      render: (r) => r.factors ? `${t('club.focus.mechanics')} ×${(r.factors.aim ?? 1).toFixed(2)} · ${t('club.focus.utility')} ×${(r.factors.impact ?? 1).toFixed(2)} · ${t('club.focus.teamplay')} ×${(r.factors.trading ?? 1).toFixed(2)}` : t('club.train.noWeeks'),
    },
  ];
  return (
    <div className="pad club" data-testid="training-screen">
      <h2>{t('club.training.title')} <span className="muted small">{w.teams[uid]?.name}</span></h2>
      <div className="career-bar"><ClubClock /></div>
      <div className="attr-grouplabel">{t('club.train.team')}</div>
      <div className="md-tabs focus-tabs">
        {TEAM_FOCI.map((f) => (
          <button key={f} className={plan.teamFocus === f ? 'on' : ''} onClick={() => updateWorld((x) => setTrainingPlan(x, uid, { teamFocus: f as TeamFocus }))} data-testid={`team-focus-${f}`}>{t(`club.focus.${f}`)}</button>
        ))}
      </div>
      <p className="small muted">{t(`club.focusHint.${plan.teamFocus}`)}</p>
      {plan.teamFocus === 'tactics' && (
        <label className="small">{t('club.train.map')}
          <select value={plan.map ?? ''} onChange={(e) => updateWorld((x) => setTrainingPlan(x, uid, { map: e.target.value || null }))} data-testid="practice-map">
            <option value="">—</option>
            {PRACTICE_MAPS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      )}
      {Object.keys(practice).length > 0 && (
        <div className="small mt" data-testid="map-practice">{t('club.train.practiceDone')} {Object.entries(practice).map(([m, g]) => `${m} ${Math.max(0, ...Object.values(g)).toFixed(1)}`).join(' · ')}</div>
      )}
      <DataTable rows={rows} columns={cols} rowId={(r) => r.playerId} initialSort={{ key: 'role', dir: 'asc' }}
        onRowClick={(r) => setDetail({ title: r.handle, body: <ContractPanel playerId={r.playerId} /> })} />
      <p className="small muted mt">{t('club.training.note')}</p>
    </div>
  );
}
