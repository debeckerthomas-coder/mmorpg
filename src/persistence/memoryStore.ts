import type { Player } from "../models/player.js";
import type { Weapon } from "../models/weapon.js";
import type { PersistenceLayer, Repository } from "./repository.js";

/**
 * Dépôt générique en mémoire (volatile).
 *
 * Utile pour les tests (réseau notamment) et le développement, sans toucher au
 * disque. Implémente le même contrat `Repository` que `JsonFileRepository`, de
 * sorte que la logique de jeu/serveur reste agnostique du support.
 */
export class MemoryRepository<TEntity extends { id: TId }, TId extends string>
  implements Repository<TEntity, TId>
{
  private readonly store = new Map<TId, TEntity>();

  async get(id: TId): Promise<TEntity | undefined> {
    return this.store.get(id);
  }

  async getAll(): Promise<TEntity[]> {
    return [...this.store.values()];
  }

  async save(entity: TEntity): Promise<void> {
    this.store.set(entity.id, entity);
  }

  async delete(id: TId): Promise<boolean> {
    return this.store.delete(id);
  }
}

/** Construit une couche de persistance entièrement en mémoire. */
export const createMemoryPersistence = (): PersistenceLayer => ({
  players: new MemoryRepository<Player, Player["id"]>(),
  weapons: new MemoryRepository<Weapon, Weapon["id"]>(),
  flush: async () => {},
});
