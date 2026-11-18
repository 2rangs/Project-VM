/**
 * Deterministic, stream-separated pseudo-random number generation (DECISION-010).
 *
 * Determinism requirement (README §27.3, Handoff §30-O): the same seed must reproduce
 * the same result. The harder requirement (DECISION-010) is *order independence across
 * concerns*: if the combat system and the movement system each draw from their own
 * named stream, then reordering their draws — or adding a draw in one — must not change
 * the numbers the other sees. We get this by deriving an independent generator per
 * stream name from the root seed, so streams never share mutable state.
 *
 * Algorithm: SplitMix64 (public domain, by Sebastiano Vigna). It is a well-distributed
 * 64-bit generator with a trivial, fully specified state transition, which makes it
 * reproducible across platforms when implemented with BigInt (no float drift). Stream
 * keys are derived by hashing the stream name (FNV-1a 64) and mixing it with the root
 * seed, so two different names yield statistically independent sequences.
 */

const MASK64 = (1n << 64n) - 1n;
const GOLDEN_GAMMA = 0x9e3779b97f4a7c15n;
const MUL1 = 0xbf58476d1ce4e5b9n;
const MUL2 = 0x94d049bb133111ebn;

const u64 = (x: bigint): bigint => x & MASK64;

/** One SplitMix64 mixing step applied to a finalised state value. */
function splitMix64Mix(z0: bigint): bigint {
  let z = u64(z0);
  z = u64((z ^ (z >> 30n)) * MUL1);
  z = u64((z ^ (z >> 27n)) * MUL2);
  return z ^ (z >> 31n);
}

/** FNV-1a 64-bit hash of a string → 64-bit seed contribution for a stream name. */
function fnv1a64(input: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = u64(hash * prime);
  }
  return hash;
}

/** Normalise an arbitrary seed (number, bigint, or string) to a 64-bit value. */
export function normalizeSeed(seed: number | bigint | string): bigint {
  if (typeof seed === "bigint") return u64(seed);
  if (typeof seed === "number") {
    if (!Number.isFinite(seed)) throw new RangeError(`seed must be finite, got ${seed}`);
    // Fold the full 64 bits of a double's bit pattern so fractional seeds differ too.
    const buf = new DataView(new ArrayBuffer(8));
    buf.setFloat64(0, seed);
    return u64(buf.getBigUint64(0));
  }
  return fnv1a64(seed);
}

/**
 * A single independent random stream. Within a stream, draw order matters (as it must);
 * across streams, nothing is shared. Serialisable via {@link getState}/{@link fromState}.
 */
export class RngStream {
  private state: bigint;

  private constructor(state: bigint) {
    this.state = u64(state);
  }

  /** Create a stream directly from a fully-specified 64-bit internal state. */
  static fromState(state: bigint): RngStream {
    return new RngStream(u64(state));
  }

  /** Derive a stream from a root seed and a stream name. */
  static derive(rootSeed: bigint, streamName: string): RngStream {
    // Mix the root seed and the name hash so (seed, name) → unique, well-spread state.
    const mixed = splitMix64Mix(u64(rootSeed + GOLDEN_GAMMA * fnv1a64(streamName)));
    return new RngStream(mixed);
  }

  /** Raw 64-bit draw. Advances state by the SplitMix64 increment. */
  nextUint64(): bigint {
    this.state = u64(this.state + GOLDEN_GAMMA);
    return splitMix64Mix(this.state);
  }

  /** 32-bit unsigned integer (high bits of a 64-bit draw). */
  nextUint32(): number {
    return Number(this.nextUint64() >> 32n);
  }

  /** Float in [0, 1) with 53 bits of entropy. */
  nextFloat(): number {
    // Take the top 53 bits for a uniform double in [0,1).
    return Number(this.nextUint64() >> 11n) / 2 ** 53;
  }

  /** Integer in [minInclusive, maxExclusive) with rejection to avoid modulo bias. */
  nextInt(minInclusive: number, maxExclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive)) {
      throw new RangeError("nextInt bounds must be integers");
    }
    const span = maxExclusive - minInclusive;
    if (span <= 0) throw new RangeError("maxExclusive must be > minInclusive");
    const spanBig = BigInt(span);
    // Rejection sampling over the full 64-bit range for an unbiased result.
    const limit = MASK64 - (MASK64 % spanBig);
    let draw = this.nextUint64();
    while (draw >= limit) draw = this.nextUint64();
    return minInclusive + Number(draw % spanBig);
  }

  /** Bernoulli trial: true with probability p (clamped to [0,1]). */
  nextBool(p = 0.5): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.nextFloat() < p;
  }

  /** Uniformly pick one element; throws on an empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("cannot pick from an empty array");
    return items[this.nextInt(0, items.length)]!;
  }

  /** Return a new array that is a deterministic Fisher–Yates shuffle of `items`. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i + 1);
      const tmp = out[i]!;
      out[i] = out[j]!;
      out[j] = tmp;
    }
    return out;
  }

  /** Derive a named sub-stream from this stream's *current* state. */
  fork(name: string): RngStream {
    return RngStream.derive(this.state, name);
  }

  /** Snapshot the internal state for serialisation (as a decimal string). */
  getState(): string {
    return this.state.toString();
  }

  /** Restore a stream from a snapshot produced by {@link getState}. */
  static restore(stateDecimal: string): RngStream {
    return new RngStream(BigInt(stateDecimal));
  }
}

/**
 * Root RNG for a simulation run. Hand out one named stream per concern
 * (e.g. "combat", "movement", "economy") so draws stay order-independent across them.
 */
export class SeededRng {
  private readonly rootSeed: bigint;
  private readonly streams = new Map<string, RngStream>();

  constructor(seed: number | bigint | string) {
    this.rootSeed = normalizeSeed(seed);
  }

  /**
   * Get the named stream. The same name always returns the same (memoised) stream for
   * this run, so repeated access continues one sequence rather than restarting it.
   */
  stream(name: string): RngStream {
    let s = this.streams.get(name);
    if (s === undefined) {
      s = RngStream.derive(this.rootSeed, name);
      this.streams.set(name, s);
    }
    return s;
  }

  /** The normalised 64-bit root seed, as a decimal string (for logging/serialisation). */
  seedString(): string {
    return this.rootSeed.toString();
  }
}
