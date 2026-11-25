// Tactics planner — FM-style pre-match tactics for one team: per site, where the spike goes down
// (a spot kind, or a spot picked on the minimap from the engine's own plant spots), what the attack
// does after the plant on that spot, and how the defence retakes (per site and spot); per map and
// side, what the team does about mid. It edits the tactics part of a MatchPlan (plan.ts) and says,
// section by section, whether the engine flag that plays it is on ("played") or off ("recorded,
// not played"). Used by the Match Day plan panel and the Tactics screen (career / sandbox).
import { useEffect, useState } from 'react';
import type { MatchPlan, MidWho, PlantChoice, TacticsField, TacticsFlags, TacticsMapView } from '../../../shared/manager.ts';
import { bridge } from '../../platform.ts';
import { useT, type TFn } from '../../i18n/index.tsx';
import { preparedMinimapUrl } from '../matchday/assets.ts';
import {
  ROLES, SPOT_KINDS, flagState, midOf, plantChoiceOf, postPlantOf, project, retakeOf, saveModeOf, setMid, setPlantChoice, setPostPlant,
  setRetake, siteBox, spotKeyOf, spotLabel,
} from '../../tactics/plan.ts';
import './tactics.css';

let mapCache: Promise<TacticsMapView> | null = null;
/** The map's spots / entries / mid, read once from the engine (op tactics.map). */
function loadMap(mapId: string): Promise<TacticsMapView> {
  if (!mapCache) mapCache = bridge.tacticsMap(mapId).catch((e) => { mapCache = null; throw e; });
  return mapCache;
}

export interface TacticsPlannerProps {
  plan: MatchPlan;
  onPlan: (p: MatchPlan) => void;
  flags: TacticsFlags;
  /** The map the mid plan is keyed by ("*" covers every map). */
  mapId: string;
  /** Our players (game-data ids) for "who goes mid". */
  roster?: Array<{ id: string; name: string }>;
  disabled?: boolean;
}

function FlagNote({ field, flags, t }: { field: TacticsField; flags: TacticsFlags; t: TFn }) {
  const st = flagState(field, flags);
  const flag = field === 'midPlans' ? 'midControl' : 'plantTactics';
  return (
    <div className={`tp-flag ${st}`} data-testid={`tp-flag-${flag}`} data-state={st} role="note">
      {st === 'on' ? t('tp.flag.on', { flag }) : t('tp.flag.off', { flag })}
    </div>
  );
}

