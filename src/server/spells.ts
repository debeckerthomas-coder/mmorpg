import type { Monster } from "../models/monsters.js";
import type { Player } from "../models/player.js";
import type { AggregatedStats } from "../models/stats.js";
import type { GeneratedSpell, Weapon, WeaponType } from "../models/weapon.js";
import { distance, isMelee } from "./combat.js";

/**
 * Système de magie (Brique 10) — sorts actifs, PM & cooldowns.
 *
 * Pour ce jalon, tous les sorts lançables sont des **AoE autour du joueur** :
 * ils infligent `stat × SPELL_DAMAGE_MULTIPLIER` à tous les monstres dans un
 * rayon de `SPELL_AOE_RADIUS` cases (Force pour les armes de mêlée, Agilité
 * pour les armes à distance). Le coût en PM et le cooldown proviennent du sort
 * lui-même (`GeneratedSpell.cost` / `cooldownMs`).
 */

/** Rayon (en cases) de l'effet de zone autour du lanceur. */
export const SPELL_AOE_RADIUS = 2;

/** Multiplicateur de dégâts du sort appliqué à la stat d'arme. */
export const SPELL_DAMAGE_MULTIPLIER = 3;

/** Régénération passive des PM (fraction du PM max par seconde). */
export const DEFAULT_PM_REGEN_PER_SECOND = 0.02;

export type SpellErrorCode =
  | "SPELL_NOT_USABLE"
  | "NOT_ENOUGH_MANA"
  | "SPELL_ON_COOLDOWN";

export type CastSpellResult =
  | { ok: false; code: SpellErrorCode; reason: string }
  | { ok: true; damage: number; targets: Monster[] };

/** Dégâts d'un sort : stat principale de l'arme × multiplicateur. */
export const computeSpellDamage = (
  weaponType: WeaponType,
  stats: AggregatedStats,
): number => {
  const stat = isMelee(weaponType)
    ? stats.rawStats.force
    : stats.rawStats.agilite;
  return (stat ?? 0) * SPELL_DAMAGE_MULTIPLIER;
};

/** Un sort est-il sous cooldown pour ce joueur à l'instant `now` ? */
export const isSpellOnCooldown = (
  player: Player,
  spellId: string,
  now: number,
): boolean => now < (player.cooldownEndTimestamps[spellId] ?? 0);

/**
 * Tente de lancer un sort. Valide l'éligibilité (sort débloqué par l'arme,
 * niveau d'arme suffisant, PM suffisants, hors cooldown). En cas de succès :
 *  - consomme le coût en PM,
 *  - applique le cooldown,
 *  - renvoie les monstres touchés (AoE) et les dégâts à appliquer.
 *
 * MUTE `player` (PM + cooldown). N'applique PAS les dégâts aux monstres :
 * l'appelant le fait (pour gérer morts + XP). Ne mute rien en cas d'échec.
 */
export const castSpell = (
  player: Player,
  weapon: Weapon,
  spell: GeneratedSpell,
  stats: AggregatedStats,
  monsters: readonly Monster[],
  now: number,
): CastSpellResult => {
  // Le sort doit appartenir à l'arme équipée et être débloqué par son niveau.
  const owned = weapon.generatedSpells.some((s) => s.id === spell.id);
  if (!owned || weapon.progression.level < spell.unlockLevel) {
    return {
      ok: false,
      code: "SPELL_NOT_USABLE",
      reason: "Sort indisponible sur l'arme équipée",
    };
  }

  if (player.pmActuels < spell.cost) {
    return {
      ok: false,
      code: "NOT_ENOUGH_MANA",
      reason: `PM insuffisants (${player.pmActuels}/${spell.cost})`,
    };
  }

  if (isSpellOnCooldown(player, spell.id, now)) {
    const remaining = Math.ceil(
      ((player.cooldownEndTimestamps[spell.id] ?? 0) - now) / 1000,
    );
    return {
      ok: false,
      code: "SPELL_ON_COOLDOWN",
      reason: `Sort en recharge (${remaining}s)`,
    };
  }

  // Succès : on consomme PM et on arme le cooldown.
  player.pmActuels -= spell.cost;
  player.cooldownEndTimestamps[spell.id] = now + spell.cooldownMs;

  const damage = computeSpellDamage(weapon.type, stats);
  const targets = monsters.filter(
    (m) => distance(player.position, m.position) <= SPELL_AOE_RADIUS,
  );
  return { ok: true, damage, targets };
};
