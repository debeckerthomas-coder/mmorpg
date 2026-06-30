/**
 * Déplacement prédictif côté client (Brique 7).
 *
 * Copie **identique** de la logique autoritaire du serveur
 * (`src/server/movement.ts`) : c'est la condition pour que la prédiction locale
 * et le rejeu (réconciliation) reproduisent exactement la position calculée par
 * le serveur. Toute modification doit être répercutée des deux côtés.
 */

export const PLAYER_SPEED = 120;
export const MAX_INPUT_DELTA_MS = 250;
export const WORLD_SIZE = 500;

const EPSILON = 1e-6;

export interface Point {
  x: number;
  y: number;
}

export interface MoveInput {
  sequenceNumber: number;
  dirX: number;
  dirY: number;
  deltaMs: number;
}

export const clampDelta = (ms: number): number =>
  Math.max(0, Math.min(MAX_INPUT_DELTA_MS, ms));

export const clampToWorld = (p: Point, size = WORLD_SIZE): Point => ({
  x: Math.max(0, Math.min(size, p.x)),
  y: Math.max(0, Math.min(size, p.y)),
});

/** Applique un input de déplacement et renvoie la nouvelle position. */
export const applyMove = (
  pos: Point,
  input: MoveInput,
  speed = PLAYER_SPEED,
): Point => {
  const dt = clampDelta(input.deltaMs) / 1000;
  const magnitude = Math.hypot(input.dirX, input.dirY);
  if (magnitude < EPSILON || dt === 0) return { x: pos.x, y: pos.y };

  const nx = input.dirX / magnitude;
  const ny = input.dirY / magnitude;
  const distance = speed * dt;
  return clampToWorld({ x: pos.x + nx * distance, y: pos.y + ny * distance });
};
