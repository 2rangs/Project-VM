import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildCatalog, requireWeapon, type WeaponCatalog } from "../../src/weapons.js";
import {
  AVERAGE_SKILLS,
  OPEN_POSTURE,
  type Combatant,
  type CombatSkills,
  type EngagePosture,
  type WeaponSpec,
} from "../../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));

export function loadWeapons(): WeaponCatalog {
  const raw = JSON.parse(readFileSync(resolve(here, "weapons.manual-approx.json"), "utf8"));
  return buildCatalog(raw.weapons as WeaponSpec[]);
}

export const WEAPONS = loadWeapons();
export const weapon = (name: string): WeaponSpec => requireWeapon(WEAPONS, name);

let n = 0;
export function mkCombatant(p: {
  id?: string;
  teamId?: string;
  weapon: string;
  health?: number;
  armor?: number;
  skills?: Partial<CombatSkills>;
  posture?: Partial<EngagePosture>;
  ammo?: number;
}): Combatant {
  return {
    id: p.id ?? `c${n++}`,
    teamId: p.teamId ?? "t",
    health: p.health ?? 100,
    armor: p.armor ?? 0,
    weapon: weapon(p.weapon),
    skills: { ...AVERAGE_SKILLS, ...p.skills },
    posture: { ...OPEN_POSTURE, ...p.posture },
    ammo: p.ammo,
  };
}
