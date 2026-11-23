// Home — the first screen of the app: a full-window lobby.
//
// Design language: the game's 5.08 interface refresh as published (fewer ornaments, higher
// contrast, one clear call to action, symmetric team presentation with a VS, `NN // LABEL`
// section headers, a centred trapezoid PLAY tab in the top bar) — re-drawn for this project with
// our own icon set and no game artwork.
//
// What it shows is real app data, not mock-ups:
//   next match    our club and opponent (the same defaults Match Day opens with), one PLAY action
//   lineup        the five players the engine fields for our club (game-data roster order), with
//                 their role, the agent of their slot and estimated ratings on the 1–20 scale
//   club          win rates / map pool from the team profile dataset
//   career        season and population from the career world (Scouting owns the detail)
//   quick links   every working screen of the manager shell
// Inbox and calendar previews are optional slots (`inbox`, `calendar`) for the career shell.
import { useMemo, type ReactNode } from 'react';
import { useLang } from '../../i18n/index.tsx';
import { players, teams, toScale20, type JoinedPlayer } from '../../data.ts';
import { populationSummary } from '../../career/world.ts';
import { useWorld } from '../../career/store.ts';
import { agentOfSlot, rosterPlayerIds } from '../../matchday/roster.ts';
import { Icon, ROLE_ICON, type IconName } from '../matchday/Icons.tsx';
import './home.css';

/** The club the user manages and the default next opponent — the same pair Match Day opens with. */
export const HOME_CLUB = 'NRG';
export const HOME_OPPONENT = 'Team Heretics';
const MAP = 'Ascent';

const LINKS: ReadonlyArray<{ route: string; icon: IconName }> = [
  { route: 'tactics', icon: 'tactics' },
  { route: 'agents', icon: 'ult' },
  { route: 'squad', icon: 'squad' },
  { route: 'opponent', icon: 'eye' },
  { route: 'veto', icon: 'series' },
  { route: 'scouting', icon: 'lastSeen' },
];
/** Card stats: the first three of these the player actually has an estimate for (many attributes are null). */
const CARD_ATTR_PREFERENCE = ['aim', 'impact', 'positioning', 'trading', 'clutch', 'consistency', 'reaction'];
const OVERALL_ATTRS = ['aim', 'reaction', 'positioning', 'impact', 'trading', 'consistency'];

