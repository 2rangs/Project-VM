// Difficulty presets (backlog #9). A career is created at one of three difficulties; the choice
// sets three knobs that the club layer reads:
//   finance        the MANAGER's club budget multiplier (wage + transfer; set every season)
//   boardTolerance the board's patience: >1 starts higher and lowers the warn/sack thresholds
//   aiStrength     how aggressively AI clubs buy in the transfer market (buys per window)
// Everything else — the simulation engine, every AI club's play — is identical across difficulties.
// `normal` is the neutral preset (every knob 1), so a career with no difficulty behaves as before.
export type DifficultyId = "easy" | "normal" | "hard";

export interface DifficultyKnobs {
  /** Manager-club budget multiplier (wage + transfer budgets). */
  readonly finance: number;
  /** Board patience: >1 = more patient (higher start confidence, lower warn/sack thresholds). */
  readonly boardTolerance: number;
  /** AI transfer-market aggressiveness (buys allowed per window). */
  readonly aiStrength: number;
}

export const DIFFICULTIES: Record<DifficultyId, DifficultyKnobs> = {
  easy: { finance: 1.5, boardTolerance: 1.5, aiStrength: 0.75 },
  normal: { finance: 1, boardTolerance: 1, aiStrength: 1 },
  hard: { finance: 0.7, boardTolerance: 0.65, aiStrength: 1.3 },
} as const;

export const DIFFICULTY_IDS = ["easy", "normal", "hard"] as const;

/** The knobs for a difficulty (undefined / unknown → normal). */
export function resolveDifficulty(id?: DifficultyId | null): DifficultyKnobs {
  return DIFFICULTIES[id ?? "normal"] ?? DIFFICULTIES.normal;
}
