// Transfers: search (scout-estimated ranges, filters), shortlist, our offers and their answers,
// incoming bids, and the window status. Every number about another club's player is the user
// scout's estimate (club/transfers.ts, docs/CLUB_OPERATIONS.md §4).
import { useState } from 'react';
import type { DetailPanel } from '../../App.tsx';
import { DataTable, type Column } from '../../ui.tsx';
import { useLang, useT } from '../../i18n/index.tsx';
import { updateWorld, useWorld } from '../../career/store.ts';
import { answerIncoming, type TransferOffer } from '../../career/world.ts';
import { incomingOffers, outgoingOffers, searchRows, usd, userTeamId, windowInfo, type SearchFilters, type SearchRow } from '../../career/club.ts';
import { ContractPanel, CounterButtons, OfferStatus } from './ContractPanel.tsx';
import { ClubClock } from './FinanceScreen.tsx';
import './club.css';

type Tab = 'search' | 'shortlist' | 'offers' | 'incoming';
const ROLES = ['', 'duelist', 'initiator', 'controller', 'sentinel'];

function OfferRow({ o, incoming }: { o: TransferOffer; incoming?: boolean }) {
  const t = useT();
  const w = useWorld();
  const p = w.players[o.playerId];
  const other = incoming ? w.teams[o.toTeamId]?.name : o.fromTeamId ? w.teams[o.fromTeamId]?.name : t('club.freeAgent');
  return (
    <div className="offer-row" data-testid={incoming ? 'incoming-row' : 'offer-row'}>
      <div><b>{p?.handle ?? o.playerId}</b> <span className="muted small">{t(`club.kind.${o.kind}`)} · {other} · {o.created}</span></div>
      <div className="small">{t('club.terms', { fee: usd(o.terms.fee), wage: usd(o.terms.wage), years: o.terms.years })}</div>
      <OfferStatus o={o} />
      {!incoming && o.status === 'countered' && <CounterButtons o={o} />}
      {incoming && o.status === 'pending' && (
        <div className="club-actions">
          <button className="club-btn primary" onClick={() => updateWorld((x) => answerIncoming(x, o.id, true))} data-testid="incoming-accept">{t('club.accept')}</button>
          <button className="club-btn" onClick={() => updateWorld((x) => answerIncoming(x, o.id, false))} data-testid="incoming-reject">{t('club.reject')}</button>
        </div>
      )}
    </div>
  );
}

