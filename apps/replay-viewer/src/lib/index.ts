// Shared, reusable viewer surface — imported by the standalone web app AND the
// Electron desktop app (apps/desktop) so the viewer is not copy-pasted.
export { ReplayViewer, valorantApiMinimap } from './ReplayViewer.tsx';
export type { ReplayViewerProps, MinimapResolver } from './ReplayViewer.tsx';
export { ReplayStage } from './PixiStage.ts';
export { viewerCss } from './styles.ts';
