// PROJECT V — PV-6 replay analysis: movement kinematics (map-independent).
//
// Pure functions that turn decoded position samples into aggregate movement
// statistics for simulation calibration (speed bands, acceleration, yaw turn
// rate, first-move latency, move/idle segment lengths). NO per-frame trajectory
// is emitted — aggregates only (privacy + repo size).
//
// UNITS (stated for PV-4 Combat Engine consumers):
//   distance : game units (uu ≈ 1 cm). metres = uu / unitsPerMeter (default 100).
//   speed    : reported in BOTH uu/s and m/s.
//   yaw rate : degrees per second (deg/s). angle wraps handled (±180).
//   time     : milliseconds (ms) unless a field says seconds.
//
// SAMPLE MODEL: input is the extract.mjs sample tuple
//   [sourceTimestamp(128Hz tick, resets per round), guid, x, y, z, yawDeg].
// dt between consecutive same-actor samples = (ts2 - ts1) / sampleHz seconds.
// A non-positive or too-large dt marks a round reset / gap and splits the stream.

export const KINEMATICS_VERSION = '1.0.0';

export const DEFAULTS = {
  sampleHz: 128,         // VALORANT replay movement tick
  unitsPerMeter: 100,    // 1 uu ≈ 1 cm (Unreal/VALORANT convention)
  maxDtSec: 0.25,        // split the stream across gaps longer than this
  // Movement-state thresholds in m/s. Basis: VALORANT documented base run
  // 6.75 m/s, shift-walk ~3.4 m/s; crouch-walk is slower still. We CANNOT read
  // the player's actual input (shift/crouch) from the .vrf, so these are speed
  // BANDS, not verified input states.
  idleMaxMps: 0.3,       // below this = standing / micro-jitter
  walkMaxMps: 4.0,       // idle..this = walk/crouch band (can't separate the two)
  runMaxMps: 7.5,        // walk..this = run band; above = anomalous (flagged)
};

const wrapDeg = (d) => { let a = Math.abs(d); return a > 180 ? 360 - a : a; };

function percentiles(sortedAsc, ps) {
  const out = {};
  for (const p of ps) {
    out[`p${Math.round(p * 100)}`] = sortedAsc.length
      ? sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(p * (sortedAsc.length - 1)))]
      : null;
  }
  return out;
}

