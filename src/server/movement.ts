import type { Point2D } from "../models/portals.js";

/**
 * Déplacement fluide basé sur le temps (prédiction & réconciliation).
 *
 * Logique PURE et déterministe, partagée conceptuellement avec le client
 * (`src/client/movement.ts` en applique une copie identique) : le client prédit
 * localement le résultat de ses inputs, le serveur recalcule la position
 * autoritaire avec la même formule, et le client réconcilie.
 */

/** Vitesse maximale du joueur, en cases par seconde. */
export const PLAYER_SPEED = 120;

/** Borne du delta-time d'un input (anti-triche : pas de « gros pas »). */
export const MAX_INPUT_DELTA_MS = 250;

/** Taille de la zone (les positions sont bornées à [0, WORLD_SIZE]). */
export const WORLD_SIZE = 500;

const EPSILON = 1e-6;

/** Un input de déplacement émis par le client. */
export interface MoveInput {
  /** Numéro de séquence unique et croissant (pour la réconciliation). */
  sequenceNumber: number;
  /** Vecteur de direction (non normalisé : le serveur le normalise). */
  dirX: number;
  dirY: number;
  /** Durée d'application de l'input (delta-time en ms). */
  deltaMs: number;
}

/** Borne le delta-time pour empêcher une téléportation via un Δt énorme. */
export const clampDelta = (ms: number): number =>
  Math.max(0, Math.min(MAX_INPUT_DELTA_MS, ms));

/** Distance maximale autorisée pour un Δt donné : MaxDistance = Vitesse × Δt. */
export const maxDistanceFor = (
  deltaMs: number,
  speed = PLAYER_SPEED,
): number => speed * (clampDelta(deltaMs) / 1000);

/** Borne une position dans les limites du monde. */
export const clampToWorld = (p: Point2D, size = WORLD_SIZE): Point2D => ({
  x: Math.max(0, Math.min(size, p.x)),
  y: Math.max(0, Math.min(size, p.y)),
});

/**
 * Applique un input de déplacement à une position et renvoie la nouvelle
 * position **autoritaire**.
 *
 * Le serveur **normalise** la direction et **borne** le delta-time : un client
 * ne peut donc jamais dépasser `PLAYER_SPEED`, quelle que soit l'amplitude du
 * vecteur ou du Δt qu'il envoie (triche neutralisée par construction).
 */
export const applyMove = (
  pos: Point2D,
  input: MoveInput,
  speed = PLAYER_SPEED,
): Point2D => {
  const dt = clampDelta(input.deltaMs) / 1000;
  const magnitude = Math.hypot(input.dirX, input.dirY);
  if (magnitude < EPSILON || dt === 0) return { x: pos.x, y: pos.y };

  const nx = input.dirX / magnitude;
  const ny = input.dirY / magnitude;
  const distance = speed * dt;
  return clampToWorld({ x: pos.x + nx * distance, y: pos.y + ny * distance });
};

/**
 * Règle de validation autoritaire : un déplacement de `from` vers `to` est-il
 * réalisable en `deltaMs` à la vitesse maximale ? Renvoie `false` pour une
 * téléportation ou une vitesse excessive.
 */
export const isMoveWithinLimit = (
  from: Point2D,
  to: Point2D,
  deltaMs: number,
  speed = PLAYER_SPEED,
): boolean => {
  const moved = Math.hypot(to.x - from.x, to.y - from.y);
  return moved <= maxDistanceFor(deltaMs, speed) + EPSILON;
};
