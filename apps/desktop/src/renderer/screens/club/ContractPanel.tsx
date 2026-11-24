// Contract panel (player detail) and the offer form: the player's contract, and — for another
// club's player or a free agent — an offer (transfer / loan / free); for one of ours, a renewal or
// a release. The answers come from the club and player utilities in @pv/career (club/transfers.ts).
import { useState } from 'react';
import { useLang, useT } from '../../i18n/index.tsx';
import { getWorld, updateWorld, useWorld } from '../../career/store.ts';
import { agentFee, agentOf, answerCounter, makeOffer, moraleOf, releasePlayer, scoutedAbility, playerValue, type OfferKind, type OfferTerms, type TransferOffer } from '../../career/world.ts';
import { defaultTerms, offerKindFor, toggleShortlist, usd, userTeamId, windowInfo } from '../../career/club.ts';

export function OfferStatus({ o }: { o: TransferOffer }) {
  const t = useT();
  const { lang } = useLang();
  return (
    <div className={`offer-status st-${o.status}`} data-testid="offer-status" data-status={o.status}>
      <b>{t(`club.status.${o.status}`)}</b>
      {o.reason && <span className="small"> — {o.reason[lang]}</span>}
      {o.counter && <div className="small">{t('club.counterTerms', { fee: usd(o.counter.fee), wage: usd(o.counter.wage), years: o.counter.years })}</div>}
    </div>
  );
}

const EXTRA_KEYS = ['signingBonus', 'loyaltyBonus', 'winBonus', 'titleBonus', 'releaseClause', 'sellOn'] as const;

export function OfferForm({ playerId }: { playerId: string }) {
  const t = useT();
  const w = useWorld();
  const p = w.players[playerId];
  const uid = userTeamId(w);
  const baseKind = p ? offerKindFor(w, p) : 'free';
  const [kind, setKind] = useState<OfferKind>(baseKind);
  const init = p && uid ? defaultTerms(w, p, kind) : { fee: 0, wage: 0, years: 1 };
  const [fee, setFee] = useState(init.fee);
  const [wage, setWage] = useState(init.wage);
  const [years, setYears] = useState(init.years);
  const [share, setShare] = useState(0.5);
  const [extra, setExtra] = useState<Partial<Record<'signingBonus' | 'loyaltyBonus' | 'winBonus' | 'titleBonus' | 'releaseClause' | 'sellOn', number>>>({});
  const [showMore, setShowMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!p || !uid) return null;
  const win = windowInfo(w);
  const kinds: OfferKind[] = baseKind === 'transfer' ? ['transfer', 'loan'] : [baseKind];

  const pickKind = (k: OfferKind) => {
    setKind(k);
    const d = defaultTerms(w, p, k);
    setFee(d.fee); setWage(d.wage); setYears(d.years);
  };
  const submit = () => {
    const clauses = Object.fromEntries(Object.entries(extra).filter(([k, v]) => v !== undefined && v > 0 && (k !== 'sellOn' || kind === 'transfer')));
    const terms: OfferTerms = { fee: kind === 'loan' ? 0 : fee, wage, years: kind === 'loan' ? 1 : years, ...(kind === 'loan' ? { wageShare: share } : clauses) };
    const r = makeOffer(getWorld(), { playerId, toTeamId: uid, kind, terms });
    if (r.error) { setError(t(`club.err.${r.error}`)); return; }
    setError(null);
    updateWorld(() => r.world);
  };

  return (
    <div className="offer-form" data-testid="offer-form">
      <div className="small muted">{t(`club.kindHint.${kind}`)}</div>
      {kinds.length > 1 && (
        <div className="md-tabs">
          {kinds.map((k) => <button key={k} className={k === kind ? 'on' : ''} onClick={() => pickKind(k)} data-testid={`offer-kind-${k}`}>{t(`club.kind.${k}`)}</button>)}
        </div>
      )}
      {(kind === 'transfer' || kind === 'loan') && !win.open && <div className="warn small">{t('club.windowClosedNote', { days: win.days })}</div>}
      {kind === 'transfer' && (
        <label className="of-row">{t('club.fee')}<input type="number" step={5000} value={fee} onChange={(e) => setFee(Number(e.target.value))} data-testid="offer-fee" /><span className="muted small">{usd(fee)}</span></label>
      )}
      {kind !== 'loan' && (
        <>
          <label className="of-row">{t('club.wage')}<input type="number" step={1000} value={wage} onChange={(e) => setWage(Number(e.target.value))} data-testid="offer-wage" /><span className="muted small">{usd(wage)}</span></label>
          <label className="of-row">{t('club.years')}<input type="number" min={1} max={4} value={years} onChange={(e) => setYears(Math.max(1, Math.min(4, Number(e.target.value))))} data-testid="offer-years" /></label>
        </>
      )}
      {kind === 'loan' && (
        <label className="of-row">{t('club.wageShare')}<input type="number" min={0} max={1} step={0.05} value={share} onChange={(e) => setShare(Number(e.target.value))} data-testid="offer-share" /><span className="muted small">{Math.round(share * 100)}%</span></label>
      )}
      {kind !== 'loan' && (
        <>
          <button className="club-btn" onClick={() => setShowMore(!showMore)} data-testid="offer-more">{t(showMore ? 'club.offer.less' : 'club.offer.more')}</button>
          {showMore && ([...EXTRA_KEYS].filter((k) => k !== 'sellOn' || kind === 'transfer')).map((k) => (
            <label key={k} className="of-row">{t(`club.offer.${k}`)}
              <input type="number" min={0} step={k === 'sellOn' ? 0.05 : 5000} value={extra[k] ?? ''} placeholder={k === 'releaseClause' ? t('club.offer.default') : '0'}
                onChange={(e) => setExtra({ ...extra, [k]: e.target.value === '' ? undefined : Number(e.target.value) })} data-testid={`offer-${k}`} />
              <span className="muted small">{k === 'sellOn' ? `${Math.round((extra[k] ?? 0) * 100)}%` : usd(extra[k] ?? 0)}</span>
            </label>
          ))}
          <div className="small muted" data-testid="offer-agent">{t('club.offer.agent', { hard: Math.round(agentOf(w, playerId).hardness * 100), fee: usd(agentFee(w, playerId, { fee, wage, years })) })}</div>
        </>
      )}
      <button className="club-btn primary" onClick={submit} data-testid="offer-submit">{t(kind === 'renewal' ? 'club.submitRenewal' : 'club.submitOffer')}</button>
      {error && <div className="err small" data-testid="offer-error">{error}</div>}
    </div>
  );
}

