import assert from "node:assert/strict";
import { test } from "node:test";

import { createMemoryPersistence } from "../persistence/memoryStore.js";
import { MaterialType } from "../models/materials.js";
import { PLAYER_SPEED, maxDistanceFor } from "../server/movement.js";
import { GameHub } from "./gameHub.js";
import {
  ClientMessageType,
  ErrorCode,
  ServerMessageType,
  type PlayerStateMessage,
  type ServerMessage,
} from "./protocol.js";

/** Crée un hub neuf + une session de test qui capture les messages envoyés. */
const setup = () => {
  const persistence = createMemoryPersistence();
  const hub = new GameHub(persistence);
  const sent: ServerMessage[] = [];
  const session = hub.register((m) => sent.push(m));
  return { persistence, hub, session, sent };
};

const lastOfType = <T extends ServerMessage["type"]>(
  sent: ServerMessage[],
  type: T,
): Extract<ServerMessage, { type: T }> | undefined =>
  [...sent].reverse().find((m) => m.type === type) as
    | Extract<ServerMessage, { type: T }>
    | undefined;

const json = (obj: unknown): string => JSON.stringify(obj);

test("CONNECT crée un joueur, une arme de départ et renvoie PLAYER_STATE", async () => {
  const { hub, session, sent, persistence } = setup();

  await hub.handleRaw(
    session,
    json({ type: ClientMessageType.Connect, pseudo: "Alice" }),
  );

  const state = lastOfType(sent, ServerMessageType.PlayerState);
  assert.ok(state, "un PLAYER_STATE doit être envoyé");
  assert.equal(state.player.pseudo, "Alice");
  assert.ok(session.playerId, "la session doit être liée au joueur");
  // L'arme de départ apporte +5 Force, cumulée dans les stats agrégées.
  assert.equal(state.stats.rawStats.force, 5);

  // Persistance : un joueur + une arme créés.
  assert.equal((await persistence.players.getAll()).length, 1);
  assert.equal((await persistence.weapons.getAll()).length, 1);

  // Un WORLD_UPDATE est aussi diffusé.
  assert.ok(lastOfType(sent, ServerMessageType.WorldUpdate));
});

test("CONNECT recharge un joueur existant (pas de doublon par pseudo)", async () => {
  const { hub, persistence } = setup();
  const s1 = hub.register(() => {});
  const s2 = hub.register(() => {});

  await hub.handleRaw(s1, json({ type: ClientMessageType.Connect, pseudo: "Bob" }));
  await hub.handleRaw(s2, json({ type: ClientMessageType.Connect, pseudo: "Bob" }));

  assert.equal((await persistence.players.getAll()).length, 1);
  assert.equal(s1.playerId, s2.playerId);
});

test("MOVE applique un déplacement autoritaire et renvoie lastProcessedSequence", async () => {
  const { hub, session, sent, persistence } = setup();
  await hub.handleRaw(
    session,
    json({ type: ClientMessageType.Connect, pseudo: "Alice" }),
  );

  // Direction +x pendant 100 ms → déplacement = PLAYER_SPEED * 0.1.
  await hub.handleRaw(
    session,
    json({
      type: ClientMessageType.Move,
      sequenceNumber: 7,
      dirX: 1,
      dirY: 0,
      deltaMs: 100,
    }),
  );

  const state = lastOfType(sent, ServerMessageType.PlayerState);
  assert.ok(state);
  assert.equal(state.lastProcessedSequence, 7);
  assert.ok(
    Math.abs(state.player.position.x - PLAYER_SPEED * 0.1) < 1e-6,
    `position.x attendu ~${PLAYER_SPEED * 0.1}, reçu ${state.player.position.x}`,
  );
  assert.ok(Math.abs(state.player.position.y) < 1e-6);

  const persisted = await persistence.players.get(session.playerId!);
  assert.ok(Math.abs((persisted?.position.x ?? 0) - PLAYER_SPEED * 0.1) < 1e-6);
});

test("MOVE triché (vecteur géant) est borné à la vitesse max", async () => {
  const { hub, session, sent, persistence } = setup();
  await hub.handleRaw(
    session,
    json({ type: ClientMessageType.Connect, pseudo: "Alice" }),
  );

  await hub.handleRaw(
    session,
    json({
      type: ClientMessageType.Move,
      sequenceNumber: 1,
      dirX: 99999,
      dirY: 0,
      deltaMs: 100,
    }),
  );

  // La position ne « téléporte » pas : déplacement borné à maxDistanceFor(100).
  const persisted = await persistence.players.get(session.playerId!);
  assert.ok(
    (persisted?.position.x ?? 0) <= maxDistanceFor(100) + 1e-6,
    `déplacement borné attendu ≤ ${maxDistanceFor(100)}, reçu ${persisted?.position.x}`,
  );
});

test("MOVE avant CONNECT renvoie une erreur NOT_CONNECTED", async () => {
  const { hub, session, sent } = setup();
  await hub.handleRaw(
    session,
    json({
      type: ClientMessageType.Move,
      sequenceNumber: 1,
      dirX: 1,
      dirY: 0,
      deltaMs: 16,
    }),
  );

  const error = lastOfType(sent, ServerMessageType.Error);
  assert.equal(error?.code, ErrorCode.NotConnected);
});

