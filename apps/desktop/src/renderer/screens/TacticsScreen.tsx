import { useState } from 'react';
import type { DetailPanel } from '../App.tsx';
import { tactics } from '../data.ts';
import { SourceTag, Disclaimer } from '../ui.tsx';

interface Tactic {
  id: string; side: string; category: string; name: string; tacticType: string; site: string;
  zones: string[]; route: [string, string][];
  utilityRequirements: { effectType: string; purpose: string; targetZones: string[] }[];
  minPlayers?: number; idealPlayers?: number; risks?: string[]; counterSetup?: string;
  provenance?: { type: string; note?: string };
}

function TacticDetail({ t }: { t: Tactic }) {
  return (
    <div className="tacdetail">
      <div className="muted small">{t.category} · {t.tacticType} · site {t.site} · {t.minPlayers ?? '?'}–{t.idealPlayers ?? '?'} players</div>
      {t.provenance && <div className="mt"><SourceTag type={t.provenance.type} /> <span className="small muted">{t.provenance.note}</span></div>}

      <div className="attr-grouplabel mt">Route (PV-4 zones)</div>
      <div className="chips">{t.zones.map((z) => <span key={z} className="chip">{z}</span>)}</div>

      <div className="attr-grouplabel mt">Utility requirements</div>
      {t.utilityRequirements.map((u, i) => (
        <div key={i} className="util-req">
          <span className={`util-type util-${u.effectType}`}>{u.effectType}</span>
          <span className="small">{u.purpose}</span>
          <div className="chips">{u.targetZones.map((z) => <span key={z} className="chip tiny">{z}</span>)}</div>
        </div>
      ))}

      {t.risks && t.risks.length > 0 && (<><div className="attr-grouplabel mt">Risks</div><ul className="risks">{t.risks.map((r, i) => <li key={i} className="small">{r}</li>)}</ul></>)}
      {t.counterSetup && (<><div className="attr-grouplabel mt">Counter setup</div><p className="small muted">{t.counterSetup}</p></>)}
    </div>
  );
}

export function TacticsScreen({ setDetail }: { setDetail: (d: DetailPanel) => void }) {
  const [side, setSide] = useState<'attack' | 'defense'>('attack');
  const list = (side === 'attack' ? tactics.attack : tactics.defense) as Tactic[];
  return (
    <div className="pad tactics">
      <h2>Tactics · {tactics.map} <span className="muted small">(Playbook builder — skeleton)</span></h2>
      <Disclaimer text={tactics.caveats[0]} kind="info" />
      <div className="sidetoggle">
        <button className={side === 'attack' ? 'on' : ''} onClick={() => setSide('attack')} data-testid="side-attack">Attack</button>
        <button className={side === 'defense' ? 'on' : ''} onClick={() => setSide('defense')} data-testid="side-defense">Defense</button>
      </div>
      <div className="taclist">
        {list.map((t) => (
          <button key={t.id} className="taccard" onClick={() => setDetail({ title: t.name, body: <TacticDetail t={t} /> })} data-testid={`tactic-${t.id}`}>
            <div className="taccard-name">{t.name}</div>
            <div className="muted small">{t.tacticType} · site {t.site} · {t.utilityRequirements.length} util</div>
            {t.provenance && <SourceTag type={t.provenance.type} />}
          </button>
        ))}
      </div>
      <div className="prov-legend small muted">
        Provenance legend: {Object.entries(tactics.provenanceLegend).map(([k, v]) => <span key={k} className="legend-item"><SourceTag type={k} /> {v}</span>)}
      </div>
    </div>
  );
}
