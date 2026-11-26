// Career scouting tabs: scout assignments, the report list, the shortlist (with what we know), and
// our own squad + academy with development at a glance.
import { useState } from 'react';
import { DataTable, Flag, type Column } from '../../ui.tsx';
import { useT } from '../../i18n/index.tsx';
import { updateWorld, useWorld } from '../../career/store.ts';
import { useCareer } from '../../career/session.ts';
import {
  assign, coverageRows, knowledgePct, lastReportRow, managerTeam, ownPanel, playerView, range200, rangeText, reportConfidencePct, reportRows, scoutRows, shortlistPlayers,
  type AssignmentKind, type CoverageRow, type ReportRow,
} from '../../career/scouting.ts';
import { REGIONS, type WorldPlayer } from '../../career/world.ts';
import { GenTag, squadRow, type SquadRow } from '../SquadScreen.tsx';

type Open = (p: SquadRow) => void;

function confClass(c: number): string { return c >= 70 ? 'rec-sign' : c >= 40 ? 'rec-monitor' : 'rec-pass'; }

export function ReportTable({ onOpen }: { onOpen: Open }) {
  const t = useT();
  const w = useWorld();
  const date = useCareer().career?.date ?? w.club?.date;
  const rows = reportRows(w);
  const cols: Column<ReportRow>[] = [
    { key: 'date', header: t('col.date'), render: (r) => r.report.date, sortValue: (r) => r.report.date, width: '11%' },
    { key: 'handle', header: t('col.handle'), render: (r) => <><b>{r.player.handle}</b>{r.player.generated && <GenTag />}</>, sortValue: (r) => r.player.handle ?? '', width: '16%' },
    { key: 'country', header: '', render: (r) => <Flag cc={r.player.country} />, width: '5%' },
    { key: 'age', header: t('col.age'), render: (r) => r.player.age, sortValue: (r) => r.player.age, width: '6%' },
    { key: 'role', header: t('col.role'), render: (r) => r.player.role ?? '—', sortValue: (r) => r.player.role ?? '', width: '9%' },
    { key: 'ca', header: t('col.ca'), render: (r) => rangeText(r.ca), sortValue: (r) => r.ca.est, width: '9%' },
    { key: 'pa', header: t('col.pa'), render: (r) => rangeText(r.pa), sortValue: (r) => r.pa.est, width: '9%' },
    { key: 'know', header: t('col.knowledge'), render: (r) => `${Math.round(r.report.knowledge * 100)}%`, sortValue: (r) => r.report.knowledge, width: '8%' },
    // Report confidence: knowledge at write time × how fresh the report still is (decays with age).
    { key: 'conf', header: t('col.confidence'), render: (r) => { const c = reportConfidencePct(r.report, date); return <span className={`rec ${confClass(c)}`} title={t('scout.confidenceTitle')}>{c}%</span>; }, sortValue: (r) => reportConfidencePct(r.report, date), width: '9%' },
    { key: 'rec', header: t('col.rec'), render: (r) => <span className={`rec rec-${r.report.recommendation}`}>{t(`scout.rec.${r.report.recommendation}`)}</span>, sortValue: (r) => ({ sign: 0, monitor: 1, pass: 2 })[r.report.recommendation] },
  ];
  if (rows.length === 0) return <p className="small muted" data-testid="reports-empty">{t('scout.noReports')}</p>;
  return <div data-testid="report-table"><DataTable rows={rows} columns={cols} filterKey={(r) => `${r.player.handle} ${r.player.role} ${r.player.country}`} initialSort={{ key: 'date', dir: 'desc' }} rowId={(r) => r.player.playerId} onRowClick={(r) => onOpen(squadRow(w, r.player))} /></div>;
}

