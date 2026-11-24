// Pre-match: the opponent report (read from their simulated film through the scouting model and
// their public map record) and the match plan it feeds. The plan becomes engine inputs only through
// existing paths (docs/MATCH_MANAGEMENT.md §4): leans → standing priors, report → opponent-model
// prior, tempo / risk / defense → standing shouts, pistol / after-pistol-loss → orders on those
// rounds. Plant-spot, post-plant, retake and mid-control choices are placeholders until the
// engine-truth / maps-data sessions land their options (shapes kept identical to theirs).
import { useState } from 'react';
import type { MatchPlan, OpponentReportView, PlantSpotKind } from '../../../shared/manager.ts';
import { bridge } from '../../platform.ts';
import { useT } from '../../i18n/index.tsx';
import { EMPTY_PLAN, pct, rateText, reportHeadlines } from '../../matchday/manager.ts';
import './manager.css';

const PLANT_KINDS: PlantSpotKind[] = ['auto', 'default', 'safe', 'open', 'cover', 'near'];

export interface PrematchPanelProps {
  us: { id: string; name: string };
  them: { id: string; name: string };
  seed: number;
  disabled: boolean;
  plan: MatchPlan;
  onPlan: (p: MatchPlan) => void;
  report: OpponentReportView | null;
  onReport: (r: OpponentReportView | null) => void;
}

