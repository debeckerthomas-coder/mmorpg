import {
  asAffixId,
  asSpellId,
  newId,
} from "./ids.js";
import {
  type Affix,
  type GeneratedSpell,
  type RawStats,
  Rarity,
  type Weapon,
  WeaponType,
} from "./weapon.js";

/**
 * Weapon Evolution Engine (Brique 2).
 *
 * Gère le gain d'XP, la montée de niveau d'une arme, la croissance de ses
 * statistiques brutes selon son Type, et la génération aléatoire de
 * récompenses (affixes passifs ou sorts actifs) à chaque niveau gagné.
 *
 * Toute l'aléatoire passe par une fonction `rng: () => number` injectable
 * (par défaut `Math.random`) afin de rendre le moteur entièrement
 * déterministe et testable.
 */

// ---------------------------------------------------------------------------
// Source d'aléatoire injectable
// ---------------------------------------------------------------------------

/** Fonction renvoyant un flottant dans [0, 1). */
export type Rng = () => number;

const pick = <T>(items: readonly T[], rng: Rng): T => {
  // items est toujours non vide dans nos catalogues (garanti par construction).
  const index = Math.min(items.length - 1, Math.floor(rng() * items.length));
  return items[index] as T;
};

// ---------------------------------------------------------------------------
// Courbe d'XP
// ---------------------------------------------------------------------------

/**
 * XP nécessaire pour passer de `level` à `level + 1`.
 * Courbe géométrique : 100 × 1.5^(level-1), arrondie à l'entier inférieur.
 * Au niveau 1 → 100, ce qui correspond au `nextLevelXp` par défaut des armes
 * créées en Brique 1 (cf. factory.ts).
 */
export const xpForLevel = (level: number): number =>
  Math.floor(100 * Math.pow(1.5, level - 1));

// ---------------------------------------------------------------------------
// Croissance des statistiques brutes selon le Type d'arme
// ---------------------------------------------------------------------------

/**
 * Incréments de statistiques brutes appliqués à CHAQUE niveau gagné, selon le
 * Type d'arme. Reflète l'identité de chaque archétype :
 *  - Épée    → orientée Force (dégâts physiques de mêlée)
 *  - Arc     → orientée Agilité (dégâts à distance, vitesse)
 *  - Bâton   → orienté soutien/magie (PV bonus + un peu d'agilité)
 *  - Bouclier→ orienté tank (gros PV bonus)
 */
export const STAT_GROWTH: Record<WeaponType, Partial<RawStats>> = {
  [WeaponType.Epee]: { force: 3, pvBonus: 1 },
  [WeaponType.Arc]: { agilite: 3, force: 1 },
  [WeaponType.Baton]: { pvBonus: 5, agilite: 1 },
  [WeaponType.Bouclier]: { pvBonus: 8 },
};

const applyStatGrowth = (weapon: Weapon): Partial<RawStats> => {
  const growth = STAT_GROWTH[weapon.type];
  for (const [key, value] of Object.entries(growth)) {
    weapon.rawStats[key] = (weapon.rawStats[key] ?? 0) + (value ?? 0);
  }
  return growth;
};

// ---------------------------------------------------------------------------
// Table de probabilités de rareté
// ---------------------------------------------------------------------------

/**
 * Table de rareté du jet de récompense à chaque niveau.
 * Probabilités cumulées (ordre croissant de rareté) :
 *   Commun 60% | Rare 25% | Épique 12% | Légendaire 3%.
 *
 * NB : la rareté `Magique` de l'énumération de la Brique 1 n'est pas tirée par
 * ce générateur (réservée à de futurs systèmes de loot, ex: drops de monstres).
 */
export const RARITY_TABLE: ReadonlyArray<{ rarity: Rarity; weight: number }> = [
  { rarity: Rarity.Commun, weight: 0.6 },
  { rarity: Rarity.Rare, weight: 0.25 },
  { rarity: Rarity.Epique, weight: 0.12 },
  { rarity: Rarity.Legendaire, weight: 0.03 },
];

