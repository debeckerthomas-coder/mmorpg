import type { PlayerId, WeaponId } from "./ids.js";

/**
 * Position du joueur dans le monde : coordonnées dans une zone donnée.
 */
export interface Position {
  x: number;
  y: number;
  /** Identifiant logique de la zone/map. */
  zone: string;
}

/**
 * Équipement du joueur. Les slots référencent des armes par leur ID
 * (les armes sont persistées séparément, cf. WeaponRepository).
 *
 * - Slot_Principal : stats brutes + affixes + sorts actifs.
 * - Slot_Secondaire : stats brutes uniquement (affixes/sorts ignorés).
 *
 * `null` = slot vide.
 */
export interface Equipment {
  slotPrincipal: WeaponId | null;
  slotSecondaire: WeaponId | null;
}

export const emptyEquipment = (): Equipment => ({
  slotPrincipal: null,
  slotSecondaire: null,
});

/**
 * Joueur — entité persistée.
 *
 * `pvBase` est le socle de points de vie, augmenté par les bonus d'armes
 * agrégés (cf. computeAggregatedStats). `pvActuels` est l'état runtime courant
 * (dégâts/soins) et doit rester <= pvMax effectif.
 */
export interface Player {
  id: PlayerId;
  pseudo: string;
  /** Statut PvP : true si le joueur est flaggé Player-Killer. */
  pk: boolean;
  pvBase: number;
  pvActuels: number;
  /** Points de Mana (Brique 10) : socle et valeur courante. */
  pmBase: number;
  pmActuels: number;
  position: Position;
  equipment: Equipment;
  /**
   * Inventaire de matériaux (Brique 9) : quantité possédée par type de
   * matériau (clé = `MaterialType`). Vide par défaut.
   */
  materials: Record<string, number>;
  /**
   * Cooldowns actifs des sorts (Brique 10) : pour chaque `spellId`, le
   * timestamp (ms epoch) auquel le sort redevient lançable.
   */
  cooldownEndTimestamps: Record<string, number>;
}
