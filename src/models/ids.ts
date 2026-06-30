/**
 * Identifiants typés (branded types).
 *
 * On utilise des "branded types" pour éviter qu'un PlayerId soit utilisé là où
 * un WeaponId est attendu (et inversement), tout en gardant une simple `string`
 * sérialisable au runtime — important pour la persistance JSON.
 */

declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

export type PlayerId = Brand<string, "PlayerId">;
export type WeaponId = Brand<string, "WeaponId">;
export type SpellId = Brand<string, "SpellId">;
export type AffixId = Brand<string, "AffixId">;

export const asPlayerId = (id: string): PlayerId => id as PlayerId;
export const asWeaponId = (id: string): WeaponId => id as WeaponId;
export const asSpellId = (id: string): SpellId => id as SpellId;
export const asAffixId = (id: string): AffixId => id as AffixId;

/**
 * Génère un identifiant unique simple basé sur `crypto.randomUUID`.
 * Centralisé ici pour pouvoir le remplacer (ex: ULID/snowflake) sans toucher
 * au reste du code.
 */
import { randomUUID } from "node:crypto";

export const newId = (): string => randomUUID();
