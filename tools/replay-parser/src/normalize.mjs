// PROJECT V — PV-6 Replay Parser: normalize stage
//
// Turns the raw replay-native object from extract.mjs into a PROJECT V-aligned
// normalized bundle: millisecond time axis, per-round split, game-world
// coordinates, and provenance on every record (README §08.3, §08.4; Handoff
// §22.3, §24.2; PV-2 datasets/schema provenance.schema.json).
//
// COORDINATE FRAME — important boundary with the Spatial agent (PV-4):
//   .vrf positions are game-world Unreal units (uu ≈ cm), Z-up. We emit them as
//   `worldPos {x,y,z}` verbatim. We DELIBERATELY DO NOT fabricate minimap
//   (0..1000) x/y: the authoritative world→minimap transform is owned by PV-4
//   (datasets/spatial/). Downstream code that needs the PV-2 Position shape
//   (minimapUnits x/y) must apply that transform; here, worldPos is the truth.
//
// TIME AXIS (README §08.4):
//   sourceTimestamp — per-move 128Hz tick, resets each round (kept verbatim).
//   matchTimeMs     — ms since match combat start, from BombGameState wall clock
//                     (ReplicatedWorldTimeSecondsDouble), anchored at sample 0.
//   roundTimeMs     — matchTimeMs minus the round's own start.
//
// DATA HONESTY:
//   `alive` is NOT decoded from .vrf (CORE_SOURCE_VERIFICATION §2.1: health /
//   alive / KDA are not in the file). We emit alive:null and record the gap in
//   provenance.notes rather than inventing a death heuristic value.

import { EXTRACT_VERSION } from './extract.mjs';

export const NORMALIZE_VERSION = '1.0.0';

// Build a sampleIdx -> matchTimeMs mapper from the bombState wall-clock table.
// Mirrors the upstream interpolation but returns ms and is reused for rounds.
function makeSampleToWallMs(bombStates) {
  if (!bombStates.length) return null;
  return (sIdx) => {
    let lo = 0, hi = bombStates.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bombStates[mid].sampleIdx < sIdx) lo = mid + 1; else hi = mid;
    }
    const next = bombStates[lo];
    const prev = lo > 0 ? bombStates[lo - 1] : null;
    if (!prev) return next.t * 1000;
    const span = next.sampleIdx - prev.sampleIdx;
    const a = span > 0 ? (sIdx - prev.sampleIdx) / span : 0;
    return (prev.t + (next.t - prev.t) * a) * 1000;
  };
}

/**
 * @param {object} raw   output of extractRaw*
 * @param {object} opts  { matchId, mapName, gamePatch, sourceVrf, sourceVersion,
 *                         redactProfileNames (bool), retrievedAt, sha256 }
 */
