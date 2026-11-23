// Match load screen — what covers the wait while a match is simulated / a session starts and the
// live view's assets are prepared. Laid out like a shooter's pre-match screen: the map name large
// in the centre, the two five-player line-ups facing each other with their side (attack /
// defense), a VS between them, and the progress underneath.
//
// Agent portraits and the map splash come from valorant-api.com at runtime (the same source the app
// already uses for the minimap); nothing is stored in git. Without network the tiles fall back to
// our role glyphs and the plain gradient.
import { useEffect, useState } from 'react';
import { useT } from '../i18n/index.tsx';
import { rosterHandles, agentOfSlot } from '../matchday/roster.ts';
import { Icon, ROLE_ICON } from '../screens/matchday/Icons.tsx';
import { LoadingBanner, useLoadingBanner, type BannerStage } from './StreakBanner.tsx';
import './loading.css';

interface GameArt { agents: Record<string, string>; splash: Record<string, string> }
let artPromise: Promise<GameArt> | null = null;
/** Agent portraits (by display name, lower-case) and map splashes (by name), fetched once. */
function loadGameArt(): Promise<GameArt> {
  if (!artPromise) {
    artPromise = Promise.all([
      fetch('https://valorant-api.com/v1/agents?isPlayableCharacter=true').then((r) => r.json()).catch(() => ({ data: [] })),
      fetch('https://valorant-api.com/v1/maps').then((r) => r.json()).catch(() => ({ data: [] })),
    ]).then(([a, m]) => ({
      agents: Object.fromEntries(((a.data ?? []) as Array<{ displayName: string; displayIcon: string | null }>).filter((x) => x.displayIcon).map((x) => [x.displayName.toLowerCase(), x.displayIcon!])),
      splash: Object.fromEntries(((m.data ?? []) as Array<{ displayName: string; splash: string | null }>).filter((x) => x.splash).map((x) => [x.displayName.toLowerCase(), x.splash!])),
    }));
  }
  return artPromise;
}
function useGameArt(): GameArt | null {
  const [art, setArt] = useState<GameArt | null>(null);
  useEffect(() => { let alive = true; void loadGameArt().then((a) => { if (alive) setArt(a); }); return () => { alive = false; }; }, []);
  return art;
}

export interface MatchLoadTeam { id: string; name: string; side: 'attack' | 'defense' }

function Lineup({ team, tone, art }: { team: MatchLoadTeam; tone: 'ally' | 'enemy'; art: GameArt | null }) {
  const t = useT();
  const handles = rosterHandles(team.id);
  return (
    <section className={`pvm-team ${tone}`} data-testid={`matchload-${tone}`}>
      <header><span>{t(team.side === 'attack' ? 'load.match.attacking' : 'load.match.defending')}</span><b>{team.name}</b></header>
      <ol>
        {handles.map((handle, i) => {
          const agent = agentOfSlot(i + 1);
          return (
            <li key={i}>
              <span className="pvm-tile">{agent && (art?.agents[agent.name.toLowerCase()]
                ? <img src={art.agents[agent.name.toLowerCase()]} alt={agent.name} />
                : <Icon name={ROLE_ICON[agent.role]} size={26} />)}</span>
              <span className="pvm-card"><i>{String(i + 1).padStart(2, '0')}</i><em>{agent?.name ?? ''}</em></span>
              <b className="pvm-name">{handle}</b>
              <span className="pvm-agent">{agent ? `${t(`mdx.role.${agent.role}`)} · ${agent.name}` : ''}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function MatchLoadScreen({ map, mode, ally, enemy, progress, steps, testId = 'loading-screen' }: {
  map: string; mode: string; ally: MatchLoadTeam; enemy: MatchLoadTeam;
  /** 0..1 when the work reports progress; null for an indeterminate bar. */
  progress: number | null; steps: string | null; testId?: string;
}) {
  const banner = useLoadingBanner();
  const art = useGameArt();
  const splash = art?.splash[map.toLowerCase()] ?? null;
  const pct = progress == null ? null : Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const stage: BannerStage = pct == null ? 'loop' : (Math.min(5, Math.floor(pct / 20) + 1) as BannerStage);
  return (
    <div className="pvm" role="status" aria-live="polite" aria-busy="true" data-testid={testId} data-banner={banner} data-layout="match" data-art={art ? 'game' : 'none'}>
      {splash && <img className="pvm-splash" src={splash} alt="" />}
      <Lineup team={ally} tone="ally" art={art} />
      <div className="pvm-mid">
        <h1>{map}</h1>
        <p>{mode}</p>
        <div className="pvm-vs"><LoadingBanner variant={banner} stage={stage} size={132} /><strong>VS</strong></div>
        <div className={`pvl-bar ${pct == null ? 'indeterminate' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}><i style={pct == null ? undefined : { width: `${pct}%` }} /></div>
        <span className="pvl-steps" data-testid="loading-steps">{steps ?? (pct != null ? `${pct}%` : ' ')}</span>
      </div>
      <Lineup team={enemy} tone="enemy" art={art} />
    </div>
  );
}
