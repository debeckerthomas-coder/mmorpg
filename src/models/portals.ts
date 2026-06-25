/**
 * Portails (Brique 6 — Solo Leveling System).
 *
 * Un portail est une faille qui s'ouvre dans le monde et fait apparaître des
 * monstres. Son rang détermine la dangerosité (et les récompenses) des mobs.
 */

/** Rang d'un portail, du plus faible (C) au plus dangereux (S). */
export enum PortalRank {
  C = "C",
  B = "B",
  A = "A",
  S = "S",
}

/** Point 2D simple (les portails/mobs vivent dans le plan de la zone). */
export interface Point2D {
  x: number;
  y: number;
}

export interface Portal {
  id: string;
  rank: PortalRank;
  position: Point2D;
  /** true tant que le portail est actif (des monstres peuvent en sortir). */
  open: boolean;
}
