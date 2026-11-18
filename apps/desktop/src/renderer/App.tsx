// Desktop shell: three screens (Replay / Decision Debugger / Simulation Runner)
// behind a tab bar. State shared across tabs lives here; screens stay dumb.
import { useState } from 'react';
import type { Replay } from '@pv/replay-engine';
import { viewerCss } from '@pv/replay-viewer';
import { ReplayScreen } from './screens/ReplayScreen.tsx';
import { DebuggerScreen } from './screens/DebuggerScreen.tsx';
import { SimulationScreen } from './screens/SimulationScreen.tsx';
import { runtime } from './platform.ts';
import syntheticReplay from '../../../replay-viewer/public/fixtures/synthetic-replay.json';

type Tab = 'replay' | 'debugger' | 'simulation';

export default function App() {
  const [tab, setTab] = useState<Tab>('replay');
  const [replay, setReplay] = useState<Replay | null>(syntheticReplay as unknown as Replay);
  const [replayLabel, setReplayLabel] = useState('synthetic fixture');
  const [seekTo, setSeekTo] = useState<number | null>(null);

  const openReplay = (r: Replay, label: string) => { setReplay(r); setReplayLabel(label); };
  const jumpToReplay = (roundNum: number) => {
    const rd = replay?.rounds.find((x) => x.roundNum === roundNum);
    if (rd) { setSeekTo(rd.startMs); setTab('replay'); }
  };

  return (
    <div className="shell">
      <style>{viewerCss}</style>
      <nav className="tabs">
        <span className="brand">PROJECT V · Desktop</span>
        {(['replay', 'debugger', 'simulation'] as Tab[]).map((t) => (
          <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)} data-testid={`tab-${t}`}>
            {t === 'replay' ? 'Replay Viewer' : t === 'debugger' ? 'Decision Debugger' : 'Simulation Runner'}
          </button>
        ))}
        <span className="rt">{runtime === 'electron' ? '⬡ Electron' : '◻ browser'} · {replayLabel}</span>
      </nav>

      <main className="screen">
        {tab === 'replay' && <ReplayScreen replay={replay} seekTo={seekTo} onOpen={openReplay} />}
        {tab === 'debugger' && <DebuggerScreen onJumpToReplay={jumpToReplay} />}
        {tab === 'simulation' && <SimulationScreen onResult={openReplay} onOpenReplay={() => setTab('replay')} />}
      </main>
    </div>
  );
}
