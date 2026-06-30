import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

import {
  asAffixId,
  asPlayerId,
  asSpellId,
  asWeaponId,
} from "../models/ids.js";
import type { Player } from "../models/player.js";
import {
  type Affix,
  type GeneratedSpell,
  type RawStats,
  Rarity,
  type Weapon,
  WeaponType,
} from "../models/weapon.js";
import { dataFile } from "./jsonStore.js";
import type {
  PersistenceLayer,
  PlayerRepository,
  Repository,
  WeaponRepository,
} from "./repository.js";

/**
 * Persistance relationnelle SQLite (Brique 7).
 *
 * Remplace `JsonFileRepository` derrière le même contrat `Repository`, si bien
 * que le reste du serveur (GameHub, GameLoop) ne voit aucune différence.
 *
 * Driver : `better-sqlite3` (synchrone, performant). Les méthodes restent
 * `async` pour respecter l'interface, mais s'exécutent en synchrone.
 */

// ---------------------------------------------------------------------------
// Schéma SQL
// ---------------------------------------------------------------------------

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS weapons (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL,
  level         INTEGER NOT NULL,
  current_xp    REAL NOT NULL,
  next_level_xp REAL NOT NULL,
  raw_stats     TEXT NOT NULL            -- JSON de RawStats (force/agilite/pvBonus + extras)
);

