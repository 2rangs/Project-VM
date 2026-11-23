// New career: 1) manager profile → 2) region and team (with an overview of the squad, its
// strength and its map pool) → 3) save slot → the world is generated with @pv/career and saved.
// The preview world is built from the same seed the career will use, so what is shown is what
// the career starts with.
import { useEffect, useMemo, useState } from 'react';
import { bridge } from '../../platform.ts';
import { useLang } from '../../i18n/index.tsx';
import teamMaps from '../../../data/team_maps.json';
import { SAVE_SLOTS, type SaveSlot, type SaveSlotInfo } from '../../../shared/career.ts';
import { FIXTURES } from '../../career/fixtures.ts';
import { buildDesktopWorld, leagueTeams, regionTeams, scoutedAbility, teamStrength, REGIONS, type Region, type World } from '../../career/world.ts';
import { startNewCareer, useCareer } from '../../career/session.ts';
import { Flag } from '../../ui.tsx';
import { GenTag } from '../SquadScreen.tsx';
import { LoadingScreen } from '../../loading/Loading.tsx';

/** Nationalities offered for the manager (ISO codes; names come from Intl in the active language). */
const NATIONS = ['kr', 'jp', 'cn', 'tw', 'th', 'ph', 'id', 'vn', 'sg', 'my', 'au', 'in', 'us', 'ca', 'br', 'ar', 'cl', 'mx', 'co', 'pe',
  'gb', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'be', 'se', 'no', 'dk', 'fi', 'pl', 'cz', 'tr', 'ru', 'ua', 'sa', 'ae', 'ma'];

const MAPS = (teamMaps as unknown as { teams: Record<string, Record<string, [number, number]>> }).teams;

function nationName(lang: string, cc: string): string {
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(cc.toUpperCase()) ?? cc.toUpperCase(); } catch { return cc.toUpperCase(); }
}

