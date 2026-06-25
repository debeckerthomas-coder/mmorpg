import { WebSocketServer, type WebSocket } from "ws";
import type { PersistenceLayer } from "../persistence/repository.js";
import { GameHub } from "./gameHub.js";
import type { ServerMessage } from "./protocol.js";

export interface NetworkServerOptions {
  port: number;
  persistence: PersistenceLayer;
  /** Hôte d'écoute (par défaut toutes les interfaces). */
  host?: string;
}

export interface NetworkServer {
  readonly wss: WebSocketServer;
  readonly hub: GameHub;
  /** Ferme proprement le serveur et toutes les connexions. */
  close(): Promise<void>;
}

/**
 * Monte le serveur WebSocket autoritaire et branche chaque socket sur le
 * `GameHub`. Gère le cycle de vie : connexion, message (parsing sécurisé via
 * le hub), déconnexion, erreurs socket.
 *
 * Le serveur écoute immédiatement ; attendez l'évènement `listening` via la
 * promesse renvoyée par `startNetworkServer` si besoin.
 */
export const createNetworkServer = (
  options: NetworkServerOptions,
): NetworkServer => {
  const { port, persistence, host } = options;
  const hub = new GameHub(persistence);
  const wss = new WebSocketServer({ port, host });

  wss.on("connection", (socket: WebSocket) => {
    const session = hub.register((message: ServerMessage) => {
      // La socket peut s'être fermée entre-temps : on protège l'envoi.
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    });

    socket.on("message", (data) => {
      // `data` peut être Buffer / ArrayBuffer / string ; on normalise en texte.
      const raw = typeof data === "string" ? data : data.toString();
      // handleRaw ne lève jamais, mais on attrape par prudence (await détaché).
      void hub.handleRaw(session, raw).catch((err) => {
        console.error("[network] erreur de traitement du message:", err);
      });
    });

    socket.on("close", () => {
      void hub.unregister(session);
    });

    socket.on("error", (err) => {
      console.error(`[network] erreur socket (${session.id}):`, err.message);
    });
  });

  const close = (): Promise<void> =>
    new Promise((resolve, reject) => {
      for (const client of wss.clients) client.close();
      wss.close((err) => (err ? reject(err) : resolve()));
    });

  return { wss, hub, close };
};

/**
 * Démarre le serveur et résout une fois qu'il est en écoute.
 */
export const startNetworkServer = (
  options: NetworkServerOptions,
): Promise<NetworkServer> =>
  new Promise((resolve, reject) => {
    const server = createNetworkServer(options);
    server.wss.once("listening", () => resolve(server));
    server.wss.once("error", reject);
  });
