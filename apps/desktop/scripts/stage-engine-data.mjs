// Stage the data files the bundled engine reads at run time into a directory shaped like the
// repository (see src/engine/root.ts): the packaged app ships it as <resources>/engine.
//
//   node scripts/stage-engine-data.mjs [outDir]        (default: dist/engine-data)
//
// Only files that match the allowlist below AND are tracked by git are copied, so nothing
// git-ignored can ship by accident: local map meshes (.glb / .blend, apps/desktop/assets/maps),
// loading banners (apps/desktop/assets/banners), raw extractions under datasets/spatial/*/mesh.
// The allowlist is exactly what the engine opens (traced over one-shot matches on every pool map,
// a series and a session); test/engine-bundle.test.ts runs the engine from a staged copy alone, so
// a file the engine starts to need without being listed here fails that test.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..', '..');

/** Repo-relative paths (forward slashes) the engine may read. */
export const ENGINE_DATA_ALLOW = [
  // team / player / agent / map-history tables (@pv/game-data)
  /^packages\/game-data\/data\/[^/]+\.json$/,
  // weapons catalog (@pv/match-runner)
  /^packages\/match-runner\/data\/[^/]+\.json$/,
  // per map: zone graph, coordinate system, navigation roadmap, measured line of sight, tactics, objects.
  // These are the committed map DERIVATIVES (points, segments, one bit per pair) — not map geometry;
  // they still need the licence review recorded in docs/LICENSE_AUDIT.md before any release.
  /^datasets\/spatial\/([a-z0-9-]+)\/(?:coordinate-system|\1\.(?:navgraph|nav|vis|tactics|objects))\.json$/,
  // defender setups
  /^datasets\/synthetic\/setups\/[^/]+\.json$/,
];
const ROOTS = ['packages/game-data/data', 'packages/match-runner/data', 'datasets/spatial', 'datasets/synthetic/setups'];

function walk(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/** Tracked files under the data roots; null when this is not a git checkout. */
function trackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', ...ROOTS], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return out.split('\0').filter(Boolean);
  } catch { return null; }
}

/** The files that would be staged (repo-relative), sorted. */
export function engineDataFiles() {
  const tracked = trackedFiles()
    ?? ROOTS.flatMap((r) => (existsSync(path.join(REPO_ROOT, r)) ? walk(path.join(REPO_ROOT, r)) : []))
      .map((f) => path.relative(REPO_ROOT, f).split(path.sep).join('/'));
  return tracked.filter((f) => ENGINE_DATA_ALLOW.some((re) => re.test(f)) && existsSync(path.join(REPO_ROOT, f))).sort();
}

/** Copy the engine data into `outDir` (emptied first). Returns the staged files and their total size. */
export function stageEngineData(outDir) {
  const files = engineDataFiles();
  if (files.length === 0) throw new Error(`no engine data found under ${REPO_ROOT}`);
  rmSync(outDir, { recursive: true, force: true });
  let bytes = 0;
  for (const f of files) {
    const to = path.join(outDir, f);
    mkdirSync(path.dirname(to), { recursive: true });
    cpSync(path.join(REPO_ROOT, f), to);
    bytes += statSync(to).size;
  }
  writeFileSync(path.join(outDir, 'engine-data-manifest.json'), JSON.stringify({ files, bytes }, null, 1));
  return { files, bytes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outDir = path.resolve(process.argv[2] ?? path.join(here, '..', 'dist', 'engine-data'));
  const { files, bytes } = stageEngineData(outDir);
  console.log(`engine data: ${files.length} files, ${(bytes / 1e6).toFixed(1)} MB → ${outDir}`);
}
