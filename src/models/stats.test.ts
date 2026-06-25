import assert from "node:assert/strict";
import { test } from "node:test";

import { createPlayer, createWeapon } from "./factory.js";
import { asAffixId, asSpellId } from "./ids.js";
import { computeAggregatedStats } from "./stats.js";
import { Rarity, WeaponType, type Weapon } from "./weapon.js";

const makeResolver = (weapons: Weapon[]) => {
  const map = new Map(weapons.map((w) => [w.id as string, w]));
  return (id: string): Weapon | undefined => map.get(id);
};

test("les stats brutes des deux slots se cumulent", () => {
  const principal = createWeapon("Épée", WeaponType.Epee, {
    rawStats: { force: 10, agilite: 2, pvBonus: 50 },
  });
  const secondaire = createWeapon("Bouclier", WeaponType.Bouclier, {
    rawStats: { force: 1, agilite: 0, pvBonus: 30 },
  });

  const player = createPlayer("Hero", {
    pvBase: 100,
    equipment: {
      slotPrincipal: principal.id,
      slotSecondaire: secondaire.id,
    },
  });

  const agg = computeAggregatedStats(
    player,
    makeResolver([principal, secondaire]),
  );

  assert.equal(agg.rawStats.force, 11);
  assert.equal(agg.rawStats.pvBonus, 80);
  assert.equal(agg.pvMax, 180); // 100 base + 80 bonus
});

test("affixes et sorts ne sont actifs que depuis le slot principal", () => {
  const affixPrincipal = {
    id: asAffixId("a1"),
    code: "VOL_DE_VIE",
    label: "Vol de vie",
    rarity: Rarity.Rare,
    power: 5,
  };
  const affixSecondaire = {
    id: asAffixId("a2"),
    code: "REGEN",
    label: "Régénération",
    rarity: Rarity.Magique,
    power: 3,
  };

  const spell = {
    id: asSpellId("s1"),
    name: "Coup tranchant",
    requiredType: WeaponType.Epee,
    unlockLevel: 1,
    cost: 10,
    cooldownMs: 1000,
  };

  const principal = createWeapon("Épée", WeaponType.Epee, {
    affixes: [affixPrincipal],
    generatedSpells: [spell],
  });
  const secondaire = createWeapon("Arc", WeaponType.Arc, {
    affixes: [affixSecondaire],
    generatedSpells: [
      {
        id: asSpellId("s2"),
        name: "Tir",
        requiredType: WeaponType.Arc,
        unlockLevel: 1,
        cost: 5,
        cooldownMs: 800,
      },
    ],
  });

  const player = createPlayer("Hero", {
    equipment: {
      slotPrincipal: principal.id,
      slotSecondaire: secondaire.id,
    },
  });

  const agg = computeAggregatedStats(
    player,
    makeResolver([principal, secondaire]),
  );

  assert.equal(agg.activeAffixes.length, 1);
  assert.equal(agg.activeAffixes[0]?.code, "VOL_DE_VIE");
  assert.equal(agg.usableSpells.length, 1);
  assert.equal(agg.usableSpells[0]?.name, "Coup tranchant");
});

test("un sort non débloqué par le niveau n'est pas utilisable", () => {
  const spell = {
    id: asSpellId("s3"),
    name: "Frappe ultime",
    requiredType: WeaponType.Epee,
    unlockLevel: 5,
    cost: 30,
    cooldownMs: 5000,
  };
  const principal = createWeapon("Épée", WeaponType.Epee, {
    progression: { level: 1, currentXp: 0, nextLevelXp: 100 },
    generatedSpells: [spell],
  });

  const player = createPlayer("Hero", {
    equipment: { slotPrincipal: principal.id, slotSecondaire: null },
  });

  const agg = computeAggregatedStats(player, makeResolver([principal]));
  assert.equal(agg.usableSpells.length, 0);
});
