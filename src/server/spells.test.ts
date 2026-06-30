import assert from "node:assert/strict";
import { test } from "node:test";

import { createPlayer, createWeapon } from "../models/factory.js";
import { asSpellId } from "../models/ids.js";
import type { Monster } from "../models/monsters.js";
import { PortalRank } from "../models/portals.js";
import type { AggregatedStats } from "../models/stats.js";
import { type GeneratedSpell, WeaponType } from "../models/weapon.js";
import {
  SPELL_DAMAGE_MULTIPLIER,
  castSpell,
  computeSpellDamage,
  isSpellOnCooldown,
} from "./spells.js";

const statsWith = (force: number, agilite: number): AggregatedStats => ({
  rawStats: { force, agilite, pvBonus: 0 },
  pvMax: 100,
  pmMax: 50,
  activeAffixes: [],
  usableSpells: [],
});

const spell = (over: Partial<GeneratedSpell> = {}): GeneratedSpell => ({
  id: asSpellId("frappe-tournoyante"),
  name: "Frappe tournoyante",
  requiredType: WeaponType.Epee,
  unlockLevel: 1,
  cost: 15,
  cooldownMs: 3000,
  ...over,
});

const mob = (id: string, x: number, y: number, pv = 30): Monster => ({
  id,
  portalId: "p1",
  rank: PortalRank.C,
  pvMax: pv,
  pvActuels: pv,
  position: { x, y },
  force: 3,
  xpDonnee: 25,
  cible: null,
});

const swordWith = (s: GeneratedSpell, level = 1) =>
  createWeapon("Épée", WeaponType.Epee, {
    progression: { level, currentXp: 0, nextLevelXp: 100 },
    generatedSpells: [s],
  });

test("computeSpellDamage : Force×mult (mêlée), Agilité×mult (distance)", () => {
  const stats = statsWith(10, 4);
  assert.equal(
    computeSpellDamage(WeaponType.Epee, stats),
    10 * SPELL_DAMAGE_MULTIPLIER,
  );
  assert.equal(
    computeSpellDamage(WeaponType.Arc, stats),
    4 * SPELL_DAMAGE_MULTIPLIER,
  );
});

test("castSpell : succès — consomme les PM, arme le cooldown, cible la zone", () => {
  const s = spell();
  const weapon = swordWith(s);
  const player = createPlayer("Mage", { pmActuels: 50 });
  const monsters = [mob("near", 1, 0), mob("far", 5, 0)]; // rayon AoE = 2

  const result = castSpell(player, weapon, s, statsWith(10, 0), monsters, 1000);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.damage, 30); // Force 10 × 3
    assert.deepEqual(
      result.targets.map((m) => m.id),
      ["near"], // seul le monstre dans le rayon
    );
  }
  assert.equal(player.pmActuels, 35); // 50 - 15
  assert.equal(player.cooldownEndTimestamps[s.id], 1000 + 3000);
});

test("castSpell : échec si PM insuffisants (rien consommé)", () => {
  const s = spell({ cost: 15 });
  const weapon = swordWith(s);
  const player = createPlayer("Sec", { pmActuels: 10 });

  const result = castSpell(player, weapon, s, statsWith(10, 0), [], 1000);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "NOT_ENOUGH_MANA");
  assert.equal(player.pmActuels, 10); // inchangé
  assert.equal(player.cooldownEndTimestamps[s.id], undefined);
});

test("castSpell : échec si sous cooldown (rien consommé)", () => {
  const s = spell();
  const weapon = swordWith(s);
  const player = createPlayer("Recharge", {
    pmActuels: 50,
    cooldownEndTimestamps: { [s.id]: 5000 },
  });

  const result = castSpell(player, weapon, s, statsWith(10, 0), [], 1000);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "SPELL_ON_COOLDOWN");
  assert.equal(player.pmActuels, 50); // inchangé
});

test("castSpell : échec si le sort n'est pas sur l'arme équipée", () => {
  const s = spell();
  const weapon = createWeapon("Épée nue", WeaponType.Epee); // aucun sort
  const player = createPlayer("X", { pmActuels: 50 });

  const result = castSpell(player, weapon, s, statsWith(10, 0), [], 1000);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "SPELL_NOT_USABLE");
});

test("castSpell : échec si le niveau d'arme est insuffisant", () => {
  const s = spell({ unlockLevel: 5 });
  const weapon = swordWith(s, 1); // niveau 1 < 5
  const player = createPlayer("Faible", { pmActuels: 50 });

  const result = castSpell(player, weapon, s, statsWith(10, 0), [], 1000);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "SPELL_NOT_USABLE");
});

test("isSpellOnCooldown reflète le timestamp", () => {
  const player = createPlayer("T", {
    cooldownEndTimestamps: { sortA: 5000 },
  });
  assert.equal(isSpellOnCooldown(player, "sortA", 4000), true);
  assert.equal(isSpellOnCooldown(player, "sortA", 5000), false);
  assert.equal(isSpellOnCooldown(player, "sortB", 4000), false);
});
