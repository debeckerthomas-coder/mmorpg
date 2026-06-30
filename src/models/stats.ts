import type { Player } from "./player.js";
import {
  type Affix,
  type GeneratedSpell,
  type RawStats,
  type Weapon,
  emptyRawStats,
} from "./weapon.js";

/**
 * Résultat de l'agrégation des bonus d'équipement sur un joueur.
 *
 * Encode la règle d'agrégation centrale du jeu :
 *   - Stats brutes : cumul du Slot_Principal + Slot_Secondaire.
 *   - Affixes actifs : Slot_Principal uniquement.
 *   - Sorts utilisables : Slot_Principal uniquement.
 */
export interface AggregatedStats {
  /** Stats brutes totales (base joueur implicite = 0 ici, voir pvMax). */
  rawStats: RawStats;
  /** PV maximum = pvBase + pvBonus cumulé. */
  pvMax: number;
  /** PM maximum = pmBase + pmBonus cumulé (Brique 10). */
  pmMax: number;
  /** Affixes actifs (issus du slot principal seulement). */
  activeAffixes: Affix[];
  /** Sorts utilisables (slot principal + débloqués par le niveau). */
  usableSpells: GeneratedSpell[];
}

const addRawStats = (target: RawStats, source: RawStats): void => {
  for (const key of Object.keys(source)) {
    target[key] = (target[key] ?? 0) + (source[key] ?? 0);
  }
};

/**
 * Calcule les statistiques effectives d'un joueur en fonction de son
 * équipement.
 *
 * `resolveWeapon` permet de résoudre un WeaponId vers l'entité Weapon
 * (les armes étant stockées séparément). Retourne `undefined` si l'arme
 * est introuvable — le slot est alors simplement ignoré.
 */
export const computeAggregatedStats = (
  player: Player,
  resolveWeapon: (id: string) => Weapon | undefined,
): AggregatedStats => {
  const rawStats = emptyRawStats();
  const activeAffixes: Affix[] = [];
  const usableSpells: GeneratedSpell[] = [];

  const { slotPrincipal, slotSecondaire } = player.equipment;

  const principal = slotPrincipal ? resolveWeapon(slotPrincipal) : undefined;
  const secondaire = slotSecondaire ? resolveWeapon(slotSecondaire) : undefined;

  // Stats brutes : cumul des deux slots.
  if (principal) addRawStats(rawStats, principal.rawStats);
  if (secondaire) addRawStats(rawStats, secondaire.rawStats);

  // Affixes + sorts : Slot_Principal uniquement.
  if (principal) {
    activeAffixes.push(...principal.affixes);
    for (const spell of principal.generatedSpells) {
      // Le sort doit être débloqué par le niveau de l'arme, et son type
      // doit correspondre à celui de l'arme équipée.
      if (
        spell.requiredType === principal.type &&
        principal.progression.level >= spell.unlockLevel
      ) {
        usableSpells.push(spell);
      }
    }
  }

  const pvMax = player.pvBase + (rawStats.pvBonus ?? 0);
  const pmMax = player.pmBase + (rawStats.pmBonus ?? 0);

  return { rawStats, pvMax, pmMax, activeAffixes, usableSpells };
};
