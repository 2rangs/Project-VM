// Deterministic seeded helpers — the same mulberry32 / FNV-style deriveSeed the engines use
// (round-simulator/src/rng.ts), copied so this package stays dependency-free for the renderer.
// Every random draw in the career layer comes from a stream derived from (world seed, label), so
// one person's draws never shift another's and the result does not depend on iteration order.
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function deriveSeed(base: number, label: string): number {
  let h = (base ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A stream for one labelled purpose under a base seed. */
export const streamFor = (base: number, label: string): Rng => mulberry32(deriveSeed(base, label));

/** Standard normal via Box–Muller, clamped to ±limit (default 2.5) so no draw is absurd. */
export function normal(rng: Rng, limit = 2.5): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(-limit, Math.min(limit, z));
}

/** Index drawn from non-negative weights (all-zero → 0). */
export function weightedIndex(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0) return 0;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i]!);
    if (r < 0) return i;
  }
  return weights.length - 1;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length]!;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
