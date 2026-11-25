// Scouting / development widgets: attribute range bars, the knowledge badge, the latest scout report,
// the development history chart, and the own-player panel (morale, personality, mentor, academy).
import { useState } from 'react';
import { useT } from '../../i18n/index.tsx';
import { updateWorld, useWorld } from '../../career/store.ts';
import { useCareer } from '../../career/session.ts';
import {
  academyAction, academyActions, devSeries, knowledgePct, lastReportRow, loanOut, loanTargets, managerTeam, ownPanel,
  rangeText, reportHistory, setMentor, type Range20,
} from '../../career/scouting.ts';
import type { World, WorldPlayer } from '../../career/world.ts';

/** A 1–20 range bar: the band is what the club's knowledge allows, the tick is the best estimate. */
export function RangeBar({ r, testId }: { r: Range20; testId?: string }) {
  const pct = (v: number) => `${((v - 1) / 19) * 100}%`;
  return (
    <span className="rating range" data-testid={testId ?? 'attr-range'} title={`${r.lo}–${r.hi}`}>
      <span className="rating-num">{rangeText(r)}</span>
      <span className="rating-track">
        <span className="range-band" style={{ left: pct(r.lo), width: `calc(${pct(r.hi)} - ${pct(r.lo)})` }} />
        <span className="range-tick" style={{ left: pct(r.est) }} />
      </span>
    </span>
  );
}

export function KnowledgeBadge({ pct }: { pct: number }) {
  const t = useT();
  const cls = pct >= 70 ? 'hi' : pct >= 40 ? 'mid' : 'lo';
  return <span className={`know-badge ${cls}`} data-testid="knowledge-pct" title={t('scout.knowledgeHint')}>{t('scout.knowledge', { n: pct })}</span>;
}

export function ReportBox({ w, playerId }: { w: World; playerId: string }) {
  const t = useT();
  const r = lastReportRow(w, playerId);
  if (!r) return <div className="small muted" data-testid="report-none">{t('scout.noReport')}</div>;
  const scout = r.report.scoutId ? w.staff[r.report.scoutId]?.name ?? '—' : t('scout.trialStaff');
  return (
    <div className="report-box small" data-testid="report-box">
      <div>{t('scout.reportLine', { date: r.report.date, scout, kind: t(`scout.kind.${r.report.kind}`) })}</div>
      <div>{t('career.caPa', { caLo: r.ca.lo, caHi: r.ca.hi, paLo: r.pa.lo, paHi: r.pa.hi })}</div>
      <div className={`rec rec-${r.report.recommendation}`} data-testid="report-rec">{t(`scout.rec.${r.report.recommendation}`)}</div>
    </div>
  );
}

/**
 * Development history: CA per season (1–200) as a line; for scouted players the report ranges
 * as bars instead (what the club believed at the time).
 */
export function DevChart({ w, p, own }: { w: World; p: WorldPlayer; own: boolean }) {
  const t = useT();
  const W = 260, H = 110, PAD = 22;
  const pts = own ? devSeries(p).map((d) => ({ x: d.season, lo: d.ca, hi: d.ca, mid: d.ca, label: `${d.season}: ${d.ca} (${t('dev.ageMaps', { age: d.age, maps: d.maps })})` }))
    : reportHistory(w, p.playerId).map((r, i) => ({ x: i, lo: r.ca.lo, hi: r.ca.hi, mid: r.ca.est, label: `${r.report.date}: ${r.ca.lo}–${r.ca.hi}` }));
  if (pts.length === 0) return <div className="small muted" data-testid="dev-chart-empty">{t(own ? 'dev.noHistory' : 'scout.noHistory')}</div>;
  const ys = pts.flatMap((q) => [q.lo, q.hi]);
  const yMin = Math.max(1, Math.min(...ys) - 8), yMax = Math.min(200, Math.max(...ys) + 8);
  const xs = pts.map((q) => q.x);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const X = (x: number) => PAD + (xMax === xMin ? (W - 2 * PAD) / 2 : ((x - xMin) / (xMax - xMin)) * (W - 2 * PAD));
  const Y = (y: number) => H - PAD + 6 - ((y - yMin) / Math.max(1, yMax - yMin)) * (H - PAD - 6);
  return (
    <figure className="dev-chart" data-testid="dev-chart">
      <figcaption className="small muted">{t(own ? 'dev.chartOwn' : 'dev.chartScouted')}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={t(own ? 'dev.chartOwn' : 'dev.chartScouted')}>
        <line x1={PAD} y1={H - PAD + 6} x2={W - PAD / 2} y2={H - PAD + 6} className="dev-axis" />
        <text x={2} y={Y(yMax) + 4} className="dev-tick">{Math.round(yMax)}</text>
        <text x={2} y={Y(yMin) + 4} className="dev-tick">{Math.round(yMin)}</text>
        {own && pts.length > 1 && <polyline className="dev-line" points={pts.map((q) => `${X(q.x)},${Y(q.mid)}`).join(' ')} />}
        {pts.map((q, i) => (
          <g key={i}>
            {q.hi > q.lo && <line x1={X(q.x)} x2={X(q.x)} y1={Y(q.lo)} y2={Y(q.hi)} className="dev-band" />}
            <circle cx={X(q.x)} cy={Y(q.mid)} r={3} className="dev-dot"><title>{q.label}</title></circle>
          </g>
        ))}
        {own && <text x={X(xMin)} y={H - 4} className="dev-tick" textAnchor="middle">{xMin}</text>}
        {own && xMax !== xMin && <text x={X(xMax)} y={H - 4} className="dev-tick" textAnchor="middle">{xMax}</text>}
      </svg>
    </figure>
  );
}