function UtilityLine({ o }: { o: TransferOffer }) {
  const t = useT();
  const u = o.utility!;
  const f = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2);
  return (
    <div className="small muted" data-testid="offer-utility">
      {t('club.utility', { total: f(u.total), wage: f(u.wage), amb: f(u.ambition), role: f(u.role), len: f(u.length) })}
      {u.margin !== undefined && <> · {t('club.utilityMargin', { m: f(u.margin) })}</>}
      {(u.morale !== undefined || u.playTime !== undefined) && <> · {t('club.utilityRenewal', { morale: f(u.morale ?? 0), time: f(u.playTime ?? 0) })}</>}
    </div>
  );
}

export function CounterButtons({ o }: { o: TransferOffer }) {
  const t = useT();
  return (
    <div className="club-actions">
      <button className="club-btn primary" onClick={() => updateWorld((w) => answerCounter(w, o.id, true))} data-testid="counter-accept">{t('club.acceptCounter')}</button>
      <button className="club-btn" onClick={() => updateWorld((w) => answerCounter(w, o.id, false))} data-testid="counter-withdraw">{t('club.withdraw')}</button>
    </div>
  );
}

/** Contract panel for the player detail. */
export function ContractPanel({ playerId }: { playerId: string }) {
  const t = useT();
  const w = useWorld();
  const p = w.players[playerId];
  const uid = userTeamId(w);
  if (!p || !w.club) return null;
  const c = w.club.contracts[playerId];
  const mine = !!uid && p.teamId === uid;
  const loan = w.club.loans.find((l) => l.playerId === playerId);
  const est = scoutedAbility(w, uid, p);
  const shortlisted = w.club.shortlist.includes(playerId);
  // Our latest offer for this player (kept in the world, so it survives the player changing club).
  const last = w.club.offers.filter((o) => o.playerId === playerId && o.toTeamId === uid).at(-1);
  return (
    <div className="contract-panel" data-testid="contract-panel">
      <div className="attr-grouplabel">{t('club.contract')}</div>
      {c ? (
        <div className="small">
          <div>{t('club.contractLine', { team: w.teams[c.teamId]?.name ?? c.teamId, end: c.endSeason })}</div>
          {mine && <div>{t('club.salaryLine', { wage: usd(c.salary) })}</div>}
          {c.buyout !== null && <div>{t('club.buyoutLine', { buyout: usd(c.buyout) })}</div>}
          <div className="muted">{t(`club.squadRole.${c.squadRole}`)}{loan ? ` · ${t('club.onLoan', { team: w.teams[loan.toTeamId]?.name ?? loan.toTeamId })}` : ''}</div>
        </div>
      ) : <div className="small muted" data-testid="contract-none">{t('club.noContract')}</div>}
      {!mine && <div className="small mt">{t('club.valueLine', { value: usd(p.teamId ? playerValue(w, p, uid) : 0), ca: `${est.caLo}–${est.caHi}`, pa: `${est.paLo}–${est.paHi}` })}</div>}
      {!mine && <button className="club-btn" onClick={() => updateWorld((x) => toggleShortlist(x, playerId))} data-testid="shortlist-toggle">{t(shortlisted ? 'club.unshortlist' : 'club.shortlist')}</button>}
      {uid && <OfferForm key={`${playerId}-${p.teamId ?? 'free'}`} playerId={playerId} />}
      {last && <OfferStatus o={last} />}
      {last?.status === 'countered' && <CounterButtons o={last} />}
      {last?.utility && <UtilityLine o={last} />}
      {mine && !loan && <button className="club-btn danger mt" onClick={() => updateWorld((x) => releasePlayer(x, playerId))} data-testid="release-player">{t('club.release')}</button>}
    </div>
  );
}
