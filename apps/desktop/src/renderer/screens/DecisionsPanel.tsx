// Round decisions — the "why" of each round, in the post-match Review. For the picked
// round, one analyst note per team: the read of the opponent it went in with, its
// opening and final call (objective / fake), every mid-round plan change with the
// round clock and the engine's reason, and what the round then showed it. All data
// comes from the engine's RoundRecord.decisions via ../decisions.ts (view model);
// this file only lays it out and picks strings.
//
// Revision reasons are engine sentences (English); ../decision-reasons.ts parses the ones the
// engine writes today so they show in the UI language, and anything else is shown verbatim.
import { useMemo, useState } from 'react';
import type { MatchSummary, TeamSlot } from '../../shared/ipc.ts';
import {
  adaptationSummary, matchNotes,
  type CallLabel, type RoundNote, type TeamNote, type TendencyView,
} from '../decisions.ts';
import { seatOf, type ReasonLabel } from '../decision-reasons.ts';
import { useT, type TFn } from '../i18n/index.tsx';

const SLOTS: TeamSlot[] = ['A', 'B'];

function callText(t: TFn, c: CallLabel): string {
  if (c.kind === 'commit') return t('rev.dec.call.commit', { site: c.site });
  if (c.kind === 'rotate') return t(`rev.dec.call.${c.mode}`, { site: c.site, n: c.count });
  if (c.kind === 'hold') return t('rev.dec.call.hold');
  if (c.kind === 'raw') return c.text;
  const key = `ostrat.${c.id}`;
  const label = t(key);
  const base = label === key ? c.id : label;
  return c.slow ? t('rev.dec.call.slow', { call: base }) : base;
}

/** A plan-change reason in the UI language; a sentence the parser does not know stays as the engine wrote it. */
function reasonText(t: TFn, why: ReasonLabel): string {
  switch (why.kind) {
    case 'raw': return why.text;
    case 'spikePlanted': case 'clockCommit': return t(`rev.dec.reason.${why.kind}`);
    case 'siteStacked': return t('rev.dec.reason.siteStacked', { from: why.from, to: why.to });
    case 'playerAdvantage': case 'evenAgain': return t(`rev.dec.reason.${why.kind}`, { us: why.us, them: why.them });
    case 'roundLost': return t('rev.dec.reason.roundLost', { us: why.us, them: why.them, chance: why.chance, floor: why.floor });
    case 'exitChase': {
      const seat = seatOf(why.player);
      const player = seat ? t(`rev.dec.reason.seat.${seat.side}`, { n: seat.n }) : why.player;
      return t('rev.dec.reason.exitChase', { atk: why.atk, def: why.def, player });
    }
    case 'rotation': {
      const evidence = t(`rev.dec.reason.${why.evidence}`, { site: why.site, n: why.n });
      const elsewhere = why.elsewhere.map((e) => t(`rev.dec.reason.else.${e.kind}`, { site: e.site, n: e.kind === 'count' ? e.n : 0 }));
      return t('rev.dec.reason.rotation', {
        evidence: [evidence + (why.contact ? t('rev.dec.reason.withContact') : ''), ...elsewhere].join(', '),
        site: why.site, hit: why.hit, fake: why.fake,
        call: why.rotate > 0 ? t('rev.dec.reason.rotate', { n: why.rotate }) : t('rev.dec.reason.standDown'),
      });
    }
  }
}

