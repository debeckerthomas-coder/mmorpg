import { createJsonPersistence } from "../persistence/index.js";
import type { PersistenceLayer } from "../persistence/index.js";
import { computeAggregatedStats, type Weapon } from "../models/index.js";

/**
 * Contexte du serveur autoritaire.
 *
 * Le serveur fait autorité sur tout l'état du monde : aucune décision de jeu
 * (déplacement, combat, équipement...) n'est validée côté client. Le client
 * n'enverra que des INTENTIONS, et le serveur appliquera/rejettera.
 *
 * Pour cette première brique, on n'expose pas encore de couche réseau
 * (WebSocket) : on se contente d'initialiser la persistance et d'offrir des
 * utilitaires de lecture/agrégation qui serviront de socle aux briques
 * suivantes.
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

// Point d'entrée exécutable : démarre le contexte serveur.
// (La boucle réseau sera ajoutée dans une brique ultérieure.)
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const ctx = createServer();
  void ctx.persistence.players.getAll().then((players) => {
    console.log(
      `[server] Persistance initialisée — ${players.length} joueur(s) chargé(s).`,
    );
  });
}
