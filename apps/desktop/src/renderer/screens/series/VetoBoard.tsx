// Veto board: the map pool as cards, whose turn it is and what the step is, the staff's
// recommendation with its reason, and the per-map decision support (our mastery vs theirs with
// the components behind it and how certain each number is; what the scouting report says).
import { useEffect, useState } from 'react';
import type { MasteryView, SeriesTeam, SeriesView } from '../../../shared/series.ts';
import { useT, type TFn } from '../../i18n/index.tsx';
import { certaintyLevel, latestAction, mapCards, pct, recommendationReason, score100, stepInfo, vetoBriefing, vetoLogLine, type MapCard } from '../../series/view.ts';

interface Props {
  view: SeriesView;
  busy: boolean;
  onChoose: (choice: string) => void;
}

function MasteryBar({ label, value, uncertainty, testId }: { label: string; value: number | null; uncertainty: number; testId?: string }) {
  const t = useT();
  if (value === null) {
    return (
      <div className="ser-bar lvl-none" data-testid={testId}>
        <span className="ser-barlabel">{label}</span>
        <span className="ser-bartrack"><i style={{ width: '100%' }} /></span>
        <span className="ser-barval">{t('ser.unknown')}</span>
      </div>
    );
  }
  const level = certaintyLevel(uncertainty);
  return (
    <div className={`ser-bar lvl-${level}`} data-testid={testId} data-level={level}>
      <span className="ser-barlabel">{label}</span>
      <span className="ser-bartrack"><i style={{ width: `${score100(value)}%` }} /></span>
      <span className="ser-barval">{score100(value)}<span className="ser-pm" title={t(`ser.certainty.${level}`)}>±{score100(uncertainty)}</span></span>
    </div>
  );
}

function Components({ m, t }: { m: MasteryView; t: TFn }) {
  const rows: Array<[string, number, number, string]> = [
    [t('ser.comp.history'), m.history.value, m.history.uncertainty,
      m.history.resultsKnown ? t('ser.comp.history.known', { games: m.history.games, wins: m.history.wins ?? 0 }) : t('ser.comp.history.unknown', { games: m.history.games })],
    [t('ser.comp.continuity'), m.continuity.value, m.continuity.uncertainty, m.continuity.measured ? t('ser.comp.continuity.measured') : t('ser.comp.continuity.allocated')],
    [t('ser.comp.fit'), m.compFit.value, m.compFit.uncertainty, m.compFit.basis === 'comps' ? t('ser.comp.fit.comps', { comp: (m.compFit.bestComp ?? []).join(' · ') }) : t('ser.comp.fit.roles')],
  ];
  return (
    <div className="ser-comps">
      {rows.map(([label, value, u, note]) => (
        <div key={label} className="ser-comprow">
          <MasteryBar label={label} value={value} uncertainty={u} />
          <div className="ser-compnote muted small">{note}</div>
        </div>
      ))}
    </div>
  );
}

