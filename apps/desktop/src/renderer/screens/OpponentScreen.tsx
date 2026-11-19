import type { DetailPanel } from '../App.tsx';
import { teams, TEAMS_DISCLAIMER, type JoinedTeam } from '../data.ts';
import { DataTable, Flag, SourceTag, Disclaimer, type Column } from '../ui.tsx';
import { useT } from '../i18n/index.tsx';

const ALL = teams();
const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);

const ECON_KEYS = ['forceBuyAfterLoss', 'pistolLossForceBuy', 'bonusBuyRate', 'antiEcoFullBuy', 'overtimeForceBuy'];

function TeamDetail({ team }: { team: JoinedTeam }) {
  const t = useT();
  const topMaps = Object.entries(team.mapPool).sort((a, b) => b[1] - a[1]).slice(0, 7);
  const maxMap = topMaps[0]?.[1] ?? 1;
  return (
    <div className="tdetail">
      <div className="pdetail-name">{team.name} <Flag cc={team.country} /></div>
      <div className="muted small">{t('opp.meta', { id: team.teamId, maps: team.maps })} {team.lowSample && <SourceTag type="low-sample" />}</div>

      <div className="attr-grouplabel mt">{t('opp.econTendency')} <SourceTag type="estimate" /></div>
      {ECON_KEYS.map((k) => {
        const e = team.economy[k];
        return (
          <div key={k} className="attr-row">
            <span className="attr-name">{t(`econ.${k}`)}</span>
            <span className="econ-val">{pct(e?.value)} <span className="muted small">n={e?.n ?? 0}</span></span>
          </div>
        );
      })}

      <div className="attr-grouplabel mt">{t('opp.mapPool')}</div>
      {topMaps.map(([m, n]) => (
        <div key={m} className="attr-row">
          <span className="attr-name">{m}</span>
          <span className="rating-track" style={{ width: 120 }}><span className="rating-fill" style={{ width: `${(n / maxMap) * 100}%` }} /></span>
          <span className="muted small">{n}</span>
        </div>
      ))}

      <div className="attr-grouplabel mt">{t('opp.sideTendency')}</div>
      <div className="row small muted">{t('opp.noSideData')}</div>
    </div>
  );
}

export function OpponentScreen({ setDetail }: { setDetail: (d: DetailPanel) => void }) {
  const t = useT();
  const cols: Column<JoinedTeam>[] = [
    { key: 'name', header: t('opp.col.team'), render: (team) => <b>{team.name}</b>, sortValue: (team) => team.name, width: '30%' },
    { key: 'country', header: '', render: (team) => <Flag cc={team.country} />, width: '8%' },
    { key: 'maps', header: t('opp.col.maps'), render: (team) => team.maps, sortValue: (team) => team.maps, width: '12%' },
    { key: 'force', header: t('opp.col.force'), render: (team) => pct(team.economy.forceBuyAfterLoss?.value), sortValue: (team) => team.economy.forceBuyAfterLoss?.value ?? -1 },
    { key: 'ascent', header: t('opp.col.ascent'), render: (team) => team.mapPool.Ascent ?? 0, sortValue: (team) => team.mapPool.Ascent ?? 0 },
  ];
  return (
    <div className="pad opponent">
      <h2>{t('opp.title')} <span className="muted small">{t('opp.sub', { n: ALL.length })}</span></h2>
      <Disclaimer text={TEAMS_DISCLAIMER} />
      <DataTable
        rows={ALL} columns={cols}
        filterKey={(team) => team.name}
        initialSort={{ key: 'maps', dir: 'desc' }}
        rowId={(team) => team.teamId}
        onRowClick={(team) => setDetail({ title: team.name, body: <TeamDetail team={team} /> })}
      />
    </div>
  );
}