/** One opponent tendency: which way it leans, how sure, and whether it mattered this round. */
function ReadRow({ t, v }: { t: TFn; v: TendencyView }) {
  const value = v.level === 'none' ? t('rev.dec.read.noData')
    : v.lean ? t('rev.dec.read.lean', { site: v.lean, pct: v.pct[v.lean] })
      : t('rev.dec.read.even', { a: v.pct.A, b: v.pct.B });
  return (
    <div className={`dec-read lvl-${v.level} ${v.used ? 'used' : 'other'}`} data-testid="dec-read" data-level={v.level} data-used={v.used}>
      <div className="dec-readtop">
        <span className="dec-readq">{t(`rev.dec.read.${v.about}`)}</span>
        <span className="dec-readtag">{t(v.used ? 'rev.dec.read.used' : 'rev.dec.read.other')}</span>
      </div>
      <div className="dec-readval">{value}</div>
      {/* A | B split; hatched and faded when the evidence is thin */}
      <div className="dec-split" aria-hidden="true">
        <span className="dec-split-a" style={{ width: `${v.pct.A}%` }}>A</span>
        <span className="dec-split-b" style={{ width: `${v.pct.B}%` }}>B</span>
      </div>
      <div className="dec-conf">
        <span className="dec-confbar"><i style={{ width: `${Math.round(v.confidence * 100)}%` }} /></span>
        <span className={`dec-conflabel conf-${v.level}`} data-testid="dec-conf">
          {v.level === 'none' ? t('conf.none')
            : t('rev.dec.read.conf', { label: t(`conf.${v.level}`), pct: Math.round(v.confidence * 100), n: v.samples.toFixed(1) })}
        </span>
      </div>
      {v.used && v.level === 'low' && <div className="dec-hint">{t('rev.dec.read.lowHint')}</div>}
      {v.used && v.level === 'none' && <div className="dec-hint">{t('rev.dec.read.noneHint')}</div>}
    </div>
  );
}

