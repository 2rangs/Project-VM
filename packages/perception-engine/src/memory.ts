import type { ObservedEnemy, PlayerId } from "./shared-mirror.js";
import { confidenceForAge, type PerceptionParams } from "./params.js";

/**
 * Per-observer memory of enemies. Currently-visible enemies refresh their entry;
 * enemies no longer in sight persist as last-seen with a confidence that decays by
 * staleness and are forgotten below a threshold (README §17.3 — old info is weak).
 *
 * Time base: the round clock is `timeRemainingMs` (decreasing), so elapsed-since-seen
 * = lastSeenAtMs - nowRemainingMs (a newer sighting has a larger remaining value).
 */
export class EnemyMemory {
  private readonly store = new Map<PlayerId, ObservedEnemy>();

  constructor(private readonly params: PerceptionParams) {}

  /** Confidence (0..1) in a stored entry at the given current round-remaining time. */
  confidenceOf(entry: ObservedEnemy, nowRemainingMs: number): number {
    const elapsed = entry.lastSeenAtMs - nowRemainingMs;
    return confidenceForAge(elapsed, this.params.memory.halfLifeMs);
  }

  /**
   * Refresh with this tick's currently-visible enemies, decay the rest, forget the
   * faded, and return the merged enemy picture (visible + still-remembered).
   */
  updateAndCollect(visibleThisTick: readonly ObservedEnemy[], nowRemainingMs: number): ObservedEnemy[] {
    const visibleIds = new Set<PlayerId>();
    for (const v of visibleThisTick) {
      visibleIds.add(v.playerId);
      this.store.set(v.playerId, v); // v.currentlyVisible === true, lastSeenAtMs === now
    }

    const result: ObservedEnemy[] = [];
    for (const [id, entry] of this.store) {
      if (visibleIds.has(id)) {
        result.push(entry);
        continue;
      }
      const confidence = this.confidenceOf(entry, nowRemainingMs);
      if (confidence < this.params.memory.forgetBelowConfidence) {
        this.store.delete(id);
        continue;
      }
      result.push({ ...entry, currentlyVisible: false });
    }
    return result;
  }

  /** Testing/inspection: number of remembered enemies. */
  size(): number {
    return this.store.size;
  }
}