export const rollRarity = (rng: Rng): Rarity => {
  const roll = rng();
  let cumulative = 0;
  for (const entry of RARITY_TABLE) {
    cumulative += entry.weight;
    if (roll < cumulative) return entry.rarity;
  }
  // Garde-fou en cas d'arrondi flottant : on retombe sur la dernière entrée.
  return RARITY_TABLE[RARITY_TABLE.length - 1]!.rarity;
};

/** Multiplicateur de puissance d'un affixe selon sa rareté. */
export const RARITY_POWER: Record<Rarity, number> = {
  [Rarity.Commun]: 5,
  [Rarity.Magique]: 8,
  [Rarity.Rare]: 12,
  [Rarity.Epique]: 25,
  [Rarity.Legendaire]: 50,
};

// ---------------------------------------------------------------------------
// Catalogues d'affixes et de sorts par Type d'arme
// ---------------------------------------------------------------------------

interface AffixTemplate {
  code: string;
  label: string;
}

interface SpellTemplate {
  name: string;
  cost: number;
  cooldownMs: number;
}

interface WeaponCatalog {
  /** Probabilité que la récompense soit un Sort (sinon, un Affixe). */
  spellChance: number;
  affixes: readonly AffixTemplate[];
  spells: readonly SpellTemplate[];
}