function TeamCard({ t, note, name }: { t: TFn; note: TeamNote; name: string }) {
  const { plan, read, stance, check, learned } = note;
  const used = read ? (note.side === 'attack' ? read.defense : read.attack) : null;
  const unused = read ? (note.side === 'attack' ? read.attack : read.defense) : null;
  return (
    <div className={`dec-team ${note.team === 'A' ? 'rv-a' : 'rv-b'}`} data-testid={`dec-team-${note.team}`}>
      <div className="dec-teamhead">
        <b>{name}</b>
        <span className="dec-side">{t(`side.${note.side}`)}</span>
        <span className={`dec-wl ${note.won ? 'w' : 'l'}`}>{note.won ? t('rev.win') : t('rev.loss')}</span>
      </div>

      <div className="dec-block">
        <div className="dec-label">{t('rev.dec.read')}</div>
        {used && unused ? (<><ReadRow t={t} v={used} /><ReadRow t={t} v={unused} /></>)
          : <p className="dec-off" data-testid="dec-read-off">{t('rev.dec.read.off')}</p>}
      </div>

      <div className="dec-block">
        <div className="dec-label">{t('rev.dec.call')}</div>
        {plan ? (
          <>
            <p className="dec-callline" data-testid="dec-call">
              <span className="dec-k">{t('rev.dec.call.opening')}</span> <b>{callText(t, plan.opening)}</b>
              {plan.changed
                ? <> <span className="dec-arrow">→</span> <span className="dec-k">{t('rev.dec.call.final')}</span> <b className="dec-final">{callText(t, plan.final)}</b></>
                : <span className="muted"> · {t('rev.dec.call.kept')}</span>}
            </p>
            {(note.side === 'attack' || plan.objective || plan.feint) && (
              <p className="dec-callline">
                <span className="dec-k">{t('rev.dec.call.objective')}</span> <b>{plan.objective ?? t('rev.dec.call.objectiveNone')}</b>
                <span className="muted"> · </span>
                <span className="dec-k">{t('rev.dec.call.feint')}</span>{' '}
                {plan.feint ? <b className="dec-feint" data-testid="dec-feint">{t('rev.dec.call.feintText', { site: plan.feint })}</b> : <span className="muted">{t('rev.dec.call.noFeint')}</span>}
              </p>
            )}
            {stance && (
              <p className={`dec-stance st-${stance.kind}`} data-testid="dec-stance">
                {stance.kind === 'neutral' ? t('rev.dec.stance.neutral')
                  : t(`rev.dec.stance.${stance.kind}.${note.side}`, { site: stance.site, pred: stance.predicted })}
              </p>
            )}
          </>
        ) : <p className="muted">{t('rev.dec.noPlan')}</p>}
      </div>

      <div className="dec-block">
        <div className="dec-label">{t('rev.dec.revisions')}{plan && plan.revisions.length > 0 && <span className="dec-count">{plan.revisions.length}</span>}</div>
        {plan && plan.revisions.length > 0 ? (
          <ol className="dec-revs">
            {plan.revisions.map((r, i) => (
              <li key={i} data-testid="dec-revision">
                <span className="dec-clock">{t('rev.dec.rev.clock', { clock: r.clock })}</span>
                <span className="dec-revcall">{callText(t, r.from)} <span className="dec-arrow">→</span> <b>{callText(t, r.to)}</b></span>
                {r.why.kind === 'raw'
                  ? <span className="dec-reason" lang="en" title={t('rev.dec.rev.reason')} data-testid="dec-reason" data-localized="false">{r.reason}</span>
                  : <span className="dec-reason" title={r.reason} data-testid="dec-reason" data-localized="true">{reasonText(t, r.why)}</span>}
              </li>
            ))}
          </ol>
        ) : <p className="muted" data-testid="dec-norevision">{t('rev.dec.rev.none')}</p>}
      </div>

      <div className="dec-block">
        <div className="dec-label">{t('rev.dec.after')}</div>
        {check && (
          <p className={`dec-check ck-${check.result}`} data-testid="dec-check">
            {check.result === 'untested' ? t('rev.dec.check.untested', { pred: check.predicted })
              : t(`rev.dec.check.${check.result}`, { pred: check.predicted, actual: check.actual, evidence: t(`rev.dec.evidence.${check.evidence}`) })}
          </p>
        )}
        <p className="dec-learned">
          <span className="dec-k">{t('rev.dec.learned')}</span>{' '}
          {learned.kind === 'plant' ? t('rev.dec.learned.plant', { site: learned.site })
            : learned.kind === 'contact' ? t('rev.dec.learned.contact', { site: learned.site })
              : learned.kind === 'defenders' ? t('rev.dec.learned.defenders', { a: learned.met.A, b: learned.met.B })
                : <span className="muted">{t('rev.dec.learned.nothing')}</span>}
        </p>
      </div>
    </div>
  );
}

function observedLine(t: TFn, n: RoundNote): string {
  const o = n.observed;
  const met = o.defendersMet.A + o.defendersMet.B > 0
    ? t('rev.dec.obs.met', { a: o.defendersMet.A, b: o.defendersMet.B }) : t('rev.dec.obs.metNone');
  return [
    o.plantSite ? t('rev.dec.obs.plant', { site: o.plantSite }) : t('rev.dec.obs.noPlant'),
    o.firstContactSite ? t('rev.dec.obs.contact', { site: o.firstContactSite }) : t('rev.dec.obs.noContact'),
    met,
  ].join(' · ');
}

