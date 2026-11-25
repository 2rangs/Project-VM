// A carrier killed mid-plant drops the spike (close-out bug: it used to stay the "carrier", the
// spike could never be picked up, and an attack 4v1 up ran out the clock).
import { describe, it, expect } from "vitest";
import { RoundSimulator, type SimPlayer, type SimState } from "../src/index.js";
import { loadSpatial, loadWeapons } from "./fixtures/setup.js";

const sim = new RoundSimulator({ spatial: loadSpatial(), weapons: loadWeapons(), abilities: {}, policies: {} as never, config: { seed: 1 } });
const drop = (state: SimState, p: SimPlayer) => (sim as unknown as { dropSpike(s: SimState, p: SimPlayer): void }).dropSpike(state, p);
const carrier = { id: "atk1", zoneId: "a-site", position: { x: 1, y: 2, z: 3 } } as SimPlayer;
const spike = (phase: "carried" | "planting", carrierId = "atk1") =>
  ({ phase, carrierId, zoneId: null, position: null, plantProgressMs: phase === "planting" ? 2500 : 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: null });

describe("spike drop on the carrier's death", () => {
  it("mid-plant: the plant is lost and the spike lies where the carrier fell", () => {
    const state = { spike: spike("planting") } as unknown as SimState;
    drop(state, carrier);
    expect(state.spike).toMatchObject({ phase: "carried", carrierId: null, zoneId: "a-site", position: { x: 1, y: 2, z: 3 }, plantProgressMs: 0 });
  });
  it("carrying: dropped as before; someone else's death changes nothing", () => {
    const state = { spike: spike("carried") } as unknown as SimState;
    drop(state, { ...carrier, id: "atk2" } as SimPlayer);
    expect(state.spike.carrierId).toBe("atk1");
    drop(state, carrier);
    expect(state.spike).toMatchObject({ carrierId: null, zoneId: "a-site" });
  });
});