function Sel({ value, options, onChange, disabled, testId, label }: { value: string; options: Array<[string, string]>; onChange: (v: string) => void; disabled?: boolean; testId: string; label: string }) {
  return (
    <label className="tp-field">{label}
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} data-testid={testId}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

export function TacticsPlanner({ plan, onPlan, flags, mapId, roster = [], disabled }: TacticsPlannerProps) {
  const t = useT();
  const [map, setMap] = useState<TacticsMapView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>('A');
  const [retakeKey, setRetakeKey] = useState('*');
  const [midKey, setMidKey] = useState('*');
  useEffect(() => { loadMap(mapId).then(setMap, (e: Error) => setError(e.message)); }, [mapId]);
  useEffect(() => { setRetakeKey('*'); }, [tab]);

  if (error) return <div className="err small" data-testid="tp-error">⚠ {t('tp.error', { e: error })}</div>;
  if (!map) return <div className="muted small" data-testid="tp-loading">{t('tp.loading')}</div>;

  const site = map.sites.find((s) => s.site === tab) ?? null;
  const auto = t('tp.auto');
  const minimap = preparedMinimapUrl();

  const siteSection = site && (() => {
    const choice = plantChoiceOf(plan, site.site);
    const picked = typeof choice === 'object' ? choice.spotId : null;
    const key = spotKeyOf(choice);
    const pp = postPlantOf(plan, site.site, key);
    const rt = retakeOf(plan, site.site, retakeKey);
    const box = siteBox(site);
    const kindMatches = (kind: string) => typeof choice === 'string' && choice === kind;
    const choiceValue = picked ? `spot:${picked}` : String(choice);
    const setChoice = (v: string) => onPlan(setPlantChoice(plan, site.site, (v.startsWith('spot:') ? { spotId: v.slice(5) } : v) as PlantChoice));
    const saveMode = saveModeOf(rt);
    const custom = typeof rt.save === 'object' ? rt.save : {};
    return (
      <div className="tp-site" data-testid={`tp-site-${site.site}`}>
        <FlagNote field="plantPreference" flags={flags} t={t} />
        <div className="tp-grid">
          <figure className="tp-map" aria-label={t('tp.map.aria', { site: site.site })}>
            <svg viewBox={`${box.u0} ${box.v0} ${box.u1 - box.u0} ${box.v1 - box.v0}`} data-testid={`tp-minimap-${site.site}`}>
              {minimap && <image href={minimap} x={0} y={0} width={1} height={1} preserveAspectRatio="none" opacity={0.75} />}
              {site.candidates.map((c) => {
                const p = project(c.x, c.y);
                const on = picked === c.id || kindMatches(c.kind);
                const r = (box.u1 - box.u0) * 0.022;
                return (
                  <g key={c.id} className={`tp-spot k-${c.kind} ${on ? 'on' : ''}`} onClick={() => !disabled && setChoice(`spot:${c.id}`)}
                    data-testid={`tp-spot-${c.id}`} role="button" aria-pressed={on} aria-label={spotLabel(c.id)}>
                    <circle cx={p.u} cy={p.v} r={on ? r * 1.4 : r} />
                    <title>{`${spotLabel(c.id)} — ${t(`tp.kind.${c.kind}`)}`}</title>
                  </g>
                );
              })}
            </svg>
            <figcaption className="muted small">{t('tp.map.hint')}</figcaption>
          </figure>

          <div className="tp-controls">
            <div className="tp-kicker">{t('tp.plant.title')}</div>
            <Sel label={t('tp.plant.spot')} value={choiceValue} disabled={disabled} testId={`tp-plant-${site.site}`} onChange={setChoice}
              options={[['auto', auto], ...SPOT_KINDS.map((k) => [k, t(`tp.kind.${k}`)] as [string, string]), ...(picked ? [[`spot:${picked}`, t('tp.plant.picked', { spot: spotLabel(picked) })] as [string, string]] : [])]} />
            <div className="muted small">{t(`tp.kind.${typeof choice === 'string' ? choice : 'picked'}.hint`)}</div>

            <div className="tp-kicker">{t('tp.post.title', { key: key === '*' ? t('tp.key.all') : spotLabel(key) })}</div>
            <div className="tp-fields">
              <Sel label={t('tp.post.hold')} value={pp.hold ?? 'auto'} disabled={disabled} testId={`tp-post-hold-${site.site}`}
                onChange={(v) => onPlan(setPostPlant(plan, site.site, key, { hold: v as never }))}
                options={[['auto', auto], ['onSpike', t('tp.post.onSpike')], ['offSpike', t('tp.post.offSpike')]]} />
              <Sel label={t('tp.post.flank')} value={pp.flankWatch === undefined || pp.flankWatch === 'auto' ? 'auto' : pp.flankWatch ? 'yes' : 'no'} disabled={disabled} testId={`tp-post-flank-${site.site}`}
                onChange={(v) => onPlan(setPostPlant(plan, site.site, key, { flankWatch: v === 'auto' ? 'auto' : v === 'yes' }))}
                options={[['auto', auto], ['yes', t('tp.yes')], ['no', t('tp.no')]]} />
              <Sel label={t('tp.post.utility')} value={pp.utility ?? 'auto'} disabled={disabled} testId={`tp-post-utility-${site.site}`}
                onChange={(v) => onPlan(setPostPlant(plan, site.site, key, { utility: v as never }))}
                options={[['auto', auto], ['savePostPlant', t('tp.post.save')], ['spend', t('tp.post.spend')]]} />
              <Sel label={t('tp.post.outnumbered')} value={pp.outnumbered ?? 'auto'} disabled={disabled} testId={`tp-post-out-${site.site}`}
                onChange={(v) => onPlan(setPostPlant(plan, site.site, key, { outnumbered: v as never }))}
                options={[['auto', auto], ['hold', t('tp.post.hold.keep')], ['retreat', t('tp.post.retreat')]]} />
            </div>

            <div className="tp-kicker">{t('tp.retake.title')}</div>
            <div className="tp-fields">
              <Sel label={t('tp.retake.for')} value={retakeKey} disabled={disabled} testId={`tp-retake-key-${site.site}`} onChange={setRetakeKey}
                options={[['*', t('tp.key.all')], ...SPOT_KINDS.map((k) => [k, t(`tp.kind.${k}`)] as [string, string]), ...site.candidates.map((c) => [c.id, spotLabel(c.id)] as [string, string])]} />
              <Sel label={t('tp.retake.entry')} value={rt.entry ?? ''} disabled={disabled} testId={`tp-retake-entry-${site.site}`}
                onChange={(v) => onPlan(setRetake(plan, site.site, retakeKey, { entry: v || undefined }))}
                options={[['', auto], ...site.retakeEntries.map((z) => [z, z] as [string, string])]} />
              <Sel label={t('tp.retake.approach')} value={rt.approach ?? 'auto'} disabled={disabled} testId={`tp-retake-approach-${site.site}`}
                onChange={(v) => onPlan(setRetake(plan, site.site, retakeKey, { approach: v as never }))}
                options={[['auto', auto], ['stack', t('tp.retake.stack')], ['split', t('tp.retake.split')]]} />
              <Sel label={t('tp.retake.save')} value={saveMode} disabled={disabled} testId={`tp-retake-save-${site.site}`}
                onChange={(v) => onPlan(setRetake(plan, site.site, retakeKey, { save: v === 'custom' ? { maxManDeficit: 1 } : (v as 'auto' | 'never') }))}
                options={[['auto', t('tp.retake.save.auto')], ['never', t('tp.retake.save.never')], ['custom', t('tp.retake.save.custom')]]} />
              {saveMode === 'custom' && (
                <>
                  <label className="tp-field">{t('tp.retake.deficit')}
                    <input type="number" min={0} max={4} value={custom.maxManDeficit ?? ''} disabled={disabled} data-testid={`tp-retake-deficit-${site.site}`}
                      onChange={(e) => onPlan(setRetake(plan, site.site, retakeKey, { save: { ...custom, maxManDeficit: e.target.value === '' ? undefined : Math.max(0, Math.min(4, Number(e.target.value))) } }))} />
                  </label>
                  <label className="tp-field">{t('tp.retake.spare')}
                    <input type="number" min={0} max={20} step={0.5} value={custom.minSpareMs === undefined ? '' : custom.minSpareMs / 1000} disabled={disabled} data-testid={`tp-retake-spare-${site.site}`}
                      onChange={(e) => onPlan(setRetake(plan, site.site, retakeKey, { save: { ...custom, minSpareMs: e.target.value === '' ? undefined : Math.round(Math.max(0, Number(e.target.value)) * 1000) } }))} />
                  </label>
                </>
              )}
            </div>
            <div className="muted small">{t('tp.retake.hint')}</div>
          </div>
        </div>
      </div>
    );
  })();

  const midSide = (side: 'attack' | 'defense') => {
    const m = midOf(plan, midKey, side);
    const who: MidWho = m.who ?? 'auto';
    const whoMode = who === 'auto' ? 'auto' : 'players' in who ? 'players' : 'roles';
    const list = who !== 'auto' ? ('players' in who ? who.players : who.roles) : [];
    const toggle = (id: string) => {
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      onPlan(setMid(plan, midKey, side, { who: next.length ? (whoMode === 'players' ? { players: next } : { roles: next }) : 'auto' }));
    };
    return (
      <div className="tp-midside" data-testid={`tp-mid-${side}`}>
        <div className="tp-kicker">{t(side === 'attack' ? 'tac.attack' : 'tac.defense')}</div>
        <Sel label={t('tp.mid.stance')} value={m.stance ?? 'auto'} disabled={disabled} testId={`tp-mid-stance-${side}`}
          onChange={(v) => onPlan(setMid(plan, midKey, side, { stance: v as never }))}
          options={[['auto', auto], ['contest', t('tp.mid.contest')], ['giveUp', t('tp.mid.giveUp')]]} />
        <Sel label={t('tp.mid.count')} value={String(m.count ?? 'auto')} disabled={disabled || m.stance === 'giveUp'} testId={`tp-mid-count-${side}`}
          onChange={(v) => onPlan(setMid(plan, midKey, side, { count: v === 'auto' ? 'auto' : Number(v) }))}
          options={[['auto', auto], ['1', '1'], ['2', '2'], ['3', '3']]} />
        {m.stance !== 'giveUp' && (
          <div className="tp-who">
            <span className="tp-field">{t('tp.mid.who')}: <b data-testid={`tp-mid-who-${side}`} data-mode={whoMode}>{whoMode === 'auto' ? auto : list.map((x) => (whoMode === 'roles' ? t(`tp.role.${x}`) : roster.find((p) => p.id === x)?.name ?? x)).join(', ')}</b>
              {whoMode !== 'auto' && <button className="ord-cancel tp-reset" onClick={() => onPlan(setMid(plan, midKey, side, { who: 'auto' }))} disabled={disabled} data-testid={`tp-mid-who-reset-${side}`}>{t('tp.mid.who.reset')}</button>}
            </span>
            <span className="muted small">{t('tp.mid.who.players')}</span>
            {roster.map((p) => (
              <label key={p.id} className="tp-check"><input type="checkbox" checked={whoMode === 'players' && list.includes(p.id)} disabled={disabled || whoMode === 'roles'}
                onChange={() => (whoMode === 'players' ? toggle(p.id) : onPlan(setMid(plan, midKey, side, { who: { players: [p.id] } })))} data-testid={`tp-mid-player-${side}-${p.id}`} />{p.name}</label>
            ))}
            <span className="muted small">{t('tp.mid.who.roles')}</span>
            {ROLES.map((r) => (
              <label key={r} className="tp-check"><input type="checkbox" checked={whoMode === 'roles' && list.includes(r)} disabled={disabled || whoMode === 'players'}
                onChange={() => (whoMode === 'roles' ? toggle(r) : onPlan(setMid(plan, midKey, side, { who: { roles: [r] } })))} data-testid={`tp-mid-role-${side}-${r}`} />{t(`tp.role.${r}`)}</label>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="tp" data-testid="tactics-planner">
      <div className="tp-tabs" role="tablist">
        {map.sites.map((s) => (
          <button key={s.site} role="tab" aria-selected={tab === s.site} className={tab === s.site ? 'on' : ''} onClick={() => setTab(s.site)} data-testid={`tp-tab-${s.site}`}>{t('tp.tab.site', { site: s.site })}</button>
        ))}
        <button role="tab" aria-selected={tab === 'mid'} className={tab === 'mid' ? 'on' : ''} onClick={() => setTab('mid')} data-testid="tp-tab-mid">{t('tp.tab.mid')}</button>
      </div>
      {tab === 'mid' ? (
        <div className="tp-mid" data-testid="tp-mid">
          <FlagNote field="midPlans" flags={flags} t={t} />
          {!map.hasMid && <div className="warn small">{t('tp.mid.none')}</div>}
          <Sel label={t('tp.mid.map')} value={midKey} disabled={disabled} testId="tp-mid-map" onChange={setMidKey}
            options={[['*', t('tp.mid.allMaps')], [mapId, mapId]]} />
          <div className="tp-midgrid">{midSide('attack')}{midSide('defense')}</div>
          <div className="muted small">{t('tp.mid.hint')}</div>
        </div>
      ) : siteSection}
      <div className="muted small tp-geo">{t('tp.geometry', { geometry: map.geometry })}</div>
    </div>
  );
}
