// Scouting · career world: this season's new prospects (generated players), the free-agent pool,
// staff (all generated — the dataset has none), and the season button that runs the yearly flow
// (development, retirements, intake, academy picks, signings). The world saves itself.
import { useState } from 'react';
import type { DetailPanel } from '../App.tsx';
import { DataTable, Flag, type Column } from '../ui.tsx';
import { useT } from '../i18n/index.tsx';
import { advanceWorld, resetWorld, useWorld } from '../career/store.ts';
import { useCareer } from '../career/session.ts';
import {
  freeAgents, newProspects, populationSummary, scoutedAbility, staffQuality, toScale200, STAFF_ATTRS,
  type World, type WorldStaff,
} from '../career/world.ts';
import { GenTag, PlayerDetail, squadRow, type SquadRow } from './SquadScreen.tsx';

type Tab = 'prospects' | 'free' | 'staff';

const to20 = (v: number) => Math.max(1, Math.min(20, Math.round(1 + v * 19)));

function StaffDetail({ s, w }: { s: WorldStaff; w: World }) {
  const t = useT();
  return (
    <div className="pdetail" data-testid="staff-detail">
      <div className="pdetail-name">{s.name} <Flag cc={s.country} /> {s.generated && <GenTag />}</div>
      <div className="muted small">
        {t(`career.staffRole.${s.role}`)} · {t('career.age', { n: s.age })} · {s.teamId ? w.teams[s.teamId]?.name ?? s.teamId : t('career.status.free')}
      </div>
      <div className="attr-group">
        {STAFF_ATTRS[s.role].map((k) => (
          <div key={k} className="attr-row">
            <span className="attr-name">{t(`career.staffAttr.${k}`)}</span>
            <span className="rating-num">{to20(s.attributes[k] ?? 0)}</span>
          </div>
        ))}
      </div>
      <p className="small muted mt">{t(`career.staffUse.${s.role}`)}</p>
    </div>
  );
}

