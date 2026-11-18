import { describe, it, expect } from "vitest";
import { SeededRng, RngStream, normalizeSeed } from "@pv/simulation-core";

describe("SeededRng determinism (DECISION-010, Handoff §30-O)", () => {
  it("produces identical sequences for the same seed", () => {
    const a = new SeededRng(12345);
    const b = new SeededRng(12345);
    const seqA = Array.from({ length: 16 }, () => a.stream("main").nextUint32());
    const seqB = Array.from({ length: 16 }, () => b.stream("main").nextUint32());
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = new SeededRng("seed-a").stream("main").nextUint32();
    const b = new SeededRng("seed-b").stream("main").nextUint32();
    expect(a).not.toEqual(b);
  });

  it("accepts number, bigint and string seeds and normalizes consistently", () => {
    expect(normalizeSeed(0n)).toBe(0n);
    const fromString = new SeededRng("abc").seedString();
    const fromStringAgain = new SeededRng("abc").seedString();
    expect(fromString).toBe(fromStringAgain);
  });
});

describe("stream separation / order independence (DECISION-010)", () => {
  it("gives each named stream an independent sequence regardless of interleaving", () => {
    // Reference: draw all of A, then all of B.
    const ref = new SeededRng(999);
    const refA = Array.from({ length: 8 }, () => ref.stream("combat").nextUint32());
    const refB = Array.from({ length: 8 }, () => ref.stream("movement").nextUint32());

    // Interleaved: alternate draws from A and B in a different order.
    const run = new SeededRng(999);
    const gotA: number[] = [];
    const gotB: number[] = [];
    for (let i = 0; i < 8; i++) {
      gotB.push(run.stream("movement").nextUint32());
      gotA.push(run.stream("combat").nextUint32());
    }

    // Each stream's own sequence is unchanged by the interleaving of the other.
    expect(gotA).toEqual(refA);
    expect(gotB).toEqual(refB);
  });

  it("adding a draw in one stream does not shift another stream's values", () => {
    const base = new SeededRng(7);
    const baseMovement = Array.from({ length: 5 }, () =>
      base.stream("movement").nextUint32(),
    );

    const withExtra = new SeededRng(7);
    withExtra.stream("combat").nextUint32(); // extra, unrelated draw
    withExtra.stream("combat").nextUint32();
    const movement = Array.from({ length: 5 }, () =>
      withExtra.stream("movement").nextUint32(),
    );

    expect(movement).toEqual(baseMovement);
  });

  it("memoizes a stream so repeated access continues the same sequence", () => {
    const rng = new SeededRng(1);
    const first = rng.stream("x").nextUint32();
    const second = rng.stream("x").nextUint32();
    expect(first).not.toEqual(second);
  });
});

describe("RngStream distributions", () => {
  it("nextFloat stays within [0, 1)", () => {
    const s = new SeededRng(42).stream("f");
    for (let i = 0; i < 1000; i++) {
      const v = s.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("nextInt stays within [min, max) and is reproducible", () => {
    const s1 = new SeededRng(3).stream("i");
    const s2 = new SeededRng(3).stream("i");
    for (let i = 0; i < 500; i++) {
      const v = s1.nextInt(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(10);
      expect(v).toBe(s2.nextInt(5, 10));
    }
  });

  it("shuffle is a deterministic permutation", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = new SeededRng(55).stream("s").shuffle(items);
    const b = new SeededRng(55).stream("s").shuffle(items);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // input not mutated
  });

  it("serializes and restores stream state losslessly", () => {
    const s = new SeededRng(88).stream("state");
    s.nextUint64();
    s.nextUint64();
    const snapshot = s.getState();
    const continued = Array.from({ length: 4 }, () => s.nextUint32());

    const restored = RngStream.restore(snapshot);
    const restoredSeq = Array.from({ length: 4 }, () => restored.nextUint32());
    expect(restoredSeq).toEqual(continued);
  });
});