/** The app's own mark: four diamonds, the same figure the loading screen animates. */
function BrandMark() {
  return (
    <svg className="pvh-logo" width="22" height="22" viewBox="0 0 48 48" aria-hidden>
      <path d="M24 4l9 9-9 9-9-9z M35 15l9 9-9 9-9-9z M13 15l9 9-9 9-9-9z" fill="currentColor" />
      <path d="M24 26l9 9-9 9-9-9z" fill="#ff4655" />
    </svg>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function overall(p: JoinedPlayer): number | null {
  const vals = OVERALL_ATTRS.map((k) => p.attributes[k]?.value).filter((v): v is number => typeof v === 'number');
  return vals.length > 0 ? toScale20(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}
const pct = (v: number | null | undefined) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : '—');

export function HomeScreen({ go, inbox, calendar }: {
  /** Navigate to a shell route (leaves the home screen). */
  go: (route: string) => void;
  /** Optional previews supplied by the career shell; the cards are omitted when absent. */
  inbox?: ReactNode;
  calendar?: ReactNode;
}) {
  const { t, lang, setLang } = useLang();
  const world = useWorld();
  const data = useMemo(() => {
    const all = teams();
    const club = all.find((x) => x.name === HOME_CLUB) ?? all[0];
    const opp = all.find((x) => x.name === HOME_OPPONENT) ?? all[1];
    const byId = new Map(players().map((p) => [p.playerId, p]));
    const lineup = rosterPlayerIds(club?.teamId).map((id, i) => ({ slot: i + 1, player: byId.get(id) ?? null, id }));
    const oppLineup = rosterPlayerIds(opp?.teamId).map((id, i) => ({ slot: i + 1, player: byId.get(id) ?? null, id }));
    const side = (club as unknown as { side?: Record<string, { value: number | null }> })?.side;
    const maps = Object.entries(club?.mapPool ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 4);
    return { club, opp, lineup, oppLineup, side, maps };
  }, []);
  const pop = populationSummary(world);
  const last = world.history[world.history.length - 1];
  let n = 0;
  const head = (label: string) => <h2 className="pvh-head"><span>{String(++n).padStart(2, '0')}</span><i>//</i>{label}</h2>;

  return (
    <div className="pvh" data-testid="home-screen">
      <header className="pvh-top">
        <div className="pvh-brand"><BrandMark /><b>PROJECT V</b><i>//</i><em>{t('home.crumb')}</em></div>
        <button className="pvh-play" onClick={() => go('match-day')} data-testid="home-play-tab">{t('home.play')}</button>
        <div className="pvh-topright">
          <span className="pvh-season">{t('career.season', { season: world.season })}</span>
          <div className="pvh-seg" role="group" aria-label={t('about.language')}>
            <button className={lang === 'ko' ? 'on' : ''} onClick={() => setLang('ko')} data-testid="home-lang-ko">KO</button>
            <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')} data-testid="home-lang-en">EN</button>
          </div>
          <button className="pvh-iconbtn" onClick={() => go('about')} title={t('nav.about')} aria-label={t('nav.about')} data-testid="home-about"><Icon name="info" size={14} /></button>
        </div>
      </header>

      <main className="pvh-body">
        <section className="pvh-col main">
          <div className="pvh-hero" data-testid="home-next-match">
            {head(t('home.nextMatch'))}
            <div className="pvh-versus">
              <b className="ally">{data.club?.name ?? HOME_CLUB}</b>
              <i>VS</i>
              <b className="enemy">{data.opp?.name ?? HOME_OPPONENT}</b>
            </div>
            <p className="pvh-meta">{MAP}<i>//</i>{t('app.league')}</p>
            <div className="pvh-cta">
              <button className="pvh-btn primary" onClick={() => go('match-day')} data-testid="home-play"><Icon name="play" size={14} />{t('home.play')}</button>
              <button className="pvh-btn" onClick={() => go('veto')} data-testid="home-series"><Icon name="series" size={14} />{t('home.series')}</button>
              <button className="pvh-btn" onClick={() => go('opponent')} data-testid="home-opponent"><Icon name="eye" size={14} />{t('nav.opponent')}</button>
            </div>
          </div>

          <div className="pvh-lineup" data-testid="home-lineup">
            {head(t('home.lineup'))}
            <ul>
              {data.lineup.map(({ slot, player, id }) => {
                const agent = agentOfSlot(slot);
                // the role shown is the one they PLAY (their slot's agent), not their rated preference
                const role = agent?.role ?? (player ? cap(player.role) : '');
                const ovr = player ? overall(player) : null;
                const attrs = CARD_ATTR_PREFERENCE.filter((k) => typeof player?.attributes[k]?.value === 'number').slice(0, 3);
                return (
                  <li key={id}>
                    <button className="pvh-card" onClick={() => go('squad')} data-testid={`home-player-${slot}`}>
                      <span className="pvh-card-slot">{String(slot).padStart(2, '0')}</span>
                      <span className="pvh-card-ovr" title={t('home.overall')}>{ovr ?? '—'}</span>
                      <b className="pvh-card-name">{player?.handle ?? `P${slot}`}</b>
                      <span className="pvh-card-role">{ROLE_ICON[role] && <Icon name={ROLE_ICON[role]} size={11} />}{ROLE_ICON[role] ? t(`mdx.role.${role}`) : role}{agent ? ` · ${agent.name}` : ''}</span>
                      <span className="pvh-card-stats">
                        {attrs.map((k) => {
                          const v = player ? toScale20(player.attributes[k]?.value ?? null) : null;
                          return (
                            <span key={k} className="pvh-stat">
                              <em>{t(`attr.${k}`)}</em>
                              <i><u style={{ width: `${v != null ? (v / 20) * 100 : 0}%` }} /></i>
                              <b>{v ?? '—'}</b>
                            </span>
                          );
                        })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="pvh-lineup opp" data-testid="home-opponent-lineup">
            {head(t('home.oppLineup', { name: data.opp?.name ?? HOME_OPPONENT }))}
            <ul>
              {data.oppLineup.map(({ slot, player, id }) => {
                const agent = agentOfSlot(slot);
                return (
                  <li key={id}>
                    <button className="pvh-card compact" onClick={() => go('opponent')} data-testid={`home-opp-player-${slot}`}>
                      <span className="pvh-card-ovr" title={t('home.overall')}>{player ? overall(player) ?? '—' : '—'}</span>
                      <b className="pvh-card-name">{player?.handle ?? `P${slot}`}</b>
                      <span className="pvh-card-role">{agent && <Icon name={ROLE_ICON[agent.role]} size={11} />}{agent ? `${t(`mdx.role.${agent.role}`)} · ${agent.name}` : ''}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <aside className="pvh-col side">
          <div className="pvh-panel" data-testid="home-club">
            {head(t('home.club'))}
            <div className="pvh-tiles">
              <div><b>{pct(data.side?.attackWinRate?.value)}</b><span>{t('home.club.attack')}</span></div>
              <div><b>{pct(data.side?.defenseWinRate?.value)}</b><span>{t('home.club.defense')}</span></div>
              <div><b>{data.club?.maps ?? '—'}</b><span>{t('home.club.maps')}</span></div>
            </div>
            <div className="pvh-chips">{data.maps.map(([m, c]) => <span key={m} className={m === MAP ? 'on' : ''}>{m}<b>{c}</b></span>)}</div>
          </div>

          <div className="pvh-panel" data-testid="home-career">
            {head(t('home.career'))}
            <p className="pvh-line"><b>{t('career.season', { season: world.season })}</b><span>{t('career.population', { players: pop.players, gen: pop.generated, staff: pop.staff })}</span></p>
            {last && <p className="pvh-line dim"><span>{t('career.lastIntake', { season: last.season, n: last.newPlayers.length, retired: last.retiredPlayers.length, signed: last.signings.length })}</span></p>}
            {inbox}
            {calendar}
          </div>

          <div className="pvh-panel" data-testid="home-links">
            {head(t('home.links'))}
            <div className="pvh-links">
              {LINKS.map((l) => (
                <button key={l.route} onClick={() => go(l.route)} data-testid={`home-go-${l.route}`}><Icon name={l.icon} size={16} /><span>{t(`nav.${l.route}`)}</span></button>
              ))}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