export function DecisionsPanel({ match }: { match: MatchSummary }) {
  const t = useT();
  const notes = useMemo(() => matchNotes(match), [match]);
  const summaries = useMemo(() => ({ A: adaptationSummary(notes, 'A'), B: adaptationSummary(notes, 'B') }), [notes]);
  const [picked, setPicked] = useState<number | null>(null);

  if (notes.length === 0) {
    return (
      <section className="rev-card" data-testid="rev-decisions-panel">
        <div className="attr-grouplabel">{t('rev.dec.title')} <span className="muted small">{t('rev.dec.sub')}</span></div>
        <div className="row small muted" data-testid="dec-none">{t('rev.dec.none')}</div>
      </section>
    );
  }

  const idx = Math.max(0, notes.findIndex((n) => n.roundNumber === picked));
  const note = notes[idx];
  const memoryOff = match.options?.opponentMemory === false || notes.every((n) => !n.teams.A.read && !n.teams.B.read);

  return (
    <section className="rev-card decisions" data-testid="rev-decisions-panel">
      <div className="attr-grouplabel">{t('rev.dec.title')} <span className="muted small">{t('rev.dec.sub')}</span></div>

      {memoryOff && <div className="dec-banner" data-testid="dec-memory-off">{t('rev.dec.memoryOff')}</div>}

      {/* match-level: did each team adapt? */}
      <div className="dec-summary" data-testid="dec-summary">
        <div className="dec-label">{t('rev.dec.summary')}</div>
        {SLOTS.map((s) => {
          const a = summaries[s];
          return (
            <div key={s} className={`dec-sumrow ${s === 'A' ? 'rv-a' : 'rv-b'}`}>
              <b>{match.teams[s].name}</b>
              <span>{t('rev.dec.sum.revised', { n: a.revisedRounds, total: a.rounds, count: a.revisions })}</span>
              <span>{t('rev.dec.sum.feints', { n: a.feints })}</span>
              <span>{a.readRounds > 0 ? t('rev.dec.sum.stance', { w: a.withRead, a: a.againstRead, n: a.readRounds }) : t('rev.dec.sum.noRead')}</span>
              <span>{a.readTested > 0 ? t('rev.dec.sum.hits', { hits: a.readHits, tested: a.readTested }) : t('rev.dec.sum.hitsNone')}</span>
            </div>
          );
        })}
      </div>

      {/* round picker */}
      <div className="dec-pickhead">
        <span className="dec-label">{t('rev.dec.pick')}</span>
        <span className="muted small">{t('rev.dec.legend', { team: match.teams.A.name })}</span>
      </div>
      <div className="dec-picker" data-testid="dec-picker">
        {notes.map((n) => (
          <button
            key={n.roundNumber}
            className={`dec-pick ${n.winner === 'A' ? 'w' : 'l'} ${n.roundNumber === note.roundNumber ? 'on' : ''}`}
            onClick={() => setPicked(n.roundNumber)}
            data-testid={`dec-pick-${n.roundNumber}`}
            aria-pressed={n.roundNumber === note.roundNumber}
          >
            {n.roundNumber}
            <span className="dec-marks">{n.revised ? '●' : ''}{n.feint ? 'F' : ''}</span>
          </button>
        ))}
      </div>

      {/* the picked round */}
      <div className="dec-round" data-testid="dec-round" data-round={note.roundNumber}>
        <div className="dec-roundhead">
          <b>{t('rev.dec.roundHead', { n: note.roundNumber, phase: t(`phase.${note.phase}`), attacker: match.teams[note.attacker].name })}</b>
          <span className={`dec-result ${note.winner === 'A' ? 'rv-a' : 'rv-b'}`}>{t('rev.dec.roundResult', { winner: match.teams[note.winner].name, reason: t(`reason.${note.reason}`) })}</span>
          <span className="dec-nav">
            <button onClick={() => setPicked(notes[idx - 1].roundNumber)} disabled={idx === 0} data-testid="dec-prev">{t('rev.dec.prev')}</button>
            <button onClick={() => setPicked(notes[idx + 1].roundNumber)} disabled={idx === notes.length - 1} data-testid="dec-next">{t('rev.dec.next')}</button>
          </span>
        </div>
        <div className="dec-observed" data-testid="dec-observed">
          <span className="dec-k">{t('rev.dec.observed')}</span> <span className="muted small">{t('rev.dec.observed.sub')}</span>
          <div>{observedLine(t, note)}</div>
        </div>
        <div className="dec-teams">
          {SLOTS.map((s) => <TeamCard key={s} t={t} note={note.teams[s]} name={match.teams[s].name} />)}
        </div>
      </div>
    </section>
  );
}
