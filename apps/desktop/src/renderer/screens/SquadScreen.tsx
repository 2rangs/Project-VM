import type { DetailPanel } from '../App.tsx';
import { players, toScale20, ATTR_GROUPS, RATINGS_DISCLAIMER, type JoinedPlayer } from '../data.ts';
import { DataTable, Rating, Flag, SourceTag, Disclaimer, type Column } from '../ui.tsx';
import { useT } from '../i18n/index.tsx';
import { useWorld } from '../career/store.ts';
import { scoutedAbility, type World, type WorldPlayer } from '../career/world.ts';

const DATASET = new Map(players().map((p) => [p.playerId, p]));

/** A player row: the dataset's view of a real player, or a generated one, as the career world has them now. */
export interface SquadRow extends JoinedPlayer {
  generated: boolean;
  name: string | null;
  age: number;
  ageEstimated: boolean;
  teamName: string | null;
  status: WorldPlayer['status'];
  world: WorldPlayer;
}

export function squadRow(w: World, p: WorldPlayer): SquadRow {
  const ds = DATASET.get(p.playerId);
  return {
    playerId: p.playerId,
    maps: p.generated ? p.careerMaps : ds?.maps ?? 0,
    role: p.role ?? '—',
    agentPool: p.agentPool,
    lowSample: ds?.lowSample ?? false,
    attributes: (p.attributes ?? {}) as JoinedPlayer['attributes'],
    handle: p.handle ?? `#${p.playerId}`,
    country: p.country,
    generated: p.generated,
    name: p.name,
    age: p.age,
    ageEstimated: p.ageEstimated,
    teamName: p.teamId ? w.teams[p.teamId]?.name ?? p.teamId : null,
    status: p.status,
    world: p,
  };
}

export function GenTag() {
  const t = useT();
  return <span className="gen-tag" title={t('career.generatedHint')} data-testid="gen-tag">{t('career.generated')}</span>;
}

function headline(p: JoinedPlayer, key: string) {
  return toScale20(p.attributes[key]?.value ?? null);
}

export function PlayerDetail({ p, w }: { p: SquadRow; w: World }) {
  const t = useT();
  const est = scoutedAbility(w, null, p.world);
  return (
    <div className="pdetail" data-testid="player-detail">
      <div className="pdetail-top">
        <div className="pdetail-name">{p.handle} <Flag cc={p.country} /> {p.generated && <GenTag />}</div>
        {p.name && <div className="small">{p.name}</div>}
        <div className="muted small">{t('squad.meta', { id: p.playerId, role: p.role, maps: p.maps })} {p.lowSample && <SourceTag type="low-sample" />}</div>
        <div className="muted small">
          {t(p.ageEstimated ? 'career.ageEst' : 'career.age', { n: p.age })} · {p.teamName ? t(`career.status.${p.status}`, { team: p.teamName }) : t('career.status.free')}
        </div>
        <div className="small mt" data-testid="ability-estimate">
          {t('career.caPa', { caLo: est.caLo, caHi: est.caHi, paLo: est.paLo, paHi: est.paHi })}
        </div>
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
      <p className="small muted">{t('career.caPaNote')}</p>
    </div>
  );
}

export function SquadScreen({ setDetail }: { setDetail: (d: DetailPanel) => void }) {
  const t = useT();
  const w = useWorld();
  const rows = Object.values(w.players).filter((p) => p.hasRatings).map((p) => squadRow(w, p));
  const generated = rows.filter((r) => r.generated).length;
  const cols: Column<SquadRow>[] = [
    { key: 'handle', header: t('col.handle'), render: (p) => <><b>{p.handle}</b>{p.generated && <GenTag />}</>, sortValue: (p) => p.handle, width: '22%' },
    { key: 'country', header: '', render: (p) => <Flag cc={p.country} />, width: '7%' },
    { key: 'role', header: t('col.role'), render: (p) => p.role, sortValue: (p) => p.role, width: '12%' },
    { key: 'age', header: t('col.age'), render: (p) => p.age, sortValue: (p) => p.age, width: '7%' },
    { key: 'maps', header: t('col.maps'), render: (p) => p.maps, sortValue: (p) => p.maps, width: '8%' },
    { key: 'aim', header: t('col.aim'), render: (p) => <Rating value20={headline(p, 'aim')} uncertainty={p.attributes.aim?.uncertainty} />, sortValue: (p) => p.attributes.aim?.value ?? -1 },
    { key: 'impact', header: t('col.impact'), render: (p) => <Rating value20={headline(p, 'impact')} uncertainty={p.attributes.impact?.uncertainty} />, sortValue: (p) => p.attributes.impact?.value ?? -1 },
    { key: 'clutch', header: t('col.clutch'), render: (p) => <Rating value20={headline(p, 'clutch')} uncertainty={p.attributes.clutch?.uncertainty} />, sortValue: (p) => p.attributes.clutch?.value ?? -1 },
  ];
  return (
    <div className="pad squad">
      <h2>{t('squad.title')} <span className="muted small">{t('squad.subWorld', { n: rows.length, gen: generated, season: w.season })}</span></h2>
      <Disclaimer text={RATINGS_DISCLAIMER} />
      <DataTable
        rows={rows} columns={cols}
        filterKey={(p) => `${p.handle} ${p.role} ${p.name ?? ''}`}
        initialSort={{ key: 'impact', dir: 'desc' }}
        rowId={(p) => p.playerId}
        onRowClick={(p) => setDetail({ title: `${p.handle} · ${p.role}`, body: <PlayerDetail p={p} w={w} /> })}
      />
    </div>
  );
}