/** Per-region scouting coverage: how many players we know and how well, and whether a scout is there. */
export function CoveragePanel() {
  const t = useT();
  const w = useWorld();
  const date = useCareer().career?.date;
  const rows: CoverageRow[] = coverageRows(w, date);
  if (rows.length === 0) return <p className="small muted" data-testid="coverage-empty">{t('scout.noScouts')}</p>;
  return (
    <table className="assign-table" data-testid="coverage-panel">
      <thead><tr>
        <th>{t('career.region.title')}</th><th>{t('scout.coverage.players')}</th><th>{t('scout.coverage.known')}</th><th>{t('col.knowledge')}</th><th>{t('scout.coverage.scouted')}</th>
      </tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.region} data-testid={`coverage-row-${r.region}`}>
            <td><b>{t(`career.region.${r.region}`)}</b></td>
            <td className="small">{r.players}</td>
            <td className="small">{r.known}</td>
            <td style={{ minWidth: 90 }}>
              <span className="small">{r.knowledge}%</span>
              <div className="wage-bar" style={{ marginTop: 2 }}><div className={`wage-fill ${r.knowledge >= 50 ? 'good' : r.knowledge <= 20 ? 'over' : ''}`} style={{ width: `${r.knowledge}%` }} /></div>
            </td>
            <td className="small">{r.scouted ? <span className="rec rec-sign">{t('scout.coverage.yes')}</span> : <span className="muted">{t('scout.coverage.no')}</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const KINDS: AssignmentKind[] = ['region', 'league', 'youth', 'player'];

function AssignRow({ i }: { i: number }) {
  const t = useT();
  const w = useWorld();
  const date = useCareer().career?.date ?? w.club?.date ?? '';
  const row = scoutRows(w)[i]!;
  const a = row.assignment;
  const ownRegion = w.teams[managerTeam(w) ?? '']?.region ?? 'americas';
  const [kind, setKind] = useState<AssignmentKind>(a?.kind ?? 'region');
  const [target, setTarget] = useState<string>(a?.target ?? ownRegion);
  const shortlist = shortlistPlayers(w);
  const needsRegion = kind === 'region' || kind === 'youth';
  const targetOk = kind === 'league' || (needsRegion ? REGIONS.includes(target as typeof REGIONS[number]) : !!w.players[target]);
  const current = a ? t(`scout.kind.${a.kind}`) + (a.target ? ` · ${a.kind === 'player' ? w.players[a.target]?.handle ?? a.target : t(`career.region.${a.target}`)}` : '') : t('scout.idle');
  return (
    <tr data-testid={`assign-row-${i}`}>
      <td><b>{row.scout.name}</b> <Flag cc={row.scout.country} /></td>
      <td className="small">{t('scout.judging', { a: Math.round(1 + 19 * (row.scout.attributes.judgingAbility ?? 0)), p: Math.round(1 + 19 * (row.scout.attributes.judgingPotential ?? 0)) })}</td>
      <td className="small" data-testid={`assign-current-${i}`}>{current}{a && <span className="muted"> · {t('scout.since', { date: a.since })}</span>}</td>
      <td>
        <select value={kind} data-testid={`assign-kind-${i}`} onChange={(e) => { const k = e.target.value as AssignmentKind; setKind(k); setTarget(k === 'player' ? shortlist[0]?.playerId ?? '' : k === 'league' ? '' : ownRegion); }}>
          {KINDS.map((k) => <option key={k} value={k}>{t(`scout.kind.${k}`)}</option>)}
        </select>{' '}
        {needsRegion && (
          <select value={target} data-testid={`assign-target-${i}`} onChange={(e) => setTarget(e.target.value)}>
            {REGIONS.map((r) => <option key={r} value={r}>{t(`career.region.${r}`)}</option>)}
          </select>
        )}
        {kind === 'player' && (
          <select value={target} data-testid={`assign-target-${i}`} onChange={(e) => setTarget(e.target.value)}>
            {shortlist.length === 0 && <option value="">{t('scout.shortlistEmpty')}</option>}
            {shortlist.map((p) => <option key={p.playerId} value={p.playerId}>{p.handle}</option>)}
          </select>
        )}{' '}
        <button className="club-btn" disabled={!targetOk} data-testid={`assign-save-${i}`} onClick={() => updateWorld((x) => assign(x, row.scout.staffId, kind, kind === 'league' ? null : target, date))}>{t('scout.assign')}</button>
      </td>
    </tr>
  );
}

export function AssignPanel() {
  const t = useT();
  const w = useWorld();
  const rows = scoutRows(w);
  if (rows.length === 0) return <p className="small muted">{t('scout.noScouts')}</p>;
  return (
    <table className="assign-table" data-testid="assign-panel">
      <thead><tr><th>{t('career.staffRole.scout')}</th><th>{t('scout.judgingHead')}</th><th>{t('scout.current')}</th><th>{t('scout.newAssignment')}</th></tr></thead>
      <tbody>{rows.map((r, i) => <AssignRow key={r.scout.staffId} i={i} />)}</tbody>
    </table>
  );
}

interface ViewRow extends SquadRow { caR: { est: number; lo: number; hi: number }; paR: { est: number; lo: number; hi: number }; know: number }

function viewRows(players: WorldPlayer[]): (w: ReturnType<typeof useWorld>, date?: string) => ViewRow[] {
  return (w, date) => players.map((p) => {
    const v = playerView(w, p, date);
    return { ...squadRow(w, p), caR: range200(v.ca), paR: range200(v.pa), know: knowledgePct(w, p, date) };
  });
}

function viewCols(t: ReturnType<typeof useT>, extra: Column<ViewRow>[] = []): Column<ViewRow>[] {
  return [
    { key: 'handle', header: t('col.handle'), render: (p) => <><b>{p.handle}</b>{p.generated && <GenTag />}</>, sortValue: (p) => p.handle, width: '16%' },
    { key: 'country', header: '', render: (p) => <Flag cc={p.country} />, width: '6%' },
    { key: 'age', header: t('col.age'), render: (p) => p.age, sortValue: (p) => p.age, width: '6%' },
    { key: 'role', header: t('col.role'), render: (p) => p.role, sortValue: (p) => p.role, width: '10%' },
    { key: 'ca', header: t('col.ca'), render: (p) => rangeText(p.caR), sortValue: (p) => p.caR.est, width: '10%' },
    { key: 'pa', header: t('col.pa'), render: (p) => rangeText(p.paR), sortValue: (p) => p.paR.est, width: '10%' },
    ...extra,
  ];
}

export function ShortlistTable({ onOpen }: { onOpen: Open }) {
  const t = useT();
  const w = useWorld();
  const date = useCareer().career?.date;
  const rows = viewRows(shortlistPlayers(w))(w, date);
  if (rows.length === 0) return <p className="small muted" data-testid="shortlist-empty">{t('scout.shortlistEmpty')}</p>;
  const cols = viewCols(t, [
    { key: 'know', header: t('col.knowledge'), render: (p) => `${p.know}%`, sortValue: (p) => p.know, width: '9%' },
    { key: 'rec', header: t('col.rec'), render: (p) => { const r = lastReportRow(w, p.playerId); return r ? t(`scout.rec.${r.report.recommendation}`) : '—'; } },
    { key: 'club', header: t('col.club'), render: (p) => p.teamName ?? t('career.status.free'), sortValue: (p) => p.teamName ?? '~' },
  ]);
  return <div data-testid="shortlist-table"><DataTable rows={rows} columns={cols} initialSort={{ key: 'pa', dir: 'desc' }} rowId={(p) => p.playerId} onRowClick={onOpen} /></div>;
}

/** Our squad and academy: CA/PA (coaching staff's read), morale, mentor, last season's change. */
export function ClubYouthTable({ onOpen }: { onOpen: Open }) {
  const t = useT();
  const w = useWorld();
  const c = useCareer().career;
  const tid = managerTeam(w);
  const team = tid ? w.teams[tid] : undefined;
  if (!team) return null;
  const ids = [...team.roster, ...team.academy];
  const rows = viewRows(ids.map((id) => w.players[id]).filter((p): p is WorldPlayer => !!p))(w, c?.date);
  const delta = (p: WorldPlayer) => { const h = p.history ?? []; return h.length >= 2 ? Math.round(199 * (h[h.length - 1]!.ca - h[h.length - 2]!.ca)) : null; };
  const cols = viewCols(t, [
    { key: 'squad', header: t('col.squad'), render: (p) => t(team.academy.includes(p.playerId) ? 'dev.academy' : 'dev.mainRoster'), sortValue: (p) => (team.academy.includes(p.playerId) ? 1 : 0), width: '10%' },
    { key: 'morale', header: t('col.morale'), render: (p) => ownPanel(w, p.world, c?.stats[p.playerId]?.form ?? 0.5).morale, sortValue: (p) => ownPanel(w, p.world, c?.stats[p.playerId]?.form ?? 0.5).morale, width: '8%' },
    { key: 'dca', header: t('col.lastChange'), render: (p) => { const d = delta(p.world); return d === null ? '—' : d > 0 ? `+${d}` : String(d); }, sortValue: (p) => delta(p.world) ?? 0, width: '9%' },
    { key: 'mentor', header: t('dev.mentor'), render: (p) => { const m = w.development?.mentors[p.playerId]; return m ? w.players[m]?.handle ?? m : '—'; } },
  ]);
  return <div data-testid="club-youth-table"><DataTable rows={rows} columns={cols} initialSort={{ key: 'ca', dir: 'desc' }} rowId={(p) => p.playerId} onRowClick={onOpen} /></div>;
}