// Split one actor's samples into contiguous runs with valid dt (no round reset).
function contiguousRuns(samples, sampleHz, maxDtSec) {
  const runs = [];
  let cur = [];
  for (let i = 0; i < samples.length; i++) {
    if (cur.length === 0) { cur.push(samples[i]); continue; }
    const dt = (samples[i][0] - cur[cur.length - 1][0]) / sampleHz;
    if (dt > 0 && dt <= maxDtSec) cur.push(samples[i]);
    else { if (cur.length > 1) runs.push(cur); cur = [samples[i]]; }
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

/**
 * Compute kinematics over all samples.
 * @param {Array} samples  extract.mjs sample tuples (mixed actors ok)
 * @param {object} opts    overrides of DEFAULTS; roundStarts (matchTimeMs[]) optional
 * @returns aggregate stats object (no per-frame data)
 */
export function computeKinematics(samples, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const upm = cfg.unitsPerMeter;
  const idleU = cfg.idleMaxMps * upm;
  const walkU = cfg.walkMaxMps * upm;
  const runU = cfg.runMaxMps * upm;

  // group by actor, preserve order
  const byActor = new Map();
  for (const s of samples) {
    if (!byActor.has(s[1])) byActor.set(s[1], []);
    byActor.get(s[1]).push(s);
  }

  const speedsU = [];          // all step speeds (uu/s)
  const yawRates = [];         // deg/s
  const bandCount = { idle: 0, walkOrCrouch: 0, run: 0, anomalous: 0 };
  const segDurations = { move: [], idle: [] }; // seconds
  const segPeakU = [];         // peak speed per move segment (uu/s)
  const accelTimes = [];       // sec from segment start to its peak speed
  const decelTimes = [];       // sec from segment peak to its end
  let stepPairs = 0;

  for (const [, arr0] of byActor) {
    for (const run of contiguousRuns(arr0, cfg.sampleHz, cfg.maxDtSec)) {
      // per-step speed + yaw rate
      const stepSpeed = [];
      for (let i = 1; i < run.length; i++) {
        const dt = (run[i][0] - run[i - 1][0]) / cfg.sampleHz;
        const d = Math.hypot(run[i][2] - run[i - 1][2], run[i][3] - run[i - 1][3]);
        const v = d / dt;
        stepSpeed.push(v);
        speedsU.push(v);
        yawRates.push(wrapDeg(run[i][5] - run[i - 1][5]) / dt);
        stepPairs++;
        if (v < idleU) bandCount.idle++;
        else if (v < walkU) bandCount.walkOrCrouch++;
        else if (v < runU) bandCount.run++;
        else bandCount.anomalous++;
      }
      // segment the run into move/idle stretches by idle threshold
      let i = 0;
      while (i < stepSpeed.length) {
        const moving = stepSpeed[i] >= idleU;
        let j = i;
        while (j < stepSpeed.length && (stepSpeed[j] >= idleU) === moving) j++;
        const durSec = (j - i) / cfg.sampleHz;
        if (moving) {
          segDurations.move.push(durSec);
          let peak = 0, peakAt = i;
          for (let k = i; k < j; k++) if (stepSpeed[k] > peak) { peak = stepSpeed[k]; peakAt = k; }
          segPeakU.push(peak);
          accelTimes.push((peakAt - i) / cfg.sampleHz);
          decelTimes.push((j - 1 - peakAt) / cfg.sampleHz);
        } else {
          segDurations.idle.push(durSec);
        }
        i = j;
      }
    }
  }

  const sU = [...speedsU].sort((a, b) => a - b);
  const yR = [...yawRates].sort((a, b) => a - b);
  const toMps = (u) => (u == null ? null : +(u / upm).toFixed(3));
  const pct = percentiles(sU, [0.5, 0.75, 0.9, 0.95, 0.99, 1.0]);
  const movingSpeeds = sU.filter((v) => v >= idleU);

  // first-move latency per round (time from round start to first moving step)
  const firstMoveMs = [];
  if (Array.isArray(opts.positionsByRound)) {
    for (const rp of opts.positionsByRound) {
      // rp: { startMs, points:[{matchTimeMs, speedU}] } precomputed by caller
      const hit = rp.points.find((p) => p.speedU >= idleU);
      if (hit) firstMoveMs.push(hit.matchTimeMs - rp.startMs);
    }
  }

  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

  return {
    version: KINEMATICS_VERSION,
    config: {
      sampleHz: cfg.sampleHz, unitsPerMeter: upm,
      thresholdsMps: { idleMax: cfg.idleMaxMps, walkMax: cfg.walkMaxMps, runMax: cfg.runMaxMps },
      thresholdBasis: 'VALORANT base run 6.75 m/s, shift-walk ~3.4 m/s (crouch slower); bands are speed-only, input state not decodable from .vrf',
    },
    counts: {
      actors: byActor.size,
      totalSamples: samples.length,
      stepPairs,
      moveSegments: segDurations.move.length,
      idleSegments: segDurations.idle.length,
    },
    speed: {
      unit: 'uu/s (and m/s)',
      percentilesUU: pct,
      percentilesMps: Object.fromEntries(Object.entries(pct).map(([k, v]) => [k, toMps(v)])),
      topSpeedUU: sU.length ? +sU[sU.length - 1].toFixed(1) : null,
      topSpeedMps: sU.length ? toMps(sU[sU.length - 1]) : null,
      meanMovingMps: toMps(mean(movingSpeeds)),
      stateFractions: {
        idle: frac(bandCount.idle, stepPairs),
        walkOrCrouch: frac(bandCount.walkOrCrouch, stepPairs),
        run: frac(bandCount.run, stepPairs),
        anomalous: frac(bandCount.anomalous, stepPairs),
      },
      stateCounts: bandCount,
    },
    yawRate: {
      unit: 'deg/s',
      n: yR.length,
      percentiles: percentiles(yR, [0.5, 0.9, 0.99, 1.0]),
      meanDegPerSec: yR.length ? +mean(yR).toFixed(1) : null,
    },
    acceleration: {
      note: 'per move-segment: time from segment start to its peak speed (accel) and peak to end (decel), seconds',
      n: accelTimes.length,
      accelSecMean: accelTimes.length ? +mean(accelTimes).toFixed(3) : null,
      decelSecMean: decelTimes.length ? +mean(decelTimes).toFixed(3) : null,
      segPeakMpsPercentiles: Object.fromEntries(
        Object.entries(percentiles([...segPeakU].sort((a, b) => a - b), [0.5, 0.9, 1.0]))
          .map(([k, v]) => [k, toMps(v)]),
      ),
    },
    segments: {
      unit: 'seconds',
      moveSecPercentiles: percentiles([...segDurations.move].sort((a, b) => a - b), [0.5, 0.9, 1.0]),
      idleSecPercentiles: percentiles([...segDurations.idle].sort((a, b) => a - b), [0.5, 0.9, 1.0]),
      moveSecMean: mean(segDurations.move) && +mean(segDurations.move).toFixed(3),
      idleSecMean: mean(segDurations.idle) && +mean(segDurations.idle).toFixed(3),
    },
    firstMove: {
      unit: 'ms since round start',
      n: firstMoveMs.length,
      values: firstMoveMs,
      meanMs: firstMoveMs.length ? Math.round(mean(firstMoveMs)) : null,
    },
  };
}

function frac(n, d) { return d ? +(n / d).toFixed(4) : null; }
