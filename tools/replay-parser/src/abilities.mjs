// PROJECT V — PV-6 Replay Parser: abilities stage (offline)
//
// Lightweight, NETWORK-FREE port of ValorantWebReplayer scripts/build-abilities.mjs.
// Upstream fetches https://valorant-api.com/v1/agents at runtime to enrich each
// spawn with agent display names + ability icons. That is a browser/viewer
// concern and makes the pipeline non-deterministic and network-dependent, so
// here we only emit the raw, decoded ability spawns (class + world position +
// time + inferred team). Enrichment with the valorant-api catalog is a viewer
// step and is intentionally left out of the data pipeline.
//
// Team inference: cluster the 10 highest-sample-count actors into two teams by
// their initial Y position (two spawns), then assign each spawn the team of the
// nearest player actor at the spawn moment — the same heuristic as upstream.
// This is INFERRED, not decoded: provenance marks it so.
//
// INPUT  : channels.jsonl (one JSON object per line; we use `{"ev":"open",...}`)
//          lines with fields { cls, x, y, t } and a raw object (for actor paths).
// OUTPUT : { meta, spawns: [{ t, x, y, cls, team }] }

export const ABILITIES_VERSION = '1.0.0';

// Heuristic: is this class an ability actor (vs player/world actor)?
// Ability actor class names in VALORANT follow prefixes seen in real dumps:
// GameObject_/Projectile_/Ability_/Patch_/FXC_... plus known keyword stems.
const ABILITY_HINTS = [
  'Smoke', 'DarkCover', 'Ruse', 'NewSmoke', 'CyberCage',
  'Wall', 'FlameWall', 'FireballWall',
  'Molotov', 'MolotovFire', 'Molly', 'Burn', 'Incendiary',
  'Flash', 'FlareCurve', 'HawkFlash', 'GuidingLight',
  'Slow', 'SlowField', 'Satchel', 'BoomBot', 'PaintShells',
  'Drone', 'OwlDrone', 'Trailblazer', 'Scout',
  'Reveal', 'LoSReveal', 'Haunt', 'Spycam', 'Leer', 'Nearsight',
  'Heal', 'HealPool', 'SelfRes', 'PostDeath', 'ResTarget',
];

function looksLikeAbility(cls) {
  if (!cls) return false;
  return ABILITY_HINTS.some((k) => cls.includes(k));
}

// Build per-actor position lookup (sampleIdx-ordered) from raw samples.
function buildActorIndex(raw) {
  const sIdxGuid = 1, sIdxX = 2, sIdxY = 3;
  const byGuid = new Map(); // guid -> { xs:[], ys:[] } first-seen order
  const count = new Map();
  for (const s of raw.samples) {
    const g = s[sIdxGuid];
    if (!byGuid.has(g)) { byGuid.set(g, { xs: [], ys: [] }); count.set(g, 0); }
    const rec = byGuid.get(g);
    rec.xs.push(s[sIdxX]); rec.ys.push(s[sIdxY]);
    count.set(g, count.get(g) + 1);
  }
  // Top 10 actors by sample count = the players.
  const players = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map((e) => e[0]);
  // Cluster by initial Y.
  const spawn = players.map((g) => ({ g, y: byGuid.get(g).ys[0] ?? 0 })).sort((a, b) => a.y - b.y);
  const teamOf = new Map();
  spawn.slice(0, 5).forEach((p) => teamOf.set(p.g, 0));
  spawn.slice(5, 10).forEach((p) => teamOf.set(p.g, 1));
  return { players, byGuid, teamOf };
}

function nearestTeam(idx, x, y) {
  let best = null, bestD = Infinity;
  for (const g of idx.players) {
    const rec = idx.byGuid.get(g);
    // Use the actor's mean position as a cheap proximity proxy (we lack a
    // per-timestamp index in this offline port; adequate for team labeling).
    const n = rec.xs.length; if (!n) continue;
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += rec.xs[i]; my += rec.ys[i]; }
    mx /= n; my /= n;
    const d = (mx - x) ** 2 + (my - y) ** 2;
    if (d < bestD) { bestD = d; best = g; }
  }
  return best === null ? -1 : (idx.teamOf.get(best) ?? -1);
}

/**
 * @param {string|string[]} channelsText  channels.jsonl content or line array
 * @param {object} raw                    extractRaw* output (for actor positions)
 */
export function extractAbilities(channelsText, raw) {
  const idx = buildActorIndex(raw);
  const lines = Array.isArray(channelsText) ? channelsText : String(channelsText).split('\n');
  const spawns = [];
  let skipped = 0;
  for (const line of lines) {
    if (!line.startsWith('{"ev":"open"')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o.cls || !looksLikeAbility(o.cls)) { skipped++; continue; }
    if ((o.x === 0 && o.y === 0) || o.t === 0) { skipped++; continue; }
    spawns.push({ t: o.t, x: o.x, y: o.y, cls: o.cls, team: nearestTeam(idx, o.x, o.y) });
  }
  return {
    meta: {
      abilitiesVersion: ABILITIES_VERSION,
      spawnCount: spawns.length,
      skipped,
      note: 'team is INFERRED via spawn clustering; cls is decoded; no valorant-api enrichment (offline).',
    },
    spawns,
  };
}
