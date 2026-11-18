/**
 * Optional pre-round win-probability model (DECISION-005: the engine works WITHOUT it).
 *
 * Loads the ONNX model exported by `tools/ml/round-value` via `onnxruntime-node` IF that optional
 * dependency and the model file are present; otherwise it falls back to the economy-matchup priors
 * lookup (priors-fixture.ts). Evaluation (docs/research/ROUND_VALUE_MODEL.md) found the LightGBM
 * model does NOT beat the priors/logistic baselines, so the fallback is, in practice, as good — the
 * ONNX path exists mainly to wire the integration seam.
 *
 * Feature order MUST match tools/ml/round-value FEATURE_NAMES.
 */
import { matchupWinRate, type BuyTier } from "./priors-fixture.js";

export const FEATURE_ORDER = [
  "round_num", "is_ot", "half_index",
  "atk_score", "def_score", "score_diff",
  "atk_loadout", "def_loadout", "loadout_diff",
  "atk_bank", "def_bank",
  "atk_streak_losses", "def_streak_losses", "prev_atk_won",
  "map_code", "atk_tier_code", "def_tier_code",
] as const;

// Matches tools/ml/round-value features.py TIER_CODE.
const CODE_TO_TIER: Record<number, BuyTier> = { 0: "eco", 1: "semi", 2: "full", 3: "pistol" };

export interface RoundValueModelOptions {
  /** Path to the .onnx file; if omitted or unloadable, the model uses the priors fallback. */
  readonly modelPath?: string;
}

export interface RoundValueModel {
  /** Attacker round win probability in [0,1]. Accepts the ordered 17-feature vector. */
  predict(features: readonly number[]): Promise<number>;
  readonly backend: "onnx" | "priors-fallback";
}

/** Priors fallback: economy-matchup win rate from the two buy-tier codes in the feature vector. */
export function priorsFallbackPredict(features: readonly number[]): number {
  const atk = CODE_TO_TIER[features[15] ?? 2] ?? "full";
  const def = CODE_TO_TIER[features[16] ?? 2] ?? "full";
  return matchupWinRate(atk, def);
}

class PriorsFallbackModel implements RoundValueModel {
  readonly backend = "priors-fallback" as const;
  async predict(features: readonly number[]): Promise<number> {
    return priorsFallbackPredict(features);
  }
}

class OnnxModel implements RoundValueModel {
  readonly backend = "onnx" as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly session: any, private readonly ort: any, private readonly inputName: string) {}

  async predict(features: readonly number[]): Promise<number> {
    const tensor = new this.ort.Tensor("float32", Float32Array.from(features), [1, features.length]);
    const out = await this.session.run({ [this.inputName]: tensor });
    // convert_lightgbm(zipmap=false) yields a label output and a probabilities output [1,2].
    for (const key of Object.keys(out)) {
      const t = out[key];
      if (t?.dims?.length === 2 && t.dims[1] === 2) {
        return Number(t.data[1]);
      }
    }
    // single-probability output fallback
    const first = out[Object.keys(out)[0]!];
    return Number(first.data[first.data.length - 1]);
  }
}

/**
 * Create a model. Tries ONNX (onnxruntime-node + modelPath); on any failure returns the priors
 * fallback. Never throws — a missing optional dependency or model is an expected, handled case.
 */
export async function createRoundValueModel(
  opts: RoundValueModelOptions = {},
): Promise<RoundValueModel> {
  if (!opts.modelPath) return new PriorsFallbackModel();
  try {
    // Dynamic import via a non-literal specifier so onnxruntime-node stays a truly OPTIONAL
    // dependency (typecheck does not require its types to be installed).
    const spec = "onnxruntime-node";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ort: any = await import(spec);
    const session = await ort.InferenceSession.create(opts.modelPath);
    const inputName = session.inputNames[0] ?? "input";
    return new OnnxModel(session, ort, inputName);
  } catch {
    return new PriorsFallbackModel();
  }
}
