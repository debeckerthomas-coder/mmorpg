import { createJsonPersistence } from "../persistence/index.js";
import type { PersistenceLayer } from "../persistence/index.js";
import { computeAggregatedStats, type Weapon } from "../models/index.js";
import { startNetworkServer } from "../network/index.js";
import { GameLoop, TICK_INTERVAL_MS, TICK_RATE } from "./gameloop.js";
import { MobManager } from "./mobs.js";

/**
 * Contexte du serveur autoritaire.
 *
 * Le serveur fait autorité sur tout l'état du monde : aucune décision de jeu
 * (déplacement, combat, équipement...) n'est validée côté client. Le client
 * n'envoie que des INTENTIONS, et le serveur applique/rejette puis diffuse
 * l'état faisant foi (cf. couche réseau dans src/network/).
 */
export interface ServerContext {
  persistence: PersistenceLayer;
}

export const createServer = (
  persistence: PersistenceLayer = createJsonPersistence(),
): ServerContext => ({ persistence });

/**
 * Résout les stats effectives d'un joueur en s'appuyant sur la persistance
 * pour récupérer les armes équipées. Illustre l'usage de la règle d'agrégation
 * côté serveur autoritaire.
 */
export const resolvePlayerStats = async (
  ctx: ServerContext,
  playerId: Parameters<PersistenceLayer["players"]["get"]>[0],
) => {
  const player = await ctx.persistence.players.get(playerId);
  if (!player) return undefined;

  // Pré-charge les armes des deux slots pour une résolution synchrone.
  const weaponCache = new Map<string, Weapon>();
  for (const slot of [
    player.equipment.slotPrincipal,
    player.equipment.slotSecondaire,
  ]) {
    if (slot && !weaponCache.has(slot)) {
      const w = await ctx.persistence.weapons.get(slot);
      if (w) weaponCache.set(slot, w);
    }
  }

  return computeAggregatedStats(player, (id) => weaponCache.get(id));
};

/** Port d'écoute WebSocket (configurable via la variable d'env PORT). */
export const DEFAULT_PORT = 8080;

// Point d'entrée exécutable : démarre la persistance puis le serveur WebSocket.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const ctx = createServer();
  const port = Number(process.env["PORT"] ?? DEFAULT_PORT);

  void (async () => {
    const players = await ctx.persistence.players.getAll();
    console.log(
      `[server] Persistance initialisée — ${players.length} joueur(s) chargé(s).`,
    );
    // Bestiaire partagé entre le hub (attaques/diffusion) et la game loop (IA).
    const mobs = new MobManager();
    const net = await startNetworkServer({
      port,
      persistence: ctx.persistence,
      mobManager: mobs,
    });
    console.log(`[server] Serveur WebSocket autoritaire en écoute sur :${port}`);

    // Boucle de jeu : IA des monstres, dégâts, régénération.
    // Après chaque tick, on diffuse l'état du monde aux clients connectés.
    const loop = new GameLoop({
      persistence: ctx.persistence,
      participants: net.hub,
      mobManager: mobs,
      onTick: () => {
        void net.hub.broadcastWorld();
      },
    });
    loop.start();
    console.log(
      `[server] Game loop démarrée (${TICK_RATE} ticks/s, ${TICK_INTERVAL_MS} ms/tick).`,
    );

    // Ouvre un premier portail puis en fait apparaître régulièrement (max 5).
    mobs.spawnPortal();
    const MAX_PORTALS = 5;
    setInterval(() => {
      if (mobs.getPortals().length < MAX_PORTALS) mobs.spawnPortal();
    }, 20000).unref?.();
    console.log("[server] Bestiaire actif (portails & monstres).");
  })();
}
