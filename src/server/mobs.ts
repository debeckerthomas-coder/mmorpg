import { newId } from "../models/ids.js";
import type { PlayerId } from "../models/ids.js";
import type { LootDrop } from "../models/materials.js";
import type { Monster } from "../models/monsters.js";
import { type Portal, type Point2D, PortalRank } from "../models/portals.js";
import {
  ATTACK_RANGE,
  DETECTION_RADIUS,
  MONSTER_SPEED,
  distance,
  findNearestPlayer,
  stepToward,
  type PlayerPosition,
} from "./combat.js";
import { rollLootAmount, rollLootMaterial } from "./materials.js";

export type Rng = () => number;

/** Table de rang d'un portail : C 60 %, B 25 %, A 12 %, S 3 %. */
export const PORTAL_RANK_TABLE: ReadonlyArray<{
  rank: PortalRank;
  weight: number;
}> = [
  { rank: PortalRank.C, weight: 0.6 },
  { rank: PortalRank.B, weight: 0.25 },
  { rank: PortalRank.A, weight: 0.12 },
  { rank: PortalRank.S, weight: 0.03 },
];

export const rollPortalRank = (rng: Rng): PortalRank => {
  const roll = rng();
  let cumulative = 0;
  for (const entry of PORTAL_RANK_TABLE) {
    cumulative += entry.weight;
    if (roll < cumulative) return entry.rank;
  }
  return PORTAL_RANK_TABLE[PORTAL_RANK_TABLE.length - 1]!.rank;
};

/** Statistiques des monstres selon le rang du portail. */
export const RANK_STATS: Record<
  PortalRank,
  { pvMax: number; force: number; xpDonnee: number }
> = {
  [PortalRank.C]: { pvMax: 30, force: 3, xpDonnee: 25 },
  [PortalRank.B]: { pvMax: 60, force: 6, xpDonnee: 60 },
  [PortalRank.A]: { pvMax: 120, force: 12, xpDonnee: 150 },
  [PortalRank.S]: { pvMax: 250, force: 25, xpDonnee: 400 },
};

export const MONSTERS_PER_PORTAL = 3;

/** Délai minimal entre deux attaques d'un même monstre (ms). */
export const MONSTER_ATTACK_COOLDOWN_MS = 1000;

export interface MobDamageEvent {
  playerId: PlayerId;
  amount: number;
  mobId: string;
}

/**
 * Gestionnaire du bestiaire : possède les portails et les monstres, gère leur
 * apparition et fait avancer leur IA à chaque tick. Sans persistance (état
 * volatile du monde), partagé entre le `GameHub` (attaques, diffusion) et la
 * `GameLoop` (IA).
 */
export class MobManager {
  private readonly portals = new Map<string, Portal>();
  private readonly monsters = new Map<string, Monster>();
  private readonly loots = new Map<string, LootDrop>();
  /** Horloge interne (ms) pour les cooldowns d'attaque. */
  private clockMs = 0;
  private readonly lastAttackAt = new Map<string, number>();

  constructor(private readonly worldSize = 500) {}

  getPortals(): Portal[] {
    return [...this.portals.values()];
  }

  getMonsters(): Monster[] {
    return [...this.monsters.values()];
  }

  getMonster(id: string): Monster | undefined {
    return this.monsters.get(id);
  }

  // --- Loots au sol (Brique 9) ---

  getLoots(): LootDrop[] {
    return [...this.loots.values()];
  }

  getLoot(id: string): LootDrop | undefined {
    return this.loots.get(id);
  }

  /** Fait apparaître un matériau au sol (type & quantité aléatoires). */
  dropLoot(position: Point2D, rng: Rng = Math.random): LootDrop {
    const loot: LootDrop = {
      id: newId(),
      materialType: rollLootMaterial(rng),
      amount: rollLootAmount(rng),
      position: { x: position.x, y: position.y },
    };
    this.loots.set(loot.id, loot);
    return loot;
  }

  /** Retire un loot du sol (ramassé). Renvoie le loot retiré, ou undefined. */
  removeLoot(id: string): LootDrop | undefined {
    const loot = this.loots.get(id);
    if (loot) this.loots.delete(id);
    return loot;
  }

  /**
   * Fait apparaître un portail de rang aléatoire avec MONSTERS_PER_PORTAL
   * monstres répartis autour de lui.
   */
  spawnPortal(rng: Rng = Math.random): Portal {
    const rank = rollPortalRank(rng);
    const position = { x: rng() * this.worldSize, y: rng() * this.worldSize };
    const portal: Portal = { id: newId(), rank, position, open: true };
    this.portals.set(portal.id, portal);

    const stats = RANK_STATS[rank];
    for (let i = 0; i < MONSTERS_PER_PORTAL; i++) {
      const angle = (Math.PI * 2 * i) / MONSTERS_PER_PORTAL;
      const monster: Monster = {
        id: newId(),
        portalId: portal.id,
        rank,
        pvMax: stats.pvMax,
        pvActuels: stats.pvMax,
        position: {
          x: position.x + Math.cos(angle) * 2,
          y: position.y + Math.sin(angle) * 2,
        },
        force: stats.force,
        xpDonnee: stats.xpDonnee,
        cible: null,
      };
      this.monsters.set(monster.id, monster);
    }
    return portal;
  }

  /**
   * Avance l'IA des monstres d'un tick :
   *  - chaque monstre cherche le joueur le plus proche dans DETECTION_RADIUS ;
   *  - s'il est à portée d'attaque (ATTACK_RANGE), il frappe (avec cooldown) ;
   *  - sinon il se rapproche de sa cible (MONSTER_SPEED).
   *
   * Renvoie les évènements de dégâts à appliquer aux joueurs.
   */
  tick(deltaMs: number, players: readonly PlayerPosition[]): MobDamageEvent[] {
    this.clockMs += deltaMs;
    const events: MobDamageEvent[] = [];

    for (const mob of this.monsters.values()) {
      const target = findNearestPlayer(mob.position, players, DETECTION_RADIUS);
      mob.cible = target ? target.id : null;
      if (!target) continue;

      if (distance(mob.position, target.position) <= ATTACK_RANGE) {
        const last = this.lastAttackAt.get(mob.id) ?? Number.NEGATIVE_INFINITY;
        if (this.clockMs - last >= MONSTER_ATTACK_COOLDOWN_MS) {
          this.lastAttackAt.set(mob.id, this.clockMs);
          events.push({ playerId: target.id, amount: mob.force, mobId: mob.id });
        }
      } else {
        mob.position = stepToward(mob.position, target.position, MONSTER_SPEED);
      }
    }
    return events;
  }

  /**
   * Applique des dégâts à un monstre. Renvoie `{ killed, mob }`, ou `null` si
   * le monstre n'existe pas. Un monstre tué est retiré du monde.
   */
  damageMob(
    mobId: string,
    amount: number,
  ): { killed: boolean; mob: Monster } | null {
    const mob = this.monsters.get(mobId);
    if (!mob) return null;

    mob.pvActuels = Math.max(0, mob.pvActuels - amount);
    const killed = mob.pvActuels <= 0;
    if (killed) {
      this.monsters.delete(mobId);
      this.lastAttackAt.delete(mobId);
    }
    return { killed, mob };
  }
}
