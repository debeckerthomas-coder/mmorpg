import type { PlayerId } from "../models/ids.js";
import type { Point2D } from "../models/portals.js";
import type { AggregatedStats } from "../models/stats.js";
import { WeaponType } from "../models/weapon.js";

/**
 * Logique de combat & d'IA (Brique 6) — fonctions PURES, sans état ni I/O,
 * donc directement testables (cf. combat.test.ts).
 *
 * Les distances sont exprimées en « cases » (1 unité de monde = 1 case).
 */

/** Rayon de détection des joueurs par les monstres (en cases). */
export const DETECTION_RADIUS = 5;

/** Distance à laquelle un monstre peut frapper le joueur (en cases). */
export const ATTACK_RANGE = 1;

/** Déplacement d'un monstre vers sa cible par tick (en cases). */
export const MONSTER_SPEED = 0.5;

/** Dégâts de base d'une attaque joueur, avant ajout de la stat d'arme. */
export const ATTACK_BASE_DAMAGE = 5;

export const distance = (a: Point2D, b: Point2D): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** Armes de mêlée (portée 1) vs armes à distance (portée 5). */
export const isMelee = (type: WeaponType): boolean =>
  type === WeaponType.Epee || type === WeaponType.Bouclier;

/** Portée d'une arme selon son type : Épée/Bouclier = 1, Arc/Bâton = 5. */
export const weaponRange = (type: WeaponType): number =>
  isMelee(type) ? 1 : 5;

/**
 * Dégâts infligés par le joueur à un monstre, selon le type d'arme et les
 * statistiques agrégées : Force pour les armes de mêlée (Épée/Bouclier),
 * Agilité pour les armes à distance (Arc/Bâton).
 */
export const computePlayerDamage = (
  type: WeaponType,
  stats: AggregatedStats,
): number => {
  const stat = isMelee(type) ? stats.rawStats.force : stats.rawStats.agilite;
  return ATTACK_BASE_DAMAGE + (stat ?? 0);
};

/**
 * Calcule la nouvelle position d'un point se déplaçant de `speed` cases vers
 * une cible. Ne dépasse jamais la cible.
 */
export const stepToward = (
  from: Point2D,
  to: Point2D,
  speed: number,
): Point2D => {
  const d = distance(from, to);
  if (d === 0 || d <= speed) return { x: to.x, y: to.y };
  const k = speed / d;
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
};

export interface PlayerPosition {
  id: PlayerId;
  position: Point2D;
}

/**
 * Trouve le joueur le plus proche d'une origine dans un rayon donné.
 * Renvoie `null` si aucun joueur n'est à portée.
 */
export const findNearestPlayer = (
  origin: Point2D,
  players: readonly PlayerPosition[],
  radius: number,
): PlayerPosition | null => {
  let best: PlayerPosition | null = null;
  let bestDistance = Infinity;
  for (const player of players) {
    const d = distance(origin, player.position);
    if (d <= radius && d < bestDistance) {
      bestDistance = d;
      best = player;
    }
  }
  return best;
};
