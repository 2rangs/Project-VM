// PROJECT V desktop — manager-game shell.
// The app opens on the START MENU (no engine runs): New Career / Continue / Load / Settings /
// Quick Match / Quit. A career opens the career shell on Home (the Continue loop); Quick Match
// opens the sandbox (the match engine and dev tools, as before).
// Layout (genre convention, no FM/OOTP branding or screen copies):
//   ┌──────────────────────────────────────────────┐
//   │ context bar: our team · date · next · ▶       │
//   ├────────┬───────────────────────────┬──────────┤
//   │  left  │        main content       │  detail  │
//   │  nav   │                           │  panel   │
//   └────────┴───────────────────────────┴──────────┘
import { useEffect, useState, type ReactNode } from 'react';
import type { Replay } from '@pv/replay-engine';
import { viewerCss } from '@pv/replay-viewer';
import { runtime } from './platform.ts';
import { NAV } from './nav.ts';
import { useT } from './i18n/index.tsx';
import { MatchDayScreen } from './screens/MatchDayScreen.tsx';
import { SquadScreen } from './screens/SquadScreen.tsx';
import { ScoutingScreen } from './screens/ScoutingScreen.tsx';
import { OpponentScreen } from './screens/OpponentScreen.tsx';
import { TacticsScreen } from './screens/TacticsScreen.tsx';
import { AgentSelectScreen } from './screens/AgentSelectScreen.tsx';
import { DevScreen } from './screens/DevScreen.tsx';
import { AboutScreen } from './screens/AboutScreen.tsx';
import { Placeholder } from './screens/Placeholder.tsx';
import { Icon, NAV_ICONS } from './screens/matchday/Icons.tsx'; // [icons] one glyph set for the whole shell
import { SeriesScreen } from './screens/series/SeriesScreen.tsx'; // [series]
// [career]
import { closeCareer, saveCareer, useCareer } from './career/session.ts';
import { nextUserFixture, unreadCount } from './career/world.ts';
import { opponentOf, teamName } from './career/view.ts';
import { StartMenu } from './screens/career/StartMenu.tsx';
import { NewCareer } from './screens/career/NewCareer.tsx';
import { HomeScreen, ContinueButton } from './screens/career/HomeScreen.tsx';
import { InboxScreen } from './screens/career/InboxScreen.tsx';
import { ScheduleScreen } from './screens/career/ScheduleScreen.tsx';
import { StandingsScreen } from './screens/career/StandingsScreen.tsx';
import { CareerMatch } from './screens/career/CareerMatch.tsx';
import './screens/career/career.css';
import { FinanceScreen } from './screens/club/FinanceScreen.tsx'; // [club-ops]
import { TransfersScreen } from './screens/club/TransfersScreen.tsx'; // [club-ops]
import { TrainingScreen } from './screens/club/TrainingScreen.tsx'; // [club-ops]

export type DetailPanel = { title: string; body: ReactNode } | null;

type Mode = 'start' | 'new-career' | 'sandbox';

