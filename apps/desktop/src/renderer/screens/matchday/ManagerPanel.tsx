// In-match manager controls (docs/MATCH_MANAGEMENT.md): a drawer over the live view with the
// alerts that paused auto-play, timeouts left this half, standing shouts, a strategy for the next
// rounds and the team's state of mind; plus the half-time team talk. Everything goes through the
// managed session (useMatchSession → engine host). Rendered by MatchDayScreen into LiveMatch.
import { useState } from 'react';
import type { SessionState } from '../../../shared/ipc.ts';
import type { AlertView, AttackStrategy, DefenseStrategy, Shouts, TalkReaction, TeamTalk } from '../../../shared/manager.ts';
import { useT } from '../../i18n/index.tsx';
import { OUR, alertLine, moodBar, moodLabel, personalityTags, reaction, talkPending } from '../../matchday/manager.ts';
import './manager.css';

const ATTACK: AttackStrategy[] = ['aExecute', 'bExecute', 'midControl', 'default'];
const DEFENSE: DefenseStrategy[] = ['defaultHold', 'stackA', 'stackB', 'aggroPush'];
const TALKS: TeamTalk[] = ['calm', 'encourage', 'demand', 'praise'];

export interface ManagerPanelProps {
  state: SessionState;
  busy: boolean;
  open: boolean;
  onOpen: (v: boolean) => void;
  alerts: AlertView[];
  reactions: TalkReaction[] | null;
  onShouts: (s: Partial<Shouts>) => void;
  onStrategy: (s: { attack?: AttackStrategy; defense?: DefenseStrategy; rounds?: number } | null) => void;
  onTimeout: () => void;
  onTalk: (talk: TeamTalk) => void;
}

function Segmented<T extends string>({ value, options, label, onChange, disabled, testId }: { value: T; options: readonly T[]; label: (v: T) => string; onChange: (v: T) => void; disabled: boolean; testId: string }) {
  return (
    <div className="mgr-seg" role="radiogroup" data-testid={testId}>
      {options.map((o) => (
        <button key={o} role="radio" aria-checked={value === o} className={value === o ? 'on' : ''} onClick={() => onChange(o)} disabled={disabled} data-testid={`${testId}-${o}`}>{label(o)}</button>
      ))}
    </div>
  );
}

