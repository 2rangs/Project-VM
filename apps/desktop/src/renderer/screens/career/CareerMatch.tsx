// The manager's match day: today's fixture through the existing series screen (veto, then each
// map one-shot or round by round in Match Day), with the career world's five players per side and
// our analyst. The finished series is recorded into the career (standings, minutes, form).
import type { ScreenCtx } from '../../App.tsx';
import { useLang } from '../../i18n/index.tsx';
import { recordUserSeries, useCareer } from '../../career/session.ts';
import { dayAgenda, quickSeries, seriesRequest } from '../../career/world.ts';
import { fixtureLabel, outcomeFromSeries, seriesSetup } from '../../career/view.ts';
import { SeriesScreen } from '../series/SeriesScreen.tsx';

export function CareerMatch({ ctx, onDone }: { ctx: ScreenCtx; onDone: () => void }) {
  const { t } = useLang();
  const cs = useCareer();
  const c = cs.career!;
  const f = dayAgenda(c).userFixture;
  if (!f) {
    return (
      <div className="pad" data-testid="career-match-none">
        <div className="muted">{t('career.match.none')}</div>
        <button className="ord-cancel mt" onClick={onDone}>{t('career.match.back')}</button>
      </div>
    );
  }
  const setup = seriesSetup(c, f);
  /** Skip the match: the quick estimate plays it from the two fives' ability (FM's instant result). */
  const instant = async () => {
    const req = seriesRequest(c, f);
    const out = quickSeries(req, c);
    await recordUserSeries(f.id, { ...out, lineups: { home: req.home.lineup, away: req.away.lineup } });
    onDone();
  };
  return (
    <>
    <div className="career-instant">
      <span className="small muted">{t('career.match.instantHint')}</span>
      <button className="ord-cancel" onClick={() => void instant()} disabled={!!cs.busy} data-testid="career-instant">{t('career.match.instant')}</button>
    </div>
    <SeriesScreen
      key={f.id}
      ctx={ctx}
      fixture={{
        ...setup,
        label: `${fixtureLabel(t, f)} · ${f.date}`,
        onBack: onDone,
        onFinished: async (view) => { await recordUserSeries(f.id, outcomeFromSeries(c, f, view)); onDone(); },
      }}
    />
    </>
  );
}
