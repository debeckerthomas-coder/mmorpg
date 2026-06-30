import { rollAffix, rollSpell, type Rng } from "../models/evolution.js";
import { MaterialType } from "../models/materials.js";
import type { Player } from "../models/player.js";
import type { Point2D } from "../models/portals.js";
import type { Weapon } from "../models/weapon.js";
import { distance } from "./combat.js";

/**
 * Règles d'artisanat (Brique 9) — fonctions PURES, testables.
 *
 * Ramassage de matériaux (portée + inventaire) et infusion d'arme (recettes :
 * 50 griffes → affixe aléatoire, 20 cailloux → sort aléatoire).
 */

/** Portée (en cases) pour ramasser un loot au sol (mêlée). */
export const LOOT_PICKUP_RANGE = 2;

/** Quantité de matériaux lâchée par un monstre mort. */
export const LOOT_AMOUNT_MIN = 1;
export const LOOT_AMOUNT_MAX = 5;

/** Tire la quantité de matériaux d'un drop (entier dans [MIN, MAX]). */
export const rollLootAmount = (rng: Rng = Math.random): number =>
  LOOT_AMOUNT_MIN +
  Math.floor(rng() * (LOOT_AMOUNT_MAX - LOOT_AMOUNT_MIN + 1));

/** Tire le type de matériau d'un drop (50/50). */
export const rollLootMaterial = (rng: Rng = Math.random): MaterialType =>
  rng() < 0.5
    ? MaterialType.GriffeChauveSouris
    : MaterialType.CaillouBrillant;

/** Un loot est-il à portée de ramassage depuis la position du joueur ? */
export const isWithinPickupRange = (
  playerPos: Point2D,
  lootPos: Point2D,
): boolean => distance(playerPos, lootPos) <= LOOT_PICKUP_RANGE;

/** Ajoute des matériaux à l'inventaire d'un joueur (mute le joueur). */
export const addMaterials = (
  player: Player,
  materialType: MaterialType,
  amount: number,
): void => {
  player.materials[materialType] = (player.materials[materialType] ?? 0) + amount;
};

// ---------------------------------------------------------------------------
// Infusion
// ---------------------------------------------------------------------------

export type InfusionEffect = "affix" | "spell";

export interface InfusionRecipe {
  cost: number;
  effect: InfusionEffect;
}

/**
 * Recettes d'infusion : combien de matériaux consommer et quel jet appliquer.
 * - 50 griffes de chauve-souris → un jet d'affixe aléatoire (Brique 2).
 * - 20 cailloux brillants       → un jet de sort aléatoire (Brique 2).
 */
export const INFUSION_RECIPES: Record<MaterialType, InfusionRecipe> = {
  [MaterialType.GriffeChauveSouris]: { cost: 50, effect: "affix" },
  [MaterialType.CaillouBrillant]: { cost: 20, effect: "spell" },
};

export type InfusionResult =
  | { ok: true; effect: InfusionEffect }
  | { ok: false; reason: string };

/** A-t-on assez de matériaux pour infuser avec ce type ? */
export const canInfuse = (
  player: Player,
  materialType: MaterialType,
): boolean => {
  const recipe = INFUSION_RECIPES[materialType];
  return (player.materials[materialType] ?? 0) >= recipe.cost;
};

/**
 * Infuse l'arme avec un matériau : consomme le coût, applique le jet
 * (affixe ou sort aléatoire) à l'arme. MUTE `player` et `weapon`.
 * Échoue (sans rien consommer) si les ressources sont insuffisantes.
 */
export const infuseWeapon = (
  player: Player,
  weapon: Weapon,
  materialType: MaterialType,
  rng: Rng = Math.random,
): InfusionResult => {
  const recipe = INFUSION_RECIPES[materialType];
  const have = player.materials[materialType] ?? 0;
  if (have < recipe.cost) {
    return {
      ok: false,
      reason: `Il faut ${recipe.cost} ${materialType} (vous en avez ${have})`,
    };
  }

  player.materials[materialType] = have - recipe.cost;

  if (recipe.effect === "affix") {
    weapon.affixes.push(rollAffix(weapon, rng));
  } else {
    weapon.generatedSpells.push(rollSpell(weapon, rng));
  }
  return { ok: true, effect: recipe.effect };
};
