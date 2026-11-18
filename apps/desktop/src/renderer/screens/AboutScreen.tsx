import { RATINGS_DISCLAIMER, TEAMS_DISCLAIMER } from '../data.ts';
import { Disclaimer } from '../ui.tsx';

export function AboutScreen() {
  return (
    <div className="pad about">
      <h2>About · PROJECT V</h2>
      <Disclaimer text="Pre-release INTERNAL development build. Real VCT player handles and team names are shown by user decision; name / likeness / license rights MUST be re-reviewed before any launch." />
      <p className="muted">
        VALORANT esports tactical simulation engine. This desktop shell is a manager-game-style
        front end over the PROJECT V simulation and data packages. It adopts genre information
        conventions only — no third-party game's branding, screen designs, icons or colour schemes
        are copied.
      </p>
      <h3>Data provenance</h3>
      <ul className="prov-list">
        <li><b>Player ratings</b> (PV-2, vct-reference): statistical ESTIMATES from public match stats, empirical-Bayes shrunk. Not assessments of real ability.</li>
        <li><b>Team profiles</b> (PV-2): economy tendencies from public match data, not scouting truth.</li>
        <li><b>Tactics / comps</b> (PV-1): zones/routes navgraph-derived; tactical content tagged <i>expert-knowledge-unsourced</i>.</li>
        <li><b>Match / simulation</b> (PV-4 stub today): synthetic until the round-simulator is integrated.</li>
        <li><b>.vrf replay players</b>: non-pro, kept anonymous (player_N) — unlike the pro names above.</li>
      </ul>
      <details className="rawdisc">
        <summary>Full data disclaimers</summary>
        <p className="small muted">{RATINGS_DISCLAIMER}</p>
        <p className="small muted">{TEAMS_DISCLAIMER}</p>
      </details>
    </div>
  );
}