export function PrematchPanel(p: PrematchPanelProps) {
  const t = useT();
  const [analyst, setAnalyst] = useState(0.7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = p.report;
  const stale = r && (r.them.id !== p.them.id || r.us.id !== p.us.id);
  const set = (patch: Partial<MatchPlan>) => p.onPlan({ ...p.plan, ...patch });

  async function build() {
    setBusy(true); setError(null);
    try { p.onReport(await bridge.prematchReport({ us: p.us, them: p.them, map: 'Ascent', seed: p.seed, analyst })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const lean = (key: 'attackLean' | 'defenseLean') => {
    const v = p.plan[key];
    return (
      <span className="pre-lean">
        <select value={v?.site ?? ''} onChange={(e) => set({ [key]: e.target.value ? { site: e.target.value as 'A' | 'B', strength: v?.strength || 5 } : null })} disabled={p.disabled} data-testid={`pre-${key}-site`}>
          <option value="">{t('pre.plan.none')}</option><option value="A">A</option><option value="B">B</option>
        </select>
        {v && <input type="range" min={1} max={10} value={v.strength} onChange={(e) => set({ [key]: { site: v.site, strength: Number(e.target.value) } })} disabled={p.disabled} data-testid={`pre-${key}-strength`} aria-label={t('pre.plan.strength')} />}
        {v && <span className="muted small">{t('pre.plan.strength.n', { n: v.strength })}</span>}
      </span>
    );
  };

  return (
    <div className="pre-panel" data-testid="prematch-panel">
      <section className="pre-report">
        <div className="pre-head">
          <b>{t('pre.report.title', { team: p.them.name })}</b>
          <label className="small">{t('pre.report.analyst')} <input type="range" min={0} max={1} step={0.1} value={analyst} onChange={(e) => setAnalyst(Number(e.target.value))} disabled={busy || p.disabled} data-testid="pre-analyst" /> {analyst.toFixed(1)}</label>
          <button className="md-run" onClick={() => void build()} disabled={busy || p.disabled} data-testid="pre-build">{busy ? t('pre.report.building') : r ? t('pre.report.rebuild') : t('pre.report.build')}</button>
        </div>
        {error && <div className="err small">⚠ {error}</div>}
        {!r && !busy && <p className="muted small">{t('pre.report.empty')}</p>}
        {r && (
          <div data-testid="pre-report">
            {stale && <div className="warn small">{t('pre.report.stale')}</div>}
            <div className="muted small">{t('pre.report.basis', { n: r.gamesReviewed, a: r.analyst.toFixed(1) })}</div>
            <ul className="pre-lines">
              {reportHeadlines(r).map((l, i) => <li key={i} className={l.thin ? 'thin' : ''} data-testid="pre-headline">{t(l.key, l.vars)}{l.thin && <span className="pre-thin">{t('pre.thin')}</span>}</li>)}
            </ul>
            <div className="pre-grid">
              <div>
                <div className="mgr-kicker">{t('pre.report.pistol')}</div>
                <div className="small">{t('pre.report.pistol.won', { v: rateText(r.pistol.won).text })}</div>
                <div className="small">{t('pre.report.pistol.siteA', { v: rateText(r.pistol.attackSiteA).text })}</div>
                <div className="mgr-kicker">{t('pre.report.eco')}</div>
                <div className="small">{t('pre.report.eco.force', { v: rateText(r.eco.forceAfterLoss).text })}</div>
                <div className="small">{t('pre.report.eco.full', { v: rateText(r.eco.fullBuy).text })}</div>
              </div>
              <div>
                <div className="mgr-kicker">{t('pre.report.players')}</div>
                {r.players.map((pl, i) => <div key={i} className={`small pre-player ${pl.tag ?? ''}`}>{pl.handle ?? '?'} <span className="muted">{pl.kills}/{pl.deaths}</span>{pl.tag && <b> · {t(`pre.tag.${pl.tag}`)}</b>}</div>)}
              </div>
              <div>
                <div className="mgr-kicker">{t('pre.report.maps')}</div>
                <table className="pre-maps"><tbody>
                  {r.maps.map((m) => <tr key={m.map} className={`v-${m.verdict}`}><td>{m.map}</td><td>{t('pre.report.maps.them', { v: pct(m.theirs) })}</td><td className="muted">{t('pre.report.maps.us', { v: pct(m.ours) })}</td></tr>)}
                </tbody></table>
              </div>
            </div>
            <button className="ord-cancel" onClick={() => p.onPlan({ ...EMPTY_PLAN, ...r.suggestedPlan, pending: p.plan.pending })} disabled={p.disabled} data-testid="pre-use-suggested">{t('pre.plan.useSuggested')}</button>
          </div>
        )}
      </section>

      <section className="pre-plan" data-testid="prematch-plan">
        <b>{t('pre.plan.title')}</b>
        <div className="pre-planrows">
          <label>{t('pre.plan.attackLean')}{lean('attackLean')}</label>
          <label>{t('pre.plan.defenseLean')}{lean('defenseLean')}</label>
          <label>{t('mgr.shout.tempo')}
            <select value={p.plan.tempo ?? 'normal'} onChange={(e) => set({ tempo: e.target.value as MatchPlan['tempo'] })} disabled={p.disabled} data-testid="pre-tempo">
              {(['slow', 'normal', 'fast'] as const).map((v) => <option key={v} value={v}>{t(`mgr.tempo.${v}`)}</option>)}
            </select>
          </label>
          <label>{t('mgr.shout.risk')}
            <select value={p.plan.risk ?? 'normal'} onChange={(e) => set({ risk: e.target.value as MatchPlan['risk'] })} disabled={p.disabled} data-testid="pre-risk">
              {(['less', 'normal', 'more'] as const).map((v) => <option key={v} value={v}>{t(`mgr.risk.${v}`)}</option>)}
            </select>
          </label>
          <label>{t('mgr.shout.defense')}
            <select value={p.plan.defense ?? 'normal'} onChange={(e) => set({ defense: e.target.value as MatchPlan['defense'] })} disabled={p.disabled} data-testid="pre-defense">
              {(['spread', 'normal', 'stack'] as const).map((v) => <option key={v} value={v}>{t(`mgr.defense.${v}`)}</option>)}
            </select>
          </label>
          <label>{t('pre.plan.pistolAttack')}
            <select value={p.plan.pistol?.attack ?? ''} onChange={(e) => set({ pistol: { ...p.plan.pistol, attack: (e.target.value || undefined) as never } })} disabled={p.disabled} data-testid="pre-pistol-attack">
              <option value="">{t('mgr.strategy.igl')}</option>
              {(['aExecute', 'bExecute', 'default'] as const).map((v) => <option key={v} value={v}>{t(`ostrat.${v}`)}</option>)}
            </select>
          </label>
          <label>{t('pre.plan.pistolDefense')}
            <select value={p.plan.pistol?.defense ?? ''} onChange={(e) => set({ pistol: { ...p.plan.pistol, defense: (e.target.value || undefined) as never } })} disabled={p.disabled} data-testid="pre-pistol-defense">
              <option value="">{t('mgr.strategy.igl')}</option>
              {(['defaultHold', 'stackA', 'stackB'] as const).map((v) => <option key={v} value={v}>{t(`ostrat.${v}`)}</option>)}
            </select>
          </label>
          <label>{t('pre.plan.afterPistolLoss')}
            <select value={p.plan.afterPistolLoss ?? ''} onChange={(e) => set({ afterPistolLoss: (e.target.value || undefined) as MatchPlan['afterPistolLoss'] })} disabled={p.disabled} data-testid="pre-after-pistol">
              <option value="">{t('mgr.strategy.igl')}</option>
              <option value="save">{t('oecon.save')}</option><option value="force">{t('oecon.force')}</option>
            </select>
          </label>
          <label className="pre-check">
            <input type="checkbox" checked={!!p.plan.useScouting && !!r} onChange={(e) => set({ useScouting: e.target.checked })} disabled={p.disabled || !r} data-testid="pre-use-scouting" />
            {t('pre.plan.useScouting')}
          </label>
        </div>

        <div className="pre-pending" data-testid="prematch-pending">
          <div className="mgr-kicker">{t('pre.pending.title')} <span className="pre-thin">{t('pre.pending.tag')}</span></div>
          <div className="pre-planrows">
            {(['A', 'B'] as const).map((site) => (
              <label key={site}>{t('pre.pending.plant', { site })}
                <select value={p.plan.pending?.plantPreference?.[site] ?? 'auto'} disabled data-testid={`pre-plant-${site}`}>
                  {PLANT_KINDS.map((k) => <option key={k} value={k}>{t(`pre.plant.${k}`)}</option>)}
                </select>
              </label>
            ))}
            <label>{t('pre.pending.postPlant')}<select value="auto" disabled data-testid="pre-postplant"><option value="auto">{t('pre.auto')}</option></select></label>
            <label>{t('pre.pending.retake')}<select value="auto" disabled data-testid="pre-retake"><option value="auto">{t('pre.auto')}</option></select></label>
            <label>{t('pre.pending.mid')}<select value="auto" disabled data-testid="pre-mid"><option value="auto">{t('pre.auto')}</option></select></label>
          </div>
          <div className="muted small">{t('pre.pending.hint')}</div>
        </div>
      </section>
    </div>
  );
}
