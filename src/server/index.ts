import { createJsonPersistence } from "../persistence/index.js";
import type { PersistenceLayer } from "../persistence/index.js";
import { computeAggregatedStats, type Weapon } from "../models/index.js";
import { startNetworkServer } from "../network/index.js";

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
    await startNetworkServer({ port, persistence: ctx.persistence });
    console.log(`[server] Serveur WebSocket autoritaire en écoute sur :${port}`);
  })();
}
