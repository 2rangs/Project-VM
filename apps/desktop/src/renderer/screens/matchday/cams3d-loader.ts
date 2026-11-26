// Lazy entry point for the entire 3D team-cam stack (three.js, the operator models, the map
// blockout and CamStage3D). LiveMatch only ever reaches this through a dynamic import, so on the
// tactical-2D / low-graphics path none of that code — nor three.js — is loaded or parsed.
import type { NavModel } from '../../matchday/nav.ts';
import type { CamStage3D, CamRenderConfig } from './CamStage3D.ts';

export type { CamView } from './CamStage3D.ts';

export interface PlantZone { zoneId: string; polygon: Array<{ x: number; y: number }> }

/** Build the 3D wall for one match. Resolves once three.js + the models chunk have loaded. */
export async function createCamStage3D(nav: NavModel, plantZones: PlantZone[], cfg: CamRenderConfig): Promise<CamStage3D> {
  const [{ CamStage3D: Stage }, { buildBlockout }] = await Promise.all([
    import('./CamStage3D.ts'),
    import('../../matchday/world3d.ts'),
  ]);
  return new Stage(nav, buildBlockout(nav, plantZones), cfg);
}