/** Morale, personality, mentor and academy actions for one of the manager's own players (or a free prospect). */
export function OwnPlayerPanel({ p }: { p: WorldPlayer }) {
  const t = useT();
  const w = useWorld();
  const career = useCareer().career;
  const date = career?.date ?? w.club?.date ?? `${w.season}-01-05`;
  const [msg, setMsg] = useState<string | null>(null);
  const [loanTo, setLoanTo] = useState('');
  const tid = managerTeam(w);
  if (!tid) return null;
  const mine = p.teamId === tid;
  const actions = academyActions(w, p);
  const form = career?.stats[p.playerId]?.form ?? 0.5;
  const panel = mine ? ownPanel(w, p, form) : null;
  const act = (fn: (x: World) => { world: World; error: string | null }) => {
    let err: string | null = null;
    updateWorld((x) => { const r = fn(x); err = r.error; return r.world; });
    setMsg(err ? t(`dev.err.${err}`) : t('dev.done'));
  };
  const targets = actions.includes('loan') ? loanTargets(w, p.playerId) : [];
  return (
    <div className="own-panel" data-testid="own-panel">
      {panel && (
        <>
          <div className="attr-grouplabel">{t('dev.title')}</div>
          <div className="small" data-testid="own-morale">{t('dev.morale', { n: panel.morale, level: t(`dev.level.${panel.moraleLevel}`) })} <span className="muted" data-testid="own-morale-source">{t(panel.moraleTracked ? 'dev.moraleTracked' : 'dev.moraleDerived')}</span></div>
          <div className="small muted" data-testid="own-traits">
            {(['professionalism', 'temperament', 'leadership', 'ambition'] as const).map((k) => `${t(`dev.trait.${k}`)} ${t(`dev.level.${panel.traits[k]}`)}`).join(' · ')}
          </div>
          {panel.canBeMentored && (
            <label className="small own-mentor">{t('dev.mentor')}{' '}
              <select value={panel.mentorId ?? ''} data-testid="mentor-select" onChange={(e) => act((x) => setMentor(x, p.playerId, e.target.value || null))}>
                <option value="">{t('dev.noMentor')}</option>
                {panel.mentorOptions.map((m) => <option key={m.playerId} value={m.playerId}>{m.handle ?? m.playerId}</option>)}
              </select>
            </label>
          )}
        </>
      )}
      {actions.length > 0 && (
        <div className="own-actions">
          {actions.includes('invite') && <button className="club-btn" data-testid="academy-invite" onClick={() => act((x) => academyAction(x, 'invite', p.playerId, date))}>{t('dev.invite')}</button>}
          {actions.includes('promote') && <button className="club-btn" data-testid="academy-promote" onClick={() => act((x) => academyAction(x, 'promote', p.playerId, date))}>{t('dev.promote')}</button>}
          {actions.includes('demote') && <button className="club-btn" data-testid="academy-demote" onClick={() => act((x) => academyAction(x, 'demote', p.playerId, date))}>{t('dev.demote')}</button>}
          {actions.includes('loan') && (
            <span className="own-loan">
              <select value={loanTo} onChange={(e) => setLoanTo(e.target.value)} data-testid="loan-target">
                <option value="">{t('dev.loanTo', { n: targets.length })}</option>
                {targets.map((id) => <option key={id} value={id}>{w.teams[id]?.name ?? id}</option>)}
              </select>
              <button className="club-btn" disabled={!loanTo} data-testid="loan-out" onClick={() => act((x) => loanOut(x, p.playerId, loanTo, date))}>{t('dev.loanOut')}</button>
            </span>
          )}
        </div>
      )}
      {msg && <div className="small muted" data-testid="own-msg">{msg}</div>}
    </div>
  );
}
