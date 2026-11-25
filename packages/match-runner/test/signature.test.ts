import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SIGNATURE_CASES, signatureOf, stableStringify, type Signature } from "./signature/cases.js";

const here = dirname(fileURLToPath(import.meta.url));
const expected = JSON.parse(readFileSync(join(here, "signature", "signatures.json"), "utf8")) as Record<string, Signature>;

/**
 * Byte-identical guard for performance work: the full runMatch output of each case must hash to
 * the recorded value. A mismatch means the simulation's behaviour changed. If that was the
 * intention, re-record with `npx tsx packages/match-runner/test/signature/capture.mts` and say so
 * in the commit; if it was meant to be a pure speed-up, it is a bug.
 */
describe("match signatures (runMatch output is byte-identical to the recording)", () => {
  it("records a signature for every case", () => {
    expect(Object.keys(expected).sort()).toEqual(SIGNATURE_CASES.map((c) => c.id).sort());
  });
  for (const c of SIGNATURE_CASES) {
    it(c.id, () => {
      expect(signatureOf(c)).toEqual(expected[c.id]);
    }, 120_000);
  }
  it("the hash covers key order, non-finite numbers and nesting", () => {
    expect(stableStringify({ b: 1, a: [Infinity, { d: NaN, c: undefined }] })).toBe('{"a":["__Infinity",{"d":"__NaN"}],"b":1}');
  });
});