function TeamOverview({ w, teamId, region }: { w: World; teamId: string; region: Region }) {
  const { t } = useLang();
  const team = w.teams[teamId]!;
  const ranked = regionTeams(w, region);
  const rank = ranked.indexOf(teamId) + 1;
  const players = team.roster.map((id) => w.players[id]!).filter(Boolean);
  const maps = Object.entries(MAPS[teamId] ?? {}).sort((a, b) => b[1][0] - a[1][0]).slice(0, 7);
  const staff = (['headCoach', 'analyst', 'scout'] as const).map((r) => ({ r, s: team.staff[r] ? w.staff[team.staff[r]!] : undefined }));
  return (
    <div className="nc-overview" data-testid="team-overview">
      <h3>{team.name} <Flag cc={team.country} /></h3>
      <div className="small">{t('nc.strength', { rank, n: ranked.length, s: Math.round(teamStrength(w, teamId) * 200) })}</div>
      <div className="attr-grouplabel">{t('nc.roster')}</div>
      <table className="nc-table">
        <tbody>
          {players.map((p, i) => {
            const e = scoutedAbility(w, teamId, p);
            return (
              <tr key={p.playerId} className={i < 5 ? 'starter' : 'bench'}>
                <td>{i < 5 ? '●' : '○'}</td>
                <td><b>{p.handle ?? p.playerId}</b> {p.generated && <GenTag />}</td>
                <td className="muted">{p.role ?? '—'}</td>
                <td className="muted">{t('nc.age', { n: p.age })}</td>
                <td>{t('nc.ca', { ca: e.ca })}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="attr-grouplabel">{t('nc.maps')}</div>
      {maps.length ? (
        <div className="chips">{maps.map(([m, [g, wins]]) => <span key={m} className="ser-chip" title={t('nc.mapTitle', { g, w: wins })}>{m} {Math.round((wins / Math.max(1, g)) * 100)}% <span className="muted">({g})</span></span>)}</div>
      ) : <div className="small muted">{t('nc.mapsNone')}</div>}
      <div className="attr-grouplabel">{t('nc.staff')}</div>
      {staff.map(({ r, s }) => <div key={r} className="small">{t(`career.staff.${r}`)}: {s ? <><b>{s.name}</b> <span className="muted">({Math.round(Object.values(s.attributes)[0]! * 20)}/20)</span></> : '—'}</div>)}
    </div>
  );
}

export function NewCareer({ onCancel }: { onCancel: () => void }) {
  const { t, lang } = useLang();
  const cs = useCareer();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState('');
  const [nation, setNation] = useState(lang === 'ko' ? 'kr' : 'us');
  const [seed, setSeed] = useState(() => (Date.now() % 900000) + 1000);
  const [seedDraft, setSeedDraft] = useState(String(seed));
  const [region, setRegion] = useState<Region>('pacific');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [slots, setSlots] = useState<SaveSlotInfo[]>([]);
  const [slot, setSlot] = useState<SaveSlot>('slot1');
  useEffect(() => {
    bridge.saveList().then((s) => { setSlots(s); setSlot((s.find((x) => !x.meta) ?? s[0])?.slot ?? 'slot1'); }).catch(() => {});
  }, []);

  const world = useMemo(() => (step >= 2 ? buildDesktopWorld(FIXTURES, seed) : null), [step >= 2, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const teams = world ? regionTeams(world, region) : [];
  const league = world && teamId ? leagueTeams(world, region, teamId) : world ? regionTeams(world, region).slice(0, 12) : [];
  const nameOk = name.trim().length >= 2 && name.trim().length <= 32;

  if (cs.busy?.kind === 'create') return <LoadingScreen cover="window" testId="career-progress" title={t('nc.generating')} detail={t('nc.generatingDetail', { seed })} />;

  return (
    <div className="nc" data-testid="new-career" data-step={step}>
      <div className="nc-head">
        <h2>{t('nc.title')}</h2>
        <div className="nc-steps">{[1, 2, 3].map((s) => <span key={s} className={s === step ? 'on' : s < step ? 'done' : ''}>{s}. {t(`nc.step${s}`)}</span>)}</div>
      </div>

      {step === 1 && (
        <div className="nc-body">
          <label className="nc-field">{t('nc.name')}
            <input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder={t('nc.namePh')} data-testid="nc-name" autoFocus />
          </label>
          <label className="nc-field">{t('nc.nation')}
            <select value={nation} onChange={(e) => setNation(e.target.value)} data-testid="nc-nation">
              {NATIONS.map((c) => <option key={c} value={c}>{nationName(lang, c)}</option>)}
            </select>
          </label>
          <p className="small muted">{t('nc.profileNote')}</p>
          <div className="nc-actions">
            <button className="ord-cancel" onClick={onCancel} data-testid="nc-cancel">{t('start.back')}</button>
            <button className="md-run" disabled={!nameOk} onClick={() => setStep(2)} data-testid="nc-next">{t('nc.next')}</button>
          </div>
        </div>
      )}

      {step === 2 && world && (
        <div className="nc-body nc-split">
          <div className="nc-left">
            <div className="md-modetoggle nc-regions">
              {REGIONS.map((r) => <button key={r} className={r === region ? 'on' : ''} onClick={() => { setRegion(r); setTeamId(null); }} data-testid={`nc-region-${r}`}>{t(`career.region.${r}`)}</button>)}
            </div>
            <div className="nc-teams" data-testid="nc-teams">
              {teams.map((id, i) => (
                <button key={id} className={`nc-team ${id === teamId ? 'on' : ''}`} onClick={() => setTeamId(id)} data-testid={`nc-team-${id}`}>
                  <span className="nc-rank">{i + 1}</span>
                  <b>{world.teams[id]!.name}</b>
                  <span className="muted small">{Math.round(teamStrength(world, id) * 200)}</span>
                  {!league.includes(id) && <span className="soon-tag">{t('nc.outside')}</span>}
                </button>
              ))}
            </div>
            <label className="small muted nc-seed">{t('nc.seed')}
              <input value={seedDraft} onChange={(e) => setSeedDraft(e.target.value.replace(/\D/g, ''))} onBlur={() => { const v = Number(seedDraft); if (v > 0 && v !== seed) { setSeed(v); setTeamId(null); } }} data-testid="nc-seed" />
            </label>
          </div>
          <div className="nc-right">
            {teamId ? <TeamOverview w={world} teamId={teamId} region={region} /> : <div className="muted">{t('nc.pickTeam')}</div>}
          </div>
          <div className="nc-actions nc-span">
            <button className="ord-cancel" onClick={() => setStep(1)}>{t('start.back')}</button>
            <button className="md-run" disabled={!teamId} onClick={() => setStep(3)} data-testid="nc-next">{t('nc.next')}</button>
          </div>
        </div>
      )}

      {step === 3 && world && teamId && (
        <div className="nc-body">
          <div className="nc-summary">
            <div>{t('nc.summary', { name: name.trim(), nation: nationName(lang, nation), team: world.teams[teamId]!.name, region: t(`career.region.${region}`), season: world.season })}</div>
            <div className="small muted">{t('nc.summarySeed', { seed })}</div>
          </div>
          <div className="attr-grouplabel">{t('nc.slot')}</div>
          {SAVE_SLOTS.map((s) => {
            const info = slots.find((x) => x.slot === s);
            return (
              <label key={s} className="start-slot" data-testid={`nc-slot-${s}`}>
                <input type="radio" name="slot" checked={slot === s} onChange={() => setSlot(s)} />
                <b>{t(`start.slot.${s}`)}</b>
                <span className="small muted">{info?.meta ? t('nc.slotOverwrite', { team: info.meta.teamName, date: info.meta.date }) : t('start.load.empty')}</span>
              </label>
            );
          })}
          {cs.error && <div className="err small">⚠ {cs.error}</div>}
          <div className="nc-actions">
            <button className="ord-cancel" onClick={() => setStep(2)}>{t('start.back')}</button>
            <button className="md-run" onClick={() => void startNewCareer({ managerName: name, nationality: nation, teamId, slot, seed })} data-testid="nc-start">{t('nc.start')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
