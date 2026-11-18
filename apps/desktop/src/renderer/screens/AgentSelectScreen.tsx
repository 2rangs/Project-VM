import type { DetailPanel } from '../App.tsx';
import { comps } from '../data.ts';
import { SourceTag, Disclaimer } from '../ui.tsx';

interface Comp {
  comp: string[]; roles: Record<string, number>; maps: number;
  mapWinRate: number; mapWinCI95: [number, number]; atkRoundWR: number; defRoundWR: number;
}
interface RoleTemplate { template: Record<string, number>; maps: number; share: number }

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function AgentSelectScreen({ setDetail }: { setDetail: (d: DetailPanel) => void }) {
  const top = (comps.topComps ?? []) as Comp[];
  const templates = ((comps as { roleTemplates?: RoleTemplate[] }).roleTemplates ?? []);
  return (
    <div className="pad agents">
      <h2>Agent Select · {comps.map} <span className="muted small">(skeleton — real pick data)</span></h2>
      <Disclaimer text="Composition win-rates are from public VCT Ascent matches (estimates with CI); role balance warnings are advisory." kind="info" />

      <div className="attr-grouplabel">Role templates (share of maps)</div>
      <div className="role-templates">
        {templates.slice(0, 5).map((rt, i) => (
          <div key={i} className="roletpl">
            <span className="roletpl-share">{pct(rt.share)}</span>
            <span className="roletpl-roles">{Object.entries(rt.template).map(([r, n]) => `${n} ${r}`).join(' · ')}</span>
            <span className="muted small">{rt.maps} maps</span>
          </div>
        ))}
      </div>

      <div className="attr-grouplabel mt">Top compositions</div>
      <div className="complist">
        {top.map((c, i) => {
          const dup = Object.values(c.roles);
          const singleDuelist = (c.roles.Duelist ?? 0) >= 1;
          return (
            <button key={i} className="compcard" onClick={() => setDetail({ title: c.comp.join(' · '), body: <CompDetail c={c} /> })} data-testid={`comp-${i}`}>
              <div className="compcard-agents">{c.comp.map((a) => <span key={a} className="chip">{a}</span>)}</div>
              <div className="compcard-stats">
                <span>WR <b>{pct(c.mapWinRate)}</b> <span className="muted small">±CI</span></span>
                <span className="muted small">{c.maps} maps</span>
                {!singleDuelist && <span className="warn small">⚠ no Duelist</span>}
                {dup.length < 4 && <span className="warn small">⚠ role gap</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CompDetail({ c }: { c: { comp: string[]; roles: Record<string, number>; maps: number; mapWinRate: number; mapWinCI95: [number, number]; atkRoundWR: number; defRoundWR: number } }) {
  return (
    <div className="compdetail">
      <div className="chips">{c.comp.map((a) => <span key={a} className="chip">{a}</span>)}</div>
      <div className="muted small mt">Roles: {Object.entries(c.roles).map(([r, n]) => `${n} ${r}`).join(' · ')}</div>
      <div className="attr-row mt"><span className="attr-name">Map win rate</span><span>{pct(c.mapWinRate)} <span className="muted small">[{pct(c.mapWinCI95[0])}–{pct(c.mapWinCI95[1])}]</span></span></div>
      <div className="attr-row"><span className="attr-name">Attack round WR</span><span>{pct(c.atkRoundWR)}</span></div>
      <div className="attr-row"><span className="attr-name">Defense round WR</span><span>{pct(c.defRoundWR)}</span></div>
      <div className="attr-row"><span className="attr-name">Sample</span><span>{c.maps} maps</span></div>
      <p className="small muted mt"><SourceTag type="estimate" /> executable tactics per comp (utility satisfaction) is a TODO — see handoff.</p>
    </div>
  );
}