test("GAIN_XP_DEBUG fait monter l'arme équipée de niveau", async () => {
  const { hub, session, sent, persistence } = setup();
  await hub.handleRaw(
    session,
    json({ type: ClientMessageType.Connect, pseudo: "Alice" }),
  );

  // 100 XP = exactement un palier (nextLevelXp de départ = 100).
  await hub.handleRaw(
    session,
    json({ type: ClientMessageType.GainXpDebug, amount: 100 }),
  );

  const weapons = await persistence.weapons.getAll();
  assert.equal(weapons[0]?.progression.level, 2);

  // Stats agrégées : Force = 5 (base arme) + 3 (croissance Épée) = 8.
  const state = lastOfType(sent, ServerMessageType.PlayerState);
  assert.equal((state as PlayerStateMessage).stats.rawStats.force, 8);
});

test("JSON malformé renvoie une erreur sans crasher le hub", async () => {
  const { hub, session, sent } = setup();
  await hub.handleRaw(session, "{ ceci n'est pas du json");

  const error = lastOfType(sent, ServerMessageType.Error);
  assert.equal(error?.code, ErrorCode.MalformedJson);
});

test("un type d'intention inconnu renvoie UNKNOWN_TYPE", async () => {
  const { hub, session, sent } = setup();
  await hub.handleRaw(session, json({ type: "FLY_TO_MOON" }));

  const error = lastOfType(sent, ServerMessageType.Error);
  assert.equal(error?.code, ErrorCode.UnknownType);
});

test("la déconnexion retire la session du hub", async () => {
  const { hub, session } = setup();
  await hub.handleRaw(
    session,
    json({ type: ClientMessageType.Connect, pseudo: "Alice" }),
  );
  assert.equal(hub.connectionCount, 1);

  await hub.unregister(session);
  assert.equal(hub.connectionCount, 0);
});

test("PICKUP_LOOT à portée ajoute le matériau et retire le loot", async () => {
  const { hub, session, sent, persistence } = setup();
  await hub.handleRaw(
    session,
    json({ type: ClientMessageType.Connect, pseudo: "Alice" }),
  );

  // Loot déposé à la position du joueur (spawn 0,0) → à portée.
  const loot = hub.mobs.dropLoot({ x: 0, y: 0 });

  await hub.handleRaw(
    session,
    json({ type: ClientMessageType.PickupLoot, lootId: loot.id }),
  );

  const state = lastOfType(sent, ServerMessageType.PlayerState);
  assert.equal(state?.player.materials[loot.materialType], loot.amount);
  assert.equal(hub.mobs.getLoot(loot.id), undefined);

  const persisted = await persistence.players.get(session.playerId!);
  assert.equal(persisted?.materials[loot.materialType], loot.amount);
});

test("PICKUP_LOOT hors de portée renvoie OUT_OF_RANGE", async () => {
  const { hub, session, sent } = setup();
  await hub.handleRaw(
    session,
    json({ type: ClientMessageType.Connect, pseudo: "Alice" }),
  );

  const loot = hub.mobs.dropLoot({ x: 300, y: 300 }); // loin du spawn
  await hub.handleRaw(
    session,
    json({ type: ClientMessageType.PickupLoot, lootId: loot.id }),
  );

  const error = lastOfType(sent, ServerMessageType.Error);
  assert.equal(error?.code, ErrorCode.OutOfRange);
  assert.ok(hub.mobs.getLoot(loot.id), "le loot reste au sol");
});

test("INFUSE_WEAPON consomme les matériaux et ajoute un affixe", async () => {
  const { hub, session, sent, persistence } = setup();
  await hub.handleRaw(
    session,
    json({ type: ClientMessageType.Connect, pseudo: "Alice" }),
  );

  // On dote le joueur de 50 griffes.
  const player = await persistence.players.get(session.playerId!);
  player!.materials = { [MaterialType.GriffeChauveSouris]: 50 };
  await persistence.players.save(player!);

  await hub.handleRaw(
    session,
    json({
      type: ClientMessageType.InfuseWeapon,
      materialType: MaterialType.GriffeChauveSouris,
    }),
  );

  const state = lastOfType(sent, ServerMessageType.PlayerState);
  assert.equal(state?.player.materials[MaterialType.GriffeChauveSouris], 0);
  assert.equal(state?.weapons.slotPrincipal?.affixes.length, 1);
});

test("INFUSE_WEAPON sans matériaux renvoie NOT_ENOUGH_MATERIALS", async () => {
  const { hub, session, sent } = setup();
  await hub.handleRaw(
    session,
    json({ type: ClientMessageType.Connect, pseudo: "Alice" }),
  );

  await hub.handleRaw(
    session,
    json({
      type: ClientMessageType.InfuseWeapon,
      materialType: MaterialType.GriffeChauveSouris,
    }),
  );

  const error = lastOfType(sent, ServerMessageType.Error);
  assert.equal(error?.code, ErrorCode.NotEnoughMaterials);
});
