import assert from "node:assert/strict";
import { test } from "node:test";

import { asPlayerId } from "../models/ids.js";
import { PortalRank } from "../models/portals.js";
import type { AggregatedStats } from "../models/stats.js";
import { WeaponType } from "../models/weapon.js";
import {
  ATTACK_BASE_DAMAGE,
  computePlayerDamage,
  distance,
  findNearestPlayer,
  stepToward,
  weaponRange,
} from "./combat.js";
import { MobManager, RANK_STATS, rollPortalRank } from "./mobs.js";

const statsWith = (force: number, agilite: number): AggregatedStats => ({
  rawStats: { force, agilite, pvBonus: 0 },
  pvMax: 100,
  activeAffixes: [],
  usableSpells: [],
});

// --- Fonctions pures ---

test("weaponRange : mêlée = 1, distance = 5", () => {
  assert.equal(weaponRange(WeaponType.Epee), 1);
  assert.equal(weaponRange(WeaponType.Bouclier), 1);
  assert.equal(weaponRange(WeaponType.Arc), 5);
  assert.equal(weaponRange(WeaponType.Baton), 5);
});

test("computePlayerDamage : Force pour l'Épée, Agilité pour l'Arc", () => {
  const stats = statsWith(10, 7);
  assert.equal(computePlayerDamage(WeaponType.Epee, stats), ATTACK_BASE_DAMAGE + 10);
  assert.equal(computePlayerDamage(WeaponType.Arc, stats), ATTACK_BASE_DAMAGE + 7);
});

test("stepToward : se rapproche sans dépasser la cible", () => {
  const moved = stepToward({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5);
  assert.equal(moved.x, 0.5);
  assert.equal(moved.y, 0);

  // Si la cible est plus proche que la vitesse, on l'atteint pile.
  const reached = stepToward({ x: 0, y: 0 }, { x: 0.3, y: 0 }, 0.5);
  assert.deepEqual(reached, { x: 0.3, y: 0 });
});

test("findNearestPlayer : choisit le plus proche dans le rayon, sinon null", () => {
  const p1 = { id: asPlayerId("p1"), position: { x: 3, y: 0 } };
  const p2 = { id: asPlayerId("p2"), position: { x: 1, y: 0 } };
  const origin = { x: 0, y: 0 };

  assert.equal(findNearestPlayer(origin, [p1, p2], 5)?.id, p2.id);
  // p2 hors rayon (radius 0.5) → seul p1... lui aussi hors rayon → null.
  assert.equal(findNearestPlayer(origin, [p1, p2], 0.5), null);
});

test("rollPortalRank respecte les seuils C/B/A/S", () => {
  assert.equal(rollPortalRank(() => 0.0), PortalRank.C);
  assert.equal(rollPortalRank(() => 0.59), PortalRank.C);
  assert.equal(rollPortalRank(() => 0.6), PortalRank.B);
  assert.equal(rollPortalRank(() => 0.85), PortalRank.A);
  assert.equal(rollPortalRank(() => 0.97), PortalRank.S);
  assert.equal(rollPortalRank(() => 0.999), PortalRank.S);
});

// --- MobManager : apparition, IA, combat ---

test("spawnPortal fait apparaître un portail et 3 monstres", () => {
  const mgr = new MobManager(500);
  const portal = mgr.spawnPortal(() => 0.5); // rang C, position (250,250)

  assert.equal(portal.rank, PortalRank.C);
  assert.equal(portal.open, true);
  assert.equal(mgr.getMonsters().length, 3);

  const mob = mgr.getMonsters()[0]!;
  assert.equal(mob.portalId, portal.id);
  assert.equal(mob.pvMax, RANK_STATS[PortalRank.C].pvMax);
  assert.equal(mob.force, RANK_STATS[PortalRank.C].force);
});

test("IA : un monstre traque le joueur le plus proche dans son rayon", () => {
  const mgr = new MobManager();
  mgr.spawnPortal(() => 0.5);
  const mob = mgr.getMonsters()[0]!;
  mob.position = { x: 3, y: 0 }; // à 3 cases du joueur (dans le rayon de 5)

  const playerId = asPlayerId("hero");
  const events = mgr.tick(50, [{ id: playerId, position: { x: 0, y: 0 } }]);

  assert.equal(events.length, 0, "pas encore à portée d'attaque");
  assert.equal(mob.cible, playerId, "le joueur devient la cible");
  assert.equal(mob.position.x, 2.5, "le monstre s'est rapproché de 0.5 case");
});

test("IA : à 1 case, le monstre attaque (avec cooldown) et inflige sa force", () => {
  const mgr = new MobManager();
  mgr.spawnPortal(() => 0.5); // rang C → force 3
  const mob = mgr.getMonsters()[0]!;
  mob.position = { x: 1, y: 0 }; // à portée d'attaque (ATTACK_RANGE = 1)

  const playerId = asPlayerId("hero");
  const players = [{ id: playerId, position: { x: 0, y: 0 } }];

  const first = mgr.tick(50, players);
  assert.equal(first.length, 1);
  assert.equal(first[0]?.playerId, playerId);
  assert.equal(first[0]?.amount, RANK_STATS[PortalRank.C].force);

  // Tick suivant rapproché → cooldown actif, pas de nouvelle attaque.
  const second = mgr.tick(50, players);
  assert.equal(second.length, 0);

  // Au-delà du cooldown (≥ 1000 ms), il frappe de nouveau.
  const third = mgr.tick(1000, players);
  assert.equal(third.length, 1);
});

test("damageMob réduit les PV puis tue et retire le monstre", () => {
  const mgr = new MobManager();
  mgr.spawnPortal(() => 0.5); // pv 30
  const mob = mgr.getMonsters()[0]!;

  const hit = mgr.damageMob(mob.id, 10);
  assert.equal(hit?.killed, false);
  assert.equal(mgr.getMonster(mob.id)?.pvActuels, 20);

  const kill = mgr.damageMob(mob.id, 25);
  assert.equal(kill?.killed, true);
  assert.equal(mgr.getMonster(mob.id), undefined);
});

test("distance euclidienne", () => {
  assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});
