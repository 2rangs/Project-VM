import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createRoundValueModel,
  priorsFallbackPredict,
  matchupWinRate,
  FEATURE_ORDER,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const MODEL = resolve(here, "../../../models/round-value/round_value_lgbm.onnx");
const SAMPLES = resolve(here, "../../../models/round-value/parity_samples.json");

function featureVec(overrides: Partial<Record<(typeof FEATURE_ORDER)[number], number>>): number[] {
  const base: Record<string, number> = Object.fromEntries(FEATURE_ORDER.map((n) => [n, 0]));
  return FEATURE_ORDER.map((n) => overrides[n] ?? base[n]!);
}

describe("RoundValueModel feature order", () => {
  it("matches the Python feature list length", () => {
    expect(FEATURE_ORDER.length).toBe(17);
  });
});

describe("priors fallback", () => {
  it("returns the economy-matchup rate from the two tier codes", () => {
    // atk full (code 2) vs def eco (code 0) -> full>eco
    const v = featureVec({ atk_tier_code: 2, def_tier_code: 0 });
    expect(priorsFallbackPredict(v)).toBeCloseTo(matchupWinRate("full", "eco"), 6);
  });

  it("createRoundValueModel with no path uses the priors fallback", async () => {
    const m = await createRoundValueModel();
    expect(m.backend).toBe("priors-fallback");
    const v = featureVec({ atk_tier_code: 1, def_tier_code: 2 }); // semi vs full
    expect(await m.predict(v)).toBeCloseTo(matchupWinRate("semi", "full"), 6);
  });

  it("falls back gracefully when the model path does not exist", async () => {
    const m = await createRoundValueModel({ modelPath: "/no/such/model.onnx" });
    expect(m.backend).toBe("priors-fallback");
    expect(await m.predict(featureVec({ atk_tier_code: 2, def_tier_code: 2 }))).toBeCloseTo(0.5, 6);
  });
});

// Real ONNX parity — runs only when both the model and onnxruntime-node are available.
let ortAvailable = false;
try {
  await import("onnxruntime-node" as string);
  ortAvailable = true;
} catch {
  ortAvailable = false;
}

describe.skipIf(!existsSync(MODEL) || !ortAvailable)("ONNX parity with Python", () => {
  it("matches Python predict_proba on the stored samples", async () => {
    const model = await createRoundValueModel({ modelPath: MODEL });
    expect(model.backend).toBe("onnx");
    const { samples } = JSON.parse(readFileSync(SAMPLES, "utf-8"));
    for (const s of samples) {
      const got = await model.predict(s.features);
      expect(Math.abs(got - s.expectedProb)).toBeLessThan(1e-3);
    }
  });
});
