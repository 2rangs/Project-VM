// Schedule: a month calendar (match days marked, today highlighted) and the fixture list with
// results — the manager's own fixtures or the whole league.
import { useMemo, useState } from 'react';
import { useLang } from '../../i18n/index.tsx';
import { useCareer } from '../../career/session.ts';
import { addDays, isoDate, weekday, isUserFixture, type Fixture } from '../../career/world.ts';
import { fixtureLabel, fixturesByMonth, teamName, userScore } from '../../career/view.ts';

export function ScheduleScreen() {
  const { t, lang } = useLang();
  const cs = useCareer();
  const c = cs.career!;
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const months = useMemo(() => [...fixturesByMonth(c.season.fixtures).keys()], [c.season.fixtures]);
  const [month, setMonth] = useState(() => months.find((m) => m >= c.date.slice(0, 7)) ?? months[0] ?? c.date.slice(0, 7));
  const fixtures = c.season.fixtures.filter((f) => f.date.startsWith(month) && (scope === 'all' || isUserFixture(c, f)));
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = isoDate(y, m, 1);
  const lead = (weekday(first) + 6) % 7; // weeks start on Monday
  const days: Array<string | null> = Array.from({ length: lead }, () => null);
  for (let d = first; d.startsWith(month); d = addDays(d, 1)) days.push(d);
  const onDay = (d: string) => c.season.fixtures.filter((f) => f.date === d);
  const monthName = (() => { try { return new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`)); } catch { return month; } })();
  const wd = (i: number) => { try { return new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + i))); } catch { return String(i); } };
  const idx = months.indexOf(month);

  const row = (f: Fixture) => {
    const sc = userScore(c, f);
    const mine = isUserFixture(c, f);
    return (
      <tr key={f.id} className={mine ? 'me' : ''} data-testid={`fixture-${f.id}`}>
        <td className="muted">{f.date}</td>
        <td className="small">{fixtureLabel(t, f)}</td>
        <td>{f.home ? teamName(c, f.home) : t('home.tbd')}</td>
        <td className="sched-score">
          {f.result ? (mine && sc ? <b className={sc.won ? 'form-up' : 'form-down'}>{f.result.mapsWon[0]}–{f.result.mapsWon[1]}</b> : <b>{f.result.mapsWon[0]}–{f.result.mapsWon[1]}</b>)
            : <span className="muted">{t(`career.enum.${f.format}`)}</span>}
        </td>
        <td>{f.away ? teamName(c, f.away) : t('home.tbd')}</td>
        <td className="small muted">{f.result ? f.result.maps.map((x) => `${x.map} ${x.score[0]}–${x.score[1]}`).join(', ') : ''}</td>
      </tr>
    );
  };

  return (
    <div className="pad sched" data-testid="schedule">
      <div className="sched-head">
        <h2>{t('nav.schedule')} <span className="muted small">{c.season.season}</span></h2>
        <div className="md-modetoggle">
          <button className={scope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')} data-testid="sched-mine">{t('sched.mine')}</button>
          <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')} data-testid="sched-all">{t('sched.all')}</button>
        </div>
      </div>
      <div className="sched-month">
        <button className="ord-cancel" disabled={idx <= 0} onClick={() => setMonth(months[idx - 1]!)}>◀</button>
        <b>{monthName}</b>
        <button className="ord-cancel" disabled={idx < 0 || idx >= months.length - 1} onClick={() => setMonth(months[idx + 1]!)}>▶</button>
        {c.season.stages.some((s) => !s.start) && <span className="small muted">{t('sched.stage2Pending')}</span>}
      </div>
      <div className="cal" data-testid="calendar">
        {Array.from({ length: 7 }, (_, i) => <div key={`h${i}`} className="cal-h">{wd(i)}</div>)}
        {days.map((d, i) => {
          if (!d) return <div key={`e${i}`} className="cal-d empty" />;
          const fx = onDay(d);
          const mine = fx.find((f) => isUserFixture(c, f));
          return (
            <div key={d} className={`cal-d ${d === c.date ? 'today' : ''} ${mine ? 'mine' : fx.length ? 'league' : ''}`} title={fx.map((f) => `${teamName(c, f.home)} – ${teamName(c, f.away)}`).join('\n')}>
              <span className="cal-n">{Number(d.slice(8))}</span>
              {mine && <span className="cal-tag">{mine.result ? userScore(c, mine)?.text : `vs ${teamName(c, mine.home === c.userTeamId ? mine.away : mine.home)}`}</span>}
              {!mine && fx.length > 0 && <span className="cal-dot">{fx.length}</span>}
            </div>
          );
        })}
      </div>
      <table className="nc-table sched-table">
        <tbody>{fixtures.map(row)}</tbody>
      </table>
      {fixtures.length === 0 && <div className="small muted">{t('sched.none')}</div>}
    </div>
  );
}