export const WEAPON_CATALOG: Record<WeaponType, WeaponCatalog> = {
  [WeaponType.Epee]: {
    spellChance: 0.4,
    affixes: [
      { code: "CRIT_CHANCE", label: "+% Critique" },
      { code: "ARMOR_PEN", label: "+% Pénétration d'armure" },
      { code: "LIFESTEAL", label: "Vol de vie" },
    ],
    spells: [
      { name: "Coup tranchant", cost: 10, cooldownMs: 1500 },
      { name: "Frappe tournoyante", cost: 20, cooldownMs: 4000 },
    ],
  },
  [WeaponType.Arc]: {
    spellChance: 0.5,
    affixes: [
      { code: "CRIT_CHANCE", label: "+% Critique" },
      { code: "ATTACK_SPEED", label: "+% Vitesse d'attaque" },
      { code: "PIERCE", label: "+% Perforation" },
    ],
    spells: [
      { name: "Flèche de Feu", cost: 15, cooldownMs: 3000 },
      { name: "Pluie de flèches", cost: 25, cooldownMs: 6000 },
    ],
  },
  [WeaponType.Baton]: {
    spellChance: 0.6,
    affixes: [
      { code: "SPELL_POWER", label: "+% Puissance des sorts" },
      { code: "MANA_REGEN", label: "Régénération de mana" },
      { code: "COOLDOWN", label: "-% Temps de recharge" },
    ],
    spells: [
      { name: "Boule de feu", cost: 20, cooldownMs: 3500 },
      { name: "Éclair", cost: 30, cooldownMs: 5000 },
    ],
  },
  [WeaponType.Bouclier]: {
    spellChance: 0.5,
    affixes: [
      { code: "BLOCK_CHANCE", label: "+% Blocage" },
      { code: "THORNS", label: "Épines (renvoi de dégâts)" },
      { code: "HP_REGEN", label: "Régénération de PV" },
    ],
    spells: [
      { name: "Coup de Bouclier", cost: 12, cooldownMs: 2500 },
      { name: "Provocation", cost: 18, cooldownMs: 8000 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Récompenses & résultat d'évolution
// ---------------------------------------------------------------------------

export type EvolutionReward =
  | { kind: "affix"; level: number; rarity: Rarity; affix: Affix }
  | { kind: "spell"; level: number; rarity: Rarity; spell: GeneratedSpell };

export interface EvolutionResult {
  /** L'arme mutée (même référence que celle passée en argument). */
  weapon: Weapon;
  /** true si au moins un niveau a été gagné. */
  leveledUp: boolean;
  /** Nombre de niveaux gagnés sur cet appel. */
  levelsGained: number;
  /** Niveau de l'arme après application. */
  newLevel: number;
  /** Récompenses générées (une par niveau gagné). */
  rewards: EvolutionReward[];
}

const generateAffix = (rarity: Rarity, tpl: AffixTemplate): Affix => ({
  id: asAffixId(newId()),
  code: tpl.code,
  label: tpl.label,
  rarity,
  power: RARITY_POWER[rarity],
});

const generateSpell = (
  type: WeaponType,
  level: number,
  tpl: SpellTemplate,
): GeneratedSpell => ({
  id: asSpellId(newId()),
  name: tpl.name,
  requiredType: type,
  unlockLevel: level,
  cost: tpl.cost,
  cooldownMs: tpl.cooldownMs,
});

/**
 * Génère et attache à l'arme une récompense (affixe ou sort) pour le niveau
 * `level` atteint, en fonction de la rareté tirée et du catalogue du Type.
 *
 * Ordre des tirages `rng` (important pour les tests déterministes) :
 *   1. rollRarity         → choix de la rareté
 *   2. affixe vs sort     → comparé à `spellChance`
 *   3. choix dans le pool  → index de l'élément
 */
const generateReward = (
  weapon: Weapon,
  level: number,
  rng: Rng,
): EvolutionReward => {
  const rarity = rollRarity(rng);
  const catalog = WEAPON_CATALOG[weapon.type];

  const wantSpell = rng() < catalog.spellChance;

  if (wantSpell && catalog.spells.length > 0) {
    const spell = generateSpell(weapon.type, level, pick(catalog.spells, rng));
    weapon.generatedSpells.push(spell);
    return { kind: "spell", level, rarity, spell };
  }

  const affix = generateAffix(rarity, pick(catalog.affixes, rng));
  weapon.affixes.push(affix);
  return { kind: "affix", level, rarity, affix };
};

/**
 * Tire un affixe aléatoire pour une arme (rareté + pioche dans son catalogue).
 * Réutilisé hors level-up, par exemple par l'infusion (Brique 9). N'attache
 * PAS l'affixe : l'appelant décide.
 */
export const rollAffix = (weapon: Weapon, rng: Rng = Math.random): Affix => {
  const rarity = rollRarity(rng);
  return generateAffix(rarity, pick(WEAPON_CATALOG[weapon.type].affixes, rng));
};

/**
 * Tire un sort aléatoire pour une arme (selon son type, débloqué à son niveau
 * courant). Réutilisé par l'infusion (Brique 9). N'attache PAS le sort.
 */
export const rollSpell = (
  weapon: Weapon,
  rng: Rng = Math.random,
): GeneratedSpell =>
  generateSpell(
    weapon.type,
    weapon.progression.level,
    pick(WEAPON_CATALOG[weapon.type].spells, rng),
  );

// ---------------------------------------------------------------------------
// Point d'entrée : gainXp
// ---------------------------------------------------------------------------

/**
 * Ajoute `amount` d'XP à une arme et applique toutes les montées de niveau
 * déclenchées (gestion des niveaux multiples si l'XP est suffisante).
 *
 * MUTE l'arme passée en argument (pratique côté serveur autoritaire qui
 * persiste l'entité ensuite) et renvoie un `EvolutionResult` décrivant ce qui
 * s'est passé.
 *
 * À chaque niveau gagné :
 *   - les statistiques brutes croissent selon le Type (STAT_GROWTH) ;
 *   - une récompense aléatoire (affixe OU sort) est générée et attachée.
 */
export const gainXp = (
  weapon: Weapon,
  amount: number,
  rng: Rng = Math.random,
): EvolutionResult => {
  if (amount < 0) {
    throw new RangeError(`gainXp: 'amount' doit être >= 0 (reçu ${amount})`);
  }

  const rewards: EvolutionReward[] = [];
  let levelsGained = 0;

  weapon.progression.currentXp += amount;

  // Boucle tant que l'XP courante franchit le seuil du niveau suivant.
  while (weapon.progression.currentXp >= weapon.progression.nextLevelXp) {
    weapon.progression.currentXp -= weapon.progression.nextLevelXp;
    weapon.progression.level += 1;
    levelsGained += 1;

    applyStatGrowth(weapon);
    rewards.push(generateReward(weapon, weapon.progression.level, rng));

    // Seuil du prochain palier.
    weapon.progression.nextLevelXp = xpForLevel(weapon.progression.level);
  }

  return {
    weapon,
    leveledUp: levelsGained > 0,
    levelsGained,
    newLevel: weapon.progression.level,
    rewards,
  };
};
