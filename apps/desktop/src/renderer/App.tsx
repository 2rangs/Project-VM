// PROJECT V desktop — manager-game shell.
// Layout (genre convention, no FM/OOTP branding or screen copies):
//   ┌──────────────────────────────────────────────┐
//   │ context bar: our team · date/round · next · ▶ │
//   ├────────┬───────────────────────────┬──────────┤
//   │  left  │        main content       │  detail  │
//   │  nav   │                           │  panel   │
//   └────────┴───────────────────────────┴──────────┘
// DECISION-001: data/engine screens work first; club/finance/etc are placeholders.
import { useState, type ReactNode } from 'react';
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
import { SeriesScreen } from './screens/series/SeriesScreen.tsx'; // [series]
import { FinanceScreen } from './screens/club/FinanceScreen.tsx'; // [club-ops]
import { TransfersScreen } from './screens/club/TransfersScreen.tsx'; // [club-ops]
import { TrainingScreen } from './screens/club/TrainingScreen.tsx'; // [club-ops]

export type DetailPanel = { title: string; body: ReactNode } | null;

export default function App() {
  const [route, setRoute] = useState('match-day');
  const [replay, setReplay] = useState<Replay | null>(null);
  const [detail, setDetail] = useState<DetailPanel>(null);
  const t = useT();

  const ctx = { setDetail, replay, setReplay };

  return (
    <div className="mgr">
      <style>{viewerCss}</style>

      <header className="ctxbar">
        <span className="ctx-team">▦ <b>PROJECT V</b> <span className="muted">{t('app.brand.sub')}</span></span>
        <span className="ctx-mid">{t('app.league')} · <b>{t('app.matchDay')}</b></span>
        <span className="ctx-next muted">{t('app.next')}vs <b>NRG</b> · Ascent</span>
        <button className="ctx-continue" data-testid="continue">{t('app.continue')}</button>
        <span className="ctx-rt">{runtime === 'electron' ? t('app.electron') : t('app.browser')}</span>
      </header>

      <div className="mgr-body">
        <nav className="leftnav">
          {NAV.map((group) => (
            <div key={group.label} className="nav-group">
              <div className="nav-grouplabel">{t(`nav.group.${group.label}`)}</div>
              {group.items.map((it) => (
                <button
                  key={it.id}
                  className={`nav-item ${route === it.id ? 'on' : ''} ${it.soon ? 'soon' : ''}`}
                  onClick={() => { setDetail(null); setRoute(it.id); }}
                  data-testid={`nav-${it.id}`}
                >
                  <span className="nav-ico">{it.icon}</span>{t(`nav.${it.id}`)}
                  {it.soon && <span className="soon-tag">{t('nav.soon')}</span>}
                  {it.dev && <span className="dev-tag">{t('nav.dev')}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <main className="maincontent" data-testid={`screen-${route}`}>
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
