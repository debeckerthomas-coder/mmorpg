import type { Player } from "../models/player.js";
import type { Weapon } from "../models/weapon.js";
import { JsonFileRepository, dataFile } from "./jsonStore.js";
import type { PersistenceLayer } from "./repository.js";

export * from "./repository.js";
export * from "./jsonStore.js";
export * from "./memoryStore.js";

/**
 * Construit la couche de persistance par défaut (stockage JSON sur disque).
 */
export const createJsonPersistence = (baseDir = "data"): PersistenceLayer => {
  const players = new JsonFileRepository<Player, Player["id"]>(
    dataFile("players.json", baseDir),
  );
  const weapons = new JsonFileRepository<Weapon, Weapon["id"]>(
    dataFile("weapons.json", baseDir),
  );

  return {
    players,
    weapons,
    // Les écritures sont déjà synchronisées à chaque save() ; flush est un
    // point d'extension pour un futur cache d'écriture différé (batching).
    flush: async () => {},
  };
};
