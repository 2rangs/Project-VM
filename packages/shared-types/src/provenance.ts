/**
 * Provenance (README §13.3, Handoff §22.2).
 *
 * Every value that originates outside the deterministic simulation — decoded from a
 * replay, derived, inferred by a model, or synthesised — must be traceable. In
 * particular an AI *estimate* must never be stored as an observed *fact*
 * (README §29 "AI 추정값을 사실로 저장하기" is forbidden).
 */

export type EvidenceType =
  | "observed" // directly present in a source (broadcast / replay)
  | "decoded" // decoded from a replay/VRF field
  | "derived" // computed deterministically from other fields
  | "inferred" // produced by a model/heuristic; uncertain
  | "simulated"; // produced by this engine's own simulation

export interface Provenance {
  readonly sourceId: string;
  readonly sourceUrl: string;

  readonly gamePatch: string | null;
  readonly retrievedAt: string; // ISO 8601

  readonly evidenceType: EvidenceType;

  /** 0..1 for inferred/simulated values; null when not applicable. */
  readonly confidence: number | null;
  readonly verified: boolean;
}
