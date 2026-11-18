// Self-contained CSS for the ReplayViewer surface, exported as a string so any
// host (web app, Electron renderer) can inject it without a build-time CSS import.
export const viewerCss = `
.rv { display: flex; flex-direction: column; gap: 10px; }
.rv-stageWrap { position: relative; }
.rv-stage { width: 100%; max-width: 760px; aspect-ratio: 1; border: 1px solid #263040; border-radius: 10px; overflow: hidden; background: #0b0e13; }
.rv-stage canvas { display: block; width: 100%; height: 100%; }
.rv-src { position: absolute; top: 10px; right: 10px; font-size: 12px; font-family: monospace; padding: 3px 8px; border-radius: 999px; border: 1px solid #263040; background: #0009; color: #8b98a9; }
.rv-src-real { color: #7ee787; border-color: #2ea04366; }
.rv-src-synthetic { color: #d2a8ff; border-color: #8957e566; }
.rv-src-simulated { color: #79c0ff; border-color: #1f6feb66; }
.rv-maphint { position: absolute; left: 10px; bottom: 10px; font-size: 11px; color: #8b98a9; background: #0009; padding: 4px 8px; border-radius: 6px; }
.rv-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.rv-controls button { background: #11161f; color: #e6edf3; border: 1px solid #263040; border-radius: 7px; padding: 6px 10px; cursor: pointer; font-size: 13px; }
.rv-controls button:hover:not(:disabled) { border-color: #3b4860; }
.rv-controls button:disabled { opacity: 0.4; cursor: default; }
.rv-speeds { display: flex; gap: 4px; }
.rv-speeds button.on { background: #1f6feb33; border-color: #1f6feb; }
.rv-scrub { flex: 1; min-width: 180px; accent-color: #58a6ff; }
.rv-clock { font-family: monospace; font-size: 13px; color: #8b98a9; min-width: 92px; text-align: right; }
.rv-rounds { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13px; color: #8b98a9; }
.rv-rounds button { background: #11161f; color: #e6edf3; border: 1px solid #263040; border-radius: 7px; padding: 5px 9px; cursor: pointer; }
`;