export function ScoutingScreen({ setDetail }: { setDetail: (d: DetailPanel) => void }) {
  const t = useT();
  const w = useWorld();
  // [career] in a career the world advances through the calendar and our own scout judges players.
  const career = useCareer().career;
  const viewer = career?.userTeamId ?? null;
  const [tab, setTab] = useState<Tab>('prospects');
  const pop = populationSummary(w);
  const last = w.history[w.history.length - 1];

  const playerCols: Column<SquadRow>[] = [
    { key: 'handle', header: t('col.handle'), render: (p) => <><b>{p.handle}</b>{p.generated && <GenTag />}</>, sortValue: (p) => p.handle, width: '16%' },
    { key: 'name', header: t('col.name'), render: (p) => p.name ?? '—', sortValue: (p) => p.name ?? '', width: '18%' },
    { key: 'country', header: '', render: (p) => <Flag cc={p.country} />, width: '6%' },
    { key: 'age', header: t('col.age'), render: (p) => p.age, sortValue: (p) => p.age, width: '6%' },
    { key: 'role', header: t('col.role'), render: (p) => p.role, sortValue: (p) => p.role, width: '11%' },
    { key: 'ca', header: t('col.ca'), render: (p) => { const e = scoutedAbility(w, viewer, p.world); return `${e.caLo}–${e.caHi}`; }, sortValue: (p) => scoutedAbility(w, viewer, p.world).ca, width: '10%' },
    { key: 'pa', header: t('col.pa'), render: (p) => { const e = scoutedAbility(w, viewer, p.world); return `${e.paLo}–${e.paHi}`; }, sortValue: (p) => scoutedAbility(w, viewer, p.world).pa, width: '10%' },
    { key: 'club', header: t('col.club'), render: (p) => (p.teamName ? t(`career.status.${p.status}`, { team: p.teamName }) : t('career.status.free')), sortValue: (p) => p.teamName ?? '~' },
  ];
  const staffCols: Column<WorldStaff>[] = [
    { key: 'name', header: t('col.name'), render: (s) => <><b>{s.name}</b>{s.generated && <GenTag />}</>, sortValue: (s) => s.name, width: '24%' },
    { key: 'country', header: '', render: (s) => <Flag cc={s.country} />, width: '6%' },
    { key: 'role', header: t('col.role'), render: (s) => t(`career.staffRole.${s.role}`), sortValue: (s) => s.role, width: '14%' },
    { key: 'age', header: t('col.age'), render: (s) => s.age, sortValue: (s) => s.age, width: '7%' },
    { key: 'q', header: t('col.quality'), render: (s) => to20(staffQuality(s)), sortValue: (s) => staffQuality(s), width: '9%' },
    { key: 'club', header: t('col.club'), render: (s) => (s.teamId ? w.teams[s.teamId]?.name ?? s.teamId : t('career.status.free')), sortValue: (s) => (s.teamId ? w.teams[s.teamId]?.name ?? s.teamId : '~') },
  ];
  const prospects = newProspects(w).map((p) => squadRow(w, p));
  const free = freeAgents(w).filter((p) => p.hasRatings).map((p) => squadRow(w, p));
  const staff = Object.values(w.staff);
  const openPlayer = (p: SquadRow) => setDetail({ title: `${p.handle} · ${p.role}`, body: <PlayerDetail p={p} w={w} /> });

  return (
    <div className="pad scouting" data-testid="career-screen">
      <h2>{t('career.title')} <span className="muted small" data-testid="career-season">{t('career.season', { season: w.season })}</span></h2>
      <div className="career-bar">
        <span className="small">{t('career.population', { players: pop.players, gen: pop.generated, staff: pop.staff })}</span>
        {last && <span className="small muted">{t('career.lastIntake', { season: last.season, n: last.newPlayers.length, retired: last.retiredPlayers.length, signed: last.signings.length })}</span>}
        {!career && <button className="career-advance" onClick={() => { setDetail(null); advanceWorld(); }} data-testid="career-advance">{t('career.advance')}</button>}
        {!career && <button className="career-reset" onClick={() => { setDetail(null); resetWorld(); }} data-testid="career-reset">{t('career.reset')}</button>}
      </div>
      <div className="md-tabs">
        <button className={tab === 'prospects' ? 'on' : ''} onClick={() => setTab('prospects')} data-testid="career-tab-prospects">{t('career.tab.prospects', { season: w.season, n: prospects.length })}</button>
        <button className={tab === 'free' ? 'on' : ''} onClick={() => setTab('free')} data-testid="career-tab-free">{t('career.tab.free', { n: free.length })}</button>
        <button className={tab === 'staff' ? 'on' : ''} onClick={() => setTab('staff')} data-testid="career-tab-staff">{t('career.tab.staff', { n: staff.length })}</button>
      </div>
      <p className="small muted">{t(`career.hint.${tab}`)}</p>
      {tab === 'prospects' && (
        <DataTable rows={prospects} columns={playerCols} filterKey={(p) => `${p.handle} ${p.name ?? ''} ${p.role} ${p.country ?? ''}`}
          initialSort={{ key: 'pa', dir: 'desc' }} rowId={(p) => p.playerId} onRowClick={openPlayer} />
      )}
      {tab === 'free' && (
        <DataTable rows={free} columns={playerCols} filterKey={(p) => `${p.handle} ${p.name ?? ''} ${p.role} ${p.country ?? ''}`}
          initialSort={{ key: 'ca', dir: 'desc' }} rowId={(p) => p.playerId} onRowClick={openPlayer} />
      )}
      {tab === 'staff' && (
        <DataTable rows={staff} columns={staffCols} filterKey={(s) => `${s.name} ${s.role} ${s.country}`}
          initialSort={{ key: 'q', dir: 'desc' }} rowId={(s) => s.staffId}
          onRowClick={(s) => setDetail({ title: `${s.name} · ${t(`career.staffRole.${s.role}`)}`, body: <StaffDetail s={s} w={w} /> })} />
      )}
      <p className="small muted mt">{t('career.scaleNote', { lo: toScale200(0)!, hi: toScale200(1)! })}</p>
    </div>
  );
}
