import { useState } from 'react';
import type { DetailPanel } from '../App.tsx';
import { tactics } from '../data.ts';
import { SourceTag, Disclaimer } from '../ui.tsx';
import { useT, type TFn } from '../i18n/index.tsx';

interface Tactic {
  id: string; side: string; category: string; name: string; tacticType: string; site: string;
  zones: string[]; route: [string, string][];
  utilityRequirements: { effectType: string; purpose: string; targetZones: string[] }[];
  minPlayers?: number; idealPlayers?: number; risks?: string[]; counterSetup?: string;
  provenance?: { type: string; note?: string };
}

function TacticDetail({ tac, t }: { tac: Tactic; t: TFn }) {
  return (
    <div className="tacdetail">
      <div className="muted small">{t('tac.detailMeta', { cat: tac.category, type: tac.tacticType, site: tac.site, min: tac.minPlayers ?? '?', ideal: tac.idealPlayers ?? '?' })}</div>
      {tac.provenance && <div className="mt"><SourceTag type={tac.provenance.type} /> <span className="small muted">{tac.provenance.note}</span></div>}

      <div className="attr-grouplabel mt">{t('tac.route')}</div>
      <div className="chips">{tac.zones.map((z) => <span key={z} className="chip">{z}</span>)}</div>

      <div className="attr-grouplabel mt">{t('tac.util')}</div>
      {tac.utilityRequirements.map((u, i) => (
        <div key={i} className="util-req">
          <span className={`util-type util-${u.effectType}`}>{u.effectType}</span>
          <span className="small">{u.purpose}</span>
          <div className="chips">{u.targetZones.map((z) => <span key={z} className="chip tiny">{z}</span>)}</div>
        </div>
      ))}

      {tac.risks && tac.risks.length > 0 && (<><div className="attr-grouplabel mt">{t('tac.risks')}</div><ul className="risks">{tac.risks.map((r, i) => <li key={i} className="small">{r}</li>)}</ul></>)}
      {tac.counterSetup && (<><div className="attr-grouplabel mt">{t('tac.counter')}</div><p className="small muted">{tac.counterSetup}</p></>)}
    </div>
  );
}

export function TacticsScreen({ setDetail }: { setDetail: (d: DetailPanel) => void }) {
  const t = useT();
  const [side, setSide] = useState<'attack' | 'defense'>('attack');
  const list = (side === 'attack' ? tactics.attack : tactics.defense) as Tactic[];
  return (
    <div className="pad tactics">
      <h2>{t('tac.title')} · {tactics.map} <span className="muted small">{t('tac.sub')}</span></h2>
      <Disclaimer text={tactics.caveats[0]} kind="info" />
      <div className="sidetoggle">
        <button className={side === 'attack' ? 'on' : ''} onClick={() => setSide('attack')} data-testid="side-attack">{t('tac.attack')}</button>
        <button className={side === 'defense' ? 'on' : ''} onClick={() => setSide('defense')} data-testid="side-defense">{t('tac.defense')}</button>
      </div>
      <div className="taclist">
        {list.map((tac) => (
          <button key={tac.id} className="taccard" onClick={() => setDetail({ title: tac.name, body: <TacticDetail tac={tac} t={t} /> })} data-testid={`tactic-${tac.id}`}>
            <div className="taccard-name">{tac.name}</div>
            <div className="muted small">{t('tac.cardSub', { type: tac.tacticType, site: tac.site, n: tac.utilityRequirements.length })}</div>
            {tac.provenance && <SourceTag type={tac.provenance.type} />}
          </button>
        ))}
      </div>
      <div className="prov-legend small muted">
        {t('tac.provLegend')} {Object.entries(tactics.provenanceLegend).map(([k, v]) => <span key={k} className="legend-item"><SourceTag type={k} /> {v}</span>)}
      </div>
    </div>
  );
}
