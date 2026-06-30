import assert from "node:assert/strict";
import { test } from "node:test";

import { createPlayer } from "../models/factory.js";
import type { PlayerId } from "../models/ids.js";
import type { Player } from "../models/player.js";
import { createMemoryPersistence } from "../persistence/memoryStore.js";
import { GameLoop, TICK_INTERVAL_MS, TICK_RATE } from "./gameloop.js";

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Participants stub : renvoie une liste fixe d'IDs connectés. */
const participantsOf = (...ids: PlayerId[]) => ({
  connectedPlayerIds: () => ids,
});

const setup = async (player: Player) => {
  const persistence = createMemoryPersistence();
  await persistence.players.save(player);
  return { persistence };
};

test("le tick rate est de 20 ticks/s (50 ms par tick)", () => {
  assert.equal(TICK_RATE, 20);
  assert.equal(TICK_INTERVAL_MS, 50);
});

test("la régénération des PV s'applique après quelques ticks", async () => {
  const player = createPlayer("Alice", { pvBase: 100, pvActuels: 50 });
  const { persistence } = await setup(player);

  const loop = new GameLoop({
    persistence,
    participants: participantsOf(player.id),
    regenPerSecond: 0.2, // 20 %/s
    // tick par défaut = 50 ms → regen/tick = 100 * 0.2 * 0.05 = 1.0 PV
  });

  for (let i = 0; i < 5; i++) await loop.tick();

  const updated = await persistence.players.get(player.id);
  assert.equal(loop.tickCount, 5);
  // 50 + 5 × 1.0 = 55
  assert.equal(updated?.pvActuels, 55);
});

test("la régénération ne dépasse jamais les PV max", async () => {
  const player = createPlayer("Bob", { pvBase: 100, pvActuels: 99.5 });
  const { persistence } = await setup(player);

  const loop = new GameLoop({
    persistence,
    participants: participantsOf(player.id),
    regenPerSecond: 5, // énorme : doit saturer au max
  });

  await loop.tick();
  let updated = await persistence.players.get(player.id);
  assert.equal(updated?.pvActuels, 100);

  // Joueur déjà au max : nouvel état inchangé.
  await loop.tick();
  updated = await persistence.players.get(player.id);
  assert.equal(updated?.pvActuels, 100);
});

test("aucune régénération si le joueur est déjà au maximum", async () => {
  const player = createPlayer("Max", { pvBase: 100, pvActuels: 100 });
  const { persistence } = await setup(player);

  const loop = new GameLoop({
    persistence,
    participants: participantsOf(player.id),
    regenPerSecond: 0.5,
  });

  const info = await loop.tick();
  // Le joueur est bien traité, mais ses PV ne bougent pas.
  assert.equal(info.playersProcessed, 1);
  const updated = await persistence.players.get(player.id);
  assert.equal(updated?.pvActuels, 100);
});

test("le temps s'écoule : start() avance les ticks, stop() les arrête", async () => {
  const player = createPlayer("Tic", { pvBase: 100, pvActuels: 10 });
  const { persistence } = await setup(player);

  const loop = new GameLoop({
    persistence,
    participants: participantsOf(player.id),
    tickIntervalMs: 10,
    regenPerSecond: 0.1,
  });

  assert.equal(loop.isRunning, false);
  loop.start();
  assert.equal(loop.isRunning, true);

  await delay(60); // ~6 ticks à 10 ms
  loop.stop();
  assert.equal(loop.isRunning, false);

  const ticksAfterStop = loop.tickCount;
  assert.ok(ticksAfterStop > 0, "des ticks doivent s'être écoulés");

  // Plus aucun tick après stop().
  await delay(40);
  assert.equal(loop.tickCount, ticksAfterStop);
});

test("start() est idempotent", () => {
  const persistence = createMemoryPersistence();
  const loop = new GameLoop({
    persistence,
    participants: participantsOf(),
    tickIntervalMs: 1000,
  });
  loop.start();
  loop.start(); // ne crée pas un second timer
  assert.equal(loop.isRunning, true);
  loop.stop();
  assert.equal(loop.isRunning, false);
});

test("la boucle expose le bestiaire et un portail y fait apparaître des mobs", async () => {
  const persistence = createMemoryPersistence();
  const loop = new GameLoop({ persistence, participants: participantsOf() });

  // rng déterministe : rang C, position (250, 250).
  loop.mobs.spawnPortal(() => 0.5);

  assert.equal(loop.mobs.getPortals().length, 1);
  assert.equal(loop.mobs.getMonsters().length, 3);

  // Un tick sans joueur connecté ne fait pas disparaître les monstres.
  await loop.tick();
  assert.equal(loop.mobs.getMonsters().length, 3);
});