export function normalize(raw, opts = {}) {
  const {
    matchId = null,
    mapName = null,
    gamePatch = null,
    sourceVrf = null,
    sourceVersion = null,
    redactProfileNames = false,
    retrievedAt = new Date().toISOString(),
    sha256 = null,
    synthetic = false, // true when the input is a fabricated fixture, not a real .vrf
  } = opts;

  const toWallMs = makeSampleToWallMs(raw.bombStates);
  const wallZero = toWallMs ? toWallMs(0) : 0;

  // --- Rounds from ClientGamePhaseEnded OldPhase=2 (buy ended = combat start) ---
  const rounds = [];
  if (toWallMs) {
    const seen = new Set();
    for (const pe of raw.phaseEvents) {
      if (pe.phase !== 2) continue;
      if (seen.has(pe.sampleIdx)) continue;
      seen.add(pe.sampleIdx);
      rounds.push({
        roundNum: rounds.length + 1,
        startSampleIdx: pe.sampleIdx,
        startTimeMs: Math.round(toWallMs(pe.sampleIdx) - wallZero),
      });
    }
  }
  if (rounds.length === 0) {
    // No decodable phase markers: treat whole stream as a single round.
    rounds.push({ roundNum: 1, startSampleIdx: 0, startTimeMs: 0 });
  }
  // Close each round at the next round's start (last round is open-ended).
  for (let i = 0; i < rounds.length; i++) {
    rounds[i].endTimeMs = i + 1 < rounds.length ? rounds[i + 1].startTimeMs : null;
    rounds[i].endSampleIdx = i + 1 < rounds.length ? rounds[i + 1].startSampleIdx : raw.samples.length;
  }

  const roundForMatchMs = (ms) => {
    let r = rounds[0];
    for (const rr of rounds) { if (ms >= rr.startTimeMs) r = rr; else break; }
    return r;
  };

  // --- Players ---
  const players = [];
  for (const ch in raw.players) {
    const p = raw.players[ch];
    players.push({
      channel: +ch,
      playerId: p.PlayerId !== undefined ? String(p.PlayerId) : `ch${ch}`,
      teamIdx: p.team === undefined ? null : p.team,
      profileName: redactProfileNames ? null : (p.ProfileName ?? null),
      competitiveTier: p.CompetitiveTier ?? null,
    });
  }

  // --- Positions ---
  const positions = [];
  const sIndexOf = raw.sampleSchema; // ['sourceTimestamp','guid','x','y','z','yawDeg']
  for (let i = 0; i < raw.samples.length; i++) {
    const s = raw.samples[i];
    const matchTimeMs = toWallMs ? Math.round(toWallMs(i) - wallZero) : null;
    const rr = matchTimeMs === null ? rounds[0] : roundForMatchMs(matchTimeMs);
    positions.push({
      roundNum: rr.roundNum,
      actorGuid: s[1],
      sourceTimestamp: s[0],                 // 128Hz round-reset tick (verbatim)
      matchTimeMs,
      roundTimeMs: matchTimeMs === null ? null : matchTimeMs - rr.startTimeMs,
      worldPos: { x: s[2], y: s[3], z: s[4] }, // game units (uu ≈ cm), Z-up
      facingDeg: s[5],
      alive: null, // NOT in .vrf — see provenance.notes
    });
  }

  const provenance = {
    sourceId: synthetic ? 'pv-synthetic-replay' : 'valorant-vrf',
    sourceUrl: null,
    sourceVersion: sourceVersion || sourceVrf || null,
    gamePatch,
    retrievedAt,
    evidenceType: synthetic ? 'simulated' : 'decoded',
    confidence: null,
    verified: !synthetic,
    verificationLevel: synthetic ? 0 : 3,
    synthetic,
    sha256,
    notes: [
      ...(synthetic
        ? ['SYNTHETIC FIXTURE — fabricated to exercise the pipeline; NOT a real pro match. Must live under test/fixtures or datasets/synthetic/.']
        : []),
      'Positions decoded from a .vrf via ValorantReplayParser (channel-hooks) + PV-6 extract/normalize.',
      'worldPos is game-world Unreal units (uu ≈ cm), Z-up; minimap projection is PV-4 (spatial) territory.',
      'alive/health/armor/weapon/KDA/kill-attribution are NOT in .vrf (anonymous mode); treat as absent, not false.',
      'facingDeg is the decoded per-move Yaw in degrees.',
      'sourceTimestamp is a 128Hz round-reset tick; matchTimeMs/roundTimeMs derive from the BombGameState wall clock.',
    ],
  };

  return {
    meta: {
      matchId,
      mapName,
      mapUrl: raw.meta.mapUrl || null,
      gamePatch,
      sourceVrf,
      frame: 'game-world-uu-zup',
      extractVersion: raw.meta.extractVersion || EXTRACT_VERSION,
      normalizeVersion: NORMALIZE_VERSION,
      generatedAt: retrievedAt,
      counts: {
        players: players.length,
        rounds: rounds.length,
        positions: positions.length,
        uniqueGuids: raw.meta.uniqueGuids.length,
      },
      provenance,
    },
    players,
    rounds,
    positions,
    _sampleSchema: sIndexOf,
  };
}
