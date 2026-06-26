import {
  asPlayerId,
  asWeaponId,
  newId,
  type PlayerId,
  type WeaponId,
} from "./ids.js";
import { emptyEquipment, type Player, type Position } from "./player.js";
import {
  emptyRawStats,
  WeaponType,
  type Weapon,
  type WeaponProgression,
} from "./weapon.js";

const DEFAULT_SPAWN: Position = { x: 0, y: 0, zone: "spawn" };
const DEFAULT_PV_BASE = 100;

/**
 * Crée un nouveau joueur avec des valeurs par défaut saines.
 */
export const createPlayer = (
  pseudo: string,
  overrides: Partial<Omit<Player, "id" | "pseudo">> = {},
): Player => {
  const pvBase = overrides.pvBase ?? DEFAULT_PV_BASE;
  return {
    id: asPlayerId(newId()) as PlayerId,
    pseudo,
    pk: overrides.pk ?? false,
    pvBase,
    pvActuels: overrides.pvActuels ?? pvBase,
    position: overrides.position ?? { ...DEFAULT_SPAWN },
    equipment: overrides.equipment ?? emptyEquipment(),
    materials: overrides.materials ?? {},
  };
};

const startingProgression = (): WeaponProgression => ({
  level: 1,
  currentXp: 0,
  nextLevelXp: 100,
});

/**
 * Crée une nouvelle arme de niveau 1, sans affixes ni sorts par défaut
 * (la génération aléatoire d'affixes/sorts sera une brique ultérieure).
 */
export const createWeapon = (
  name: string,
  type: WeaponType,
  overrides: Partial<Omit<Weapon, "id" | "name" | "type">> = {},
): Weapon => ({
  id: asWeaponId(newId()) as WeaponId,
  name,
  type,
  progression: overrides.progression ?? startingProgression(),
  rawStats: overrides.rawStats ?? emptyRawStats(),
  affixes: overrides.affixes ?? [],
  generatedSpells: overrides.generatedSpells ?? [],
});
