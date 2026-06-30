import type { AffixId, SpellId, WeaponId } from "./ids.js";

/**
 * Types d'armes disponibles. Le Type conditionne les sorts générés.
 */
export enum WeaponType {
  Epee = "EPEE",
  Arc = "ARC",
  Baton = "BATON",
  Bouclier = "BOUCLIER",
}

/**
 * Rareté d'un affixe. Sert d'échelle de puissance qualitative.
 */
export enum Rarity {
  Commun = "COMMUN",
  Magique = "MAGIQUE",
  Rare = "RARE",
  Epique = "EPIQUE",
  Legendaire = "LEGENDAIRE",
}

/**
 * Statistiques brutes apportées par une arme.
 *
 * Ces stats se CUMULENT sur le joueur, que l'arme soit en slot principal ou
 * secondaire (cf. règle d'agrégation dans ARCHITECTURE.md).
 *
 * Le champ est volontairement ouvert (`[key: string]: number`) pour permettre
 * l'ajout de nouvelles stats brutes ("etc." de la spec) sans rupture de schéma,
 * tout en garantissant la présence des stats de base.
 */
export interface RawStats {
  force: number;
  agilite: number;
  pvBonus: number;
  [key: string]: number;
}

export const emptyRawStats = (): RawStats => ({
  force: 0,
  agilite: 0,
  pvBonus: 0,
});

/**
 * Affixe : effet passif aléatoire porté par l'arme.
 *
 * IMPORTANT (règle d'agrégation) : un affixe n'est ACTIF que si l'arme est
 * équipée dans le Slot_Principal. En slot secondaire, il est ignoré.
 */
export interface Affix {
  id: AffixId;
  /** Code machine de l'effet, ex: "VOL_DE_VIE", "REGEN_PV". */
  code: string;
  /** Libellé lisible. */
  label: string;
  rarity: Rarity;
  /** Puissance numérique de l'effet (interprétée selon `code`). */
  power: number;
}

/**
 * Sort généré : compétence active débloquée via l'arme.
 *
 * Dépend du Type de l'arme (`requiredType`) et n'est UTILISABLE que si l'arme
 * est équipée dans le Slot_Principal.
 */
export interface GeneratedSpell {
  id: SpellId;
  name: string;
  /** Type d'arme qui débloque ce sort. */
  requiredType: WeaponType;
  /** Niveau d'arme minimal pour que le sort soit débloqué. */
  unlockLevel: number;
  /** Coût (mana/énergie) — modèle de coût affiné plus tard. */
  cost: number;
  cooldownMs: number;
}

/**
 * Courbe d'expérience d'une arme.
 */
export interface WeaponProgression {
  level: number;
  /** XP accumulée dans le niveau courant. */
  currentXp: number;
  /** XP nécessaire pour passer au niveau suivant. */
  nextLevelXp: number;
}

/**
 * Arme — entité persistée indépendamment du joueur (référencée par WeaponId).
 */
export interface Weapon {
  id: WeaponId;
  name: string;
  type: WeaponType;
  progression: WeaponProgression;
  /** Stats brutes — cumulées sur le joueur quel que soit le slot. */
  rawStats: RawStats;
  /** Affixes — actifs uniquement en Slot_Principal. */
  affixes: Affix[];
  /** Sorts — utilisables uniquement en Slot_Principal. */
  generatedSpells: GeneratedSpell[];
}