CREATE TABLE IF NOT EXISTS weapon_affixes (
  id        TEXT PRIMARY KEY,
  weapon_id TEXT NOT NULL,
  code      TEXT NOT NULL,
  label     TEXT NOT NULL,
  rarity    TEXT NOT NULL,
  power     REAL NOT NULL,
  FOREIGN KEY (weapon_id) REFERENCES weapons(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS weapon_spells (
  id            TEXT PRIMARY KEY,
  weapon_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  required_type TEXT NOT NULL,
  unlock_level  INTEGER NOT NULL,
  cost          REAL NOT NULL,
  cooldown_ms   REAL NOT NULL,
  FOREIGN KEY (weapon_id) REFERENCES weapons(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS players (
  id              TEXT PRIMARY KEY,
  pseudo          TEXT NOT NULL,
  pk              INTEGER NOT NULL,       -- 0/1 (booléen)
  pv_base         REAL NOT NULL,
  pv_actuels      REAL NOT NULL,
  pm_base         REAL NOT NULL DEFAULT 50,   -- Points de Mana (Brique 10)
  pm_actuels      REAL NOT NULL DEFAULT 50,
  pos_x           REAL NOT NULL,
  pos_y           REAL NOT NULL,
  zone            TEXT NOT NULL,
  slot_principal  TEXT,                   -- FK nullable vers weapons(id)
  slot_secondaire TEXT,
  materials       TEXT NOT NULL DEFAULT '{}', -- JSON: inventaire de matériaux
  cooldowns       TEXT NOT NULL DEFAULT '{}', -- JSON: cooldowns de sorts (Brique 10)
  FOREIGN KEY (slot_principal)  REFERENCES weapons(id) ON DELETE SET NULL,
  FOREIGN KEY (slot_secondaire) REFERENCES weapons(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_affixes_weapon ON weapon_affixes(weapon_id);
CREATE INDEX IF NOT EXISTS idx_spells_weapon  ON weapon_spells(weapon_id);
`;

export type Db = Database.Database;

/** Ouvre (ou crée) la base, active les contraintes et applique le schéma. */
export const initDatabase = (path: string): Db => {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  return db;
};

/** Migrations légères pour les bases créées avant l'ajout d'une colonne. */
const migrate = (db: Db): void => {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(players)").all() as { name: string }[]).map(
      (c) => c.name,
    ),
  );
  const addColumn = (name: string, ddl: string): void => {
    if (!columns.has(name)) db.exec(`ALTER TABLE players ADD COLUMN ${ddl}`);
  };
  addColumn("materials", "materials TEXT NOT NULL DEFAULT '{}'");
  addColumn("pm_base", "pm_base REAL NOT NULL DEFAULT 50");
  addColumn("pm_actuels", "pm_actuels REAL NOT NULL DEFAULT 50");
  addColumn("cooldowns", "cooldowns TEXT NOT NULL DEFAULT '{}'");
};

// ---------------------------------------------------------------------------
// Lignes SQL (typage des rows)
// ---------------------------------------------------------------------------

interface WeaponRow {
  id: string;
  name: string;
  type: string;
  level: number;
  current_xp: number;
  next_level_xp: number;
  raw_stats: string;
}

interface AffixRow {
  id: string;
  code: string;
  label: string;
  rarity: string;
  power: number;
}

interface SpellRow {
  id: string;
  name: string;
  required_type: string;
  unlock_level: number;
  cost: number;
  cooldown_ms: number;
}

interface PlayerRow {
  id: string;
  pseudo: string;
  pk: number;
  pv_base: number;
  pv_actuels: number;
  pm_base: number;
  pm_actuels: number;
  pos_x: number;
  pos_y: number;
  zone: string;
  slot_principal: string | null;
  slot_secondaire: string | null;
  materials: string;
  cooldowns: string;
}

// ---------------------------------------------------------------------------
// Repository des armes (avec jointures affixes/sorts)
// ---------------------------------------------------------------------------

export class SqliteWeaponRepository
  implements Repository<Weapon, Weapon["id"]>
{
  private readonly selectOne: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectAffixes: Database.Statement;
  private readonly selectSpells: Database.Statement;
  private readonly upsert: Database.Statement;
  private readonly deleteAffixes: Database.Statement;
  private readonly deleteSpells: Database.Statement;
  private readonly insertAffix: Database.Statement;
  private readonly insertSpell: Database.Statement;
  private readonly deleteOne: Database.Statement;
  /** Transaction de sauvegarde (typée comme une simple fonction). */
  private readonly saveTx: (weapon: Weapon) => void;

  constructor(private readonly db: Db) {
    this.selectOne = db.prepare("SELECT * FROM weapons WHERE id = ?");
    this.selectAll = db.prepare("SELECT * FROM weapons");
    this.selectAffixes = db.prepare(
      "SELECT * FROM weapon_affixes WHERE weapon_id = ?",
    );
    this.selectSpells = db.prepare(
      "SELECT * FROM weapon_spells WHERE weapon_id = ?",
    );
    this.upsert = db.prepare(
      `INSERT INTO weapons (id, name, type, level, current_xp, next_level_xp, raw_stats)
       VALUES (@id, @name, @type, @level, @currentXp, @nextLevelXp, @rawStats)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, type = excluded.type, level = excluded.level,
         current_xp = excluded.current_xp, next_level_xp = excluded.next_level_xp,
         raw_stats = excluded.raw_stats`,
    );
    this.deleteAffixes = db.prepare(
      "DELETE FROM weapon_affixes WHERE weapon_id = ?",
    );
    this.deleteSpells = db.prepare(
      "DELETE FROM weapon_spells WHERE weapon_id = ?",
    );
    this.insertAffix = db.prepare(
      `INSERT INTO weapon_affixes (id, weapon_id, code, label, rarity, power)
       VALUES (@id, @weaponId, @code, @label, @rarity, @power)`,
    );
    this.insertSpell = db.prepare(
      `INSERT INTO weapon_spells (id, weapon_id, name, required_type, unlock_level, cost, cooldown_ms)
       VALUES (@id, @weaponId, @name, @requiredType, @unlockLevel, @cost, @cooldownMs)`,
    );
    this.deleteOne = db.prepare("DELETE FROM weapons WHERE id = ?");

    // Sauvegarde atomique : upsert de l'arme puis remplacement complet des
    // affixes/sorts (delete + insert) dans une transaction SQL.
    this.saveTx = db.transaction((weapon: Weapon) => {
      this.upsert.run({
        id: weapon.id,
        name: weapon.name,
        type: weapon.type,
        level: weapon.progression.level,
        currentXp: weapon.progression.currentXp,
        nextLevelXp: weapon.progression.nextLevelXp,
        rawStats: JSON.stringify(weapon.rawStats),
      });
      this.deleteAffixes.run(weapon.id);
      this.deleteSpells.run(weapon.id);
      for (const affix of weapon.affixes) {
        this.insertAffix.run({
          id: affix.id,
          weaponId: weapon.id,
          code: affix.code,
          label: affix.label,
          rarity: affix.rarity,
          power: affix.power,
        });
      }
      for (const spell of weapon.generatedSpells) {
        this.insertSpell.run({
          id: spell.id,
          weaponId: weapon.id,
          name: spell.name,
          requiredType: spell.requiredType,
          unlockLevel: spell.unlockLevel,
          cost: spell.cost,
          cooldownMs: spell.cooldownMs,
        });
      }
    });
  }

  private hydrate(row: WeaponRow): Weapon {
    const affixes = (this.selectAffixes.all(row.id) as AffixRow[]).map(
      (a): Affix => ({
        id: asAffixId(a.id),
        code: a.code,
        label: a.label,
        rarity: a.rarity as Rarity,
        power: a.power,
      }),
    );
    const generatedSpells = (this.selectSpells.all(row.id) as SpellRow[]).map(
      (s): GeneratedSpell => ({
        id: asSpellId(s.id),
        name: s.name,
        requiredType: s.required_type as WeaponType,
        unlockLevel: s.unlock_level,
        cost: s.cost,
        cooldownMs: s.cooldown_ms,
      }),
    );
    return {
      id: asWeaponId(row.id),
      name: row.name,
      type: row.type as WeaponType,
      progression: {
        level: row.level,
        currentXp: row.current_xp,
        nextLevelXp: row.next_level_xp,
      },
      rawStats: JSON.parse(row.raw_stats) as RawStats,
      affixes,
      generatedSpells,
    };
  }

  async get(id: Weapon["id"]): Promise<Weapon | undefined> {
    const row = this.selectOne.get(id) as WeaponRow | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  async getAll(): Promise<Weapon[]> {
    return (this.selectAll.all() as WeaponRow[]).map((row) => this.hydrate(row));
  }

  async save(weapon: Weapon): Promise<void> {
    this.saveTx(weapon);
  }

  async delete(id: Weapon["id"]): Promise<boolean> {
    return this.deleteOne.run(id).changes > 0;
  }
}

// ---------------------------------------------------------------------------
// Repository des joueurs
// ---------------------------------------------------------------------------

export class SqlitePlayerRepository
  implements Repository<Player, Player["id"]>
{
  private readonly selectOne: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly upsert: Database.Statement;
  private readonly deleteOne: Database.Statement;

  constructor(private readonly db: Db) {
    this.selectOne = db.prepare("SELECT * FROM players WHERE id = ?");
    this.selectAll = db.prepare("SELECT * FROM players");
    this.upsert = db.prepare(
      `INSERT INTO players
         (id, pseudo, pk, pv_base, pv_actuels, pm_base, pm_actuels, pos_x, pos_y, zone, slot_principal, slot_secondaire, materials, cooldowns)
       VALUES
         (@id, @pseudo, @pk, @pvBase, @pvActuels, @pmBase, @pmActuels, @posX, @posY, @zone, @slotPrincipal, @slotSecondaire, @materials, @cooldowns)
       ON CONFLICT(id) DO UPDATE SET
         pseudo = excluded.pseudo, pk = excluded.pk, pv_base = excluded.pv_base,
         pv_actuels = excluded.pv_actuels, pm_base = excluded.pm_base,
         pm_actuels = excluded.pm_actuels, pos_x = excluded.pos_x, pos_y = excluded.pos_y,
         zone = excluded.zone, slot_principal = excluded.slot_principal,
         slot_secondaire = excluded.slot_secondaire, materials = excluded.materials,
         cooldowns = excluded.cooldowns`,
    );
    this.deleteOne = db.prepare("DELETE FROM players WHERE id = ?");
  }

  private hydrate(row: PlayerRow): Player {
    return {
      id: asPlayerId(row.id),
      pseudo: row.pseudo,
      pk: row.pk !== 0,
      pvBase: row.pv_base,
      pvActuels: row.pv_actuels,
      pmBase: row.pm_base,
      pmActuels: row.pm_actuels,
      position: { x: row.pos_x, y: row.pos_y, zone: row.zone },
      equipment: {
        slotPrincipal: row.slot_principal
          ? asWeaponId(row.slot_principal)
          : null,
        slotSecondaire: row.slot_secondaire
          ? asWeaponId(row.slot_secondaire)
          : null,
      },
      materials: JSON.parse(row.materials) as Record<string, number>,
      cooldownEndTimestamps: JSON.parse(row.cooldowns) as Record<
        string,
        number
      >,
    };
  }

  async get(id: Player["id"]): Promise<Player | undefined> {
    const row = this.selectOne.get(id) as PlayerRow | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  async getAll(): Promise<Player[]> {
    return (this.selectAll.all() as PlayerRow[]).map((row) => this.hydrate(row));
  }

  async save(player: Player): Promise<void> {
    this.upsert.run({
      id: player.id,
      pseudo: player.pseudo,
      pk: player.pk ? 1 : 0,
      pvBase: player.pvBase,
      pvActuels: player.pvActuels,
      pmBase: player.pmBase,
      pmActuels: player.pmActuels,
      posX: player.position.x,
      posY: player.position.y,
      zone: player.position.zone,
      slotPrincipal: player.equipment.slotPrincipal,
      slotSecondaire: player.equipment.slotSecondaire,
      materials: JSON.stringify(player.materials),
      cooldowns: JSON.stringify(player.cooldownEndTimestamps),
    });
  }

  async delete(id: Player["id"]): Promise<boolean> {
    return this.deleteOne.run(id).changes > 0;
  }
}

// ---------------------------------------------------------------------------
// Couche de persistance SQLite
// ---------------------------------------------------------------------------

export class SqlitePersistence implements PersistenceLayer {
  readonly players: PlayerRepository;
  readonly weapons: WeaponRepository;
  private readonly db: Db;

  constructor(path: string = dataFile("database.db")) {
    this.db = initDatabase(path);
    this.players = new SqlitePlayerRepository(this.db);
    this.weapons = new SqliteWeaponRepository(this.db);
  }

  async flush(): Promise<void> {
    // better-sqlite3 écrit de façon synchrone à chaque requête : rien à vider.
  }

  /** Ferme la connexion (utile pour les tests / arrêt propre). */
  close(): void {
    this.db.close();
  }
}

export const createSqlitePersistence = (path?: string): SqlitePersistence =>
  new SqlitePersistence(path);
