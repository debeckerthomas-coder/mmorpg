import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Repository } from "./repository.js";

/**
 * Dépôt générique persistant dans un fichier JSON.
 *
 * Stratégie :
 *  - L'état complet de la collection est chargé en mémoire au démarrage
 *    (jeu de données "micro" → tient en RAM), ce qui rend les lectures
 *    instantanées pour le serveur autoritaire.
 *  - Les écritures sont atomiques : on écrit dans un fichier temporaire puis
 *    `rename` (atomique sur le même volume) pour éviter de corrompre la
 *    sauvegarde en cas d'arrêt brutal.
 *
 * Cette implémentation est volontairement simple ; elle pourra être remplacée
 * par un vrai SGBD (cf. ARCHITECTURE.md) sans impacter le reste du code.
 */
export class JsonFileRepository<TEntity extends { id: TId }, TId extends string>
  implements Repository<TEntity, TId>
{
  private readonly cache = new Map<TId, TEntity>();
  private loaded = false;

  constructor(private readonly filePath: string) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const content = await readFile(this.filePath, "utf-8");
      const entities = JSON.parse(content) as TEntity[];
      for (const entity of entities) {
        this.cache.set(entity.id, entity);
      }
    } catch (err: unknown) {
      // Fichier absent au premier démarrage → collection vide.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const data = JSON.stringify([...this.cache.values()], null, 2);
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, data, "utf-8");
    await rename(tmp, this.filePath);
  }

  async get(id: TId): Promise<TEntity | undefined> {
    await this.ensureLoaded();
    return this.cache.get(id);
  }

  async getAll(): Promise<TEntity[]> {
    await this.ensureLoaded();
    return [...this.cache.values()];
  }

  async save(entity: TEntity): Promise<void> {
    await this.ensureLoaded();
    this.cache.set(entity.id, entity);
    await this.persist();
  }

  async delete(id: TId): Promise<boolean> {
    await this.ensureLoaded();
    const existed = this.cache.delete(id);
    if (existed) await this.persist();
    return existed;
  }
}

/** Construit un chemin de fichier de données sous le dossier `data/`. */
export const dataFile = (name: string, baseDir = "data"): string =>
  join(process.cwd(), baseDir, name);
