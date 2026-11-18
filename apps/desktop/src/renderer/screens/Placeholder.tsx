// "준비 중" placeholder for club-ops screens deferred by DECISION-001.
export function Placeholder({ title }: { title: string }) {
  return (
    <div className="pad placeholder">
      <h2>{title}</h2>
      <div className="soon-card">
        <div className="soon-badge">준비 중 · Coming later</div>
        <p className="muted">
          PROJECT V builds the match engine and data screens first (DECISION-001). Club
          management, finance, transfers, training and scouting are deliberately deferred —
          this is a reserved menu slot, not a missing feature.
        </p>
      </div>
    </div>
  );
}
