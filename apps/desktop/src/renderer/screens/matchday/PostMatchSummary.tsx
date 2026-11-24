// Post-match summary of the managers' decisions (ours and the AI's): what was done, the team's
// state of mind when it was done, and what followed — rounds won in the three rounds before and
// after, and tilt three rounds later. "What followed", not "what it caused": the table says so.
import type { ManagerResultView, Seat } from '../../../shared/manager.ts';
import { useT, strategyLabel } from '../../i18n/index.tsx';
import { decisionRows, moodLabel, reaction, sparkPath } from '../../matchday/manager.ts';
import './manager.css';

export function PostMatchSummary({ result, teams }: { result: ManagerResultView; teams: Record<Seat, { name: string }> }) {
  const t = useT();
  const fmt = (vars: Record<string, string | number>) => {
    const out: Record<string, string | number> = { ...vars };
    if (typeof vars.talk === 'string') out.talk = t(`mgr.talk.${vars.talk}`);
    if (typeof vars.reason === 'string') out.reason = t(`mgr.reason.${vars.reason}`);
    if (typeof vars.tempo === 'string') out.tempo = t(`mgr.tempo.${vars.tempo}`);
    if (typeof vars.risk === 'string') out.risk = t(`mgr.risk.${vars.risk}`);
    if (typeof vars.defense === 'string') out.defense = t(`mgr.defense.${vars.defense}`);
    if (typeof vars.what === 'string') out.what = vars.what.split(' / ').map((s) => (s === '—' ? s : t(`ostrat.${s}`) !== `ostrat.${s}` ? t(`ostrat.${s}`) : t(`oecon.${s}`) !== `oecon.${s}` ? t(`oecon.${s}`) : strategyLabel(t, s))).join(' / ');
    return out;
  };
  return (
    <section className="md-card mgr-post" data-testid="post-match-summary">
      <h3>{t('mgr.post.title')}</h3>
      <p className="muted small">{t('mgr.post.hint')}</p>
      <div className="mgr-spark">
        {(['A', 'B'] as const).map((s) => (
          <div key={s} className={`mgr-sparkrow s-${s}`}>
            <span className="small">{t('mgr.post.tilt', { team: teams[s].name })}</span>
            <svg viewBox="0 0 240 40" width="240" height="40" role="img" aria-label={t('mgr.post.tilt', { team: teams[s].name })}>
              <path d={sparkPath(result.tiltByRound[s])} fill="none" strokeWidth="2" />
            </svg>
          </div>
        ))}
      </div>
      {(['A', 'B'] as const).map((s) => {
        const rows = decisionRows(result.decisions, s);
        return (
          <div key={s} data-testid={`post-decisions-${s}`}>
            <div className="mgr-kicker">{t('mgr.post.decisions', { team: teams[s].name })} {s === 'B' && <span className="muted small">{t('mgr.post.ai')}</span>}</div>
            {rows.length === 0 ? <div className="muted small">{t('mgr.post.none')}</div> : (
              <table className="mgr-dec">
                <thead><tr><th>R</th><th>{t('mgr.post.col.decision')}</th><th>{t('mgr.post.col.before')}</th><th>{t('mgr.post.col.after')}</th><th>{t('mgr.post.col.tilt')}</th></tr></thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} data-testid="post-decision-row" data-kind={row.decision.kind}>
                      <td>{row.decision.round}</td>
                      <td>{t(row.key, fmt(row.vars))}{row.decision.kind === 'talk' && row.decision.perPlayer && (
                        <div className="muted small">{row.decision.perPlayer.map((p) => `${p.handle ?? '#' + (p.index + 1)} ${t(`mgr.react.${reaction(p.delta)}`)}`).join(' · ')}</div>
                      )}</td>
                      <td>{row.before}</td>
                      <td className={row.swing === null ? '' : row.swing > 0 ? 'up' : row.swing < 0 ? 'down' : ''}>{row.after}</td>
                      <td>{Math.round(100 * row.tiltBefore)} → {Math.round(100 * row.tiltAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
      <div className="mgr-kicker">{t('mgr.post.final', { team: teams.A.name })}</div>
      <div className="mgr-final">
        {result.minds.A.players.map((p) => <span key={p.index} className={`mgr-chip m-${moodLabel(p)}`}>{p.handle ?? `#${p.index + 1}`} · {t(`mgr.mood.${moodLabel(p)}`)}</span>)}
      </div>
    </section>
  );
}