export function TransfersScreen({ setDetail }: { setDetail: (d: DetailPanel) => void }) {
  const t = useT();
  useLang();
  const w = useWorld();
  const uid = userTeamId(w);
  const [tab, setTab] = useState<Tab>('search');
  const [f, setF] = useState<SearchFilters>({ ownRegion: true });
  if (!uid) return <div className="pad">{t('club.noClub')}</div>;
  const win = windowInfo(w);
  const fin = w.club!.finances[uid]!;
  const rows = tab === 'shortlist' ? searchRows(w, { ownRegion: false, shortlistOnly: true }) : searchRows(w, f);
  const out = outgoingOffers(w);
  const inc = incomingOffers(w);
  const cols: Column<SearchRow>[] = [
    { key: 'handle', header: t('col.handle'), render: (r) => <><b>{r.handle}</b>{r.shortlisted && <span className="star"> ★</span>}</>, sortValue: (r) => r.handle, width: '16%' },
    { key: 'age', header: t('col.age'), render: (r) => r.age, sortValue: (r) => r.age, width: '6%' },
    { key: 'role', header: t('col.role'), render: (r) => r.role, sortValue: (r) => r.role, width: '11%' },
    { key: 'club', header: t('col.club'), render: (r) => r.teamName ?? t('club.freeAgent'), sortValue: (r) => r.teamName ?? '~', width: '17%' },
    { key: 'ca', header: t('col.ca'), render: (r) => `${r.caLo}–${r.caHi}`, sortValue: (r) => r.ca, width: '10%' },
    { key: 'pa', header: t('col.pa'), render: (r) => `${r.paLo}–${r.paHi}`, sortValue: (r) => r.pa, width: '10%' },
    { key: 'value', header: t('club.col.value'), render: (r) => (r.teamName ? usd(r.value) : '—'), sortValue: (r) => r.value, width: '11%' },
    { key: 'end', header: t('club.col.end'), render: (r) => r.contractEnd ?? '—', sortValue: (r) => r.contractEnd ?? 0 },
  ];
  const num = (v: string) => (v === '' ? undefined : Number(v));
  return (
    <div className="pad club" data-testid="transfers-screen">
      <h2>{t('club.transfers.title')} <span className="muted small">{w.teams[uid]?.name}</span></h2>
      <div className="career-bar">
        <span className={`window-pill ${win.open ? 'open' : ''}`} data-testid="window-status" data-open={win.open ? '1' : '0'}>
          {win.open ? t('club.windowOpen', { to: win.to, days: win.days }) : t('club.windowClosed', { from: win.from, days: win.days })}
        </span>
        <span className="small">{t('club.budgetsLine', { transfer: usd(fin.transferBudget), wage: usd(fin.wageBudget) })}</span>
        <ClubClock />
      </div>
      <div className="md-tabs">
        <button className={tab === 'search' ? 'on' : ''} onClick={() => setTab('search')} data-testid="tr-tab-search">{t('club.tab.search')}</button>
        <button className={tab === 'shortlist' ? 'on' : ''} onClick={() => setTab('shortlist')} data-testid="tr-tab-shortlist">{t('club.tab.shortlist', { n: w.club!.shortlist.length })}</button>
        <button className={tab === 'offers' ? 'on' : ''} onClick={() => setTab('offers')} data-testid="tr-tab-offers">{t('club.tab.offers', { n: out.length })}</button>
        <button className={tab === 'incoming' ? 'on' : ''} onClick={() => setTab('incoming')} data-testid="tr-tab-incoming">{t('club.tab.incoming', { n: inc.filter((o) => o.status === 'pending').length })}</button>
      </div>
      {tab === 'search' && (
        <div className="tr-filters">
          <select value={f.role ?? ''} onChange={(e) => setF({ ...f, role: e.target.value || undefined })} data-testid="flt-role">
            {ROLES.map((r) => <option key={r} value={r}>{r ? r : t('club.flt.anyRole')}</option>)}
          </select>
          <label className="small">{t('club.flt.maxAge')}<input type="number" value={f.maxAge ?? ''} onChange={(e) => setF({ ...f, maxAge: num(e.target.value) })} data-testid="flt-age" /></label>
          <label className="small">{t('club.flt.minCa')}<input type="number" value={f.minCa ?? ''} onChange={(e) => setF({ ...f, minCa: num(e.target.value) })} data-testid="flt-ca" /></label>
          <label className="small">{t('club.flt.maxFee')}<input type="number" step={50000} value={f.maxFee ?? ''} onChange={(e) => setF({ ...f, maxFee: num(e.target.value) })} data-testid="flt-fee" /></label>
          <label className="small"><input type="checkbox" checked={!!f.freeOnly} onChange={(e) => setF({ ...f, freeOnly: e.target.checked })} data-testid="flt-free" />{t('club.flt.freeOnly')}</label>
          <label className="small"><input type="checkbox" checked={f.ownRegion === false} onChange={(e) => setF({ ...f, ownRegion: !e.target.checked })} data-testid="flt-all-regions" />{t('club.flt.allRegions')}</label>
        </div>
      )}
      {(tab === 'search' || tab === 'shortlist') && (
        <DataTable rows={rows} columns={cols} rowId={(r) => r.playerId} initialSort={{ key: 'ca', dir: 'desc' }}
          filterKey={(r) => `${r.handle} ${r.role} ${r.teamName ?? ''}`}
          onRowClick={(r) => setDetail({ title: `${r.handle} · ${r.role}`, body: <ContractPanel playerId={r.playerId} /> })} />
      )}
      {tab === 'offers' && (
        <div className="offer-list">{out.length ? out.map((o) => <OfferRow key={o.id} o={o} />) : <p className="muted small">{t('club.noOffers')}</p>}</div>
      )}
      {tab === 'incoming' && (
        <div className="offer-list">{inc.length ? inc.map((o) => <OfferRow key={o.id} o={o} incoming />) : <p className="muted small">{t('club.noIncoming')}</p>}</div>
      )}
      <p className="small muted mt">{t('club.transfers.note')}</p>
    </div>
  );
}
