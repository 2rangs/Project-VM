import type { DetailPanel } from '../App.tsx';
import { teams, TEAMS_DISCLAIMER, type JoinedTeam } from '../data.ts';
import { DataTable, Flag, SourceTag, Disclaimer, type Column } from '../ui.tsx';

const ALL = teams();
const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);

const ECON_LABELS: Record<string, string> = {
  forceBuyAfterLoss: 'Force-buy after loss',
  pistolLossForceBuy: 'Force after pistol loss',
  bonusBuyRate: 'Bonus-round buy',
  antiEcoFullBuy: 'Anti-eco full buy',
  overtimeForceBuy: 'Overtime force-buy',
};

function TeamDetail({ t }: { t: JoinedTeam }) {
  const topMaps = Object.entries(t.mapPool).sort((a, b) => b[1] - a[1]).slice(0, 7);
  const maxMap = topMaps[0]?.[1] ?? 1;
  return (
    <div className="tdetail">
      <div className="pdetail-name">{t.name} <Flag cc={t.country} /></div>
      <div className="muted small">id {t.teamId} · {t.maps} maps {t.lowSample && <SourceTag type="low-sample" />}</div>

      <div className="attr-grouplabel mt">Economy tendency <SourceTag type="estimate" /></div>
      {Object.entries(ECON_LABELS).map(([k, label]) => {
        const e = t.economy[k];
        return (
          <div key={k} className="attr-row">
            <span className="attr-name">{label}</span>
            <span className="econ-val">{pct(e?.value)} <span className="muted small">n={e?.n ?? 0}</span></span>
          </div>
        );
      })}

      <div className="attr-grouplabel mt">Map pool</div>
      {topMaps.map(([m, n]) => (
        <div key={m} className="attr-row">
          <span className="attr-name">{m}</span>
          <span className="rating-track" style={{ width: 120 }}><span className="rating-fill" style={{ width: `${(n / maxMap) * 100}%` }} /></span>
          <span className="muted small">{n}</span>
        </div>
      ))}

      <div className="attr-grouplabel mt">Side tendency · positioning</div>
      <div className="row small muted">데이터 없음 (no side/position tendency in current profile)</div>
    </div>
  );
}

export function OpponentScreen({ setDetail }: { setDetail: (d: DetailPanel) => void }) {
  const cols: Column<JoinedTeam>[] = [
    { key: 'name', header: 'Team', render: (t) => <b>{t.name}</b>, sortValue: (t) => t.name, width: '30%' },
    { key: 'country', header: '', render: (t) => <Flag cc={t.country} />, width: '8%' },
    { key: 'maps', header: 'Maps', render: (t) => t.maps, sortValue: (t) => t.maps, width: '12%' },
    { key: 'force', header: 'Force-after-loss', render: (t) => pct(t.economy.forceBuyAfterLoss?.value), sortValue: (t) => t.economy.forceBuyAfterLoss?.value ?? -1 },
    { key: 'ascent', header: 'Ascent maps', render: (t) => t.mapPool.Ascent ?? 0, sortValue: (t) => t.mapPool.Ascent ?? 0 },
  ];
  return (
    <div className="pad opponent">
      <h2>Opponent Report <span className="muted small">({ALL.length} teams)</span></h2>
      <Disclaimer text={TEAMS_DISCLAIMER} />
      <DataTable
        rows={ALL} columns={cols}
        filterKey={(t) => t.name}
        initialSort={{ key: 'maps', dir: 'desc' }}
        rowId={(t) => t.teamId}
        onRowClick={(t) => setDetail({ title: t.name, body: <TeamDetail t={t} /> })}
      />
    </div>
  );
}
