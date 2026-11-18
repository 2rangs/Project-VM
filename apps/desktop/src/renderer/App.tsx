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
import { MatchDayScreen } from './screens/MatchDayScreen.tsx';
import { SquadScreen } from './screens/SquadScreen.tsx';
import { OpponentScreen } from './screens/OpponentScreen.tsx';
import { TacticsScreen } from './screens/TacticsScreen.tsx';
import { AgentSelectScreen } from './screens/AgentSelectScreen.tsx';
import { DevScreen } from './screens/DevScreen.tsx';
import { AboutScreen } from './screens/AboutScreen.tsx';
import { Placeholder } from './screens/Placeholder.tsx';

export type DetailPanel = { title: string; body: ReactNode } | null;

export default function App() {
  const [route, setRoute] = useState('match-day');
  const [replay, setReplay] = useState<Replay | null>(null);
  const [detail, setDetail] = useState<DetailPanel>(null);

  const ctx = { setDetail, replay, setReplay };

  return (
    <div className="mgr">
      <style>{viewerCss}</style>

      <header className="ctxbar">
        <span className="ctx-team">▦ <b>PROJECT V</b> <span className="muted">· my team</span></span>
        <span className="ctx-mid">VCT 2026 · Regular Season · <b>Match Day</b></span>
        <span className="ctx-next muted">Next: vs <b>NRG</b> · Ascent</span>
        <button className="ctx-continue" data-testid="continue">Continue ▶</button>
        <span className="ctx-rt">{runtime === 'electron' ? '⬡ Electron' : '◻ browser'}</span>
      </header>

      <div className="mgr-body">
        <nav className="leftnav">
          {NAV.map((group) => (
            <div key={group.label} className="nav-group">
              <div className="nav-grouplabel">{group.label}</div>
              {group.items.map((it) => (
                <button
                  key={it.id}
                  className={`nav-item ${route === it.id ? 'on' : ''} ${it.soon ? 'soon' : ''}`}
                  onClick={() => { setDetail(null); setRoute(it.id); }}
                  data-testid={`nav-${it.id}`}
                >
                  <span className="nav-ico">{it.icon}</span>{it.label}
                  {it.soon && <span className="soon-tag">soon</span>}
                  {it.dev && <span className="dev-tag">dev</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <main className="maincontent" data-testid={`screen-${route}`}>
          {route === 'match-day' && <MatchDayScreen ctx={ctx} />}
          {route === 'squad' && <SquadScreen setDetail={setDetail} />}
          {route === 'opponent' && <OpponentScreen setDetail={setDetail} />}
          {route === 'tactics' && <TacticsScreen setDetail={setDetail} />}
          {route === 'agents' && <AgentSelectScreen setDetail={setDetail} />}
          {route === 'dev-debugger' && <DevScreen />}
          {route === 'about' && <AboutScreen />}
          {NAV.flatMap((g) => g.items).find((i) => i.id === route)?.soon && (
            <Placeholder title={NAV.flatMap((g) => g.items).find((i) => i.id === route)!.label} />
          )}
        </main>

        <aside className={`detailpanel ${detail ? 'open' : ''}`} data-testid="detail-panel">
          {detail ? (
            <>
              <div className="detail-head">{detail.title}<button className="detail-close" onClick={() => setDetail(null)}>✕</button></div>
              <div className="detail-body">{detail.body}</div>
            </>
          ) : <div className="detail-empty muted">Select an item to see details.</div>}
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
