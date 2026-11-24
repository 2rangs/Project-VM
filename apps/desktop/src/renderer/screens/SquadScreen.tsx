import type { DetailPanel } from '../App.tsx';
import { players, toScale20, ATTR_GROUPS, RATINGS_DISCLAIMER, type JoinedPlayer } from '../data.ts';
import { DataTable, Rating, Flag, SourceTag, Disclaimer, type Column } from '../ui.tsx';
import { useT } from '../i18n/index.tsx';
import { useWorld } from '../career/store.ts';
import { scoutedAbility, type World, type WorldPlayer } from '../career/world.ts';
import { ContractPanel } from './club/ContractPanel.tsx';
import { useState } from 'react';
import { updateWorld } from '../career/store.ts';
import { useCareer } from '../career/session.ts';
import { assign, fogged, knowledgePct, playerView, range20, range200, scoutRows } from '../career/scouting.ts';
import { DevChart, KnowledgeBadge, OwnPlayerPanel, RangeBar, ReportBox } from './scouting/parts.tsx';

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

/** Put one of the club's scouts on this player. */
function ScoutThisPlayer({ w, playerId }: { w: World; playerId: string }) {
  const t = useT();
  const date = useCareer().career?.date ?? w.club?.date ?? `${w.season}-01-05`;
  const rows = scoutRows(w);
  const [scoutId, setScoutId] = useState(rows[0]?.scout.staffId ?? '');
  if (rows.length === 0) return null;
  const on = rows.filter((r) => r.assignment?.kind === 'player' && r.assignment.target === playerId);
  return (
    <div className="small scout-this">
      {on.length > 0 ? <span data-testid="scout-on-player">{t('scout.onPlayer', { scouts: on.map((r) => r.scout.name).join(', ') })}</span> : (
        <>
          <select value={scoutId} onChange={(e) => setScoutId(e.target.value)} data-testid="scout-pick">
            {rows.map((r) => <option key={r.scout.staffId} value={r.scout.staffId}>{r.scout.name}</option>)}
          </select>{' '}
          <button className="club-btn" data-testid="scout-assign-player" onClick={() => updateWorld((x) => assign(x, scoutId, 'player', playerId, date))}>{t('scout.assignPlayer')}</button>
        </>
      )}
    </div>
  );
}

export function PlayerDetail({ p, w }: { p: SquadRow; w: World }) {
  const t = useT();
  if (fogged(w)) return <FoggedDetail p={p} w={w} />;
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
      <ContractPanel playerId={p.playerId} />
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

/** The career's player page: what the manager's club knows (ranges), reports, development, academy. */
function FoggedDetail({ p, w }: { p: SquadRow; w: World }) {
  const t = useT();
  const date = useCareer().career?.date;
  const v = playerView(w, p.world, date);
  const ca = range200(v.ca), pa = range200(v.pa);
  const own = v.own;
  return (
    <div className="pdetail" data-testid="player-detail">
      <div className="pdetail-top">
        <div className="pdetail-name">{p.handle} <Flag cc={p.country} /> {p.generated && <GenTag />}</div>
        {p.name && <div className="small">{p.name}</div>}
        <div className="muted small">{t('squad.meta', { id: p.playerId, role: p.role, maps: p.maps })}</div>
        <div className="muted small">
          {t(p.ageEstimated ? 'career.ageEst' : 'career.age', { n: p.age })} · {p.teamName ? t(`career.status.${p.status}`, { team: p.teamName }) : t('career.status.free')}
        </div>
        <div className="small mt" data-testid="ability-estimate">
          {t('career.caPa', { caLo: ca.lo, caHi: ca.hi, paLo: pa.lo, paHi: pa.hi })} {own ? <span className="know-badge hi" data-testid="knowledge-own">{t('scout.ownPlayer')}</span> : <KnowledgeBadge pct={knowledgePct(w, p.world, date)} />}
        </div>
      </div>
      <ContractPanel playerId={p.playerId} />
      {!own && <ReportBox w={w} playerId={p.playerId} />}
      {!own && <ScoutThisPlayer w={w} playerId={p.playerId} />}
      <OwnPlayerPanel p={p.world} />
      <DevChart w={w} p={p.world} own={own} />
      <div className="agentpool">
        <div className="muted small">{t('squad.agentPool', { n: p.agentPool.length })}</div>
        <div className="chips">{p.agentPool.slice(0, 14).map((a) => <span key={a} className="chip">{a}</span>)}</div>
      </div>
      {Object.entries(ATTR_GROUPS).map(([group, keys]) => (
        <div key={group} className="attr-group">
          <div className="attr-grouplabel">{t(`attr.group.${group}`)}</div>
          {keys.filter((k) => k in p.attributes).map((k) => {
            const r = v.attributes[k];
            return (
              <div key={k} className="attr-row" data-testid={`attr-${k}`}>
                <span className="attr-name">{t(`attr.${k}`)}</span>
                {r ? <RangeBar r={range20(r)} /> : <Rating value20={null} reason={t('scout.unrated')} />}
              </div>
            );
          })}
        </div>
      ))}
      <p className="small muted mt">{t(own ? 'scout.ownNote' : 'scout.fogNote')}</p>
    </div>
  );
}

export function SquadScreen({ setDetail }: { setDetail: (d: DetailPanel) => void }) {
  const t = useT();
  const w = useWorld();
  const rows = Object.values(w.players).filter((p) => p.hasRatings).map((p) => squadRow(w, p));
  const generated = rows.filter((r) => r.generated).length;
  const fog = fogged(w);
  const date = useCareer().career?.date;
  const views = new Map(fog ? rows.map((r) => [r.playerId, playerView(w, r.world, date)]) : []);
  const fogCol = (key: string, label: string): Column<SquadRow> => ({
    key, header: label,
    render: (p) => { const r = views.get(p.playerId)?.attributes[key]; return r ? <RangeBar r={range20(r)} /> : <Rating value20={null} />; },
    sortValue: (p) => views.get(p.playerId)?.attributes[key]?.est ?? -1,
  });
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
  if (fog) {
    // The career shows what the club knows: ranges for everyone outside the club.
    cols.splice(5, 3, fogCol('aim', t('col.aim')), fogCol('impact', t('col.impact')),
      { key: 'know', header: t('col.knowledge'), render: (p) => `${Math.round(100 * (views.get(p.playerId)?.knowledge ?? 1))}%`, sortValue: (p) => views.get(p.playerId)?.knowledge ?? 1 });
  }
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
