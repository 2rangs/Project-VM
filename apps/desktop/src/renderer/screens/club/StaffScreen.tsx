// Staff market: the club's head coach, analyst, scout and physio, and the free staff of each role
// with what they would ask. Staff reach the game only through formulas that read them
// (docs/CLUB_OPERATIONS.md §12): development, morale, opponent analysis, scouting error, recovery.
import { useState } from 'react';
import type { DetailPanel } from '../../App.tsx';
import { DataTable, Flag, type Column } from '../../ui.tsx';
import { useLang, useT } from '../../i18n/index.tsx';
import { getWorld, updateWorld, useWorld } from '../../career/store.ts';
import { fireStaff, hireStaff, staffMarket, STAFF_ATTRS, STAFF_ROLES, type StaffRole, type StaffRow, type Text } from '../../career/world.ts';
import { usd, userTeamId } from '../../career/club.ts';
import './club.css';

const to20 = (v: number) => Math.max(1, Math.min(20, Math.round(1 + v * 19)));

function StaffDetail({ staffId, role }: { staffId: string; role: StaffRole }) {
  const t = useT();
  const { lang } = useLang();
  const w = useWorld();
  const uid = userTeamId(w)!;
  const [msg, setMsg] = useState<Text | null>(null);
  const row = staffMarket(w, uid, role).find((r) => r.staff.staffId === staffId);
  if (!row) return <div className="small muted">{t('club.staff.gone')}</div>;
  const s = row.staff;
  return (
    <div className="pdetail" data-testid="staff-market-detail">
      <div className="pdetail-name">{s.name} <Flag cc={s.country} /></div>
      <div className="muted small">{t(`career.staffRole.${s.role}`)} · {t('career.age', { n: s.age })}</div>
      <div className="attr-group">
        {STAFF_ATTRS[s.role].map((k) => (
          <div key={k} className="attr-row"><span className="attr-name">{t(`career.staffAttr.${k}`)}</span><span className="rating-num">{to20(s.attributes[k] ?? 0)}</span></div>
        ))}
      </div>
      <p className="small muted">{t(`career.staffUse.${s.role}`)}</p>
      <div className="small">{t(row.current ? 'club.staff.salary' : 'club.staff.demand', { wage: usd(row.demand) })}</div>
      {row.current
        ? <button className="club-btn danger mt" onClick={() => updateWorld((x) => fireStaff(x, staffId))} data-testid="staff-fire">{t('club.staff.fire')}</button>
        : <button className="club-btn primary mt" onClick={() => { const r = hireStaff(getWorld(), uid, staffId, row.demand); setMsg(r.reason); updateWorld(() => r.world); }} data-testid="staff-hire">{t('club.staff.hire', { wage: usd(row.demand) })}</button>}
      {msg && <div className="small" data-testid="staff-hire-result">{msg[lang]}</div>}
    </div>
  );
}

export function StaffScreen({ setDetail }: { setDetail: (d: DetailPanel) => void }) {
  const t = useT();
  const w = useWorld();
  const [role, setRole] = useState<StaffRole>('headCoach');
  const uid = userTeamId(w);
  if (!uid) return <div className="pad">{t('club.noClub')}</div>;
  const rows = staffMarket(w, uid, role);
  const cols: Column<StaffRow>[] = [
    { key: 'name', header: t('col.name'), render: (r) => <><b>{r.staff.name}</b>{r.current && <span className="gen-tag">{t('club.staff.ours')}</span>}</>, sortValue: (r) => r.staff.name, width: '26%' },
    { key: 'country', header: '', render: (r) => <Flag cc={r.staff.country} />, width: '6%' },
    { key: 'age', header: t('col.age'), render: (r) => r.staff.age, sortValue: (r) => r.staff.age, width: '7%' },
    ...STAFF_ATTRS[role].map((k) => ({ key: k, header: t(`career.staffAttr.${k}`), render: (r: StaffRow) => to20(r.staff.attributes[k] ?? 0), sortValue: (r: StaffRow) => r.staff.attributes[k] ?? 0, width: '12%' })),
    { key: 'demand', header: t('club.staff.wageCol'), render: (r) => usd(r.demand), sortValue: (r) => r.demand },
  ];
  return (
    <div className="pad club" data-testid="staff-screen">
      <h2>{t('club.staff.title')} <span className="muted small">{w.teams[uid]?.name}</span></h2>
      <div className="md-tabs">
        {STAFF_ROLES.map((r) => <button key={r} className={role === r ? 'on' : ''} onClick={() => setRole(r)} data-testid={`staff-role-${r}`}>{t(`career.staffRole.${r}`)}</button>)}
      </div>
      <p className="small muted">{t(`career.staffUse.${role}`)}</p>
      <DataTable rows={rows} columns={cols} rowId={(r) => r.staff.staffId} initialSort={{ key: STAFF_ATTRS[role][0]!, dir: 'desc' }}
        onRowClick={(r) => setDetail({ title: r.staff.name, body: <StaffDetail staffId={r.staff.staffId} role={role} /> })} />
      <p className="small muted mt">{t('club.staff.note')}</p>
    </div>
  );
}
