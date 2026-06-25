import type { PlayerId } from "./ids.js";
import type { Point2D, PortalRank } from "./portals.js";

/**
 * Monstre (Brique 6). Entité mobile hostile issue d'un portail.
 *
 * `cible` mémorise le joueur actuellement traqué par l'IA (null si aucun
 * joueur n'est à portée de détection).
 */
export interface Monster {
  id: string;
  /** Portail d'origine. */
  portalId: string;
  rank: PortalRank;
  pvMax: number;
  pvActuels: number;
  position: Point2D;
  /** Puissance d'attaque (dégâts infligés au joueur). */
  force: number;
  /** XP accordée à l'arme du tueur. */
  xpDonnee: number;
  cible: PlayerId | null;
}