export default function App() {
  const cs = useCareer();
  const [mode, setMode] = useState<Mode>('start');
  const inCareer = !!cs.career;
  const [route, setRoute] = useState('match-day');
  const [replay, setReplay] = useState<Replay | null>(null);
  const [detail, setDetail] = useState<DetailPanel>(null);
  const t = useT();

  // A career that opens (new or loaded) lands on Home.
  const careerKey = cs.career ? `${cs.slot}:${cs.career.seed}:${cs.career.userTeamId}` : null;
  useEffect(() => { if (careerKey) { setRoute('home'); setDetail(null); } }, [careerKey]);

  const ctx = { setDetail, replay, setReplay };
  const go = (r: string) => { setDetail(null); setRoute(r); };
  const toMenu = () => { closeCareer(); setMode('start'); setDetail(null); setRoute('match-day'); };

  if (!inCareer && mode === 'start') return <StartMenu onNewCareer={() => setMode('new-career')} onQuickMatch={() => { setMode('sandbox'); setRoute('match-day'); }} />;
  if (!inCareer && mode === 'new-career') return <NewCareer onCancel={() => setMode('start')} />;

  const c = cs.career;
  const next = c ? nextUserFixture(c) : null;
  const nav = NAV.map((g) => ({ ...g, items: g.items.filter((it) => inCareer || !it.career) })).filter((g) => g.items.length > 0);
  const unread = c ? unreadCount(c) : 0;

  return (
    <div className="mgr" data-mode={inCareer ? 'career' : 'sandbox'}>
      <style>{viewerCss}</style>

      <header className="ctxbar">
        {c ? (
          <>
            <span className="ctx-team">▦ <b data-testid="ctx-team">{teamName(c, c.userTeamId)}</b> <span className="muted">· {c.manager.name}</span></span>
            <span className="ctx-mid"><b data-testid="ctx-date">{c.date}</b> · {t('career.enum.' + (c.season.stages.find((s) => s.start && !s.champion)?.id ?? 'stage1'))}</span>
            <span className="ctx-next muted">{next ? <>{t('app.next')}vs <b>{teamName(c, opponentOf(c, next)) }</b> · {next.date}</> : null}</span>
            <ContinueButton />
            <button className="ord-cancel" onClick={() => void saveCareer()} disabled={!!cs.busy} data-testid="ctx-save">{t('career.save')}</button>
            <button className="ord-cancel" onClick={() => { if (!cs.busy) toMenu(); }} disabled={!!cs.busy} data-testid="ctx-menu">{t('career.menu')}</button>
          </>
        ) : (
          <>
            <span className="ctx-team">▦ <b>PROJECT V</b> <span className="muted">{t('app.sandbox')}</span></span>
            <span className="ctx-mid muted">{t('app.sandboxHint')}</span>
            <button className="ctx-continue" onClick={toMenu} data-testid="ctx-menu">{t('career.menu')}</button>
          </>
        )}
        <span className="ctx-rt">{runtime === 'electron' ? t('app.electron') : t('app.browser')}</span>
      </header>

      <div className="mgr-body">
        <nav className="leftnav">
          {nav.map((group) => (
            <div key={group.label} className="nav-group">
              <div className="nav-grouplabel">{t(`nav.group.${group.label}`)}</div>
              {group.items.map((it) => (
                <button
                  key={it.id}
                  className={`nav-item ${route === it.id ? 'on' : ''} ${it.soon ? 'soon' : ''}`}
                  onClick={() => go(it.id)}
                  data-testid={`nav-${it.id}`}
                >
                  <span className="nav-ico">{NAV_ICONS[it.id] ? <Icon name={NAV_ICONS[it.id]} size={15} /> : it.icon}</span>{t(`nav.${it.id}`)}
                  {it.id === 'inbox' && unread > 0 && <span className="nav-badge" data-testid="inbox-unread">{unread}</span>}
                  {it.soon && <span className="soon-tag">{t('nav.soon')}</span>}
                  {it.dev && <span className="dev-tag">{t('nav.dev')}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <main className="maincontent" data-testid={`screen-${route}`}>
          {route === 'home' && c && <HomeScreen go={go} openMatch={() => go('career-match')} />}
          {route === 'inbox' && c && <InboxScreen />}
          {route === 'schedule' && c && <ScheduleScreen />}
          {route === 'standings' && c && <StandingsScreen />}
          {route === 'career-match' && c && <CareerMatch ctx={ctx} onDone={() => go('home')} />}
          {route === 'match-day' && <MatchDayScreen ctx={ctx} />}
          {route === 'veto' && <SeriesScreen ctx={ctx} />}
          {route === 'squad' && <SquadScreen setDetail={setDetail} />}
          {route === 'scouting' && <ScoutingScreen setDetail={setDetail} />}
          {route === 'finance' && <FinanceScreen setDetail={setDetail} />}
          {route === 'transfers' && <TransfersScreen setDetail={setDetail} />}
          {route === 'training' && <TrainingScreen setDetail={setDetail} />}
          {route === 'opponent' && <OpponentScreen setDetail={setDetail} />}
          {route === 'tactics' && <TacticsScreen setDetail={setDetail} />}
          {route === 'agents' && <AgentSelectScreen setDetail={setDetail} />}
          {route === 'dev-debugger' && <DevScreen ctx={ctx} />}
          {route === 'about' && <AboutScreen />}
          {NAV.flatMap((g) => g.items).find((i) => i.id === route)?.soon && (
            <Placeholder title={t(`nav.${route}`)} />
          )}
        </main>

        <aside className={`detailpanel ${detail ? 'open' : ''}`} data-testid="detail-panel">
          {detail ? (
            <>
              <div className="detail-head">{detail.title}<button className="detail-close" onClick={() => setDetail(null)}>✕</button></div>
              <div className="detail-body">{detail.body}</div>
            </>
          ) : <div className="detail-empty muted">{t('common.selectItem')}</div>}
        </aside>
      </div>
    </div>
  );
}

export interface ScreenCtx {
  setDetail: (d: DetailPanel) => void;
  replay: Replay | null;
  setReplay: (r: Replay | null) => void;
}
