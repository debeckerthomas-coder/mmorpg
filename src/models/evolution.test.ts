import assert from "node:assert/strict";
import { test } from "node:test";

import { createWeapon } from "./factory.js";
import {
  type Rng,
  gainXp,
  rollRarity,
  xpForLevel,
} from "./evolution.js";
import { Rarity, WeaponType } from "./weapon.js";

/**
 * RNG déterministe : renvoie successivement les valeurs fournies (en boucle si
 * épuisé) pour piloter précisément les tirages du moteur d'évolution.
 *
 * Rappel de l'ordre des tirages par niveau gagné :
 *   1. rareté (rollRarity)
 *   2. affixe vs sort (comparé à spellChance)
 *   3. index dans le pool
 */
const seq = (values: number[]): Rng => {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
};

test("xpForLevel(1) vaut 100 (cohérent avec la factory)", () => {
  assert.equal(xpForLevel(1), 100);
  assert.equal(xpForLevel(2), 150);
});

test("une arme monte d'un niveau quand l'XP atteint le seuil", () => {
  const sword = createWeapon("Épée courte", WeaponType.Epee);
  assert.equal(sword.progression.level, 1);

  // rng : Commun, puis affixe (0.9 >= spellChance 0.4), puis index 0.
  const result = gainXp(sword, 100, seq([0.0, 0.9, 0.0]));

  assert.equal(result.leveledUp, true);
  assert.equal(result.levelsGained, 1);
  assert.equal(result.newLevel, 2);
  assert.equal(sword.progression.level, 2);
  // XP consommée par le palier (100), reste 0.
  assert.equal(sword.progression.currentXp, 0);
  // Croissance des stats d'une Épée : +3 Force, +1 pvBonus.
  assert.equal(sword.rawStats.force, 3);
  assert.equal(sword.rawStats.pvBonus, 1);
});

test("un affixe est bien attribué lors d'une montée de niveau", () => {
  const sword = createWeapon("Épée longue", WeaponType.Epee);

  const result = gainXp(sword, 100, seq([0.0, 0.9, 0.0]));

  assert.equal(sword.affixes.length, 1);
  const affix = sword.affixes[0]!;
  assert.equal(affix.code, "CRIT_CHANCE");
  assert.equal(affix.rarity, Rarity.Commun);
  assert.equal(affix.power, 5); // RARITY_POWER[Commun]

  // La récompense reportée correspond à l'affixe attaché.
  const reward = result.rewards[0]!;
  assert.equal(reward.kind, "affix");
  assert.equal(reward.rarity, Rarity.Commun);
});

test("un sort actif peut être généré selon le tirage et le type d'arme", () => {
  const bow = createWeapon("Arc long", WeaponType.Arc);

  // rng : rareté, puis 0.0 < spellChance(0.5) => sort, puis index 0.
  gainXp(bow, 100, seq([0.0, 0.0, 0.0]));

  assert.equal(bow.generatedSpells.length, 1);
  const spell = bow.generatedSpells[0]!;
  assert.equal(spell.name, "Flèche de Feu");
  assert.equal(spell.requiredType, WeaponType.Arc);
  assert.equal(spell.unlockLevel, 2);
});

test("plusieurs niveaux sont gagnés en un seul appel si l'XP suffit", () => {
  const shield = createWeapon("Bouclier", WeaponType.Bouclier);

  // Niveau 1->2 coûte 100, 2->3 coûte 150 → 250 XP = 2 niveaux.
  const result = gainXp(shield, 250, seq([0.0, 0.9, 0.0]));

  assert.equal(result.levelsGained, 2);
  assert.equal(result.newLevel, 3);
  assert.equal(result.rewards.length, 2);
  assert.equal(shield.progression.currentXp, 0);
  // Bouclier : +8 pvBonus par niveau × 2 = 16.
  assert.equal(shield.rawStats.pvBonus, 16);
});

test("aucune montée de niveau si l'XP est insuffisante", () => {
  const staff = createWeapon("Bâton", WeaponType.Baton);
  const result = gainXp(staff, 50, seq([0.0, 0.0, 0.0]));

  assert.equal(result.leveledUp, false);
  assert.equal(result.levelsGained, 0);
  assert.equal(staff.progression.level, 1);
  assert.equal(staff.progression.currentXp, 50);
  assert.equal(staff.affixes.length, 0);
  assert.equal(staff.generatedSpells.length, 0);
});

test("la table de rareté respecte les seuils de probabilité", () => {
  assert.equal(rollRarity(() => 0.0), Rarity.Commun); // < 0.60
  assert.equal(rollRarity(() => 0.5), Rarity.Commun);
  assert.equal(rollRarity(() => 0.6), Rarity.Rare); // [0.60, 0.85)
  assert.equal(rollRarity(() => 0.84), Rarity.Rare);
  assert.equal(rollRarity(() => 0.85), Rarity.Epique); // [0.85, 0.97)
  assert.equal(rollRarity(() => 0.97), Rarity.Legendaire); // [0.97, 1.0)
  assert.equal(rollRarity(() => 0.999), Rarity.Legendaire);
});

test("gainXp refuse un montant négatif", () => {
  const sword = createWeapon("Épée", WeaponType.Epee);
  assert.throws(() => gainXp(sword, -10), RangeError);
});
