import type { Point2D } from "./portals.js";

/**
 * Matériaux & Infusion d'arme (Brique 9 — Artisanat & Catalyseurs).
 *
 * Les monstres lâchent des matériaux au sol (`LootDrop`). Ramassés, ils
 * alimentent l'inventaire du joueur (`Player.materials`) puis servent à
 * « infuser » l'arme équipée (jets d'affixes/sorts de la Brique 2).
 */

export enum MaterialType {
  GriffeChauveSouris = "GRIFFE_CHAUVE_SOURIS",
  CaillouBrillant = "CAILLOU_BRILLANT",
}

/** Garde de type : `v` est-il une valeur valide de `MaterialType` ? */
export const isMaterialType = (v: string): v is MaterialType =>
  (Object.values(MaterialType) as string[]).includes(v);

/** Matériau lâché au sol par un monstre mort, ramassable par un joueur. */
export interface LootDrop {
  id: string;
  materialType: MaterialType;
  amount: number;
  position: Point2D;
}