export function ManagerPanel(p: ManagerPanelProps) {
  const t = useT();
  const m = p.state.manager;
  const [attack, setAttack] = useState<AttackStrategy | ''>('');
  const [defense, setDefense] = useState<DefenseStrategy | ''>('');
  const [rounds, setRounds] = useState(3);
  const [talked, setTalked] = useState<TeamTalk | null>(null);
  const [skippedAt, setSkippedAt] = useState<number | null>(null);
  if (!m) return null;
  const shouts = m.shouts[OUR];
  const mind = m.minds[OUR];
  const left = m.timeoutsLeftThisHalf[OUR];
  const locked = p.busy || p.state.finished;
  const strat = m.strategy[OUR];
  const showTalk = (talkPending(m) && skippedAt !== p.state.roundNumber) || (talked !== null && p.reactions !== null);

  return (
    <>
      <button className={`mgr-toggle ${p.alerts.length ? 'alert' : ''}`} onClick={() => p.onOpen(!p.open)} aria-expanded={p.open} data-testid="mgr-toggle">
        {t('mgr.toggle')}{p.alerts.length > 0 && <span className="mgr-dot" data-testid="mgr-alert-dot">{p.alerts.length}</span>}
      </button>

      {p.open && (
        <aside className="mgr-drawer" data-testid="mgr-panel" aria-label={t('mgr.title')}>
          <div className="mgr-head"><b>{t('mgr.title')}</b><button className="mgr-close" onClick={() => p.onOpen(false)} aria-label={t('mgr.close')}>✕</button></div>

          {p.alerts.length > 0 && (
            <section className="mgr-alerts" data-testid="mgr-alerts">
              <div className="mgr-kicker">{t('mgr.alerts')}</div>
              {p.alerts.map((a, i) => { const l = alertLine(a); return <div key={i} className={`mgr-alert k-${a.kind}`} data-testid={`mgr-alert-${a.kind}`}>{t(l.key, l.vars)}</div>; })}
              <div className="muted small">{t('mgr.alerts.paused')}</div>
            </section>
          )}

          <section>
            <div className="mgr-kicker">{t('mgr.timeout')}</div>
            <div className="mgr-row">
              <span className="small">{t('mgr.timeout.left', { n: left, half: m.half === 3 ? t('mgr.half.ot') : t('mgr.half.n', { n: m.half }) })}</span>
              <button className="md-timeout" onClick={p.onTimeout} disabled={locked || left <= 0 || p.state.timeoutActive[OUR]} data-testid="mgr-timeout">{t('mgr.timeout.call')}</button>
            </div>
            <div className="muted small">{t('mgr.timeout.hint')}</div>
          </section>

          <section data-testid="mgr-shouts">
            <div className="mgr-kicker">{t('mgr.shouts')}</div>
            <label className="mgr-field">{t('mgr.shout.tempo')}
              <Segmented value={shouts.tempo} options={['slow', 'normal', 'fast'] as const} label={(v) => t(`mgr.tempo.${v}`)} onChange={(v) => p.onShouts({ tempo: v })} disabled={locked} testId="mgr-tempo" />
            </label>
            <label className="mgr-field">{t('mgr.shout.risk')}
              <Segmented value={shouts.risk} options={['less', 'normal', 'more'] as const} label={(v) => t(`mgr.risk.${v}`)} onChange={(v) => p.onShouts({ risk: v })} disabled={locked} testId="mgr-risk" />
            </label>
            <label className="mgr-field">{t('mgr.shout.defense')}
              <Segmented value={shouts.defense} options={['spread', 'normal', 'stack'] as const} label={(v) => t(`mgr.defense.${v}`)} onChange={(v) => p.onShouts({ defense: v })} disabled={locked} testId="mgr-defense" />
            </label>
            <div className="muted small">{t('mgr.shouts.hint')}</div>
          </section>

          <section data-testid="mgr-strategy">
            <div className="mgr-kicker">{t('mgr.strategy')}</div>
            <div className="mgr-row wrap">
              <label className="mgr-field">{t('tac.attack')}
                <select value={attack} onChange={(e) => setAttack(e.target.value as AttackStrategy | '')} disabled={locked} data-testid="mgr-strat-attack">
                  <option value="">{t('mgr.strategy.igl')}</option>
                  {ATTACK.map((s) => <option key={s} value={s}>{t(`ostrat.${s}`)}</option>)}
                </select>
              </label>
              <label className="mgr-field">{t('tac.defense')}
                <select value={defense} onChange={(e) => setDefense(e.target.value as DefenseStrategy | '')} disabled={locked} data-testid="mgr-strat-defense">
                  <option value="">{t('mgr.strategy.igl')}</option>
                  {DEFENSE.map((s) => <option key={s} value={s}>{t(`ostrat.${s}`)}</option>)}
                </select>
              </label>
              <label className="mgr-field">{t('mgr.strategy.rounds')}
                <input type="number" min={1} max={6} value={rounds} onChange={(e) => setRounds(Math.max(1, Math.min(6, Number(e.target.value) || 1)))} disabled={locked} data-testid="mgr-strat-rounds" />
              </label>
            </div>
            <div className="mgr-row">
              <button className="md-run" onClick={() => p.onStrategy({ ...(attack ? { attack } : {}), ...(defense ? { defense } : {}), rounds })} disabled={locked || (!attack && !defense)} data-testid="mgr-strat-apply">{t('mgr.strategy.apply')}</button>
              {strat && <span className="small" data-testid="mgr-strat-active">{t('mgr.strategy.active', { what: [strat.attack, strat.defense].filter(Boolean).map((s) => t(`ostrat.${s}`)).join(' / '), n: strat.roundsLeft })}</span>}
              {strat && <button className="ord-cancel" onClick={() => p.onStrategy(null)} disabled={locked} data-testid="mgr-strat-clear">{t('mgr.strategy.clear')}</button>}
            </div>
          </section>

          <section data-testid="mgr-mood">
            <div className="mgr-kicker">{t('mgr.mood')} <span className="muted small">{t('mgr.mood.team', { tilt: Math.round(100 * mind.tilt), conf: Math.round(100 * mind.confidence) })}</span></div>
            {mind.players.map((pl) => {
              const label = moodLabel(pl);
              return (
                <div key={pl.index} className={`mgr-player m-${label}`} data-testid={`mgr-player-${pl.index}`} data-mood={label}>
                  <span className="mgr-name">{pl.key && <span className="mgr-key" title={t('mgr.key')}>★</span>}{pl.handle ?? `#${pl.index + 1}`}</span>
                  <span className="mgr-moodbar" title={pl.mood.toFixed(2)}><i style={{ left: `${Math.min(50, moodBar(pl.mood))}%`, width: `${Math.abs(moodBar(pl.mood) - 50)}%` }} /></span>
                  <span className="mgr-moodtag">{t(`mgr.mood.${label}`)}</span>
                  <span className="mgr-traits muted small">{personalityTags(pl.personality).map((x) => t(`mgr.trait.${x}`)).join(' · ')}</span>
                </div>
              );
            })}
            <div className="muted small">{t('mgr.mood.hint')}</div>
          </section>
        </aside>
      )}

      {showTalk && (
        <div className="mdx-modal" role="dialog" aria-modal="true" aria-label={t('mgr.talk.title')} data-testid="mgr-talk">
          <div className="mdx-modal-card mgr-talkcard">
            <div className="mdx-modal-kicker">{t('mgr.talk.kicker', { a: p.state.score.A, b: p.state.score.B })}</div>
            <h3>{t('mgr.talk.title')}</h3>
            {talked === null || p.reactions === null ? (
              <>
                <p className="muted small">{t(`mgr.talk.situation.${m.halfTime?.situation[OUR] ?? 'level'}`)}</p>
                <div className="mgr-talks">
                  {TALKS.map((k) => (
                    <button key={k} className="mgr-talkbtn" onClick={() => { setTalked(k); p.onTalk(k); }} disabled={p.busy} data-testid={`mgr-talk-${k}`}>
                      <b>{t(`mgr.talk.${k}`)}</b><span className="muted small">{t(`mgr.talk.${k}.hint`)}</span>
                    </button>
                  ))}
                </div>
                <button className="ord-cancel" onClick={() => setSkippedAt(p.state.roundNumber)} disabled={p.busy} data-testid="mgr-talk-skip">{t('mgr.talk.skip')}</button>
              </>
            ) : (
              <>
                <p className="small">{t('mgr.talk.given', { talk: t(`mgr.talk.${talked}`) })}</p>
                <div className="mgr-reactions" data-testid="mgr-talk-reactions">
                  {p.reactions.map((r) => {
                    const re = reaction(r.delta);
                    return <div key={r.index} className={`mgr-reaction r-${re}`} data-reaction={re}><span>{r.handle ?? `#${r.index + 1}`}</span><b>{t(`mgr.react.${re}`)}</b><span className="muted small">{r.delta >= 0 ? '+' : ''}{r.delta.toFixed(2)}</span></div>;
                  })}
                </div>
                <button className="md-run" onClick={() => setTalked(null)} data-testid="mgr-talk-done">{t('mgr.talk.done')}</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
