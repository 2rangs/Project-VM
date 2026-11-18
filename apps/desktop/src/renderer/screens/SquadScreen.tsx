import type { DetailPanel } from '../App.tsx';
import { players, toScale20, ATTR_GROUPS, RATINGS_DISCLAIMER, type JoinedPlayer } from '../data.ts';
import { DataTable, Rating, Flag, SourceTag, Disclaimer, type Column } from '../ui.tsx';

const ALL = players();

function headline(p: JoinedPlayer, key: string) {
  return toScale20(p.attributes[key]?.value ?? null);
}

function PlayerDetail({ p }: { p: JoinedPlayer }) {
  return (
    <div className="pdetail">
      <div className="pdetail-top">
        <div className="pdetail-name">{p.handle} <Flag cc={p.country} /></div>
        <div className="muted small">id {p.playerId} · {p.role} · {p.maps} maps {p.lowSample && <SourceTag type="low-sample" />}</div>
      </div>
      <div className="agentpool">
        <div className="muted small">Agent pool ({p.agentPool.length})</div>
        <div className="chips">{p.agentPool.slice(0, 14).map((a) => <span key={a} className="chip">{a}</span>)}{p.agentPool.length > 14 && <span className="chip muted">+{p.agentPool.length - 14}</span>}</div>
      </div>
      {Object.entries(ATTR_GROUPS).map(([group, keys]) => (
        <div key={group} className="attr-group">
          <div className="attr-grouplabel">{group}</div>
          {keys.filter((k) => k in p.attributes).map((k) => {
            const a = p.attributes[k];
            return (
              <div key={k} className="attr-row" data-testid={`attr-${k}`}>
                <span className="attr-name">{k.replace(/([A-Z])/g, ' $1')}</span>
                <Rating value20={toScale20(a.value)} uncertainty={a.uncertainty} reason={`no qualifying sample (nMaps ${a.nMaps ?? 0})`} />
              </div>
            );
          })}
        </div>
      ))}
      <p className="small muted mt">Scale: 0–1 estimate → 1–20 as <code>round(1 + v·19)</code>. Whisker = uncertainty. "est. N/A" = not estimable (reason on hover).</p>
    </div>
  );
}

export function SquadScreen({ setDetail }: { setDetail: (d: DetailPanel) => void }) {
  const cols: Column<JoinedPlayer>[] = [
    { key: 'handle', header: 'Handle', render: (p) => <b>{p.handle}</b>, sortValue: (p) => p.handle, width: '22%' },
    { key: 'country', header: '', render: (p) => <Flag cc={p.country} />, width: '8%' },
    { key: 'role', header: 'Role', render: (p) => p.role, sortValue: (p) => p.role, width: '14%' },
    { key: 'maps', header: 'Maps', render: (p) => p.maps, sortValue: (p) => p.maps, width: '10%' },
    { key: 'aim', header: 'Aim', render: (p) => <Rating value20={headline(p, 'aim')} uncertainty={p.attributes.aim?.uncertainty} />, sortValue: (p) => p.attributes.aim?.value ?? -1 },
    { key: 'impact', header: 'Impact', render: (p) => <Rating value20={headline(p, 'impact')} uncertainty={p.attributes.impact?.uncertainty} />, sortValue: (p) => p.attributes.impact?.value ?? -1 },
    { key: 'clutch', header: 'Clutch', render: (p) => <Rating value20={headline(p, 'clutch')} uncertainty={p.attributes.clutch?.uncertainty} />, sortValue: (p) => p.attributes.clutch?.value ?? -1 },
  ];
  return (
    <div className="pad squad">
      <h2>Squad / Scouting pool <span className="muted small">({ALL.length} VCT players)</span></h2>
      <Disclaimer text={RATINGS_DISCLAIMER} />
      <DataTable
        rows={ALL} columns={cols}
        filterKey={(p) => `${p.handle} ${p.role}`}
        initialSort={{ key: 'impact', dir: 'desc' }}
        rowId={(p) => p.playerId}
        onRowClick={(p) => setDetail({ title: `${p.handle} · ${p.role}`, body: <PlayerDetail p={p} /> })}
      />
    </div>
  );
}
