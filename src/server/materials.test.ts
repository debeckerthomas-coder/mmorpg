import assert from "node:assert/strict";
import { test } from "node:test";

import { createPlayer, createWeapon } from "../models/factory.js";
import { MaterialType } from "../models/materials.js";
import { WeaponType } from "../models/weapon.js";
import { MobManager } from "./mobs.js";
import {
  INFUSION_RECIPES,
  addMaterials,
  canInfuse,
  infuseWeapon,
  isWithinPickupRange,
  rollLootAmount,
  rollLootMaterial,
} from "./materials.js";

// --- Loot ---

test("rollLootAmount reste dans [1, 5]", () => {
  assert.equal(rollLootAmount(() => 0), 1);
  assert.equal(rollLootAmount(() => 0.999), 5);
});

test("rollLootMaterial : 50/50 entre les deux matériaux", () => {
  assert.equal(rollLootMaterial(() => 0), MaterialType.GriffeChauveSouris);
  assert.equal(rollLootMaterial(() => 0.9), MaterialType.CaillouBrillant);
});

test("MobManager : dropLoot apparaît, getLoot/removeLoot fonctionnent", () => {
  const mgr = new MobManager();
  const loot = mgr.dropLoot({ x: 10, y: 10 }, () => 0); // Griffe, quantité 1
  assert.equal(loot.materialType, MaterialType.GriffeChauveSouris);
  assert.equal(loot.amount, 1);
  assert.equal(mgr.getLoots().length, 1);
  assert.equal(mgr.getLoot(loot.id)?.id, loot.id);

  const removed = mgr.removeLoot(loot.id);
  assert.equal(removed?.id, loot.id);
  assert.equal(mgr.getLoot(loot.id), undefined);
});

// --- Ramassage : portée + inventaire ---

test("isWithinPickupRange : accepte à portée, rejette trop loin", () => {
  assert.equal(isWithinPickupRange({ x: 0, y: 0 }, { x: 1, y: 1 }), true); // ~1.41 ≤ 2
  assert.equal(isWithinPickupRange({ x: 0, y: 0 }, { x: 5, y: 0 }), false);
});

test("addMaterials incrémente l'inventaire du joueur", () => {
  const player = createPlayer("Looter");
  addMaterials(player, MaterialType.GriffeChauveSouris, 3);
  addMaterials(player, MaterialType.GriffeChauveSouris, 2);
  assert.equal(player.materials[MaterialType.GriffeChauveSouris], 5);
});

// --- Infusion ---

test("infuseWeapon (griffes) : consomme 50 et ajoute un affixe", () => {
  const player = createPlayer("Forgeron", {
    materials: { [MaterialType.GriffeChauveSouris]: 50 },
  });
  const weapon = createWeapon("Épée", WeaponType.Epee);
  assert.equal(weapon.affixes.length, 0);

  const result = infuseWeapon(player, weapon, MaterialType.GriffeChauveSouris, () => 0);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.effect, "affix");
  assert.equal(player.materials[MaterialType.GriffeChauveSouris], 0);
  assert.equal(weapon.affixes.length, 1);
});

test("infuseWeapon (cailloux) : consomme 20 et ajoute un sort", () => {
  const player = createPlayer("Forgeron", {
    materials: { [MaterialType.CaillouBrillant]: 25 },
  });
  const weapon = createWeapon("Arc", WeaponType.Arc);
  assert.equal(weapon.generatedSpells.length, 0);

  const result = infuseWeapon(player, weapon, MaterialType.CaillouBrillant, () => 0);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.effect, "spell");
  assert.equal(player.materials[MaterialType.CaillouBrillant], 5);
  assert.equal(weapon.generatedSpells.length, 1);
});

test("infuseWeapon échoue si ressources insuffisantes (rien consommé)", () => {
  const player = createPlayer("Pauvre", {
    materials: { [MaterialType.GriffeChauveSouris]: 10 },
  });
  const weapon = createWeapon("Épée", WeaponType.Epee);

  const result = infuseWeapon(player, weapon, MaterialType.GriffeChauveSouris);
  assert.equal(result.ok, false);
  assert.equal(player.materials[MaterialType.GriffeChauveSouris], 10); // inchangé
  assert.equal(weapon.affixes.length, 0); // arme inchangée
});

test("canInfuse reflète le coût de la recette", () => {
  const recipe = INFUSION_RECIPES[MaterialType.GriffeChauveSouris];
  assert.equal(recipe.cost, 50);

  const rich = createPlayer("R", { materials: { [MaterialType.GriffeChauveSouris]: 50 } });
  const poor = createPlayer("P", { materials: { [MaterialType.GriffeChauveSouris]: 49 } });
  assert.equal(canInfuse(rich, MaterialType.GriffeChauveSouris), true);
  assert.equal(canInfuse(poor, MaterialType.GriffeChauveSouris), false);
});
