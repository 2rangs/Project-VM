/**
 * World State construction (Handoff §12, README §14.1; TASK 006).
 *
 * Factories build a *valid, fully-populated* WorldState / PlayerState from partial input
 * so callers (tests, scenario loaders, the future replay loader) never hand around
 * half-built state. Results are deep-frozen to make the "immutable update" contract
 * enforceable at runtime — a stray mutation throws in strict mode / tests.
 */
import type {
  AbilityInventory,
  AgentId,
  InventoryState,
  MapId,
  MatchId,
  PatchVersion,
  PlayerId,
  PlayerState,
  RoundId,
  Side,
  SpikeState,
  TeamEconomyState,
  TeamId,
  WorldState,
} from "@pv/shared-types";
import { asAbilityId, ZERO_VEC2, ZERO_VEC3 } from "@pv/shared-types";

/** Recursively freeze an object graph (arrays and plain objects). */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

const EMPTY_INVENTORY: InventoryState = {
  primary: null,
  secondary: null,
  armor: { type: "none", points: 0 },
  hasSpike: false,
};

function defaultAbilities(ultimateAbilityId: string, required = 7): AbilityInventory {
  return {
    basic: [],
    signature: null,
    ultimate: { abilityId: asAbilityId(ultimateAbilityId), points: 0, required, ready: false },
  };
}

export interface CreatePlayerInput {
  readonly id: PlayerId;
  readonly teamId: TeamId;
  readonly side: Side;
  readonly agentId: AgentId;
  readonly position?: PlayerState["position"];
  readonly facing?: PlayerState["facing"];
  readonly health?: number;
  readonly armor?: number;
  readonly alive?: boolean;
  readonly credits?: number;
  readonly ultimatePoints?: number;
  readonly ultimateRequired?: number;
  readonly inventory?: InventoryState;
  readonly behaviorState?: string;
}

export function createPlayerState(input: CreatePlayerInput): PlayerState {
  const player: PlayerState = {
    id: input.id,
    teamId: input.teamId,
    side: input.side,
    agentId: input.agentId,
    position: input.position ?? ZERO_VEC3,
    velocity: ZERO_VEC3,
    facing: input.facing ?? ZERO_VEC2,
    health: input.health ?? 100,
    armor: input.armor ?? 0,
    alive: input.alive ?? true,
    weapon: null,
    inventory: input.inventory ?? EMPTY_INVENTORY,
    abilities: defaultAbilities(`${input.agentId}:ultimate`, input.ultimateRequired ?? 7),
    credits: input.credits ?? 0,
    ultimatePoints: input.ultimatePoints ?? 0,
    behaviorState: input.behaviorState ?? "idle",
    currentOrderId: null,
  };
  return deepFreeze(player);
}

export interface CreateWorldInput {
  readonly matchId: MatchId;
  readonly roundId: RoundId;
  readonly roundNumber: number;
  readonly mapId: MapId;
  readonly patchVersion: PatchVersion;
  readonly players: readonly PlayerState[];
  readonly timeRemainingMs: number;
  readonly tick?: number;
  readonly spike?: SpikeState;
  readonly economy?: readonly TeamEconomyState[];
  readonly matchScore?: readonly [number, number] | null;
}

const DEFAULT_SPIKE: SpikeState = {
  phase: "carried",
  position: null,
  holderId: null,
  detonationInMs: null,
};

export function createWorldState(input: CreateWorldInput): WorldState {
  const world: WorldState = {
    matchId: input.matchId,
    roundId: input.roundId,
    roundNumber: input.roundNumber,
    tick: input.tick ?? 0,
    timeRemainingMs: input.timeRemainingMs,
    mapId: input.mapId,
    patchVersion: input.patchVersion,
    players: input.players.slice(),
    spike: input.spike ?? DEFAULT_SPIKE,
    activeAbilities: [],
    environment: { openDoors: [], activeInteractables: [] },
    economy: input.economy ?? [],
    matchScore: input.matchScore ?? null,
    events: [],
  };
  return deepFreeze(world);
}

/** Find a player by id, or undefined. */
export function getPlayer(world: WorldState, id: PlayerId): PlayerState | undefined {
  return world.players.find((p) => p.id === id);
}
