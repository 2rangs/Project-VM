/**
 * Branded identifier types.
 *
 * Handoff §13.2 requires that identities are NOT merged by raw name strings
 * (player renames, transfers, duplicate names, temporary nicknames). Branding the
 * id types makes it a compile-time error to pass a raw string or the wrong kind of
 * id where a specific identity is expected. The brand is erased at runtime — the
 * value is still a plain string.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type MatchId = Brand<string, "MatchId">;
export type RoundId = Brand<string, "RoundId">;
export type PlayerId = Brand<string, "PlayerId">;
export type TeamId = Brand<string, "TeamId">;
export type AgentId = Brand<string, "AgentId">;
export type MapId = Brand<string, "MapId">;
export type TournamentId = Brand<string, "TournamentId">;
export type PatchVersion = Brand<string, "PatchVersion">;
export type WeaponId = Brand<string, "WeaponId">;
export type AbilityId = Brand<string, "AbilityId">;
export type EventId = Brand<string, "EventId">;

/** Constructors. These are the only sanctioned way to mint a branded id. */
export const asMatchId = (v: string): MatchId => v as MatchId;
export const asRoundId = (v: string): RoundId => v as RoundId;
export const asPlayerId = (v: string): PlayerId => v as PlayerId;
export const asTeamId = (v: string): TeamId => v as TeamId;
export const asAgentId = (v: string): AgentId => v as AgentId;
export const asMapId = (v: string): MapId => v as MapId;
export const asTournamentId = (v: string): TournamentId => v as TournamentId;
export const asPatchVersion = (v: string): PatchVersion => v as PatchVersion;
export const asWeaponId = (v: string): WeaponId => v as WeaponId;
export const asAbilityId = (v: string): AbilityId => v as AbilityId;
export const asEventId = (v: string): EventId => v as EventId;

/** Which side of the round a team is playing. Side swaps at the half (DECISION rules in game-rules). */
export type Side = "attack" | "defense";
