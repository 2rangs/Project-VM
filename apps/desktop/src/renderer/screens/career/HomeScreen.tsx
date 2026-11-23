// Home hub (the Continue loop): today, the next fixture, squad status, latest inbox, the group
// table, and Continue — which advances the calendar day by day and stops when the manager is
// needed (match day, a message to answer, the season end).
import { useLang } from '../../i18n/index.tsx';
import { Flag } from '../../ui.tsx';
import { continueGame, useCareer } from '../../career/session.ts';
import { dayAgenda, groupStandings, GROUPS, nextUserFixture, scoutedAbility, startingFive, type CareerState } from '../../career/world.ts';
import { fixtureLabel, inboxText, opponentOf, teamName, userScore } from '../../career/view.ts';
import { LoadingScreen } from '../../loading/Loading.tsx';

export function ContinueButton({ big }: { big?: boolean }) {
  const { t } = useLang();
  const cs = useCareer();
  const c = cs.career;
  if (!c) return null;
  const ag = dayAgenda(c);
  const busy = !!cs.busy;
  const label = ag.userFixture ? t('home.continue.match') : ag.awaiting.length ? t('home.continue.answer') : t('app.continue');
  return (
    <button className={big ? 'md-run home-continue' : 'ctx-continue'} disabled={busy || !!ag.userFixture || ag.awaiting.length > 0}
      onClick={() => void continueGame()} data-testid={big ? 'home-continue' : 'continue'} title={label}>
      {busy ? t('home.continue.busy') : label}
    </button>
  );
}

export function SimProgressBar() {
  const { t } = useLang();
  const cs = useCareer();
  if (cs.busy?.kind !== 'continue') return null;
  const sim = cs.busy.sim;
  const running = sim && sim.current;
  return (
    // The match-day session's loading surface, in a box on Home (the rest of Home stays visible).
    <div className="home-sim">
      <LoadingScreen cover="area" testId="career-progress"
        title={running ? t('home.sim.title', { date: cs.busy.date ?? '' }) : t('home.sim.days', { date: cs.busy.date ?? '' })}
        detail={running ? `${sim!.current!.home} vs ${sim!.current!.away}` : undefined}
        progress={sim && sim.total ? sim.done / sim.total : null}
        steps={sim && sim.total ? t('home.sim.steps', { done: sim.done, total: sim.total }) : null}
      />
    </div>
  );
}

