// Coach orders panel — opened when the user calls a tactical timeout between rounds.
// Lets the IGL commit a strategy / economy call / tempo / role pins for the next
// round, alongside a situation summary (score, economy, ultimates, recent rounds,
// opponent buys). The chosen order is sent via session.setOrders and reflected in
// the next round (and the timeout log).
import { useState } from 'react';
import type { MatchSummary, SessionState, TeamOrder } from '../../shared/ipc.ts';
import { useT } from '../i18n/index.tsx';

const ATTACK_STRATS = ['aExecute', 'bExecute', 'midControl', 'default', 'split'] as const;
const DEFENSE_STRATS = ['defaultHold', 'stackA', 'stackB', 'aggroPush'] as const;
const ECON = ['save', 'force', 'full'] as const;
const TEMPO = ['slow', 'normal', 'fast'] as const;

export function OrdersPanel({
  state, match, team, onConfirm, onCancel,
}: {
  state: SessionState; match: MatchSummary | null; team: 'A' | 'B';
  onConfirm: (order: TeamOrder) => void; onCancel: () => void;
}) {
  const t = useT();
  const attacking = state.attacker === team;
  const strats = attacking ? ATTACK_STRATS : DEFENSE_STRATS;
  const [strategy, setStrategy] = useState<string>(strats[0]);
  const [economy, setEconomy] = useState<string>('');
  const [tempo, setTempo] = useState<string>('');
  const [entry, setEntry] = useState<string>('');
  const [lurker, setLurker] = useState<string>('');

  // This team's roster slots for the next round (side-based ids the sim uses).
  const prefix = attacking ? 'atk' : 'def';
  const slots = [1, 2, 3, 4, 5].map((n) => `${prefix}${n}`);
  const other = team === 'A' ? 'B' : 'A';
  const recent = (match?.rounds ?? []).slice(-6).map((r) => (r.winner === team ? t('rev.win') : t('rev.loss'))).join(' ');
  const oppBuys = (match?.rounds ?? []).slice(-4).map((r) => t(`buy.${r.buys[other].tier}`)).join(' · ');

  function confirm() {
    const order: TeamOrder = { strategy: strategy as TeamOrder['strategy'] };
    if (economy) order.economy = economy as TeamOrder['economy'];
    if (tempo) order.tempo = tempo as TeamOrder['tempo'];
    if (entry || lurker) order.roles = { ...(entry ? { entry } : {}), ...(lurker ? { lurker } : {}) };
    onConfirm(order);
  }

  return (
    <div className="orders-panel" data-testid="orders-panel">
      <div className="orders-head">
        <h3>{t('orders.title')} <span className="pill">{attacking ? t('tac.attack') : t('tac.defense')}</span></h3>
      </div>

      <div className="orders-grid">
        <label className="ord-field">{t('orders.strategy')}
          <select value={strategy} onChange={(e) => setStrategy(e.target.value)} data-testid="ord-strategy">
            {strats.map((s) => <option key={s} value={s}>{t(`ostrat.${s}`)}</option>)}
          </select>
        </label>
        <label className="ord-field">{t('orders.economy')}
          <select value={economy} onChange={(e) => setEconomy(e.target.value)} data-testid="ord-economy">
            <option value="">{t('orders.none')}</option>
            {ECON.map((s) => <option key={s} value={s}>{t(`oecon.${s}`)}</option>)}
          </select>
        </label>
        <label className="ord-field">{t('orders.tempo')}
          <select value={tempo} onChange={(e) => setTempo(e.target.value)} data-testid="ord-tempo">
            <option value="">{t('orders.none')}</option>
            {TEMPO.map((s) => <option key={s} value={s}>{t(`otempo.${s}`)}</option>)}
          </select>
        </label>
        <label className="ord-field">{t('orders.entry')}
          <select value={entry} onChange={(e) => setEntry(e.target.value)} data-testid="ord-entry">
            <option value="">{t('orders.none')}</option>
            {slots.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="ord-field">{t('orders.lurker')}
          <select value={lurker} onChange={(e) => setLurker(e.target.value)} data-testid="ord-lurker">
            <option value="">{t('orders.none')}</option>
            {slots.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      <div className="orders-sit">
        <div className="attr-grouplabel">{t('orders.situation')}</div>
        <div className="sit-row"><span className="muted small">{t('orders.sit.score')}</span><b>{state.score.A} – {state.score.B}</b></div>
        <div className="sit-row"><span className="muted small">{t('orders.sit.economy')}</span>
          <span>{match?.teams.A.name ?? 'A'} {state.economy.A.credits}c · {match?.teams.B.name ?? 'B'} {state.economy.B.credits}c</span>
        </div>
        <div className="sit-row"><span className="muted small">{t('orders.sit.ult')}</span>
          <span>{state.economy.A.ultPoints} / {state.economy.B.ultPoints} pt</span>
        </div>
        <div className="sit-row"><span className="muted small">{t('orders.sit.recent')}</span><span className="mono">{recent || '—'}</span></div>
        <div className="sit-row"><span className="muted small">{t('orders.sit.oppBuys')}</span><span className="small">{oppBuys || '—'}</span></div>
      </div>

      <div className="orders-actions">
        <button className="md-run" onClick={confirm} data-testid="ord-confirm">{t('orders.confirm')}</button>
        <button className="ord-cancel" onClick={onCancel} data-testid="ord-cancel">{t('orders.cancel')}</button>
      </div>
    </div>
  );
}
