// Finance: the user's club balance, wage and transfer budgets, sponsorship and fanbase, the
// monthly ledger, the wage list, and the board's messages. Formulas: docs/CLUB_OPERATIONS.md §3.
import { useState } from 'react';
import type { DetailPanel } from '../../App.tsx';
import { DataTable, type Column } from '../../ui.tsx';
import { useLang, useT } from '../../i18n/index.tsx';
import { useWorld } from '../../career/store.ts';
import { useCareer } from '../../career/session.ts';
import { inboxText } from '../../career/view.ts';
import type { LedgerEntry } from '../../career/world.ts';
import { financeSummary, usd, userTeamId, wageRows, type WageRow } from '../../career/club.ts';
import { ContractPanel } from './ContractPanel.tsx';
import './club.css';

type Tab = 'ledger' | 'wages' | 'board';

/** The club's date: career mode's calendar (time moves only with Continue on Home). */
export function ClubClock() {
  const t = useT();
  const w = useWorld();
  return <span className="club-clock"><span className="small" data-testid="club-date">{t('club.date', { date: w.club?.date ?? '—', season: w.season })}</span></span>;
}

function Card({ label, value, sub, warn, testid }: { label: string; value: string; sub?: string; warn?: boolean; testid?: string }) {
  return (
    <div className={`fin-card ${warn ? 'warn' : ''}`} data-testid={testid}>
      <div className="muted small">{label}</div>
      <div className="fin-value">{value}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}

export function FinanceScreen({ setDetail }: { setDetail: (d: DetailPanel) => void }) {
  const t = useT();
  const { lang } = useLang();
  const w = useWorld();
  const career = useCareer().career;
  const [tab, setTab] = useState<Tab>('ledger');
  const uid = userTeamId(w);
  const s = financeSummary(w);
  if (!uid || !s) return <div className="pad">{t('club.noClub')}</div>;
  const f = w.club!.finances[uid]!;
  const ledger = f.ledger.slice().reverse();
  const ledgerCols: Column<LedgerEntry & { i: number }>[] = [
    { key: 'date', header: t('club.col.date'), render: (e) => e.date, sortValue: (e) => e.date, width: '16%' },
    { key: 'kind', header: t('club.col.item'), render: (e) => t(`club.ledger.${e.kind}`), sortValue: (e) => e.kind, width: '28%' },
    { key: 'amount', header: t('club.col.amount'), render: (e) => <span className={e.amount < 0 ? 'neg' : 'pos'}>{usd(e.amount)}</span>, sortValue: (e) => e.amount, width: '18%' },
    { key: 'note', header: t('club.col.note'), render: (e) => e.note ?? '' },
  ];
  const wageCols: Column<WageRow>[] = [
    { key: 'name', header: t('col.name'), render: (r) => <b>{r.name}</b>, sortValue: (r) => r.name, width: '24%' },
    { key: 'role', header: t('col.role'), render: (r) => (r.kind === 'staff' ? t(`career.staffRole.${r.role}`) : r.role), sortValue: (r) => r.role, width: '16%' },
    { key: 'squad', header: t('club.col.squadRole'), render: (r) => t(`club.squadRole.${r.squadRole}`), sortValue: (r) => r.squadRole, width: '14%' },
    { key: 'salary', header: t('club.col.salary'), render: (r) => usd(r.salary), sortValue: (r) => r.salary, width: '14%' },
    { key: 'end', header: t('club.col.end'), render: (r) => r.endSeason, sortValue: (r) => r.endSeason, width: '10%' },
    { key: 'buyout', header: t('club.col.buyout'), render: (r) => (r.buyout === null ? '—' : usd(r.buyout)), sortValue: (r) => r.buyout ?? 0 },
  ];
  // The club's messages live in the career inbox (source "club").
  const msgs = (career?.inbox ?? []).filter((m) => m.source === 'club').slice().reverse();
  const wagePct = s.wageBudget > 0 ? Math.min(150, Math.round((s.wageBill / s.wageBudget) * 100)) : 0;
  return (
    <div className="pad club" data-testid="finance-screen">
      <h2>{t('club.finance.title')} <span className="muted small">{w.teams[uid]?.name}</span></h2>
      <div className="career-bar"><ClubClock /></div>
      <div className="fin-cards">
        <Card label={t('club.balance')} value={usd(s.balance)} warn={s.balance < 0} testid="fin-balance" />
        <Card label={t('club.wageBudget')} value={`${usd(s.wageBill)} / ${usd(s.wageBudget)}`} sub={t('club.wageSplit', { players: usd(s.playerWages), staff: usd(s.staffWages) })} warn={s.overBudget} testid="fin-wages" />
        <Card label={t('club.transferBudget')} value={usd(s.transferBudget)} testid="fin-transfer" />
        <Card label={t('club.sponsorship')} value={usd(s.sponsorship)} sub={t('club.fanbase', { n: Math.round(s.fanbase * 100) })} />
        <Card label={t('club.seasonFlow')} value={`${usd(s.seasonIncome)} / ${usd(-s.seasonCosts)}`} sub={t('club.expectedIncome', { v: usd(s.expectedIncome) })} />
      </div>
      <div className="wage-bar" title={`${wagePct}%`}><div className={`wage-fill ${s.overBudget ? 'over' : ''}`} style={{ width: `${Math.min(100, wagePct)}%` }} /></div>
      <div className="md-tabs">
        {(['ledger', 'wages', 'board'] as Tab[]).map((k) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} data-testid={`fin-tab-${k}`}>{t(`club.finance.tab.${k}`)}</button>)}
      </div>
      {tab === 'ledger' && (ledger.length
        ? <DataTable rows={ledger.map((e, i) => ({ ...e, i }))} columns={ledgerCols} rowId={(e) => String(e.i)} initialSort={{ key: 'date', dir: 'desc' }} />
        : <p className="muted small">{t('club.ledgerEmpty')}</p>)}
      {tab === 'wages' && (
        <DataTable rows={wageRows(w)} columns={wageCols} rowId={(r) => r.id} initialSort={{ key: 'salary', dir: 'desc' }}
          onRowClick={(r) => r.kind === 'player' && setDetail({ title: r.name, body: <ContractPanel playerId={r.id} /> })} />
      )}
      {tab === 'board' && (
        <div className="club-msgs" data-testid="club-messages">
          {msgs.length === 0 && <p className="muted small">{t('club.noMessages')}</p>}
          {msgs.map((m) => {
            const tx = inboxText(t, lang, m);
            return (
              <div key={m.id} className={`club-msg k-${m.category}`}>
                <div className="small muted">{m.date} · {t(`inbox.cat.${m.category}`)}</div>
                <div><b>{tx.title}</b></div>
                <div className="small">{tx.body}</div>
              </div>
            );
          })}
        </div>
      )}
      <p className="small muted mt">{t('club.finance.note')}</p>
    </div>
  );
}