export function VetoBoard({ view, busy, onChoose }: Props) {
  const t = useT();
  const cards = mapCards(view);
  const step = stepInfo(view);
  const pending = view.veto.pending;
  const reason = recommendationReason(view);
  const brief = vetoBriefing(view);
  const latest = latestAction(view);
  const name = (team: SeriesTeam) => view.teams[team].name;
  const [selected, setSelected] = useState<string>(view.pool[0] ?? '');
  // Follow the action: when a step is ours, open the recommended map's details.
  useEffect(() => { if (pending && !pending.ai && pending.kind !== 'side') setSelected(pending.recommendation.choice); }, [pending?.step]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = cards.find((c) => c.map === selected) ?? cards[0];

  const statusTag = (c: MapCard) => {
    if (c.status === 'banned') return t('ser.card.banned', { team: c.by ? name(c.by) : '' });
    if (c.status === 'picked') return t('ser.card.picked', { n: c.gameNumber ?? 0, team: c.by ? name(c.by) : '' });
    if (c.status === 'decider') return t('ser.card.decider', { n: c.gameNumber ?? 0 });
    return t('ser.card.open');
  };

  return (
    <div className="ser-veto" data-testid="veto-board">
      {/* briefing: the stakes before/through the draft */}
      <div className="ser-brief" data-testid="veto-brief">
        <span className="ser-brief-fmt">{t('ser.brief.format', { games: brief.games })}</span>
        {brief.ourBest && <span className="ser-brief-item best">{t('ser.brief.best', { map: brief.ourBest.map, score: brief.ourBest.score })}</span>}
        {brief.edge && <span className="ser-brief-item edge">{t('ser.brief.edge', { map: brief.edge.map, gap: brief.edge.gap })}</span>}
        {brief.risk && <span className="ser-brief-item risk">{t('ser.brief.risk', { map: brief.risk.map, gap: brief.risk.gap })}</span>}
      </div>

      {/* whose turn / what step */}
      <div className={`ser-turn ${step ? (step.ours ? 'ours' : 'theirs') : 'done'}`} data-testid="veto-turn" data-step-kind={step?.kind ?? 'done'} data-step-ours={step ? String(step.ours) : ''}>
        {step ? (
          <>
            <span className="ser-stepno">{t('ser.step.n', { i: step.index, n: step.total })}</span>
            <b className="ser-stepwho">{step.ours ? t('ser.turn.ours') : t('ser.turn.theirs', { team: name(step.team) })}</b>
            <span className={`ser-stepkind k-${step.kind}`}>{step.kind === 'side' ? t('ser.step.side', { map: step.map ?? '' }) : t(`ser.step.${step.kind}`)}</span>
            {!step.ours && <span className="muted small" data-testid="veto-ai-thinking">{t('ser.turn.aiThinking')}</span>}
          </>
        ) : <b>{t('ser.veto.done')}</b>}
      </div>

      {/* recommendation */}
      {pending && !pending.ai && reason && (
        <div className="ser-rec" data-testid="veto-recommendation">
          <span className="ser-rectag">{t('ser.rec.tag')}</span>
          <span className="ser-rectext">{t(reason.key, reason.vars)}</span>
          <button className="md-run" onClick={() => onChoose(pending.recommendation.choice)} disabled={busy} data-testid="veto-accept">{t('ser.rec.accept')}</button>
        </div>
      )}

      {/* side choice */}
      {pending && !pending.ai && pending.kind === 'side' && (
        <div className="ser-sidepick" data-testid="veto-side">
          <span>{t('ser.side.prompt', { map: pending.map ?? '' })}</span>
          {(['attack', 'defense'] as const).map((s) => (
            <button key={s} className={`ser-sidebtn ${pending.recommendation.choice === s ? 'rec' : ''}`} onClick={() => onChoose(s)} disabled={busy} data-testid={`veto-side-${s}`}>
              {t(`ser.side.${s}`)}
            </button>
          ))}
        </div>
      )}

      {/* the pool */}
      <div className="ser-cards" data-testid="veto-cards">
        {cards.map((c) => {
          const their = c.info.scouting ? c.info.scouting.estimatedMastery : null;
          return (
            <div key={c.map} className={`ser-card st-${c.status} ${c.recommended ? 'rec' : ''} ${selected === c.map ? 'sel' : ''} ${latest && latest.map === c.map && latest.kind !== 'side' ? 'latest' : ''}`}
              onClick={() => setSelected(c.map)} data-testid={`veto-card-${c.map}`} data-status={c.status}>
              <div className="ser-cardhead">
                <b className="ser-mapname">{c.map}</b>
                {c.recommended && <span className="ser-recdot" title={t('ser.rec.tag')}>★</span>}
              </div>
              <div className={`ser-cardstatus st-${c.status}`}>{statusTag(c)}</div>
              {c.ourSide && <div className="ser-cardside small">{t('ser.card.side', { side: t(`ser.side.${c.ourSide}`) })}</div>}
              {c.played && <div className="ser-cardscore small">{c.played.score.A}–{c.played.score.B}</div>}
              <MasteryBar label={t('ser.us')} value={c.info.mastery.A.value} uncertainty={c.info.mastery.A.uncertainty} testId={`veto-mastery-us-${c.map}`} />
              <MasteryBar label={t('ser.them')} value={their} uncertainty={c.info.mastery.B.uncertainty} testId={`veto-mastery-them-${c.map}`} />
              {c.selectable && pending && (
                <button className={`ser-choose k-${pending.kind}`} onClick={(e) => { e.stopPropagation(); onChoose(c.map); }} disabled={busy} data-testid={`veto-choose-${c.map}`}>
                  {t(pending.kind === 'ban' ? 'ser.choose.ban' : 'ser.choose.pick')}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* decision support for the selected map */}
      {sel && (
        <div className="ser-detail" data-testid="veto-detail">
          <h3>{sel.map} <span className="muted small">{t('ser.detail.belief', { pct: pct(sel.info.winBelief) })}</span></h3>
          <div className="ser-detailgrid">
            <section>
              <h4>{name('A')} <span className="pill">{t('ser.mastery')} {score100(sel.info.mastery.A.value)}</span></h4>
              <Components m={sel.info.mastery.A} t={t} />
            </section>
            <section>
              <h4>{name('B')} <span className="pill">{t('ser.mastery.public')} {score100(sel.info.mastery.B.value)}</span></h4>
              <Components m={sel.info.mastery.B} t={t} />
            </section>
            <section className="ser-scout" data-testid="veto-scouting">
              <h4>{t('ser.scout.title')}</h4>
              {sel.info.scouting ? (
                <>
                  <div className={`ser-verdict v-${sel.info.scouting.verdict}`}>{t(`ser.scout.verdict.${sel.info.scouting.verdict}`, { est: score100(sel.info.scouting.estimatedMastery) })}</div>
                  {([['attack', sel.info.scouting.attack, sel.info.scouting.priorMass.attack], ['defense', sel.info.scouting.defense, sel.info.scouting.priorMass.defense]] as const).map(([k, e, mass]) => (
                    <div key={k} className={`ser-tend ${e.rounds < 6 ? 'thin' : ''}`}>
                      <span>{t(`ser.scout.${k}`)}</span>
                      {e.rounds > 0
                        ? <b>{t('ser.scout.share', { a: pct(e.shareA), b: 100 - pct(e.shareA) })}</b>
                        : <b className="muted">{t('ser.scout.none')}</b>}
                      <span className="muted small">{t('ser.scout.evidence', { rounds: e.rounds.toFixed(1), mass: mass.toFixed(1) })}</span>
                    </div>
                  ))}
                  <div className="muted small">{t('ser.scout.quality', { reviewed: view.scouting.gamesReviewed, available: view.scouting.gamesAvailable, uptake: pct(view.scouting.uptake) })}</div>
                </>
              ) : <div className="muted small">{t('ser.scout.off')}</div>}
            </section>
          </div>
        </div>
      )}

      {/* what has happened so far */}
      <div className="ser-log" data-testid="veto-log">
        <div className="attr-grouplabel">{t('ser.log.title')}</div>
        {view.veto.actions.length === 0 && <div className="muted small">{t('ser.log.empty')}</div>}
        {view.veto.actions.map((a) => {
          const line = vetoLogLine(a);
          return (
            <div key={a.step} className={`ser-logrow by-${a.by} ${a.team === 'A' ? 'ours' : a.team === 'B' ? 'theirs' : 'rule'} ${latest && a.step === latest.step ? 'latest' : ''}`}>
              <span className="ser-logn">{a.step + 1}</span>
              <span>{t(line.key, { ...line.vars, team: line.team ? name(line.team) : '' })}</span>
              {a.by === 'ai' && <span className="ser-logai">AI</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
