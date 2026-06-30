import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { WebSocket } from "ws";

import { createMemoryPersistence } from "../persistence/memoryStore.js";
import { GameHub } from "../network/gameHub.js";
import { startNetworkServer } from "../network/server.js";
import {
  ServerMessageType,
  type ServerMessage,
  type WorldUpdateMessage,
} from "../network/protocol.js";
import { PLAYER_SPEED } from "./movement.js";

// ---------------------------------------------------------------------------
// Tests au niveau du hub (deux sessions = deux sockets simulées)
// ---------------------------------------------------------------------------

const setup2 = () => {
  const persistence = createMemoryPersistence();
  const hub = new GameHub(persistence);
  const sentA: ServerMessage[] = [];
  const sentB: ServerMessage[] = [];
  const a = hub.register((m) => sentA.push(m));
  const b = hub.register((m) => sentB.push(m));
  return { persistence, hub, a, b, sentA, sentB };
};

const lastWorld = (sent: ServerMessage[]): WorldUpdateMessage | undefined =>
  [...sent].reverse().find((m) => m.type === ServerMessageType.WorldUpdate) as
    | WorldUpdateMessage
    | undefined;

const json = (o: unknown) => JSON.stringify(o);

test("le déplacement de A est diffusé dans le WORLD_UPDATE reçu par B", async () => {
  const { hub, a, b, sentB } = setup2();
  await hub.handleRaw(a, json({ type: "CONNECT", pseudo: "Alice" }));
  await hub.handleRaw(b, json({ type: "CONNECT", pseudo: "Bob" }));

  sentB.length = 0; // on n'observe que ce qui suit
  await hub.handleRaw(
    a,
    json({ type: "MOVE", sequenceNumber: 1, dirX: 1, dirY: 0, deltaMs: 100 }),
  );

  const world = lastWorld(sentB);
  assert.ok(world, "B doit recevoir un WORLD_UPDATE");
  assert.equal(world.players.length, 2);
  const alice = world.players.find((p) => p.pseudo === "Alice");
  assert.ok(alice, "Alice doit figurer dans le monde de B");
  assert.ok(Math.abs(alice.position.x - PLAYER_SPEED * 0.1) < 1e-6);
});

test("WORLD_UPDATE porte PV (actuels/max) et statut PK de chaque joueur", async () => {
  const { hub, a, b, sentB } = setup2();
  await hub.handleRaw(a, json({ type: "CONNECT", pseudo: "Alice" }));
  await hub.handleRaw(b, json({ type: "CONNECT", pseudo: "Bob" }));

  const world = lastWorld(sentB);
  assert.ok(world);
  for (const p of world.players) {
    assert.equal(typeof p.pvActuels, "number");
    assert.equal(typeof p.pvMax, "number");
    assert.equal(typeof p.isPk, "boolean");
  }
});

test("la déconnexion de A le retire du WORLD_UPDATE diffusé à B", async () => {
  const { hub, a, b, sentB } = setup2();
  await hub.handleRaw(a, json({ type: "CONNECT", pseudo: "Alice" }));
  await hub.handleRaw(b, json({ type: "CONNECT", pseudo: "Bob" }));
  assert.equal(hub.connectionCount, 2);

  sentB.length = 0;
  await hub.unregister(a); // déconnexion de A

  assert.equal(hub.connectionCount, 1);
  const world = lastWorld(sentB);
  assert.ok(world, "B est notifié de la disparition de A");
  assert.ok(world.players.every((p) => p.pseudo !== "Alice"));
  assert.equal(world.players.length, 1);
  assert.equal(world.players[0]?.pseudo, "Bob");
});

// ---------------------------------------------------------------------------
// Test d'intégration : deux vraies sockets WebSocket
// ---------------------------------------------------------------------------

interface Client {
  ws: WebSocket;
  waitForWorld: (
    pred: (p: WorldUpdateMessage["players"][number]) => boolean,
  ) => Promise<WorldUpdateMessage>;
}

const openClient = (port: number, pseudo: string): Promise<Client> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const waiters: {
      pred: (p: WorldUpdateMessage["players"][number]) => boolean;
      resolve: (m: WorldUpdateMessage) => void;
    }[] = [];

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type !== ServerMessageType.WorldUpdate) return;
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (msg.players.some(waiters[i]!.pred)) {
          waiters[i]!.resolve(msg);
          waiters.splice(i, 1);
        }
      }
    });
    ws.on("error", reject);

    const onFirst = (data: Buffer) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type !== ServerMessageType.PlayerState) return;
      ws.off("message", onFirst);
      resolve({
        ws,
        waitForWorld: (pred) =>
          new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error("timeout world")), 3000);
            waiters.push({
              pred,
              resolve: (m) => {
                clearTimeout(timer);
                res(m);
              },
            });
          }),
      });
    };
    ws.on("message", onFirst);
    ws.on("open", () => ws.send(json({ type: "CONNECT", pseudo })));
  });

test("intégration deux sockets : le déplacement de A parvient à B", async () => {
  const server = await startNetworkServer({
    port: 0,
    persistence: createMemoryPersistence(),
  });
  const port = (server.wss.address() as AddressInfo).port;

  const A = await openClient(port, "Alice");
  const B = await openClient(port, "Bob");

  try {
    // On s'abonne AVANT d'émettre le mouvement (évite la course).
    const worldP = B.waitForWorld(
      (p) => p.pseudo === "Alice" && p.position.x > 0,
    );
    A.ws.send(
      json({ type: "MOVE", sequenceNumber: 1, dirX: 1, dirY: 0, deltaMs: 100 }),
    );

    const world = await worldP;
    const alice = world.players.find((p) => p.pseudo === "Alice");
    assert.ok(alice && alice.position.x > 0);
    assert.equal(typeof alice.pvMax, "number");
  } finally {
    A.ws.close();
    B.ws.close();
    await server.close();
  }
});
