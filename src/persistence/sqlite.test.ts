import assert from "node:assert/strict";
import { test } from "node:test";

import { createPlayer, createWeapon } from "../models/factory.js";
import { asAffixId, asSpellId } from "../models/ids.js";
import { Rarity, WeaponType } from "../models/weapon.js";
import { createSqlitePersistence } from "./sqliteStore.js";

/** Crée une arme richement dotée (affixes + sorts) pour les round-trips. */
const richWeapon = () =>
  createWeapon("Lame runique", WeaponType.Epee, {
    progression: { level: 4, currentXp: 80, nextLevelXp: 337 },
    rawStats: { force: 18, agilite: 3, pvBonus: 12 },
    affixes: [
      {
        id: asAffixId("affix-crit"),
        code: "CRIT_CHANCE",
        label: "+% Critique",
        rarity: Rarity.Rare,
        power: 12,
      },
      {
        id: asAffixId("affix-vol"),
        code: "LIFESTEAL",
        label: "Vol de vie",
        rarity: Rarity.Epique,
        power: 25,
      },
    ],
    generatedSpells: [
      {
        id: asSpellId("spell-coup"),
        name: "Coup tranchant",
        requiredType: WeaponType.Epee,
        unlockLevel: 2,
        cost: 10,
        cooldownMs: 1500,
      },
    ],
  });

test("round-trip : un joueur équipé d'une arme (affixes+sorts) est rechargé à l'identique", async () => {
  const db = createSqlitePersistence(":memory:");
  try {
    const weapon = richWeapon();
    const player = createPlayer("Sung", {
      pk: true,
      pvActuels: 73,
      position: { x: 12, y: 34, zone: "donjon" },
      equipment: { slotPrincipal: weapon.id, slotSecondaire: null },
    });

    // L'arme doit exister avant le joueur (contrainte de clé étrangère).
    await db.weapons.save(weapon);
    await db.players.save(player);

    const reloadedWeapon = await db.weapons.get(weapon.id);
    const reloadedPlayer = await db.players.get(player.id);

    assert.deepEqual(reloadedWeapon, weapon);
    assert.deepEqual(reloadedPlayer, player);
  } finally {
    db.close();
  }
});

test("save remplace les affixes/sorts sans les dupliquer", async () => {
  const db = createSqlitePersistence(":memory:");
  try {
    const weapon = richWeapon();
    await db.weapons.save(weapon);

    // Nouvelle sauvegarde après ajout d'un affixe : pas de doublon.
    weapon.affixes.push({
      id: asAffixId("affix-extra"),
      code: "ARMOR_PEN",
      label: "+% Pénétration",
      rarity: Rarity.Commun,
      power: 5,
    });
    await db.weapons.save(weapon);

    const reloaded = await db.weapons.get(weapon.id);
    assert.equal(reloaded?.affixes.length, 3);
    assert.equal(reloaded?.generatedSpells.length, 1);
  } finally {
    db.close();
  }
});

test("getAll et delete fonctionnent", async () => {
  const db = createSqlitePersistence(":memory:");
  try {
    const w1 = createWeapon("Arc court", WeaponType.Arc);
    const w2 = createWeapon("Bouclier", WeaponType.Bouclier);
    await db.weapons.save(w1);
    await db.weapons.save(w2);

    assert.equal((await db.weapons.getAll()).length, 2);

    assert.equal(await db.weapons.delete(w1.id), true);
    assert.equal(await db.weapons.get(w1.id), undefined);
    assert.equal((await db.weapons.getAll()).length, 1);

    // delete d'un id inexistant renvoie false.
    assert.equal(await db.weapons.delete(w1.id), false);
  } finally {
    db.close();
  }
});

test("supprimer une arme retire ses affixes/sorts (ON DELETE CASCADE)", async () => {
  const db = createSqlitePersistence(":memory:");
  try {
    const weapon = richWeapon();
    await db.weapons.save(weapon);
    await db.weapons.delete(weapon.id);

    // Re-créer une arme du même id ne doit ramener aucun affixe résiduel.
    const fresh = createWeapon("Neuve", WeaponType.Epee);
    const sameId = { ...fresh, id: weapon.id };
    await db.weapons.save(sameId);

    const reloaded = await db.weapons.get(weapon.id);
    assert.equal(reloaded?.affixes.length, 0);
    assert.equal(reloaded?.generatedSpells.length, 0);
  } finally {
    db.close();
  }
});

test("un joueur sans arme (slots vides) se recharge correctement", async () => {
  const db = createSqlitePersistence(":memory:");
  try {
    const player = createPlayer("Solo");
    await db.players.save(player);
    const reloaded = await db.players.get(player.id);
    assert.deepEqual(reloaded, player);
    assert.equal(reloaded?.equipment.slotPrincipal, null);
  } finally {
    db.close();
  }
});
