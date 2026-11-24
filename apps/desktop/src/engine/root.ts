// Where the engine's data files live.
//
// The @pv engine packages find their JSON through `import.meta.url` ("../data/x.json" next to
// the package source, "../../../datasets/…" at the repo root). Once they are bundled into one file
// those URLs would all point at the bundle, so the build (electron.vite.config.ts →
// pvEngineDataPaths) rewrites every `import.meta.url` under packages/** to
// `pvSourceUrl("<repo-relative path of that source file>")`. The data root is therefore a tree
// shaped like the repository:
//   <root>/packages/game-data/data/…   <root>/packages/match-runner/data/…   <root>/datasets/…
// - development / tests: the repository itself (nothing is copied);
// - packaged app: <resources>/engine, filled by scripts/stage-engine-data.mjs.
// The main process passes it as PV_ENGINE_ROOT; without it we look upward from the bundle.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MARKER = path.join('packages', 'match-runner', 'data');

let cached: string | null = null;

export function engineRoot(): string {
  if (cached) return cached;
  const fromEnv = process.env.PV_ENGINE_ROOT;
  if (fromEnv) {
    if (!existsSync(path.join(fromEnv, MARKER))) throw new Error(`PV_ENGINE_ROOT=${fromEnv} has no ${MARKER} — engine data is missing`);
    return (cached = fromEnv);
  }
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, MARKER)) && existsSync(path.join(dir, 'datasets', 'spatial'))) return (cached = dir);
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error('engine data root not found: set PV_ENGINE_ROOT to a directory holding packages/*/data and datasets/');
}

/** The file:// URL a bundled engine source file would have had inside the data root. */
export function pvSourceUrl(repoRelativePath: string): string {
  return pathToFileURL(path.join(engineRoot(), repoRelativePath)).href;
}
