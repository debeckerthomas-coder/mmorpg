import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocket } from "ws";

import { createMemoryPersistence } from "../persistence/memoryStore.js";
import { startNetworkServer } from "./server.js";
import { ClientMessageType, ServerMessageType } from "./protocol.js";

/**
 * Test d'intégration bout-en-bout : on monte un vrai serveur WebSocket sur un
 * port éphémère (0), on connecte un client `ws` réel et on vérifie qu'une
 * intention CONNECT déclenche bien un PLAYER_STATE diffusé sur la socket.
 */
test("intégration WebSocket : CONNECT renvoie un PLAYER_STATE", async () => {
  const server = await startNetworkServer({
    port: 0,
    persistence: createMemoryPersistence(),
  });

  const addr = server.wss.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  assert.ok(port > 0, "le serveur doit écouter sur un port");

  const client = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    const playerState = await new Promise<Record<string, any>>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("timeout: pas de PLAYER_STATE reçu")),
          3000,
        );
        client.on("open", () => {
          client.send(
            JSON.stringify({ type: ClientMessageType.Connect, pseudo: "Net" }),
          );
        });
        client.on("message", (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === ServerMessageType.PlayerState) {
            clearTimeout(timer);
            resolve(msg);
          }
        });
        client.on("error", reject);
      },
    );

    assert.equal(playerState["player"].pseudo, "Net");
    assert.ok(playerState["stats"], "les stats agrégées doivent être présentes");
  } finally {
    client.close();
    await server.close();
  }
});