function SquadStatus({ c }: { c: CareerState }) {
  const { t } = useLang();
  const five = startingFive(c.world, c.userTeamId);
  return (
    <table className="nc-table" data-testid="home-squad">
      <thead><tr><th>{t('home.squad.player')}</th><th>{t('col.role')}</th><th>{t('home.squad.ca')}</th><th>{t('home.squad.maps')}</th><th>{t('home.squad.form')}</th></tr></thead>
      <tbody>
        {five.map((p) => {
          const s = c.stats[p.playerId];
          const form = s ? Math.round(s.form * 100) : null;
          return (
            <tr key={p.playerId}>
              <td><b>{p.handle ?? p.playerId}</b> <Flag cc={p.country} /></td>
              <td className="muted">{p.role ?? '—'}</td>
              <td>{scoutedAbility(c.world, c.userTeamId, p).ca}</td>
              <td>{s?.maps ?? 0}</td>
              <td className={form == null ? 'muted' : form >= 55 ? 'form-up' : form <= 45 ? 'form-down' : ''}>{form ?? '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function HomeScreen({ go, openMatch }: { go: (route: string) => void; openMatch: () => void }) {
  const { t, lang } = useLang();
  const cs = useCareer();
  const c = cs.career!;
  const ag = dayAgenda(c);
  const next = nextUserFixture(c);
  const opp = next ? opponentOf(c, next) : null;
  const stage = c.season.stages.find((s) => s.start && !s.champion) ?? c.season.stages.find((s) => s.start)!;
  const group = GROUPS.find((g) => stage.groups[g].includes(c.userTeamId)) ?? 'alpha';
  const table = groupStandings(c.season, stage.id, group);
  const recent = [...c.inbox].reverse().slice(0, 5);
  const last = [...c.season.fixtures].reverse().find((f) => f.result && (f.home === c.userTeamId || f.away === c.userTeamId));
  const lastScore = last ? userScore(c, last) : null;

  return (
    <div className="pad home" data-testid="home">
      <div className="home-top">
        <div>
          <div className="home-date" data-testid="home-date">{c.date}</div>
          <div className="muted small">{t('home.season', { season: c.season.season, stage: t(`career.enum.${stage.id}`) })} · {teamName(c, c.userTeamId)} · {c.manager.name}</div>
        </div>
        <ContinueButton big />
      </div>
      <SimProgressBar />
      {cs.notice && <div className="disclaimer-banner warn small" data-testid="home-notice">{t('home.sim.fallback', { msg: cs.notice })}</div>}
      {cs.error && <div className="err small">⚠ {cs.error}</div>}

      {ag.userFixture && (
        <div className="home-matchday" data-testid="home-matchday">
          <div><b>{t('home.matchday')}</b> · {fixtureLabel(t, ag.userFixture)} · {t(`career.enum.${ag.userFixture.format}`)}</div>
          <div className="home-vs">{teamName(c, c.userTeamId)} <span className="muted">vs</span> {teamName(c, opponentOf(c, ag.userFixture))}</div>
          <button className="md-run" onClick={openMatch} data-testid="home-go-match">{t('home.goMatch')}</button>
        </div>
      )}
      {ag.awaiting.length > 0 && (
        <div className="home-matchday warn" data-testid="home-awaiting">
          <b>{t('home.awaiting', { n: ag.awaiting.length })}</b>
          <button className="md-run" onClick={() => go('inbox')} data-testid="home-go-inbox">{t('home.goInbox')}</button>
        </div>
      )}
      {ag.seasonEnd && <div className="home-matchday" data-testid="home-season-end"><b>{t('home.seasonEnd', { season: c.season.season })}</b><span className="small muted">{t('home.seasonEndHint')}</span></div>}

      <div className="home-grid">
        <section className="md-card" data-testid="home-next">
          <h3>{t('home.next')}</h3>
          {next && opp !== undefined ? (
            <>
              <div className="home-vs">{teamName(c, c.userTeamId)} <span className="muted">vs</span> {opp ? teamName(c, opp) : t('home.tbd')}</div>
              <div className="small muted">{next.date} · {fixtureLabel(t, next)} · {t(`career.enum.${next.format}`)}</div>
            </>
          ) : <div className="small muted">{t('home.noFixture')}</div>}
          {last && lastScore && (
            <div className="small mt">{t('home.last')}: <b className={lastScore.won ? 'form-up' : 'form-down'}>{lastScore.text}</b> vs {teamName(c, opponentOf(c, last))}</div>
          )}
          <button className="ord-cancel mt" onClick={() => go('schedule')}>{t('nav.schedule')} →</button>
        </section>

        <section className="md-card">
          <h3>{t('home.table', { stage: t(`career.enum.${stage.id}`), group: t(`career.enum.${group}`) })}</h3>
          <table className="nc-table" data-testid="home-table">
            <tbody>
              {table.map((r, i) => (
                <tr key={r.teamId} className={r.teamId === c.userTeamId ? 'me' : ''}>
                  <td>{i + 1}</td><td>{teamName(c, r.teamId)}</td><td>{r.wins}–{r.losses}</td><td className="muted">{r.mapsWon - r.mapsLost >= 0 ? '+' : ''}{r.mapsWon - r.mapsLost}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="ord-cancel mt" onClick={() => go('standings')}>{t('nav.standings')} →</button>
        </section>

        <section className="md-card">
          <h3>{t('home.squad')}</h3>
          <SquadStatus c={c} />
        </section>

        <section className="md-card" data-testid="home-inbox">
          <h3>{t('nav.inbox')}</h3>
          {recent.map((m) => {
            const tx = inboxText(t, lang, m);
            return <div key={m.id} className={`home-mail ${m.read ? '' : 'unread'}`} onClick={() => go('inbox')}><span className="muted small">{m.date}</span> {tx.title}</div>;
          })}
          <button className="ord-cancel mt" onClick={() => go('inbox')}>{t('nav.inbox')} →</button>
        </section>
      </div>
    </div>
  );
}
