// @pv/game-data — single typed runtime loader for PROJECT V game data.
// Used by the Match Runner (PV-3) and desktop (PV-6). Data is a committed JSON
// bundle under ./data (regenerate with tools/catalog-builder/build_game_data.py).
//
// Weapons: data/weapons.generated.json is produced at build from valorant-api
// (licence unclear -> gitignored). When absent, a small manual-approx table is
// used so the package still works offline.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeAgentSlug, normalizeId } from "./normalize.ts";
import type {
  AbilityEffect, Agent, BundleMeta, Player, RosterEntry, Team, Weapon,
} from "./types.ts";

export * from "./types.ts";
export { normalizeAgentSlug, normalizeId } from "./normalize.ts";

const DATA = new URL("../data/", import.meta.url);
function load<T>(name: string): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(name, DATA)), "utf8")) as T;
}
function loadOptional<T>(name: string): T | null {
  try { return load<T>(name); } catch { return null; }
}

// --- manual-approx weapon fallback (public prices; used only if generated file absent) ---
const WEAPON_FALLBACK: Weapon[] = ([
  ["classic", "Classic", "Sidearms", 0], ["shorty", "Shorty", "Sidearms", 150],
  ["frenzy", "Frenzy", "Sidearms", 450], ["ghost", "Ghost", "Sidearms", 500],
  ["sheriff", "Sheriff", "Sidearms", 800], ["stinger", "Stinger", "SMGs", 1100],
  ["spectre", "Spectre", "SMGs", 1600], ["bucky", "Bucky", "Shotguns", 850],
  ["judge", "Judge", "Shotguns", 1850], ["bulldog", "Bulldog", "Rifles", 2050],
  ["guardian", "Guardian", "Rifles", 2250], ["phantom", "Phantom", "Rifles", 2900],
  ["vandal", "Vandal", "Rifles", 2900], ["marshal", "Marshal", "Snipers", 950],
  ["outlaw", "Outlaw", "Snipers", 2400], ["operator", "Operator", "Snipers", 4700],
  ["ares", "Ares", "Heavy", 1600], ["odin", "Odin", "Heavy", 3200],
] as const).map(([id, name, category, cost]) => ({ id, name, category, cost, provenance: "manual-approx" as const }));

// --- lazy singletons ---
let _weapons: Map<string, Weapon> | null = null;
let _agents: Map<string, Agent> | null = null;
let _effects: AbilityEffect[] | null = null;
let _players: Map<string, Player> | null = null;
let _teams: Map<string, Team> | null = null;
let _rosters: Record<string, RosterEntry[]> | null = null;

function weapons(): Map<string, Weapon> {
  if (_weapons) return _weapons;
  const gen = loadOptional<Array<Omit<Weapon, "provenance">>>("weapons.generated.json");
  const list: Weapon[] = gen ? gen.map((w) => ({ ...w, provenance: "api" as const })) : WEAPON_FALLBACK;
  _weapons = new Map();
  for (const w of list) {
    _weapons.set(w.id.toLowerCase(), w);
    _weapons.set(w.name.toLowerCase(), w);
  }
  return _weapons;
}
function agents(): Map<string, Agent> {
  if (_agents) return _agents;
  _agents = new Map(load<Agent[]>("agents.json").map((a) => [normalizeAgentSlug(a.slug), a]));
  return _agents;
}
function players(): Map<string, Player> {
  if (_players) return _players;
  _players = new Map(load<Player[]>("players.json").map((p) => [normalizeId(p.playerId), p]));
  return _players;
}
function teams(): Map<string, Team> {
  if (_teams) return _teams;
  _teams = new Map(load<Team[]>("teams.json").map((t) => [normalizeId(t.teamId), t]));
  return _teams;
}
function rosters(): Record<string, RosterEntry[]> {
  if (_rosters) return _rosters;
  _rosters = load<Record<string, RosterEntry[]>>("rosters.json");
  return _rosters;
}

// --- public API ---
export function meta(): BundleMeta { return load<BundleMeta>("meta.json"); }

export function getWeapon(idOrName: string): Weapon | undefined {
  return weapons().get(idOrName.trim().toLowerCase());
}
export function listWeapons(): Weapon[] {
  return [...new Set(weapons().values())];
}
export function getAgent(slug: string): Agent | undefined {
  return agents().get(normalizeAgentSlug(slug));
}
export function listAgents(): Agent[] { return [...agents().values()]; }

export function getAbilityEffects(agentSlug: string): AbilityEffect[] {
  if (!_effects) _effects = load<AbilityEffect[]>("ability-effects.json");
  const name = getAgent(agentSlug)?.name;
  const slug = normalizeAgentSlug(agentSlug);
  return _effects.filter((e) => e.agentName === name || e.abilityId.startsWith(`${slug}:`));
}

export function getPlayer(playerId: string): Player | undefined {
  return players().get(normalizeId(playerId));
}
export function listPlayers(): Player[] { return [...players().values()]; }

export function getTeam(teamId: string): (Team & { roster: RosterEntry[] }) | undefined {
  const t = teams().get(normalizeId(teamId));
  if (!t) return undefined;
  return { ...t, roster: rosters()[normalizeId(teamId)] ?? [] };
}
export function listTeams(): Team[] { return [...teams().values()]; }

/** Teams that have a usable (>=5 player) recent roster — i.e. simulatable. */
export function listSimulatableTeams(): Array<Team & { roster: RosterEntry[] }> {
  const r = rosters();
  return listTeams()
    .filter((t) => (r[normalizeId(t.teamId)]?.length ?? 0) >= 5)
    .map((t) => ({ ...t, roster: r[normalizeId(t.teamId)]! }));
}

export function getAscentComps(): unknown { return load("ascent-comps.json"); }
export function getAscentTactics(): unknown { return load("ascent-tactics.json"); }
export function getPatchMeta(): unknown { return load("patch-meta.json"); }
