/**
 * Floor items: guns dropped on death are picked up mid-round when better, in reach and safe; orbs
 * are taken once. Unit level on a hand-built state (the hook runs once per tick in the simulator).
 */
import { describe, expect, it } from "vitest";
import { FloorItems, PICKUP_REACH_UNITS } from "../src/floor-items.js";
import type { SimEvent, SimPlayer, SimState } from "../src/types.js";

const PRICE: Record<string, number> = { Classic: 0, Spectre: 1600, Vandal: 2900 };
const player = (id: string, x: number, weaponId: string): SimPlayer => ({
  id, teamId: id.slice(0, 3), side: id.startsWith("atk") ? "attack" : "defense", agentId: "jett",
  position: { x, y: 0, z: 0 }, zoneId: "mid", facing: { x: 1, y: 0 }, health: 100, armor: 0, alive: true, weaponId,
  skills: {} as SimPlayer["skills"], abilities: [], ultimatePoints: 0, ultimateCost: 7, path: [], pathIndex: 0, edgeProgressMs: 0, moveMode: "run",
});
const stateOf = (players: SimPlayer[]): SimState => ({ players, tick: 0, elapsedMs: 0 } as unknown as SimState);

describe("floor items", () => {
  it("a living player in reach takes a better gun off a body and leaves their own; out of reach or busy, nothing", () => {
    const victim = player("atk1", 0, "Vandal");
    const near = player("def1", PICKUP_REACH_UNITS - 10, "Spectre");
    const far = player("def2", PICKUP_REACH_UNITS * 3, "Classic");
    const state = stateOf([victim, near, far]);
    const items = new FloorItems({ priceOf: (w) => PRICE[w] ?? 0, defaultWeaponId: "Classic" });
    const events: SimEvent[] = [];
    items.step(state, () => false, (e) => events.push(e)); // everyone alive: nothing on the floor
    victim.alive = false;
    items.step(state, (p) => p.id === "def1", (e) => events.push(e)); // def1 busy (enemy in sight)
    expect(events).toHaveLength(0);
    items.step(state, () => false, (e) => events.push(e));
    expect(near.weaponId).toBe("Vandal");
    expect(far.weaponId).toBe("Classic");
    expect(events).toEqual([expect.objectContaining({ kind: "weaponPickup", actor: "def1", target: "atk1", detail: "Vandal|Spectre" })]);
    expect(items.weapons.map((w) => w.weaponId)).toEqual(["Spectre"]);
    // A Spectre is no upgrade for the Vandal holder; nobody walks to it.
    items.step(state, () => false, (e) => events.push(e));
    expect(events).toHaveLength(1);
  });

  it("an orb is taken once, by the first player in reach; no orb points → no orb events", () => {
    const a = player("atk1", 0, "Vandal");
    const b = player("def1", 50, "Vandal");
    const events: SimEvent[] = [];
    const withOrb = new FloorItems({ priceOf: () => 0, orbs: [{ id: "orbA", position: { x: 20, y: 0, z: 0 } }] });
    withOrb.step(stateOf([a, b]), () => false, (e) => events.push(e));
    withOrb.step(stateOf([a, b]), () => false, (e) => events.push(e));
    expect(events).toEqual([expect.objectContaining({ kind: "orbPickup", actor: "atk1", detail: "orbA" })]);
    const none: SimEvent[] = [];
    new FloorItems({ priceOf: () => 0 }).step(stateOf([a, b]), () => false, (e) => none.push(e));
    expect(none).toHaveLength(0);
  });
});
