import type { Player } from "../models/player.js";
import type { Weapon } from "../models/weapon.js";

/**
 * Contrat de persistance générique.
 *
 * Le serveur autoritaire ne dépend QUE de cette interface, jamais d'une
 * implémentation concrète. On pourra ainsi remplacer le stockage JSON par
 * SQLite/Postgres/Redis sans toucher à la logique de jeu.
 */
export interface Repository<TEntity, TId extends string> {
  get(id: TId): Promise<TEntity | undefined>;
  getAll(): Promise<TEntity[]>;
  save(entity: TEntity): Promise<void>;
  delete(id: TId): Promise<boolean>;
}

export type PlayerRepository = Repository<Player, Player["id"]>;
export type WeaponRepository = Repository<Weapon, Weapon["id"]>;

/**
 * Façade regroupant les dépôts du jeu. Injectée dans le serveur.
 */
export interface PersistenceLayer {
  players: PlayerRepository;
  weapons: WeaponRepository;
  /** Force l'écriture sur le support durable (no-op si déjà synchrone). */
  flush(): Promise<void>;
}
