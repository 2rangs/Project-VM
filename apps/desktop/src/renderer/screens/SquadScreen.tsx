import type { DetailPanel } from '../App.tsx';
import { players, toScale20, ATTR_GROUPS, RATINGS_DISCLAIMER, type JoinedPlayer } from '../data.ts';
import { DataTable, Rating, Flag, SourceTag, Disclaimer, type Column } from '../ui.tsx';
import { useT } from '../i18n/index.tsx';

const ALL = players();

function headline(p: JoinedPlayer, key: string) {
  return toScale20(p.attributes[key]?.value ?? null);
}

function PlayerDetail({ p }: { p: JoinedPlayer }) {
  const t = useT();
  return (
    <div className="pdetail">
      <div className="pdetail-top">
        <div className="pdetail-name">{p.handle} <Flag cc={p.country} /></div>
        <div className="muted small">{t('squad.meta', { id: p.playerId, role: p.role, maps: p.maps })} {p.lowSample && <SourceTag type="low-sample" />}</div>
      </div>
      <div className="agentpool">
        <div className="muted small">{t('squad.agentPool', { n: p.agentPool.length })}</div>
        <div className="chips">{p.agentPool.slice(0, 14).map((a) => <span key={a} className="chip">{a}</span>)}{p.agentPool.length > 14 && <span className="chip muted">+{p.agentPool.length - 14}</span>}</div>
      </div>
      {Object.entries(ATTR_GROUPS).map(([group, keys]) => (
        <div key={group} className="attr-group">
          <div className="attr-grouplabel">{t(`attr.group.${group}`)}</div>
          {keys.filter((k) => k in p.attributes).map((k) => {
            const a = p.attributes[k];
            return (
              <div key={k} className="attr-row" data-testid={`attr-${k}`}>
                <span className="attr-name">{t(`attr.${k}`)}</span>
                <Rating value20={toScale20(a.value)} uncertainty={a.uncertainty} reason={`no qualifying sample (nMaps ${a.nMaps ?? 0})`} />
              </div>
            );
          })}
        </div>
      ))}
      <p className="small muted mt">{t('squad.scaleNote')}</p>
    </div>
  );
}

export function SquadScreen({ setDetail }: { setDetail: (d: DetailPanel) => void }) {
  const t = useT();
  const cols: Column<JoinedPlayer>[] = [
    { key: 'handle', header: t('col.handle'), render: (p) => <b>{p.handle}</b>, sortValue: (p) => p.handle, width: '22%' },
    { key: 'country', header: '', render: (p) => <Flag cc={p.country} />, width: '8%' },
    { key: 'role', header: t('col.role'), render: (p) => p.role, sortValue: (p) => p.role, width: '14%' },
    { key: 'maps', header: t('col.maps'), render: (p) => p.maps, sortValue: (p) => p.maps, width: '10%' },
    { key: 'aim', header: t('col.aim'), render: (p) => <Rating value20={headline(p, 'aim')} uncertainty={p.attributes.aim?.uncertainty} />, sortValue: (p) => p.attributes.aim?.value ?? -1 },
    { key: 'impact', header: t('col.impact'), render: (p) => <Rating value20={headline(p, 'impact')} uncertainty={p.attributes.impact?.uncertainty} />, sortValue: (p) => p.attributes.impact?.value ?? -1 },
    { key: 'clutch', header: t('col.clutch'), render: (p) => <Rating value20={headline(p, 'clutch')} uncertainty={p.attributes.clutch?.uncertainty} />, sortValue: (p) => p.attributes.clutch?.value ?? -1 },
  ];
  return (
    <div className="pad squad">
      <h2>{t('squad.title')} <span className="muted small">{t('squad.sub', { n: ALL.length })}</span></h2>
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
